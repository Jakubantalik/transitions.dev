// Refine relay — local server behind the timeline panel's Refine button.
//
// It does two jobs:
//   1. Serves the injectable timeline at GET /inject.js, so any page can show
//      the panel with a single <script> tag (no npm install — see bin/cli.mjs).
//   2. Brokers refine jobs between the browser and whoever answers them.
//
//   Browser ──POST /jobs──►  relay  ──►  answer  ──►  Browser ──GET /jobs/:id──►
//
// Who answers a job (chosen per request via the panel's LLM / Deterministic tabs):
//   • Deterministic → answered in-process by snapping each value to the nearest
//     transitions.dev motion token (zero-config, not usage-aware).
//   • LLM → answered by a real agent. Two ways to provide one:
//       a) A polling agent in your editor: run `/refine live` in Cursor/Codex.
//          It long-polls GET /jobs/next, reasons with the transitions-dev skill,
//          and POSTs the result back. This is the default, install-free path.
//       b) A headless CLI: start the relay with REFINE_AGENT_CMD set and the
//          relay spawns it once per job (stdin = prompt, stdout = JSON).
//          e.g.  REFINE_AGENT_CMD='cursor-agent -p --trust --force' npm run relay
//          (for cursor-agent the relay auto-appends any missing -p/--trust/--force
//          so headless jobs don't fail the workspace-trust prompt.)
//
// Run: node server/relay.mjs   (or: npm run relay)

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { refineTimings, DURATION_TOKENS, SCALE_TOKENS, BLUR_TOKENS, DISTANCE_TOKENS, SMOOTH_OUT } from "./motion-tokens.mjs";
import { buildInjectModule } from "./inject.mjs";
import { resolveAgentCmd } from "./agent-resolve.mjs";
import { groupDeterministic } from "./group-deterministic.mjs";

const PORT = Number(process.env.REFINE_RELAY_PORT) || 7331;
// Bind to loopback by default. The relay is a local dev daemon that spawns the
// user's coding agent, so it should not be reachable from other machines on the
// network. Set REFINE_RELAY_HOST to override (e.g. "0.0.0.0") if you knowingly
// need to reach it from another device.
const HOST = process.env.REFINE_RELAY_HOST || "127.0.0.1";
const AUTO = process.env.REFINE_AUTO !== "0";
// Own package version, surfaced on /health so you can verify which relay build is
// actually running (npx caches — a stale relay is the usual "fix didn't work").
let PKG_VERSION = "0.0.0";
try {
  PKG_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version || PKG_VERSION;
} catch {}

// Self-healing agent wiring. Instead of freezing the agent at boot — which left
// the relay stuck in /refine-live poller mode for its whole life if the CLI
// wasn't runnable at that one instant (not logged in yet, not on PATH, a startup
// race) — we re-resolve via the shared resolver on a short TTL. The moment an
// agent CLI becomes available, the relay wires it; if one disappears, it unwires.
// An explicit REFINE_AGENT_CMD still wins and is effectively pinned (the resolver
// short-circuits on it). REFINE_AGENT carries a forced --agent choice from the CLI.
const FORCE_AGENT = process.env.REFINE_AGENT || null;
const AGENT_RECHECK_MS = Number(process.env.REFINE_AGENT_RECHECK_MS) || 5000;
let _agent = { at: 0, cmd: null, source: null, reason: null, label: null };
function agentInfo(force = false) {
  if (force || _agent.at === 0 || now() - _agent.at >= AGENT_RECHECK_MS) {
    const r = resolveAgentCmd({ forceKey: FORCE_AGENT });
    const prev = _agent.cmd;
    _agent = {
      at: now(),
      cmd: r.cmd || null,
      source: r.source || null,
      reason: r.reason || null,
      label: (r.agent && r.agent.label) || null,
    };
    if (r.cmd && r.cmd !== prev) console.log(`✓ agent wired${r.source ? ` (${r.source})` : ""}: ${r.cmd}`);
    else if (!r.cmd && prev) console.log(`• agent unwired — ${r.reason || "no agent CLI"}`);
  }
  return _agent;
}
const agentCmd = () => agentInfo().cmd;
// Pin a fast model for scan jobs. Grouping is a structured task that doesn't
// need a heavy reasoning model, and the user's *default* model may be a slow one
// (Opus / GPT-5.5) — forcing a fast model here keeps the initial scan snappy.
// Override with REFINE_SCAN_MODEL=""  to fall back to the agent's default.
const SCAN_MODEL = process.env.REFINE_SCAN_MODEL ?? "composer-2.5-fast";
// Reasoning effort for scan jobs on Codex (cursor-agent uses SCAN_MODEL instead).
// Grouping is a structured, near-mechanical task — the cssRules payload already
// hands the agent the timings + state selectors — so it does NOT need deep
// reasoning. A default-effort Codex run can take tens of seconds; "low" cuts that
// dramatically with no grouping/naming loss. Override with REFINE_SCAN_EFFORT
// (minimal|low|medium|high) or "" to use the agent's configured effort.
const SCAN_EFFORT = process.env.REFINE_SCAN_EFFORT ?? "low";
// Pin a fast model for refine (suggestion) jobs too. The motion-token vocabulary
// is inlined into the prompt (see MOTION_TOKENS_BLOCK) so a fast model has every
// fact it needs for the common token-tweak path — keeping suggestions snappy
// without falling back to the user's (possibly heavy/slow) default model.
// Override with REFINE_MODEL="" to use the agent's default model if you ever find
// the fast model regresses a tricky `replace`/recipe judgement. cursor-agent only.
const REFINE_MODEL = process.env.REFINE_MODEL ?? "composer-2.5-fast";
const AGENT_TIMEOUT_MS = Number(process.env.REFINE_AGENT_TIMEOUT_MS) || 120000;

// Inject `--model <m>` into a `cursor-agent …` command (after the binary).
// IMPORTANT: `--model` and the SCAN_MODEL slug (e.g. "composer-2.5-fast") are
// cursor-agent-specific. If a user wired a different CLI (Codex, Claude Code, …)
// into REFINE_AGENT_CMD, appending the flag would be invalid and break the scan,
// so we leave non-cursor commands untouched — those agents still get the speedup
// from the trimmed scan prompt. Also a no-op when the model is empty
// (REFINE_SCAN_MODEL="") or a model is already pinned explicitly.
function withModel(cmd, model) {
  if (!cmd || !model) return cmd;
  if (!/cursor-agent/.test(cmd)) return cmd; // not cursor-agent → don't touch
  if (/(^|\s)--model(\s|=)/.test(cmd)) return cmd; // respect an explicit choice
  return cmd.replace(/^(\s*\S+)/, `$1 --model ${model}`);
}

// Speed up the SCAN job per agent — grouping is structured and doesn't need a
// heavy model / deep reasoning:
//   • cursor-agent → pin SCAN_MODEL (a fast model) via --model.
//   • codex exec   → drop reasoning to SCAN_EFFORT ("low") and silence reasoning
//     summaries (less work AND cleaner stdout for JSON parsing) via `-c` config
//     overrides, inserted right after `exec` (before the trailing `-` stdin marker).
// No-ops if the user already pinned a model / reasoning effort, or disabled it
// (REFINE_SCAN_MODEL="" / REFINE_SCAN_EFFORT=""). Other CLIs are left untouched.
function withScanSpeed(cmd) {
  if (!cmd) return cmd;
  let out = withModel(cmd, SCAN_MODEL); // cursor-agent fast model
  const isCodexExec =
    /(^|\s|\/)codex(\s|$)/.test(out) && /(^|\s)exec(\s|$)/.test(out);
  if (isCodexExec && SCAN_EFFORT && !/model_reasoning_effort/.test(out)) {
    out = out.replace(
      /(^|\s)exec(\s|$)/,
      `$1exec -c model_reasoning_effort="${SCAN_EFFORT}" -c model_reasoning_summary="none"$2`
    );
  }
  return out;
}
const LONGPOLL_MS = Number(process.env.REFINE_LONGPOLL_MS) || 25000;
// Grace window after a `/refine live` agent's last poll during which LLM mode is
// still reported "available". Kept well above LONGPOLL_MS so the normal gaps
// between an in-IDE agent's polls (reasoning, posting results, brief turn pauses)
// don't flip the panel's LLM tab off mid-session.
const POLLER_TTL_MS = Number(process.env.REFINE_POLLER_TTL_MS) || 120000;
// How long a pending LLM job waits to be claimed before erroring. Comfortably
// above one long-poll cycle so a transient polling gap doesn't fail the job.
const PENDING_TIMEOUT_MS = Number(process.env.REFINE_PENDING_TIMEOUT_MS) || 120000;
// Idle auto-stop for the in-chat `/refine live` loop. The chat poll loop costs
// agent turns even while idle, so after this long with no job we tell the loop
// to stop (it returns {stop:true} from /jobs/next). 0 disables. Only the chat
// loop is affected — a wired REFINE_AGENT_CMD never polls /jobs/next.
const POLLER_IDLE_STOP_MS = Number(process.env.REFINE_POLLER_IDLE_STOP_MS) || 600000;

/** @type {Map<string, Job>} */
const jobs = new Map();
const now = () => Date.now();

// When did a `/refine live` agent last poll? Used to know if LLM mode can be
// served by a live editor agent (vs. needing REFINE_AGENT_CMD).
let lastPollAt = 0;
// Stop latch. Set by POST /poller/stop (and idle auto-stop); cleared ONLY by an
// explicit POST /poller/start (a fresh `/refine live` / agent loop announcing
// itself). While latched the poller reports inactive and every GET /jobs/next
// answers {stop:true}, so a loop that ignores the stop — or keeps polling /
// re-polls — can never silently revive the session. This is what makes the
// panel's Stop button stick instead of flipping "Live" back on seconds later.
let pollerStopped = false;
const pollerActive = () => !pollerStopped && now() - lastPollAt < POLLER_TTL_MS;
const llmAvailable = () => Boolean(agentCmd()) || pollerActive();

// Stop signal for the in-chat `/refine live` loop. Set by POST /poller/stop
// (the panel's "Stop" button) or by the idle auto-stop; consumed by the next
// GET /jobs/next, which returns {stop:true} so the loop exits cleanly.
let stopRequested = false;
// When did a real job last arrive? Drives idle auto-stop so a forgotten loop
// can't poll (and bill) forever. Seeded on first poll so a fresh loop gets the
// full idle window before any auto-stop.
let lastJobAt = 0;

// Whether the Cursor CLI (cursor-agent) is installed on this machine. Drives the
// panel's two agent-unavailable states: "Cursor CLI not installed" vs. simply
// "run /refine live". A wired REFINE_AGENT_CMD implies it's present.
const HOME = homedir();
const AGENT_BIN_CANDIDATES = [
  join(HOME, ".local", "bin", "cursor-agent"),
  "/usr/local/bin/cursor-agent",
  "/opt/homebrew/bin/cursor-agent",
];
function cursorCliInstalled() {
  if (agentCmd()) return true;
  for (const p of AGENT_BIN_CANDIDATES) {
    try { if (existsSync(p)) return true; } catch {}
  }
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    try { if (existsSync(join(dir, "cursor-agent"))) return true; } catch {}
  }
  return false;
}

function createJob(request) {
  const id = randomUUID();
  const job = {
    id,
    status: "pending", // pending | working | done | error
    request,
    statusLog: [],
    result: null,
    error: null,
    createdAt: now(),
    updatedAt: now(),
  };
  jobs.set(id, job);
  lastJobAt = now(); // real work → reset the chat-loop idle auto-stop window
  if (jobs.size > 100) {
    const oldest = [...jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (oldest && oldest.status !== "pending" && oldest.status !== "working") jobs.delete(oldest.id);
  }
  return job;
}

// LLM jobs left pending for a `/refine live` agent to claim via GET /jobs/next.
function nextPendingLlm() {
  let oldest = null;
  for (const job of jobs.values()) {
    if (job.status !== "pending") continue;
    if ((job.request?.mode || "llm") !== "llm") continue;
    if (!oldest || job.createdAt < oldest.createdAt) oldest = job;
  }
  return oldest;
}

// ── answering a job (one run per job) ────────────────────────────────────────

// Inlined transitions.dev motion-token vocabulary (mirrors motion-tokens.mjs and
// the transitions-dev skill's "## Motion tokens"). Embedding it in the refine
// prompt means the common token-tweak path needs ZERO file reads — only recipe
// selection (replace/both) still opens the skill + a reference file.
const MOTION_TOKENS_BLOCK = [
  "Motion tokens (transitions.dev) — match on USAGE intent, not the nearest number:",
  "Durations:",
  ...DURATION_TOKENS.map((t) => `  - ${t.ms}ms ${t.name}: ${t.usage}`),
  `Default easing "Smooth ease out": ${SMOOTH_OUT}.`,
  "Token easings (already on-grid — leave unchanged): ease-out, ease-in-out, linear, cubic-bezier(0.34, 1.36, 0.64, 1) (bouncy overshoot, badge pop), cubic-bezier(0.34, 3.85, 0.64, 1) (strong overshoot, avatar return).",
  'Generic curves to nudge toward "Smooth ease out": "ease", "ease-in", or any hand-rolled cubic-bezier()/linear() that is not a token above.',
  "Scales (the non-resting 'pre' scale a surface animates FROM — it always settles to 1):",
  ...SCALE_TOKENS.map((t) => `  - ${t.v} ${t.name}: ${t.usage}`),
  "Blur (the non-resting 'pre' blur a surface animates FROM — it always settles to 0):",
  ...BLUR_TOKENS.map((t) => `  - ${t.px}px ${t.name}: ${t.usage}`),
  "Distances (the non-resting 'pre' translate a surface animates FROM — it always settles to 0):",
  ...DISTANCE_TOKENS.map((t) => `  - ${t.px}px ${t.name}: ${t.usage}`),
].join("\n");

// Inlined recipe catalog + decision hints (mirrors the transitions-dev skill's
// "## Quick reference" + "## Decision rules"). Embedding it lets the `replace`
// path pick a recipe WITHOUT reading SKILL.md — at most it opens the ONE chosen
// reference file for exact structure/timings.
const RECIPES_BLOCK = [
  "transitions.dev recipes — match the inferred USAGE to ONE recipe (reference file in parens):",
  "- Card resize: a container changes width/height on a layout change (01-card-resize.md)",
  "- Number pop-in: a number/digit updates (02-number-pop-in.md)",
  "- Notification badge: a small dot/badge appears on a trigger (03-notification-badge.md)",
  "- Text states swap: text content changes in place (04-text-states-swap.md)",
  "- Menu dropdown: an anchored surface grows from its trigger (05-menu-dropdown.md)",
  "- Modal open/close: a centered dialog scales up, softer scale-down on close (06-modal.md)",
  "- Panel reveal: a surface slides into a region with a cross-blur (07-panel-reveal.md)",
  "- Page side-by-side: slide between list<->detail or step1<->step2 (08-page-side-by-side.md)",
  "- Icon swap: two icons cross-fade in the same slot (09-icon-swap.md)",
  "- Success check: a checkmark celebration, fade+rotate+bob+stroke-draw (10-success-check.md)",
  "- Avatar group hover: hover lifts an item in a horizontal stack (11-avatar-group-hover.md)",
  "- Error state shake: invalid-input shake (12-error-state-shake.md)",
  "- Input clear with dissolve: clearing a text field (13-input-clear-dissolve.md)",
  "- Skeleton loader and reveal: placeholder pulses then swaps to real content (14-skeleton-reveal.md)",
  "- Shimmer text: in-progress/'thinking' text shimmer (15-shimmer-text.md)",
  "- Tabs sliding: a moving highlight across segmented options (16-tabs-sliding.md)",
  "- Tooltip open/close: delayed fade+scale in, instant out (17-tooltip.md)",
  "- Texts reveal: staggered blurred rise of stacked text lines (18-texts-reveal.md)",
  "- Card hover tilt: 3D tilt toward the pointer (19-card-tilt.md)",
  "- Plus to menu morph: a circular trigger becomes the surface it opens (20-plus-menu-morph.md)",
  "- Accordion expand: a collapsible body grows/shrinks in height (21-accordion.md)",
  "Recipe non-resting values — the pre-blur/pre-scale/slide-distance the recipe animates FROM (settling to blur 0 / scale 1 / translate 0). When you pick one of these recipes you MUST also emit a lane-level value patch for EACH of its values, EVEN IF the input has no such lane (add the lane so the element gains the recipe's blur/scale/distance):",
  "  - Panel reveal → filter blur 2px (Small)",
  "  - Page side-by-side → filter blur 3px (Medium) AND transform translate distance 8px, both on the sliding page",
  "  - Icon swap → filter blur 2px (Small) AND transform scale 0.25 (start-scale) on the swapping icon",
  "  - Text states swap → filter blur 2px (Small) AND transform translateY distance 4px, on the swapping text (exit and enter both settle to blur 0 / translate 0)",
  "  - Skeleton loader and reveal → filter blur 2px (Small)",
  "  - Texts reveal → filter blur 3px (Medium)",
  "  - Success check → filter blur 8px (Large)",
  "  - Modal open/close → transform scale 0.96 (Large)",
  "  - Menu dropdown → transform scale 0.97 (Medium) open, 0.99 (Tiny) close",
  "  - Tooltip open/close → transform scale 0.98 (Small)",
  "Recipe timing & easing — SET the transition to the recipe's documented values; do NOT keep the source's duration/easing when they differ from the recipe (a value being an on-grid token is NOT a reason to keep it if the recipe uses a different one):",
  "  - Easing: most surface/slide/reveal recipes use cubic-bezier(0.22, 1, 0.36, 1) (Smooth ease out) — page side-by-side, panel reveal, menu dropdown, modal, tooltip, accordion, tabs sliding, card resize, texts reveal, success check. Cross-fade swaps use ease-in-out — icon swap, text states swap. Overshoot curves stay as documented — notification badge / number pop-in cubic-bezier(0.34, 1.36, 0.64, 1), avatar return cubic-bezier(0.34, 3.85, 0.64, 1).",
  "  - SYMMETRIC recipes (SAME duration + easing BOTH directions — do NOT split open/close): page side-by-side (250ms), tabs sliding (250ms), accordion (250ms), icon swap (250ms), text states swap (150ms). Emit identical durationMs/easing for every phase.",
  "  - WHOLE-GROUP swaps: icon swap and text states swap are two stacked members in the same slot. A replace suggestion MUST patch BOTH members in EVERY phase, not just the currently selected/exiting member. Emit blur/scale (icon) or blur/translate (text) lane patches once per member per phase, copying each member name from `phases[].timings`.",
  "  - ASYMMETRIC recipes (open slower, close faster): menu dropdown / modal / tooltip / panel reveal → open 250ms, close 150ms.",
  "Tie-break: prefer the lower-overhead recipe (card resize over panel reveal, dropdown over modal). If no recipe genuinely fits, return an empty suggestions array.",
].join("\n");

// Shared guidance for the token-tweak passes (small + both). Mirrors the
// deterministic engine's "missing-blur" path: some usages animate a non-resting
// pre-blur that a bare opacity/transform capture won't show, so the agent must
// ADD it rather than only tweak blur lanes that already exist.
const MISSING_BLUR_NOTE =
  "MISSING BLUR: blur can be ABSENT, not just off-token. When the inferred usage clearly implies a non-resting pre-blur per the Blur tokens above (e.g. a page slide / page side-by-side panel → 3px Medium; an icon swap, text swap, panel reveal, skeleton reveal or number pop-in → 2px Small; a text reveal → 3px Medium; a success check → 8px Large) but the input timings carry NO `filter` lane, ADD one: emit a `blur` suggestion with `property:\"filter\"`, `from:\"0px\"`, `to` the usage token (e.g. \"3px\"), echoing the `member` (and `varName` if present) of the sibling lanes so the sliding/swapping element gains the recipe's blur. Only add blur when the usage genuinely calls for it — never on motion that is intentionally opacity-only (a plain fade, a colour/theme change).";

// Optional `transitions-polish` add-on skill. When the user has it installed in
// their project, its `_refine-rules.md` (open/close asymmetry, hover in/out,
// stagger & delay, distance guidance) is inlined into the Small/Both refine
// prompt so per-click suggestions honor those rules with ZERO extra file reads —
// the Small prompt forbids the agent from reading files for speed, so inlining is
// the only way to get the rules in. Resolved relative to the relay's cwd (the
// user's project, where `npx transitions-refine` runs) across the same skill
// locations the agents use. Cached with a short TTL, mirroring the agent
// resolver, so a mid-session install is picked up without restarting the relay.
const POLISH_RULES_TTL_MS = Number(process.env.REFINE_POLISH_RECHECK_MS) || 10000;
const POLISH_RULES_FILE = "_refine-rules.md";
const POLISH_SKILL_DIRS = [
  ".agents/skills/transitions-polish",
  ".claude/skills/transitions-polish",
  "skills/transitions-polish",
];
let _polish = { at: 0, rules: null };
function loadPolishRules() {
  if (_polish.at !== 0 && now() - _polish.at < POLISH_RULES_TTL_MS) return _polish.rules;
  let rules = null;
  for (const dir of POLISH_SKILL_DIRS) {
    const p = join(process.cwd(), dir, POLISH_RULES_FILE);
    try {
      if (existsSync(p)) {
        rules = readFileSync(p, "utf8").trim() || null;
        if (rules) break;
      }
    } catch {}
  }
  const had = Boolean(_polish.rules);
  _polish = { at: now(), rules };
  if (rules && !had) console.log("✓ transitions-polish skill detected — inlining polish rules into Small refinements");
  else if (!rules && had) console.log("• transitions-polish skill no longer found — reverting to base motion-token refinements");
  return rules;
}

function buildPrompt(job) {
  const r = job.request || {};
  // "All transitions" replace scope: the panel sends EVERY detected transition
  // and wants a LIST of whole-transition replacements — one per transition the
  // agent finds a good transitions.dev recipe for. Each suggestion echoes its
  // `transitionId` so the panel applies it to the right transition, and carries
  // the SAME patch/patches contract as a single replace so Apply is unchanged.
  const transitions = Array.isArray(r.transitions) ? r.transitions.filter((t) => t && t.transitionId) : [];
  if (r.scope === "all" && transitions.length) {
    return [
      "You are refining MULTIPLE CSS transitions against the transitions.dev library and motion tokens. Evaluate EVERY transition below; for each one where a transitions.dev recipe is a genuinely good fit, emit ONE whole-transition replacement. Transitions with no good recipe match are simply OMITTED — never force a swap.",
      MOTION_TOKENS_BLOCK,
      "",
      "Transitions (JSON array). Each has a stable `transitionId` you MUST echo VERBATIM in that transition's suggestion, its current `timings`, and — when it has related states — a `phases` array (e.g. open + close) that is ONE motion.",
      JSON.stringify(
        transitions.map((t) => ({
          transitionId: t.transitionId,
          label: t.label,
          selector: t.selector,
          timings: t.timings,
          phases: Array.isArray(t.phases) && t.phases.length ? t.phases : undefined,
        })),
        null,
        2
      ),
      "",
      "For EACH transition infer its USAGE (modal close, dropdown open, tooltip, badge, resize, page slide, icon/text swap…) from its label/selector. Match on usage intent, not the nearest number. A lane may carry `scale`/`translate` (transform) or `blur` (filter) plus a `varName`/`translateVarName` — check those against the Scales/Blur/recipe values too and pass any var names straight through in the patch.",
      "",
      "To pick a whole-transition replacement, match the inferred USAGE against the recipe list below (the skill's decision rules are summarised here — do NOT read SKILL.md or any reference file). Put the recipe's reference filename in `reference`.",
      "",
      RECIPES_BLOCK,
      "",
      "PER-TRANSITION OUTPUT — for each transition you replace, emit ONE suggestion with kind \"replace\" and `transitionId` set to that transition's id:",
      "  - If the transition has a `phases` array, emit a `patches` array with ONE phase-level timing entry per phase (`{\"phase\":<phase>,\"property\":\"all\",\"durationMs\":...,\"easing\":...}`) PLUS extra per-lane value patches for any recipe non-resting scale/blur/translate (`property:\"transform\"`/`\"filter\"` with the lane `member` and `varName`/`translateVarName` copied from that phase's input timings; when the recipe adds a lane the input lacks, still emit it and reuse a sibling lane's `member`, omitting the var name). Also include a single `patch` (the first phase) for the live preview. Set each phase's durationMs AND easing from \"Recipe timing & easing\" (SYMMETRIC recipes use the SAME duration+easing for every phase; ASYMMETRIC use open 250ms / close 150ms).",
      "  - Otherwise (single phase): set its `patch` to the recipe's documented duration AND easing on the property that already transitions (or \"all\"); if the recipe prescribes a non-resting pre-blur/pre-scale/slide-distance, put those `blur`/`scale`/`translate` values on the `patch` too so the element gains them even when the captured transition had no such lane.",
      "Copy each suggestion's and patch's `member` VERBATIM from the input lane it came from — REQUIRED whenever an input lane carries a member (it is the only way to tell which lane a transform/filter tweak targets).",
      "Return ALL such suggestions in ONE array (order doesn't matter). If NO transition has a good recipe match, return an empty suggestions array.",
      "Answer in ONE response — do NOT read or search files.",
      "",
      "Output ONLY a JSON object — no prose, no markdown fences — shaped exactly like:",
      '{"summary":"…","suggestions":[{"id":"dropdown-replace","transitionId":"<echo an id from the input>","kind":"replace","title":"Menu dropdown","reference":"05-menu-dropdown.md","patch":{"property":"all","member":"Panel","durationMs":250,"easing":"cubic-bezier(0.22, 1, 0.36, 1)","scale":0.97},"patches":[{"phase":"open","property":"all","durationMs":250,"easing":"cubic-bezier(0.22, 1, 0.36, 1)"},{"phase":"open","property":"transform","member":"Panel","scale":0.97},{"phase":"close","property":"all","durationMs":150,"easing":"cubic-bezier(0.22, 1, 0.36, 1)"}],"reason":"…"}]}',
    ].join("\n");
  }
  const rawType = r.refineType || "small";
  const refineType = rawType === "replace" ? "replace" : rawType === "both" ? "both" : "small";
  const needsRecipe = refineType === "replace" || refineType === "both";
  // Token-tweak passes (small + both) get the optional polish-skill rules inlined.
  const polishRules = refineType === "replace" ? null : loadPolishRules();
  // A grouped transition usually has related phases (open + close). When the panel
  // sends them, a recipe swap is ONE motion and must update every phase together —
  // so the agent returns a `patches` array (one entry per phase) instead of a
  // single-phase `patch`.
  const phases = Array.isArray(r.phases) ? r.phases.filter((p) => p && p.phase) : [];
  const multiPhase = needsRecipe && phases.length > 1;
  const lines = [
    "You are refining ONE CSS transition against the transitions.dev library and motion tokens.",
    MOTION_TOKENS_BLOCK,
    "",
    "Transition context (JSON):",
    JSON.stringify({ label: r.label, selector: r.selector, refineType, timings: r.timings, phases: phases.length ? phases : undefined }, null, 2),
    "",
    "Infer each declaration's USAGE (modal close, dropdown open, tooltip, badge, resize, color/theme change…) from the label/selector. Match on usage intent, not the nearest number.",
    "",
    "Some timings carry VALUES too: a `transform` lane may include `scale` (its non-resting pre-scale, e.g. 0.8) and/or `translate` (its non-resting slide distance in px, e.g. 30), and a `filter` lane may include `blur` (its non-resting pre-blur in px). When present, also check these against the Scales/Blur tokens and the recipe values by USAGE (a dropdown-open surface should pre-scale to 0.97, not whatever number it has; a page slide should travel the recipe's distance) and propose a fix when they differ. A lane may also carry `varName` / `translateVarName` (the CSS custom property backing each value) — pass them straight through in the patch so the edit targets that variable.",
    "",
  ];
  if (needsRecipe) {
    lines.push(
      "To pick a whole-transition replacement, match the inferred USAGE against the recipe list below (the skill's decision rules are summarised here — do NOT read SKILL.md or any reference file). Derive the duration/easing from the MOTION TOKENS above for the recipe's phase (open vs close), and put the recipe's reference filename in `reference` so the user can paste the full recipe themselves. The patch only drives the live preview; exact keyframes/structure come from that pasted file — so you never need to open it.",
      "",
      RECIPES_BLOCK,
      "",
    );
    if (multiPhase) {
      lines.push(
        "RELATED PHASES: `phases` lists this transition's related states (e.g. open AND close). They are ONE motion — a recipe swap must update them TOGETHER. For the replace suggestion emit a `patches` array with ONE timing entry per phase in `phases`, shaped `{\"phase\":<phase>,\"property\":\"all\",\"durationMs\":...,\"easing\":...}`. If the recipe uses transform pre-scale, filter pre-blur or a slide distance (see \"Recipe non-resting values\" above), add EXTRA per-lane value patches for those lanes (not property:\"all\"), e.g. `{\"phase\":\"open\",\"property\":\"transform\",\"member\":\"Panel\",\"varName\":\"--dropdown-pre-scale\",\"scale\":0.97}`, `{\"phase\":\"open\",\"property\":\"filter\",\"member\":\"Panel\",\"varName\":\"--panel-blur\",\"blur\":2}` or `{\"phase\":\"forward\",\"property\":\"transform\",\"member\":\"Page panel\",\"translateVarName\":\"--page-slide-distance\",\"translate\":8}`. Copy each lane's `member` + `varName`/`translateVarName` from the input timings when that lane exists; when the recipe adds a lane the input LACKS (e.g. Page side-by-side prescribes a 3px blur but the captured page has no `filter` lane), STILL emit the value patch — reuse the sibling lane's `member` so it targets the right element and omit the var name (Apply discovers the page's backing variable itself). Set each phase's `durationMs` AND `easing` from \"Recipe timing & easing\" above (SYMMETRIC recipes use the SAME duration+easing for every phase — do NOT split open/close; ASYMMETRIC recipes use open 250ms / close 150ms). The added value lanes (blur/translate) automatically inherit their phase's timing on Apply, so you don't need to repeat duration/easing on those lane-level patches. Also include a single `patch` for live preview (first timing patch is fine). Apply will write every phase from `patches`.",
        "",
      );
    }
  }
  if (refineType === "replace") {
    lines.push(
      "refineType is \"replace\": suggest a WHOLE-TRANSITION replacement ONLY — do NOT propose motion-token tweaks (no kind \"duration\"/\"delay\"/\"easing\").",
      multiPhase
        ? "Pick the SINGLE best-fit recipe from the list above. Emit ONE suggestion with kind \"replace\": include the `patches` array (one entry per related phase, as described above) AND a single `patch` (the first phase) for the live preview, add a `reference` field with the reference filename, and name the recipe in `title`/`reason`. If no recipe genuinely fits the usage, return an empty suggestions array."
        : "Pick the SINGLE best-fit recipe from the list above. Emit ONE suggestion with kind \"replace\": set its `patch` to the recipe's documented duration AND easing (see \"Recipe timing & easing\" — do NOT keep the source's easing when the recipe differs) on the property that already transitions (or \"all\") so Apply works live, add a `reference` field with the reference filename, and name the recipe in `title`/`reason`. If the recipe prescribes a non-resting pre-blur/pre-scale/slide-distance (see \"Recipe non-resting values\" above), put those values on the `patch` too (add `blur` for a filter-blur recipe like Page side-by-side → 3px, `scale` for a scale recipe, `translate` for a slide distance like Page side-by-side → 8px) so the sliding/scaling element gains them even when the captured transition had no such lane. If no recipe genuinely fits the usage, return an empty suggestions array.",
      "Answer in ONE response — do NOT read or search files.",
    );
  } else if (refineType === "both") {
    lines.push(
      "refineType is \"both\": produce TWO independent groups in the SAME suggestions array — the UI shows them in separate tabs, so include each group whenever it applies.",
      "(1) Motion-token tweaks (kind \"duration\"/\"delay\"/\"easing\"/\"scale\"/\"blur\"/\"distance\"): for each declaration, propose the token value only where it DIFFERS from the current one. Use \"scale\" for an off-token transform pre-scale, \"blur\" for an off-token filter pre-blur, and \"distance\" for an off-token transform translate distance, picked by usage.",
      MISSING_BLUR_NOTE,
      multiPhase
        ? "(2) Whole-transition replacement (kind \"replace\"): ALWAYS evaluate one — pick the SINGLE best-fit recipe. Emit at most ONE \"replace\" suggestion with the `patches` array (one entry per related phase) AND a single `patch` (the first phase), a `reference` field, and the recipe named in `title`/`reason`. If no recipe genuinely fits, omit the replace suggestion."
        : "(2) Whole-transition replacement (kind \"replace\"): ALWAYS evaluate one — pick the SINGLE best-fit recipe from the list above. Emit at most ONE \"replace\" suggestion: set its `patch` to the recipe's documented duration AND easing (see \"Recipe timing & easing\" — do NOT keep the source's easing when the recipe differs) on the property that already transitions (or \"all\"); if the recipe prescribes a non-resting pre-blur/pre-scale/slide-distance (see \"Recipe non-resting values\" above) put those `blur`/`scale`/`translate` values on the `patch` too so e.g. Page side-by-side gains its 3px blur and 8px distance. Add a `reference` field with the reference filename, and name the recipe in `title`/`reason`. If no recipe genuinely fits, omit the replace suggestion.",
      ...(polishRules ? ["", polishRules] : []),
      "Answer in ONE response — do NOT read or search files.",
    );
  } else {
    lines.push(
      "refineType is \"small\": suggest motion-token tweaks ONLY — for each declaration, propose the token value only where it DIFFERS from the current one (kind \"duration\"/\"delay\"/\"easing\"/\"scale\"/\"blur\"/\"distance\"). Use \"scale\" for an off-token transform pre-scale, \"blur\" for an off-token filter pre-blur, and \"distance\" for an off-token transform translate distance, picked by usage. Do NOT propose a whole-transition replacement (no kind \"replace\") — the Replace tab requests that separately.",
      MISSING_BLUR_NOTE,
      ...(polishRules ? ["", polishRules] : []),
      "Answer in ONE response using ONLY the data above. Do NOT read or search files, run tools, spawn subagents, or explore the codebase — the motion tokens contain everything you need. This is a quick judgement, not a coding task.",
    );
  }
  lines.push(
    "",
    "Output ONLY a JSON object — no prose, no markdown fences — shaped exactly like:",
    '{"summary":"…","suggestions":[{"id":"width-duration","kind":"duration","property":"width","member":"Container","title":"Duration → Fast","from":"400ms","to":"250ms","patch":{"property":"width","member":"Container","durationMs":250},"reason":"…"}]}',
    'A scale tweak looks like {"id":"transform-scale","kind":"scale","property":"transform","member":"Menu","title":"Scale → Medium","from":"0.8","to":"0.97","patch":{"property":"transform","member":"Menu","scale":0.97},"reason":"…"}; a blur tweak like {"id":"filter-blur","kind":"blur","property":"filter","member":"Panel","title":"Blur → Small","from":"8px","to":"2px","patch":{"property":"filter","member":"Panel","blur":2},"reason":"…"}; a distance tweak like {"id":"transform-distance","kind":"distance","property":"transform","member":"Page","title":"Distance → Base","from":"24px","to":"8px","patch":{"property":"transform","member":"Page","translate":8,"translateVarName":"--page-slide-distance"},"reason":"…"}.',
    "CRITICAL — `member`: every suggestion and its `patch` MUST echo the `member` of the input lane it came from, copied VERBATIM from that lane in the data above. This is REQUIRED whenever any input lane carries a `member` — most importantly when several lanes share the same `property` (e.g. a dropdown where a caret does `transform: rotate` AND a panel does `transform: scale`): the `member` is the ONLY way to tell which lane a `transform` tweak targets. Omitting it mislabels the suggestion onto the wrong element. Omit `member` only for lanes that genuinely have none.",
    multiPhase
      ? 'A multi-phase replace suggestion ALSO carries a `patches` array. Put timing in phase-level entries (`property:"all"`, duration/easing), and put scale/blur/translate in lane-level entries (`property:"transform"`/`"filter"` plus the lane `member` and `varName`/`translateVarName` from input timings). In each `patch`/`patches` entry include only changed fields (durationMs, delayMs, easing, scale, blur, translate — plus `member` copied from input lane and `varName`/`translateVarName` when present); `property` must match an input property or "all".'
      : 'In each `patch` include only the changed fields (durationMs, delayMs, easing, scale, blur, translate — plus `member` copied from the input lane, and `varName`/`translateVarName` if the input lane had one); `property` must match an input property or "all". If nothing should change, return an empty suggestions array.',
  );
  return lines.join("\n");
}

function parseJsonish(stdout) {
  let s = (stdout || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error("agent output was not JSON");
  }
}

function parseAgentOutput(stdout) {
  const obj = parseJsonish(stdout);
  if (!obj || !Array.isArray(obj.suggestions)) throw new Error("agent output missing suggestions[]");
  return { suggestions: obj.suggestions, summary: obj.summary ?? null };
}

// Apply jobs ask the agent to edit the user's source, so the result is an
// outcome, not suggestions.
function parseApplyOutput(stdout) {
  const obj = parseJsonish(stdout);
  if (!obj || typeof obj.applied === "undefined") throw new Error("agent output missing `applied`");
  return { applied: Boolean(obj.applied), summary: obj.summary ?? null, files: Array.isArray(obj.files) ? obj.files : null };
}

// Scan jobs ask the agent to read the source and group related transitions into
// components with open/close phases and member elements.
function parseScanOutput(stdout) {
  const obj = parseJsonish(stdout);
  if (!obj || !Array.isArray(obj.groups)) throw new Error("agent output missing groups[]");
  return { groups: obj.groups, summary: obj.summary ?? null };
}

// Serialize cursor-agent spawns. Two cursor-agent processes started at once race
// on their shared CLI config — one renames `…/cli-config.json.tmp → cli-config.json`
// while the other already moved it, so the loser crashes with ENOENT mid config
// save and its scan/refine job fails. Because the relay fires every job via
// setImmediate, a cold-start scan + any other job spawn in parallel and trip this.
// Running cursor-agent one-at-a-time removes the race; jobs are rarely concurrent
// so the queuing cost is negligible (and each attempt is still bounded by
// AGENT_TIMEOUT_MS). Non-cursor CLIs are left to run freely.
let agentLock = Promise.resolve();
function withAgentLock(fn) {
  const run = agentLock.then(fn, fn);
  // keep the chain alive regardless of this run's outcome
  agentLock = run.then(() => {}, () => {});
  return run;
}

// Failures worth retrying: transient agent startup / shared-config races, not
// genuine "the model answered wrong" errors (those reject from parse, not here)
// or timeouts (a retry would just time out again).
const AGENT_TRANSIENT_RE = /ENOENT|EAGAIN|EBUSY|ECONNRESET|EPIPE|cli-config|\brename\b|failed to start/i;
const AGENT_RETRIES = Number.isFinite(Number(process.env.REFINE_AGENT_RETRIES))
  ? Number(process.env.REFINE_AGENT_RETRIES)
  : 2;

// CLIs (Codex especially) print verbose startup WARNINGs to stderr even on
// success — e.g. "could not create PATH aliases" and "failed to open state db"
// (Codex literally logs "proceeding" right after). Those lines used to eat the
// 300-char error budget, truncating away the REAL failure. Strip the known
// noise so the genuine error surfaces; keep a generous cap.
function cleanAgentErr(err) {
  const noise = /could not create PATH aliases|failed to open state db|state DB at|codex_state::runtime|^\s*WARNING:|(^|\s)WARN(\s|:)/i;
  const lines = (err || "").split(/\r?\n/).filter((l) => l.trim() && !noise.test(l));
  const msg = lines.join("\n").trim() || (err || "").trim() || "(no stderr)";
  return msg.slice(0, 1500);
}

function runAgentOnce(cmd, prompt, parse) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", cmd], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`REFINE_AGENT_CMD timed out after ${AGENT_TIMEOUT_MS}ms`));
    }, AGENT_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`failed to start REFINE_AGENT_CMD: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`agent exited ${code}: ${cleanAgentErr(err)}`));
      try {
        resolve(parse(out));
      } catch (e) {
        reject(new Error(`${e.message} — got: ${out.slice(0, 200)}`));
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Spawn the agent CLI once per attempt, serializing cursor-agent runs and
// retrying transient startup/config-race failures with backoff. A retry re-spawns
// a fresh process (read-only scan/refine, idempotent apply), so it's safe — and
// the backoff happens OUTSIDE the lock so a retrying job doesn't block others.
async function runAgentCmd(cmd, prompt, parse = parseAgentOutput) {
  const isCursor = /(^|\s|\/)cursor-agent(\s|$)/.test(cmd || "");
  const attempt = () =>
    isCursor ? withAgentLock(() => runAgentOnce(cmd, prompt, parse)) : runAgentOnce(cmd, prompt, parse);
  const maxTries = 1 + Math.max(0, AGENT_RETRIES);
  let lastErr;
  for (let i = 0; i < maxTries; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      if (i < maxTries - 1 && AGENT_TRANSIENT_RE.test(msg)) {
        const backoff = 250 * (i + 1) + Math.floor(Math.random() * 150);
        console.warn(`  ↻ agent attempt ${i + 1}/${maxTries} failed (${msg.slice(0, 120)}) — retrying in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// Prompt for an "apply" job: the agent edits the user's source so the selected
// transition uses the approved timings.
function buildApplyPrompt(job) {
  const r = job.request || {};
  return [
    "You are APPLYING an approved transition change to the user's SOURCE CODE. Edit files; do not just suggest.",
    "",
    "Change context (JSON):",
    JSON.stringify({ label: r.label, selector: r.selector, component: r.component, group: r.group, phase: r.phase, changes: r.changes }, null, 2),
    "",
    "Each change may carry its own `phase` (e.g. \"open\"/\"close\"), `member`, and `selector`. A change's `phase` targets ONE state of the component — edit the rule for THAT state (e.g. the `.is-open` rule for open; the `.is-closing`/base rule for close), NOT the other phase. The top-level `phase` is only a fallback for changes that omit their own. A recipe swap may include changes for BOTH open and close — apply each to its own phase's rule so the open and close timings end up different where the recipe says so.",
    "",
    "Steps:",
    "1. Find where this transition is defined in the source. Search by the per-change `selector`/`member`, the `component` hint, and class names. Handle plain CSS, CSS Modules, styled-components/emotion template literals, Tailwind utilities/config, inline style objects, and Motion/Framer variants — the browser selector is a hint, the real declaration may live in any of these.",
    "2. For each change, edit the source so that property's transition uses the `to` values. A change's `to` may include timing (durationMs in ms, easing, delayMs in ms) AND/OR values: `scale` (the non-resting transform pre-scale, e.g. set `transform: scale(0.97)` on the pre-open/closed state — never the resting scale(1)), `blur` (the non-resting filter pre-blur in px, e.g. `filter: blur(2px)` on that same state) and `translate` (the non-resting slide distance in px — the offset the element travels from, keeping the existing direction/sign convention). A change with `added:true` introduces a lane the source never animated — add that property to the transition (with the `to` timing) AND give the pre-state its non-resting value from the paired value change. If the change carries `varName`, the value is backed by that CSS custom property — update the variable's value at its definition instead of the inline declaration. Keep the file's existing unit/format conventions (e.g. `0.25s` vs `250ms`) and only touch the named property on the right member + phase.",
    "3. Make the minimal edit. Do not reformat or change unrelated code.",
    "",
    'Output ONLY a JSON object — no prose, no markdown fences — shaped exactly like:',
    '{"applied":true,"summary":"Set .modal transition to 250ms ease-out","files":["src/Modal.css:42"]}',
    'If you cannot confidently locate the declaration, output {"applied":false,"summary":"<what you looked for and why it was not found>"}.',
  ].join("\n");
}

// Prompt for a "scan" job: the agent reads the source and groups the raw,
// DOM-detected transitions into components with open/close phases and members.
function buildScanPrompt(job) {
  const r = job.request || {};
  return [
    "You are GROUPING UI transitions by reading the user's SOURCE CODE. A naive DOM scan only sees each element's current computed transition — it cannot tell open from close, and lists related elements separately. Fix that.",
    "",
    "Raw DOM-detected transitions (JSON). Each entry's `timings` are ALREADY ACCURATE for the component's CURRENT on-screen state — treat them as ground truth, do NOT re-derive them from source. Most entries also carry `cssRules`: the CSS rules harvested live from the page (CSSOM) that drive that element across ALL states (base + open + close), with var() already resolved to concrete values.",
    JSON.stringify({ url: r.url, raw: r.raw }, null, 2),
    "",
    "FAST PATH — when an entry has `cssRules`, they are AUTHORITATIVE and contain everything you need: the opposite-phase timings live on a state-variant selector inside them (e.g. `.dd.is-closing .dd-panel`, `.modal[data-closing] .dialog`), and the toggled state is visible in those selectors. Derive grouping, phases, toggled state, and opposite-phase timings DIRECTLY from `cssRules` + `timings`. Do NOT glob, grep, or read files for any element whose `cssRules` is non-empty — it only wastes time. ONLY fall back to reading source for entries with an empty/missing `cssRules` (CORS-locked sheets, styled-components, Tailwind, etc.), and even then read the minimum.",
    "",
    "Steps:",
    "1. Identify each animated UI component (dropdown, modal, tooltip, accordion, drawer, toast…). The provided `label`/`selector`/`properties` usually make the grouping obvious; only read source when the grouping is genuinely unclear.",
    "2. For each component, split into PHASES — typically `open` and `close` (a hover-only component may have a single phase). The phase matching the CURRENT DOM state reuses the provided timings verbatim. The OPPOSITE phase often lives on a different selector (e.g. `.is-open` vs `.is-closing`) with different timings — take it from this element's `cssRules` (or, only if it has none, read source). Report BOTH even though only one is in the DOM right now.",
    "3. PHASE STATE — how the phase is driven (REQUIRED for playback to work). For each phase provide:",
    "   - `stateTarget`: a CSS selector for the ONE element whose class/attribute is toggled to drive the whole phase (e.g. the dropdown root, the `.modal`, the element with `[data-open]`). It MUST resolve in the live DOM RIGHT NOW, in any state — so it must NOT itself contain the toggled state (write `.t-morph`, never `.t-morph[data-open=\"true\"]`).",
    "   - `fromState` and `toState`: the class/attribute on `stateTarget` at the START and END of this phase, as a token: a class `\".is-open\"`, an attribute `\"[data-open=\\\"true\\\"]\"`, or `null`/`\"\"` for the base/no-class state. OPEN usually goes base→open (`fromState:null`, `toState:\".is-open\"`); CLOSE goes open→base (`fromState:\".is-open\"`, `toState:null`). Get the DIRECTION right — open must animate into the open look, close must animate back out.",
    "4. For each phase, list its MEMBER elements (panel, backdrop, the staggered items…). Give each member a stable `id`, a human `label`, a CSS `selector`, and its `propertyTimings`. For the phase that matches the current DOM, COPY each member's `propertyTimings` straight from the provided `raw.timings` (same per-property duration/delay/easing) — don't change numbers you were handed. The member `selector` MUST resolve in the live DOM RIGHT NOW regardless of phase — use the BASE element selector and do NOT bake the phase's toggled class/attribute into it (write `.t-morph .t-morph-plus`, never `.t-morph[data-open=\"true\"] .t-morph-plus`). The toggled state belongs only in the phase's `stateTarget`/`toState`.",
    "5. TIMINGS ARE PER-PROPERTY. For the OPPOSITE phase (from `cssRules`, or source if none): list one `propertyTimings` entry per animated property with its own duration/delay/easing; `cssRules` already have var() resolved, but if you ever read a raw `var(...)` resolve it to a concrete number, and convert `s`→ms (`0.25s`→250); never emit a `var(...)` or a guess. Open and close usually have DIFFERENT durations/easings. (The current-state phase just reuses the provided numbers.)",
    "",
    "Output ONLY a JSON object — no prose, no markdown fences — shaped exactly like:",
    '{"summary":"Grouped 3 components.","groups":[{"id":"dropdown","label":"Dropdown","component":"src/Dropdown.tsx","phases":[{"id":"dropdown:open","phase":"open","label":"Open","stateTarget":".dropdown","fromState":null,"toState":".is-open","members":[{"id":"panel","label":"Panel","selector":".dropdown .dropdown-panel","propertyTimings":[{"property":"opacity","durationMs":200,"delayMs":0,"easing":"ease-out"},{"property":"transform","durationMs":200,"delayMs":0,"easing":"cubic-bezier(0.22, 1, 0.36, 1)"}]}]},{"id":"dropdown:close","phase":"close","label":"Close","stateTarget":".dropdown","fromState":".is-open","toState":null,"members":[{"id":"panel","label":"Panel","selector":".dropdown .dropdown-panel","propertyTimings":[{"property":"opacity","durationMs":150,"delayMs":0,"easing":"ease-in"},{"property":"transform","durationMs":150,"delayMs":0,"easing":"ease-in"}]}]}]}]}',
    "If you cannot confidently group anything, return an empty groups array with a short summary; the panel keeps its flat DOM scan.",
  ].join("\n");
}

function refineDeterministic(job) {
  // Whole-transition replacement needs usage inference + recipe selection, which
  // only the agent (LLM) path can do. Deterministic can only snap to tokens.
  if ((job.request?.refineType || "small") === "replace") {
    return {
      suggestions: [],
      summary: "Replacing a whole transition needs the agent — switch to the Agent tab and run `/refine live`.",
    };
  }
  const r = job.request || {};
  const suggestions = refineTimings(r.timings || [], { label: r.label, selector: r.selector, phase: r.phase });
  return {
    suggestions,
    summary: suggestions.length
      ? `${suggestions.length} value${suggestions.length === 1 ? "" : "s"} differ from the transitions.dev tokens.`
      : "Already aligned to the motion tokens.",
  };
}

async function answerJob(job) {
  job.status = "working";
  job.updatedAt = now();
  // Snapshot the current wiring once for this job (the resolver is self-healing
  // on a TTL; capturing avoids a mid-job change between the guard and the spawn).
  const AGENT_CMD = agentCmd();
  const isApply = job.request?.kind === "apply";
  const isScan = job.request?.kind === "scan";
  const label = job.request?.label || job.request?.selector || "transition";
  // The browser picks the mode per job via the LLM / Deterministic tabs.
  // Default: LLM when a command is configured, otherwise deterministic.
  const mode = job.request?.mode || (AGENT_CMD ? "llm" : "deterministic");
  job.statusLog.push({
    message: isApply ? `Writing "${label}" to your code…` : isScan ? "Grouping transitions from your source…" : `Scanning "${label}"…`,
    at: now(),
  });
  try {
    let result;
    if (isApply) {
      // Editing source can only be done by the agent.
      if (!AGENT_CMD) {
        throw new Error(
          "Saving to your code needs the agent. Run `/refine live` in your editor, " +
            "or start the relay with REFINE_AGENT_CMD set."
        );
      }
      job.statusLog.push({ message: "Editing source files…", at: now() });
      result = await runAgentCmd(AGENT_CMD, buildApplyPrompt(job), parseApplyOutput);
      job.result = { applied: result.applied, summary: result.summary, files: result.files };
      job.status = "done";
      job.updatedAt = now();
      console.log(`  ✓ apply ${job.id.slice(0, 8)} — applied=${result.applied}`);
      return;
    }
    if (isScan) {
      // Reading source to group transitions can only be done by the agent.
      if (!AGENT_CMD) {
        throw new Error(
          "Grouping transitions needs the agent. Run `/refine live` in your editor, " +
            "or start the relay with REFINE_AGENT_CMD set."
        );
      }
      job.statusLog.push({ message: "Reading components from source…", at: now() });
      result = await runAgentCmd(withScanSpeed(AGENT_CMD), buildScanPrompt(job), parseScanOutput);
      job.result = { groups: result.groups, summary: result.summary };
      job.status = "done";
      job.updatedAt = now();
      console.log(`  ✓ scan ${job.id.slice(0, 8)} — ${result.groups.length} group(s)`);
      return;
    }
    if (mode === "llm") {
      if (!AGENT_CMD) {
        throw new Error(
          "LLM mode needs an agent CLI. Restart the relay with REFINE_AGENT_CMD set " +
            "(e.g. REFINE_AGENT_CMD='cursor-agent -p --trust --force' npm run relay), or switch to the Deterministic tab."
        );
      }
      job.statusLog.push({ message: "Asking your agent…", at: now() });
      const t0 = now();
      result = await runAgentCmd(withModel(AGENT_CMD, REFINE_MODEL), buildPrompt(job));
      console.log(`  ⏱ refine agent ${job.id.slice(0, 8)} (${job.request?.refineType || "small"}) ${now() - t0}ms`);
    } else {
      job.statusLog.push({ message: "Matching values to the motion tokens…", at: now() });
      result = refineDeterministic(job);
    }
    job.result = { suggestions: result.suggestions, summary: result.summary };
    job.status = "done";
    job.updatedAt = now();
    console.log(`  ✓ job ${job.id.slice(0, 8)} — ${result.suggestions.length} suggestion(s)`);
  } catch (e) {
    job.error = String(e.message || e);
    job.status = "error";
    job.updatedAt = now();
    console.error(`  ✗ job ${job.id.slice(0, 8)} — ${job.error}`);
  }
}

// ── http plumbing ────────────────────────────────────────────────────────────

function send(res, status, body) {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || "GET";

  if (method === "OPTIONS") return send(res, 204);

  if (method === "GET" && path === "/health") {
    const ai = agentInfo();
    return send(res, 200, {
      ok: true,
      version: PKG_VERSION,
      auto: AUTO,
      llmAvailable: llmAvailable(),
      pollerActive: pollerActive(),
      pollerStopped,
      agentCmd: Boolean(ai.cmd),
      // Why LLM mode isn't wired by a spawned CLI (panel surfaces this + offers a
      // Reconnect that POSTs /agent/recheck). null when an agent IS wired.
      agentSource: ai.source,
      agentLabel: ai.label,
      agentReason: ai.cmd ? null : ai.reason,
      cliInstalled: cursorCliInstalled(),
      jobs: jobs.size,
    });
  }

  // GET /inject.js — the self-mounting timeline, served to any page.
  if (method === "GET" && (path === "/inject.js" || path === "/timeline.mjs")) {
    try {
      const mod = await buildInjectModule({ noCache: process.env.REFINE_INJECT_NOCACHE === "1" });
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      });
      return res.end(mod);
    } catch (e) {
      return send(res, 500, { error: String(e.message || e) });
    }
  }

  // POST /jobs — browser enqueues a refine request.
  if (method === "POST" && path === "/jobs") {
    const body = await readJson(req);
    if (!body || typeof body.request !== "object" || body.request === null) {
      return send(res, 400, { error: "Body must be { request: {...} }" });
    }
    const job = createJob(body.request);
    // Apply and scan jobs read/edit source — agent only, never deterministic.
    const mode = (job.request.kind === "apply" || job.request.kind === "scan")
      ? "llm"
      : (job.request.mode || (llmAvailable() ? "llm" : "deterministic"));
    job.request.mode = mode;

    // Provisional grouping: for a scan, try to group the components IN-PROCESS
    // from the CSSOM harvest the browser already sent (entry.cssRules). This is
    // the slow part — a cold agent turn — so showing a result in <1ms here makes
    // the panel feel instant in BOTH wired and /refine-live modes. The real agent
    // scan still runs below and OVERWRITES this when it lands (see answerJob /
    // POST /jobs/:id/result), so final naming/grouping stays agent-quality. When
    // the grouper isn't confident it returns null → unchanged, agent-only flow.
    if (job.request.kind === "scan") {
      try {
        const prov = groupDeterministic(job.request.raw);
        if (prov && prov.groups && prov.groups.length) {
          job.result = { groups: prov.groups, summary: prov.summary, provisional: true };
          job.updatedAt = now();
          job.statusLog.push({ message: `Grouped ${prov.groups.length} component(s) — refining names…`, at: now() });
        }
      } catch (e) {
        console.warn(`  provisional grouping failed (${String((e && e.message) || e).slice(0, 120)}) — deferring to agent`);
      }
    }

    if (!AUTO) {
      // External-poller-only mode: everything waits on GET /jobs/next.
    } else if (mode === "deterministic") {
      setImmediate(() => answerJob(job)); // in-process, off the response path
    } else if (agentCmd()) {
      setImmediate(() => answerJob(job)); // spawn the configured CLI once
    } else if (pollerActive()) {
      // A `/refine live` agent is polling — leave it pending for them to claim.
      job.statusLog.push({ message: "Waiting for your agent (/refine live)…", at: now() });
      setTimeout(() => {
        if (job.status === "pending" || job.status === "working") {
          job.status = "error";
          job.error = "No agent answered in time. Is `/refine live` still running?";
          job.updatedAt = now();
        }
      }, PENDING_TIMEOUT_MS);
    } else {
      job.status = "error";
      job.error =
        "LLM mode needs a live agent. In Cursor/Codex run `/refine live`, " +
        "or start the relay with REFINE_AGENT_CMD set — or use the Deterministic tab.";
    }
    return send(res, 201, { id: job.id, status: job.status });
  }

  // GET /jobs/next — long-poll claimed by a `/refine live` agent (LLM jobs).
  if (method === "GET" && path === "/jobs/next") {
    // Stopped latch: a Stop was issued and not yet resumed. STICKY — every poll
    // gets {stop:true} and the poller reports inactive until an explicit
    // POST /poller/start (a fresh `/refine live` / loop announcing itself) or a
    // relay restart. We deliberately do NOT auto-resume on a quiet gap: a stubborn
    // agent's straggler poll arriving seconds later would be misread as a new
    // session and flip the panel back to "Live" — which is exactly the bug where
    // Stop "didn't stick". A pending job still wins so we never drop real work.
    if (pollerStopped && !nextPendingLlm()) {
      return send(res, 200, { stop: true });
    }
    lastPollAt = now();
    if (!lastJobAt) lastJobAt = now(); // seed idle window on the loop's first poll
    // Idle auto-stop (or a leftover stopRequested) → latch stopped + tell the
    // loop to exit. A pending job always wins so we never drop real work.
    if ((stopRequested || (POLLER_IDLE_STOP_MS && now() - lastJobAt >= POLLER_IDLE_STOP_MS)) && !nextPendingLlm()) {
      stopRequested = false;
      pollerStopped = true; // latch until an explicit /poller/start
      lastJobAt = 0;
      lastPollAt = 0; // loop is exiting → report it inactive immediately on /health
      return send(res, 200, { stop: true });
    }
    const deadline = now() + LONGPOLL_MS;
    const attempt = () => {
      if (res.writableEnded) return;
      if (stopRequested && !nextPendingLlm()) {
        stopRequested = false;
        pollerStopped = true; // latch until an explicit /poller/start
        lastJobAt = 0;
        lastPollAt = 0; // loop is exiting → report it inactive immediately on /health
        return send(res, 200, { stop: true });
      }
      const job = nextPendingLlm();
      if (job) {
        lastJobAt = now();
        job.status = "working";
        job.updatedAt = now();
        return send(res, 200, { id: job.id, request: job.request });
      }
      if (now() >= deadline) return send(res, 204);
      setTimeout(attempt, 400);
    };
    return attempt();
  }

  // POST /poller/stop — the panel's "Stop" button. Flags the in-chat loop to
  // exit on its next poll. No-op for a wired REFINE_AGENT_CMD (never polls).
  if (method === "POST" && path === "/poller/stop") {
    const wasActive = now() - lastPollAt < POLLER_TTL_MS;
    stopRequested = true;
    pollerStopped = true; // latch: stays stopped until an explicit /poller/start
    lastPollAt = 0; // report inactive immediately; a straggler poll won't revive it
    return send(res, 200, { ok: true, stopping: wasActive });
  }

  // POST /shutdown — let the CLI replace a stale relay cleanly. `live` calls this
  // when it finds an older-version relay on the port (the npx-cache / lingering-
  // daemon trap) so a re-run always converges to the current build.
  if (method === "POST" && path === "/shutdown") {
    send(res, 200, { ok: true, version: PKG_VERSION });
    setTimeout(() => process.exit(0), 50);
    return;
  }

  // POST /agent/recheck — force an immediate agent re-resolve, bypassing the TTL.
  // Backs the panel's "Reconnect" affordance: after the user installs / logs into
  // a CLI, this wires it right away instead of waiting out the recheck interval.
  if (method === "POST" && path === "/agent/recheck") {
    const ai = agentInfo(true);
    return send(res, 200, { ok: true, agentCmd: Boolean(ai.cmd), agentLabel: ai.label, agentReason: ai.cmd ? null : ai.reason });
  }

  // POST /poller/start — a fresh `/refine live` agent (or loop) announces itself
  // and clears the Stop latch so its polls count as live again. Without this an
  // explicit re-run couldn't resume at all (the sticky latch tells every poll to
  // stop). Call it once at loop startup, before the first GET /jobs/next.
  if (method === "POST" && path === "/poller/start") {
    pollerStopped = false;
    stopRequested = false;
    lastJobAt = now();
    lastPollAt = now();
    return send(res, 200, { ok: true });
  }

  const m = path.match(/^\/jobs\/([^/]+)(?:\/(status|result|error))?$/);
  if (m) {
    const job = jobs.get(m[1]);
    if (!job) return send(res, 404, { error: "No such job" });
    const sub = m[2];

    if (method === "GET" && !sub) {
      return send(res, 200, {
        id: job.id,
        status: job.status,
        statusLog: job.statusLog,
        result: job.result,
        error: job.error,
      });
    }

    if (method === "POST" && sub === "status") {
      const body = await readJson(req);
      const message = body && typeof body.message === "string" ? body.message : null;
      if (!message) return send(res, 400, { error: "Body must be { message }" });
      job.statusLog.push({ message, at: now() });
      job.updatedAt = now();
      return send(res, 200, { ok: true });
    }

    if (method === "POST" && sub === "result") {
      const body = await readJson(req);
      if (body && Array.isArray(body.suggestions)) {
        job.result = { suggestions: body.suggestions, summary: body.summary ?? null };
      } else if (body && Array.isArray(body.groups)) {
        // scan-job result from a `/refine live` agent
        job.result = { groups: body.groups, summary: body.summary ?? null };
      } else if (body && typeof body.applied !== "undefined") {
        // apply-job result from a `/refine live` agent
        job.result = { applied: Boolean(body.applied), summary: body.summary ?? null, files: Array.isArray(body.files) ? body.files : null };
      } else {
        return send(res, 400, { error: "Body must be { suggestions: [...] }, { groups: [...] }, or { applied, summary }" });
      }
      job.status = "done";
      job.updatedAt = now();
      return send(res, 200, { ok: true });
    }

    if (method === "POST" && sub === "error") {
      const body = await readJson(req);
      job.error = (body && body.message) || "Agent reported an error";
      job.status = "error";
      job.updatedAt = now();
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`refine relay listening on http://localhost:${PORT}`);
  console.log(`  timeline injectable at  http://localhost:${PORT}/inject.js`);
  const ai = agentInfo();
  if (!AUTO) {
    console.log("  auto-answer OFF (REFINE_AUTO=0) — all jobs wait for a poller on GET /jobs/next");
  } else if (ai.cmd) {
    console.log(`  LLM jobs answered by spawning: ${ai.cmd}`);
  } else {
    console.log(`  no agent CLI wired yet (${ai.reason || "none found"}) — re-checking every ${Math.round(AGENT_RECHECK_MS / 1000)}s.`);
    console.log("  LLM jobs wait for a live agent — run `/refine live` in Cursor/Codex.");
    console.log(`  live agent stays 'available' for ${Math.round(POLLER_TTL_MS / 1000)}s after its last poll.`);
    console.log("  Deterministic jobs answered in-process (nearest motion token).");
  }
});
