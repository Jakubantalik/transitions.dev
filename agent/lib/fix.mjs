// Fix flow: send findings + files to the transitions.dev fix service (option C:
// the service holds the AI key), show proposed diffs, apply only after an
// explicit yes, optionally open a pull request after a second explicit yes.
// Keyless runs point to signup - the hosted service is the only fix path.
import { readFileSync, writeFileSync, mkdtempSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import readline from "node:readline";
import { isInteractive, runByAgent, sandboxNoNetwork, NETWORK_HELP } from "./env.mjs";
import { scan } from "./scan.mjs";
import { describeChanges, changesMarkdown, changesText } from "./describe.mjs";
import { TOKENS } from "./catalog.mjs";

// A run is sized by how much code the service has to read, not by file
// count: the model answers with small edits, so big files are fine, but one
// request still has to fit comfortably in the model's context.
const MAX_FILES = 15;
const MAX_FILE_BYTES = 100_000;
const BATCH_BYTES = 120_000;
const SEVERITY_WEIGHT = { major: 8, warn: 4, minor: 1, info: 0.25 };
// Findings a fix must never create where they were not before.
const REGRESSIONS = new Set(["hover-without-transition", "layout-animation", "untransitioned-overlay", "recipe-mismatch"]);
const findingKey = (f) => [f.rule, f.selector || f.usage || f.recipe || f.message].join("|");
// A transitions.dev token used in a fix always carries its value as a CSS
// fallback, var(--duration-fast, 250ms), so the fix works whether or not the
// project defines the tokens. Without it, an undefined token silently turns a
// transition off.
const TOKEN_VALUE = new Map(TOKENS.map((t) => [t.name, t.value]));
export function withTokenFallbacks(css) {
  return css.replace(/var\(\s*(--(?:duration|ease|distance|scale|blur)-[a-z-]+)\s*\)/g, (m, name) => (TOKEN_VALUE.has(name) ? `var(${name}, ${TOKEN_VALUE.get(name)})` : m));
}

// The service sends a space every few seconds while it works; this long a
// silence means the connection is dead.
const IDLE_MS = 90_000;

async function readBody(res, idleMs) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    let timer;
    const idle = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("idle"), { idle: true })), idleMs); });
    let step;
    try { step = await Promise.race([reader.read(), idle]); }
    catch (e) { reader.cancel().catch(() => {}); throw e; }
    finally { clearTimeout(timer); }
    if (step.done) return out + decoder.decode();
    out += decoder.decode(step.value, { stream: true });
  }
}

// Which files this run fixes: the most important first (by finding severity),
// with the markup that drives a component in revamp mode, until the size
// budget is used. Everything else waits for the next run.
export function planBatch(root, fixable, mode, { budget = BATCH_BYTES, maxFiles = MAX_FILES } = {}) {
  const byPath = new Map();
  for (const f of fixable) {
    const e = byPath.get(f.path) || { path: f.path, weight: 0, related: new Set(), onlyInfo: true };
    e.weight += SEVERITY_WEIGHT[f.severity] ?? 1;
    if (f.severity !== "info") e.onlyInfo = false;
    if (mode === "revamp") for (const r of f.related || []) e.related.add(r);
    byPath.set(f.path, e);
  }
  const order = [...byPath.values()].sort((a, b) => b.weight - a.weight || a.path.localeCompare(b.path));
  const sizeOf = (p) => { try { return statSync(join(root, p)).size; } catch { return null; } };
  const paths = [];
  const tooBig = [];
  let bytes = 0;
  for (const e of order) {
    const own = sizeOf(e.path);
    if (own == null) continue;
    if (own > MAX_FILE_BYTES) { tooBig.push(e.path); continue; }
    const group = [e.path, ...e.related].filter((p) => !paths.includes(p)).filter((p) => { const z = sizeOf(p); return z != null && z <= MAX_FILE_BYTES; });
    const add = group.reduce((sum, p) => sum + sizeOf(p), 0);
    if (paths.length && (bytes + add > budget || paths.length + group.length > maxFiles)) continue;
    paths.push(...group);
    bytes += add;
    if (bytes >= budget || paths.length >= maxFiles) break;
  }
  const remaining = order.filter((e) => !paths.includes(e.path) && !tooBig.includes(e.path));
  return { paths, bytes, tooBig, remaining: remaining.map((e) => e.path), remainingInfoOnly: remaining.filter((e) => e.onlyInfo).length };
}

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

// polish (the transitions-polish skill): values onto the motion scale by usage,
// hover coverage, reduced motion. revamp (the transitions.dev skill): polish
// plus installing the library recipe on every recognized component.
const POLISH_RULES = new Set([
  "hardcoded-duration", "transition-all", "no-reduced-motion", "inconsistent-durations",
  "hover-without-transition", "slow-duration", "off-scale", "layout-animation",
]);

export function findingsForMode(findings, mode) {
  if (mode === "revamp") return findings;
  return findings.filter((f) => POLISH_RULES.has(f.rule));
}

// opts.report, when given, is filled with what happened so callers (the
// GitHub Action) can act on it: { status, reason, before, after, applied,
// summary, usage, pr: { number, url, created } }.
export async function runFix(root, result, opts) {
  const { api, license, yes, pr, mode = "polish", report = {} } = opts;
  const done = (code, status, reason) => { report.status = status; if (reason) report.reason = reason; return code; };
  report.mode = mode;
  report.before = result.score;
  const findings = findingsForMode(result.findings, mode);
  const skipped = result.findings.length - findings.length;
  report.recipeFindings = skipped;
  if (skipped > 0) {
    console.log(c.dim(`${skipped} findings need the library recipe (--mode revamp) and are skipped in polish mode.`));
  }
  const fixable = findings.filter((f) => f.path !== "(project)");
  if (!fixable.length && !findings.length) {
    console.log(c.green("Nothing to fix" + (mode === "polish" ? " in polish mode." : ".")));
    return done(0, "nothing", "nothing to fix" + (mode === "polish" ? " in polish mode" : ""));
  }

  const plan = planBatch(root, fixable, mode);
  report.deferred = plan.remaining.length;
  if (!plan.paths.length) {
    const msg = plan.tooBig.length
      ? `The files with findings are over ${MAX_FILE_BYTES / 1000}KB each, too big to fix automatically: ${plan.tooBig.slice(0, 3).join(", ")}${plan.tooBig.length > 3 ? ", ..." : ""}.`
      : "The files with findings could not be read.";
    console.log(c.yellow(msg));
    return done(1, "too-large", msg);
  }

  if (!license) {
    await offerSignup(api);
    console.log("Hosted fixes need a license key. Free plan: 10 polish fixes/month.");
    console.log("Get yours: " + c.bold("npx transitions-agent signup") + c.dim(" (opens the browser)") + " - then re-run fix.");
    return done(1, "no-license", "no license key");
  }

  // Ask for fixes. The service streams its answer (a space every few seconds
  // while the model works) so long fixes never hit a timeout; a batch that is
  // still too big is retried with fewer files.
  let batch = plan.paths;
  let paths = batch;
  let status = 0;
  let data = {};
  for (let attempt = 0; ; attempt++) {
    paths = batch;
    const files = [];
    for (const p of batch) {
      try { files.push({ path: p, content: readFileSync(join(root, p), "utf8") }); } catch { /* file may be gone */ }
    }
    const inBatch = new Set(batch);
    const sent = findings.filter((f) => f.path === "(project)" || inBatch.has(f.path));
    const later = plan.remaining.length + (plan.paths.length - batch.length);
    console.log(c.dim(`Requesting ${mode} fixes for ${files.length} file${files.length === 1 ? "" : "s"}` + (later ? `, the most important first (${later} more next run)` : "") + "..."));
    try {
      const res = await fetch(api + "/v1/agent/fix", {
        method: "POST",
        // Uncompressed, so the service's keepalive spaces arrive as it sends them.
        headers: { "content-type": "application/json", authorization: "Bearer " + license, "x-ta-stream": "1", "accept-encoding": "identity" },
        body: JSON.stringify({
          mode, findings: sent, files, score: result.score,
          components: (result.components || []).filter((x) => x.status !== "matches" && inBatch.has(x.path)),
        }),
      });
      const raw = await readBody(res, IDLE_MS);
      try { data = raw.trim() ? JSON.parse(raw) : {}; } catch { data = {}; }
      const streamed = res.headers.get("x-ta-stream") === "1";
      status = streamed ? (data.status ?? 0) : res.status;
    } catch (e) {
      const cause = (e && e.cause && (e.cause.code || e.cause.message)) || "";
      if (e && e.idle) {
        console.error(c.red("✗ ") + "The fix service stopped responding mid-run. Run it again.");
        return done(1, "unreachable", "the fix service stopped responding mid-run");
      }
      console.error(c.red("✗ ") + "Could not reach the fix service: " + e.message + (cause ? ` (${cause})` : ""));
      // Only a failed lookup or refused connection points at a sandbox without network.
      if (sandboxNoNetwork() || (runByAgent() && /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH|getaddrinfo/i.test(cause))) console.error(NETWORK_HELP);
      ciSummary("Could not reach the fix service: " + e.message);
      return done(1, "unreachable", "could not reach the fix service");
    }
    if (status === 0) {
      console.error(c.red("✗ ") + "The connection dropped before the fixes arrived. Run it again.");
      return done(1, "unreachable", "the connection dropped before the fixes arrived");
    }
    if ((status === 413) && batch.length > 1 && attempt < 3) {
      batch = batch.slice(0, Math.max(1, Math.floor(batch.length / 2)));
      console.log(c.dim("That was more code than one run can handle. Retrying with fewer files (nothing was counted)..."));
      continue;
    }
    break;
  }

  if (status === 401) {
    console.error(c.red("✗ ") + "License key not valid. Check TRANSITIONS_AGENT_LICENSE.");
    ciSummary("License key not valid. Check the `TRANSITIONS_AGENT_LICENSE` repo secret.");
    return done(1, "invalid-license", "the license key is not valid");
  }
  if (status === 403 || status === 429) {
    const err = data;
    if (err.error === "revamp requires team") {
      console.error(c.yellow("Revamp mode is a Business plan feature") + " (full recipe rewrites, Pro library).");
      console.error("Your free plan includes polish mode. Upgrade at " + c.bold("transitions.dev/pro.html") + " or run without --mode revamp.");
      ciSummary("Revamp mode needs a Business license. This key covers polish mode; upgrade at https://transitions.dev/pro.html.");
      return done(1, "revamp-needs-business", "revamp needs the Business plan");
    }
    const msg = (err.detail || "Monthly fix quota reached. Upgrade at transitions.dev/pro.") +
      (err.error === "daily limit" ? " Business has no daily cap: transitions.dev/pro.html" : "");
    console.error(c.red("✗ ") + msg);
    ciSummary("No fixes this run: " + msg);
    return done(1, "quota", msg);
  }
  if (status === 503) {
    console.error(c.yellow("The fix service is down on our side.") + " " + (data.detail || "Please try again later."));
    ciSummary("The fix service is down on our side. Re-run this workflow later.");
    return done(1, "service-down", "the fix service is down on our side");
  }
  if (status === 413) {
    const msg = data.detail || "This file has more code than one fix can handle.";
    console.error(c.yellow("Too big for one run.") + " " + msg);
    return done(1, "too-large", msg);
  }
  if (status === 502) {
    console.error(c.yellow("The fix did not go through.") + " " + (data.detail || "Try again in a minute."));
    return done(1, "model-failed", (data.detail || "the AI backend returned an error").replace(/\.$/, ""));
  }
  if (status < 200 || status >= 300) { console.error(c.red("✗ ") + `Fix service error (${status}).`); return done(1, "error", `fix service error ${status}`); }
  report.summary = data.summary || "";
  report.usage = data.usage || null;
  const proposed = (data.files || []).filter((f) => f.path && typeof f.content === "string")
    .map((f) => ({ ...f, content: withTokenFallbacks(f.content) }));
  if (!proposed.length) { console.log(c.yellow("The service proposed no changes.")); return done(0, "no-changes", "the service proposed no changes"); }

  // Show each proposal as a diff. Nothing is written yet.
  for (const p of proposed) showDiff(root, p);
  if (data.summary) console.log("\n" + data.summary + "\n");
  if (data.usage) console.log(c.dim(`Fixes used this month: ${data.usage.used}/${data.usage.quota}`));

  const apply = yes || await confirm(`Apply these changes to ${proposed.length} files? [y/N] `);
  if (!apply) { console.log(c.dim("Nothing changed.")); return done(0, "declined"); }
  const originals = new Map();
  for (const p of proposed) {
    const dest = join(root, p.path);
    let original = "";
    try { original = readFileSync(dest, "utf8"); } catch { /* new file */ }
    originals.set(p.path, original);
    const content = original.endsWith("\n") && !p.content.endsWith("\n") ? p.content + "\n" : p.content;
    writeFileSync(dest, content);
  }
  // Never make motion worse: a file whose fix creates a new problem (a hover
  // that now snaps, a layout jump, a surface that now pops) goes back to how
  // it was, whatever the model intended.
  let afterResult = scan(root);
  const reverted = [];
  for (const p of proposed) {
    const was = new Set(result.findings.filter((f) => f.path === p.path && REGRESSIONS.has(f.rule)).map(findingKey));
    const worse = afterResult.findings.find((f) => f.path === p.path && REGRESSIONS.has(f.rule) && !was.has(findingKey(f)));
    if (!worse) continue;
    writeFileSync(join(root, p.path), originals.get(p.path));
    reverted.push({ path: p.path, why: worse.message });
  }
  if (reverted.length) {
    afterResult = scan(root);
    for (const r of reverted) console.log(c.yellow("↺ ") + `Left ${r.path} as it was: the fix would have introduced a problem (${r.why.slice(0, 120)}).`);
  }
  const kept = proposed.filter((p) => !reverted.some((r) => r.path === p.path));
  report.reverted = reverted.map((r) => r.path);
  if (!kept.length) {
    console.log(c.yellow("No changes kept: every proposed fix would have made something worse. Nothing else was changed."));
    return done(0, "no-changes", "the proposed fixes would have made the motion worse, so none were kept");
  }
  const after = afterResult.score;
  const changes = describeChanges(result, afterResult, { mode });
  report.after = after;
  report.applied = kept.map((p) => p.path);
  report.changes = changes;
  // Progress in the files this run touched; on a big project the overall
  // score moves only as more files are fixed.
  const touched = new Set(kept.map((p) => p.path));
  const beforeHere = result.findings.filter((f) => touched.has(f.path)).length;
  const afterHere = afterResult.findings.filter((f) => touched.has(f.path)).length;
  report.fixedFindings = Math.max(0, beforeHere - afterHere);
  console.log(c.green("✓ ") + `Applied ${kept.length} file${kept.length === 1 ? "" : "s"}: fixed ${report.fixedFindings} of ${beforeHere} findings in them. Motion score ${result.score} to ${after}` +
    (after <= result.score && plan.remaining.length ? ` (the score covers the whole project, so it climbs as the remaining ${plan.remaining.length} files get fixed).` : "."));
  if (changes.groups.length || changes.remaining.length) console.log("\n" + c.bold("What changed") + "\n" + changesText(changes) + "\n");
  const left = plan.remaining.length + (plan.paths.length - paths.length);
  if (left) {
    const infoNote = plan.remainingInfoOnly ? ` (${plan.remainingInfoOnly} of them only have hand-rolled components the library could replace)` : "";
    console.log(c.dim(`${left} more file${left === 1 ? " has" : "s have"} findings${infoNote}. Run fix again to continue: each run takes the most important files next and counts as one fix.`));
  }

  if (!pr) {
    console.log(c.dim("Review with git diff. Re-run with --pr to open a pull request."));
    return done(0, "applied");
  }
  const code = await openPr(root, result, kept, { ...opts, yes, mode, after, changes, summary: data.summary || "" });
  return done(code, code === 0 && report.pr ? "pr" : code === 0 ? "applied" : "pr-failed", code === 0 ? null : "could not push the fixes or open the pull request");
}

function showDiff(root, proposal) {
  // git diff --no-index gives a familiar colored diff without touching the repo.
  const tmp = mkdtempSync(join(tmpdir(), "tagent-"));
  const tmpFile = join(tmp, "proposed");
  writeFileSync(tmpFile, proposal.content);
  const out = spawnSync("git", ["diff", "--no-index", "--color=always", "--", proposal.path, tmpFile], {
    cwd: root, encoding: "utf8", maxBuffer: 10_000_000,
  });
  console.log("\n" + c.bold(proposal.path));
  const body = (out.stdout || "").split("\n").slice(4).join("\n").trim();
  console.log(body || c.dim("(no change)"));
}

const MODE_LINE = {
  polish: "polish: tunes timing, easing, and hover transitions",
  revamp: "revamp: installs transitions.dev recipes on the components",
};

// The fix pull request's description: what someone will notice first, the
// technical notes folded away.
export function fixPrBody({ intro, mode, before, after, changes, summary, files, footer = [] }) {
  return [
    intro,
    "",
    `**Motion score: ${before} → ${after}** · ${MODE_LINE[mode] || mode}`,
    "",
    "### What changes",
    "",
    changes && changes.groups.length ? changesMarkdown(changes) : files.map((f) => `- \`${f}\``).join("\n"),
    "",
    ...footer,
    "<details>",
    "<summary>Technical notes</summary>",
    "",
    summary || "No notes.",
    "",
    "Files: " + files.map((f) => `\`${f}\``).join(", "),
    "",
    "</details>",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

function git(root, args, opts = {}) {
  return execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8", ...opts });
}

// The branch the fixes land on: the branch you ran from, so fixes stack on
// your work instead of going to main.
export function currentBranch(root) {
  try {
    const b = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    return b && b !== "HEAD" ? b : null;
  } catch { return null; }
}

// opts: base (target branch; default: the current branch), branch (the fix
// branch name; reused and force-pushed when given), title/body (override),
// report (filled with the pull request).
async function openPr(root, result, proposed, opts) {
  const { yes, mode, after, report = {} } = opts;
  const go = yes || await confirm("Create a branch, commit, push, and open a pull request? [y/N] ");
  if (!go) { console.log(c.dim("Changes stay local. Commit them yourself when ready.")); return 0; }
  const base = opts.base || currentBranch(root);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const branch = opts.branch || `transitions-agent/${mode}-${stamp}`;
  const custom = (v) => (typeof v === "function" ? v({ before: result.score, after, files: proposed.map((p) => p.path), summary: opts.summary, changes: opts.changes }) : v);
  const title = custom(opts.title) || (mode === "revamp"
    ? `Revamp UI transitions with transitions.dev recipes (motion score ${result.score} to ${after})`
    : `Polish UI transitions (motion score ${result.score} to ${after})`);
  const body = custom(opts.body) || fixPrBody({
    intro: "Transitions Agent reviewed the motion in this branch and proposes the changes below. Every change was shown as a diff and confirmed in the terminal first.",
    mode, before: result.score, after, changes: opts.changes, summary: opts.summary, files: proposed.map((p) => p.path),
  });
  try {
    git(root, ["checkout", "-B", branch]);
    git(root, ["add", ...proposed.map((p) => p.path)]);
    git(root, ["commit", "-m", opts.commitMessage || `fix(motion): transitions-agent ${mode} pass`]);
    git(root, ["push", ...(opts.branch ? ["--force"] : []), "-u", "origin", branch], { stdio: "inherit" });
  } catch (e) {
    console.error(c.red("✗ ") + "Git step failed: " + (e.stderr?.toString() || e.message));
    return 1;
  }
  // One pull request per fix branch: a re-run updates it instead of opening another.
  const existing = spawnSync("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number,url", "--limit", "1"], { cwd: root, encoding: "utf8" });
  let found = null;
  try { found = JSON.parse(existing.stdout || "[]")[0] || null; } catch { /* gh missing */ }
  if (found) {
    spawnSync("gh", ["pr", "edit", String(found.number), "--title", title, "--body", body], { cwd: root, stdio: "inherit" });
    report.pr = { number: found.number, url: found.url, created: false };
    console.log(c.green("✓ ") + "Updated pull request " + found.url);
    return 0;
  }
  const args = ["pr", "create", "--title", title, "--body", body, "--head", branch, ...(base ? ["--base", base] : [])];
  const gh = spawnSync("gh", args, { cwd: root, encoding: "utf8" });
  const url = (gh.stdout || "").trim().split("\n").pop();
  if (gh.status !== 0 || !/\/pull\/\d+/.test(url)) {
    console.log(c.yellow("Could not open the PR automatically (is GitHub CLI installed?)."));
    if (gh.stderr) console.log(c.dim(gh.stderr.trim()));
    console.log("Branch " + c.bold(branch) + " is pushed. Open the PR from GitHub with this description:\n\n" + body);
    return 0;
  }
  report.pr = { number: Number(url.match(/\/pull\/(\d+)/)[1]), url, created: true };
  console.log(c.green("✓ ") + "Opened " + url + (base ? " into " + base : ""));
  return 0;
}

// No key + a human at the keyboard: offer the free signup right here.
async function offerSignup(api) {
  console.log(c.yellow("No license key found.") + " The free plan includes 10 hosted fixes/month.");
  if (!isInteractive()) return;
  const email = (await ask("Email for a free license key? (enter to skip) ")).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  try {
    const res = await fetch(api + "/agent/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (res.ok) {
      console.log(c.green("✓ ") + `Check ${email} for your key, then: export TRANSITIONS_AGENT_LICENSE=<key> and re-run.`);
    } else {
      console.log(c.dim("Signup did not go through; try: npx transitions-agent signup " + email));
    }
  } catch {
    console.log(c.dim("Could not reach the signup service; try: npx transitions-agent signup " + email));
  }
}
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer); });
  });
}

async function confirm(question) {
  return /^y(es)?$/i.test((await ask(question)).trim());
}

// In GitHub Actions a failed fix run is easy to miss: surface the reason on
// the run's summary page, not only in the log.
function ciSummary(text) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try { appendFileSync(file, "### Transitions Agent fix\n\n" + text + "\n"); } catch { /* log already has it */ }
}
