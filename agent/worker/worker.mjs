// Transitions Motion Agent fix service (Cloudflare Worker).
// Option C architecture: this service holds the Anthropic API key. Clients send
// findings + file contents with a license key; the service validates the
// license, meters monthly usage, asks Claude for fixed files, and returns them.
//
// Bindings (wrangler.toml):
//   KV  LICENSES  key: license key,        value: {"plan":"free"|"team","quota":10|200,"active":true}
//   KV  USAGE     key: "<license>:<YYYY-MM>", value: "<count>"
//                 also "<license>:d:<YYYY-MM-DD>" (free daily) and
//                 "global:free:<YYYY-MM>" (free-tier budget fuse) and
//                 "<license>:<YYYY-MM>:bonus" (extra fixes granted for that month)
//   KV  RECIPES   key: "recipe:<slug>",    value: {"slug","tier","variants":{css,react,...}}
//                 populated by pack-recipes.mjs (free + Pro recipe sources)
//   var FREE_GLOBAL_MONTHLY   total free-tier fixes across all users per month
//   D1  DB        transitions_pro: agent_events usage history (events.mjs)
//   secret ANTHROPIC_API_KEY
//
// Deploy: npx wrangler deploy   (route it under api.transitions.dev)
//
// Plans. free: polish only, haiku, 10 fixes/month, 5/day, shared monthly budget
// fuse. team: polish + revamp, sonnet, 200 fixes/month. A fix is one run,
// whatever the number of files in it; failed runs are never counted.

const MODELS = { free: "claude-haiku-4-5-20251001", paid: "claude-sonnet-5" };
const QUOTAS = { free: 10, paid: 200 };
const FREE_DAILY_LIMIT = 5;
const DEFAULT_FREE_GLOBAL_MONTHLY = 2000;
const MAX_BODY_BYTES = 600_000;
// Output budget per run. Big enough for a full batch of edits; a run that
// still reaches it keeps the edits it finished (salvageEdits).
const MAX_OUTPUT = { free: 32000, paid: 64000 };
// The most findings one run fixes, most important first; the rest wait for
// the next run. Runs that tried to fix everything at once (95 findings, or a
// revamp across 30+ files) ran out of output and gave nothing back.
const MAX_FINDINGS = { polish: 40, revamp: 15 };
const SEVERITY_RANK = { major: 0, warn: 1, minor: 2, info: 3 };
// USD per million tokens [input, output], for the cost noted on each run.
const PRICES = { "claude-haiku-4-5-20251001": [1, 5], "claude-sonnet-5": [3, 15] };
const ENTERPRISE = "https://transitions.dev/pro.html#enterprise";

import { handleMcp } from "./mcp.mjs";
import { BASE_RULES, MODE_RULES } from "./guidance.mjs";
import { logEvent } from "./events.mjs";
import { applyEdits, readMessageStream } from "./edits.mjs";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/agent/fix") {
      return handleFix(request, env, ctx);
    }
    // MCP (streamable HTTP): the user's own AI connects here and fixes on
    // its own tokens; this server serves guidance + recipe sources only.
    if (request.method === "POST" && url.pathname === "/v1/agent/mcp") {
      return handleMcp(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/v1/agent/license") {
      return handleLicense(request, env, ctx);
    }
    if (request.method === "GET" && url.pathname === "/v1/agent/mcp") {
      return new Response(null, { status: 405 }); // JSON-only transport, no SSE stream
    }
    return json({ error: "not found" }, 404);
  },
};

// What a key can do, so setup tools can say whether revamp is available.
async function handleLicense(request, env, ctx) {
  const license = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!license) return json({ error: "missing license" }, 401);
  const record = await env.LICENSES.get(license, { type: "json" });
  if (!record || record.active === false) return json({ error: "invalid license" }, 401);
  const isFree = record.plan === "free";
  const month = new Date().toISOString().slice(0, 7);
  const used = parseInt((await env.USAGE.get(`${license}:${month}`)) || "0", 10);
  const quota = (record.quota || (isFree ? QUOTAS.free : QUOTAS.paid)) + await monthBonus(env, license, month);
  logEvent(env, ctx, { event: "license", record });
  return json({ plan: record.plan, modes: isFree ? ["polish"] : ["polish", "revamp"], used, quota });
}

async function handleFix(request, env, ctx) {
  const license = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!license) return json({ error: "missing license" }, 401);

  const record = await env.LICENSES.get(license, { type: "json" });
  if (!record || record.active === false) return json({ error: "invalid license" }, 401);
  const isFree = record.plan === "free";

  // Plan gates before quota checks, so a free key asking for revamp hears
  // about revamp, not about today's limit.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  const { files = [], mode = "polish", components = [] } = body;
  if (!files.length) return json({ error: "no files" }, 400);
  // Only the findings for the files in this run reach the model. Older CLIs
  // sent every finding in the repository, which on a large project made the
  // prompt huge and the run time out.
  const sentPaths = new Set(files.map((f) => f && f.path));
  if (mode !== "polish" && mode !== "revamp") return json({ error: "bad mode" }, 400);
  const all = (body.findings || []).filter((f) => f && (f.path === "(project)" || sentPaths.has(f.path))).slice(0, 400);
  // This run's share: the most important findings, up to MAX_FINDINGS, and
  // only the files they are in (fewer files, less to read and to rewrite).
  const cap = MAX_FINDINGS[mode];
  const findings = all
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (SEVERITY_RANK[a.f.severity] ?? 2) - (SEVERITY_RANK[b.f.severity] ?? 2) || a.i - b.i)
    .slice(0, cap)
    .map((x) => x.f);
  const deferred = all.length - findings.length;
  const keep = new Set(findings.map((f) => f.path));
  const runFiles = deferred && files.some((f) => keep.has(f.path)) ? files.filter((f) => keep.has(f.path)) : files;
  const shape = { mode, findings: findings.length, files: files.length, score: body.score };
  if (mode === "revamp" && isFree) {
    logEvent(env, ctx, { event: "fix_blocked", record, ...shape, status: "revamp_gate" });
    // People asking for revamp are asking for a Business feature: make the
    // offer at that moment. A new error code on purpose: CLIs up to 0.11
    // print their own fixed line for "revamp requires team", but show this
    // detail as written for any other 403.
    const upgrade = "https://transitions.dev/pro.html?plan=business&from=revamp";
    const detail = [
      record.pro
        ? "Revamp is part of Business. You're on Pro, which includes polish mode."
        : "Revamp is part of Business. The free plan includes polish mode.",
      "Business rewrites your motion from the full Pro recipe library (polish only tunes values), with 200 hosted fixes a month, the GitHub Action merge gate, and one license for your whole team (5 seats included): $59/month.",
      record.pro ? "Sign in on the pricing page before you switch: your Pro moves into Business and the rest of this month is credited." : "",
      "Upgrade: " + upgrade,
      "Or run fix without --mode revamp for polish fixes now.",
    ].filter(Boolean).join("\n");
    return json({ error: "revamp_business", detail, upgrade }, 403);
  }

  const month = new Date().toISOString().slice(0, 7);
  const usageKey = `${license}:${month}`;
  const used = parseInt((await env.USAGE.get(usageKey)) || "0", 10);
  const quota = (record.quota || (isFree ? QUOTAS.free : QUOTAS.paid)) + await monthBonus(env, license, month);
  if (used >= quota) {
    logEvent(env, ctx, { event: "fix_blocked", record, ...shape, status: "quota" });
    // Out of this month's fixes: what is next, and for Business, Enterprise.
    const detail = isFree
      ? `You've used the ${quota} fixes in the free plan this month. They reset on the 1st. Business includes 200 a month with revamp: https://transitions.dev/pro.html`
      : `You've used all ${quota} fixes this month. They reset on the 1st. Need more? Enterprise runs the Motion Agent without monthly limits on your own AI keys: ${ENTERPRISE} (or email jakubja@gmail.com).`;
    return json({ error: "quota exceeded", detail, used, quota }, 429);
  }

  // Free-tier valves: per-day rate limit and a global monthly budget fuse.
  let dayKey, globalKey, dayUsed, globalUsed;
  if (isFree) {
    const day = new Date().toISOString().slice(0, 10);
    dayKey = `${license}:d:${day}`;
    dayUsed = parseInt((await env.USAGE.get(dayKey)) || "0", 10);
    if (dayUsed >= FREE_DAILY_LIMIT) {
      logEvent(env, ctx, { event: "fix_blocked", record, ...shape, status: "daily" });
      return json({ error: "daily limit", detail: `Free plan allows ${FREE_DAILY_LIMIT} fixes per day. Try again tomorrow or upgrade.` }, 429);
    }
    globalKey = `global:free:${month}`;
    globalUsed = parseInt((await env.USAGE.get(globalKey)) || "0", 10);
    const globalCap = parseInt(env.FREE_GLOBAL_MONTHLY || "", 10) || DEFAULT_FREE_GLOBAL_MONTHLY;
    if (globalUsed >= globalCap) {
      logEvent(env, ctx, { event: "fix_blocked", record, ...shape, status: "capacity" });
      return json({ error: "free capacity", detail: "Free fix capacity for this month is used up. It resets on the 1st; Team plans are unaffected." }, 429);
    }
  }


  const work = async () => {
    // Revamp rewrites against the real library source, Pro recipes included:
    // the license already paid for the fix, so tier does not gate the source here.
    const recipes = mode === "revamp" ? await loadRecipes(env, findings) : [];
    const model = isFree ? MODELS.free : MODELS.paid;
    // A failed run never counts against the quota.
    let fixed;
    try {
      fixed = await proposeFixes(env, findings, runFiles, mode, recipes, model,
        components.filter((c) => !c || !c.path || runFiles.some((f) => f.path === c.path)).slice(0, 30), isFree);
    } catch (e) {
      const detail = e?.detail || e?.message || "model error";
      console.error("[fix] model call failed:", e?.status, detail);
      logEvent(env, ctx, { event: "fix_error", record, ...shape, status: e?.kind || "model", detail: (e?.status ? e.status + " " : "") + detail });
      return modelFailure(e, detail);
    }
    const ttl = { expirationTtl: 60 * 60 * 24 * 62 };
    await env.USAGE.put(usageKey, String(used + 1), ttl);
    if (isFree) {
      await env.USAGE.put(dayKey, String(dayUsed + 1), { expirationTtl: 60 * 60 * 48 });
      await env.USAGE.put(globalKey, String(globalUsed + 1), ttl);
    }
    if (deferred) {
      fixed.summary = (fixed.summary ? fixed.summary + " " : "") +
        `This run fixed the ${findings.length} most important findings; ${deferred} more remain. Run fix again to continue.`;
      fixed.deferred = deferred;
    }
    const notes = [fixed.spend || "", fixed.skipped ? "edits skipped: " + fixed.skipped.join(", ") : "", fixed.truncated ? "output limit, partial" : "", deferred ? "deferred " + deferred : ""].filter(Boolean);
    delete fixed.spend;
    logEvent(env, ctx, { event: "fix", record, ...shape, ...(notes.length ? { detail: notes.join("; ") } : {}) });
    return { status: 200, body: { ...fixed, usage: { used: used + 1, quota, plan: record.plan || "team" } } };
  };

  // Clients that opt in get the answer on a stream that sends a space every
  // few seconds while the model works, so no proxy or client timeout fires on
  // a long fix. Leading whitespace keeps the body valid JSON; the real status
  // travels inside it.
  if (request.headers.get("x-ta-stream") === "1") return keepAlive(work, ctx);
  const { status, body: out } = await work();
  return json(out, status);
}

// Turn a model-call failure into an honest answer. Nothing is ever counted.
function modelFailure(e, detail) {
  const counted = "Nothing was counted against your quota.";
  if (e?.kind === "too_large") {
    return { status: 413, body: { error: "too_large", detail: "This run had more code than one fix can rewrite. " + counted + " Run it again with fewer files: the CLI retries with a smaller batch on its own." } };
  }
  if (e?.kind === "unreadable") {
    return { status: 502, body: { error: "model_unreadable", detail: "The AI answer could not be read. " + counted + " Try again." } };
  }
  // Anthropic does not serve some regions (China, Hong Kong, Russia and
  // others) and answers 403 "Request not allowed" there. Say so plainly
  // instead of blaming our side. (Status 502 so every CLI shows the detail.)
  if (e?.status === 403 && /not allowed|forbidden/i.test(detail)) {
    return { status: 502, body: { error: "region_unavailable", detail: "Hosted AI fixes are not available in your region: our AI provider, Anthropic, does not serve it. Scans and motion scores still work, and you can fix with your own AI through the Transitions MCP. " + counted + " Paid for a plan? You can ask for a refund anytime: email jakubja@gmail.com from your account address." } };
  }
  if (e?.status === 401 || e?.status === 403 || /credential|authentication|api.key/i.test(detail)) {
    return { status: 503, body: { error: "service_unavailable", detail: "The fix service is temporarily unavailable on our side. " + counted + " Please try again later." } };
  }
  if (e?.status === 429) {
    return { status: 502, body: { error: "model_busy", detail: "The AI backend is rate limiting us right now. " + counted + " Try again in a minute." } };
  }
  if (e?.status === 529 || /overloaded/i.test(detail)) {
    return { status: 502, body: { error: "model_busy", detail: "The AI backend is overloaded right now. " + counted + " Try again in a few minutes." } };
  }
  if (e?.status === 524 || e?.status === 504 || /timed? ?out|timeout/i.test(detail)) {
    return { status: 502, body: { error: "model_timeout", detail: "The fix took too long and timed out. " + counted + " Try again; if it keeps happening, fix fewer files per run." } };
  }
  return { status: 502, body: { error: "model_unavailable", detail: "The AI backend returned an error. " + counted + " Try again in a minute." } };
}

function keepAlive(work, ctx) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const tick = setInterval(() => { writer.write(enc.encode(" ")).catch(() => {}); }, 5000);
  const run = (async () => {
    let result;
    try { result = await work(); } catch (e) { result = { status: 500, body: { error: "server_error", detail: String(e?.message || e).slice(0, 200) } }; }
    clearInterval(tick);
    try {
      await writer.write(enc.encode(JSON.stringify({ ...result.body, status: result.status })));
      await writer.close();
    } catch { /* client went away */ }
  })();
  ctx?.waitUntil?.(run);
  // Compression would hold the spaces back until the end, so it is off here.
  return new Response(readable, {
    status: 200,
    encodeBody: "manual",
    headers: { "content-type": "application/json", "x-ta-stream": "1", "cache-control": "no-store, no-transform", "content-encoding": "identity" },
  });
}

// Extra fixes granted to one license for one month (support goodwill). Kept
// beside the usage counter so it expires with it and never touches the
// license record the billing webhook rewrites.
async function monthBonus(env, license, month) {
  const n = parseInt((await env.USAGE.get(`${license}:${month}:bonus`)) || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const MAX_RECIPES = 6;

async function loadRecipes(env, findings) {
  const slugs = [...new Set(findings.map((f) => f.recipe).filter(Boolean))].slice(0, MAX_RECIPES);
  const recipes = [];
  for (const slug of slugs) {
    const rec = await env.RECIPES.get("recipe:" + slug, { type: "json" });
    if (rec) recipes.push(rec);
  }
  return recipes;
}

async function proposeFixes(env, findings, files, mode, recipes, model, components = [], isFree = false) {
  // polish: token-level adjustments only. revamp: full recipe rewrites allowed.
  // (Shared with the MCP server's fix_guidance tool - see guidance.mjs.)
  // The model returns exact search-and-replace edits instead of whole files:
  // a big component costs a few hundred tokens to fix instead of thousands,
  // so a run is fast and never truncated. The edits are applied here, to the
  // files the client sent, and full files go back as before.
  const system = [
    ...BASE_RULES,
    "You receive source files and a list of motion findings. Fix them with exact search-and-replace edits.",
    ...MODE_RULES[mode] || MODE_RULES.polish,
    'Respond with ONLY a JSON object: {"summary": "<at most three short sentences for the engineer',
    'reviewing it: which components changed and how; no jargon like rAF or keyed>",',
    '"edits": [{"path": "<file path>", "find": "<exact text from the file>", "replace": "<new text>"}]}.',
    "Each find must be copied character for character from the current file, including indentation, and",
    "must appear exactly once in it: include a few surrounding lines when a snippet repeats. Edits to one file",
    "apply in order, each to the result of the previous one. To add new code, find a nearby line and replace",
    "it with that line plus the new code. Keep every edit as small as the change allows. Check that every",
    "edited declaration closes each parenthesis it opens, and no more.",
  ].join(" ");

  const user = JSON.stringify({ findings, files, ...(components.length ? { components } : {}), ...(recipes.length ? { recipes } : {}) });
  const { text, stop, usage } = await streamMessage(env, { model, max_tokens: isFree ? MAX_OUTPUT.free : MAX_OUTPUT.paid, system, messages: [{ role: "user", content: user }] });
  const [pin, pout] = PRICES[model] || [3, 15];
  const cost = usage ? ((usage.input_tokens + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1) * pin + usage.output_tokens * pout) / 1e6 : 0;
  const spend = usage ? `tokens ${usage.input_tokens}/${usage.output_tokens}, $${cost.toFixed(3)}` : "";

  let parsed, truncated = false;
  if (stop === "max_tokens") {
    // Out of output: keep every edit the model finished.
    parsed = salvageEdits(text);
    if (!parsed) {
      const err = new Error("output limit reached");
      err.kind = "too_large";
      err.detail = "max_tokens";
      throw err;
    }
    truncated = true;
  } else {
    // No readable answer is a failed run, not an empty one: it is not counted.
    const match = text.match(/\{[\s\S]*\}/);
    try { parsed = JSON.parse(match ? match[0] : ""); } catch {
      const err = new Error("unreadable model answer");
      err.kind = "unreadable";
      throw err;
    }
  }
  const { files: changed, skipped, broken } = applyEdits(files, parsed.edits || []);
  // Older answers in the whole-file shape still work.
  for (const f of parsed.files || []) if (f && f.path && typeof f.content === "string" && !changed.some((c) => c.path === f.path)) changed.push(f);
  let summary = parsed.summary || "";
  if (skipped.length) summary += (summary ? " " : "") + `Left unchanged because an edit did not match the file exactly: ${skipped.join(", ")}.`;
  if (broken.length) summary += (summary ? " " : "") + `Left unchanged because the edit would have broken the code: ${broken.join(", ")}.`;
  if (truncated) summary += (summary ? " " : "") + "The run hit its output limit, so only part of it was fixed. Run fix again to continue.";
  const notApplied = [...skipped, ...broken];
  return { summary, files: changed, ...(notApplied.length ? { skipped: notApplied } : {}), ...(truncated ? { truncated: true } : {}), spend };
}

// A response cut off by the output limit: {"summary":"...","edits":[{...},{...},{...
// Returns { summary, edits } with every edit object that closed, or null.
export function salvageEdits(text) {
  const start = text.indexOf('"edits"');
  if (start < 0) return null;
  const open = text.indexOf("[", start);
  if (open < 0) return null;
  const edits = [];
  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = open + 1; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") { if (depth === 0) objStart = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        try { const e = JSON.parse(text.slice(objStart, i + 1)); if (e && e.path && typeof e.find === "string") edits.push(e); } catch {}
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) break;
  }
  if (!edits.length) return null;
  const m = text.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)"/);
  let summary = "";
  try { summary = m ? JSON.parse('"' + m[1] + '"') : ""; } catch {}
  return { summary, edits };
}

// Anthropic's API sits behind an edge that cuts any response slower than 100
// seconds (error 524). Streaming keeps bytes flowing for as long as the model
// writes; the text is collected here.
async function streamMessage(env, payload) {
  const res = await fetch((env.ANTHROPIC_BASE_URL || "https://api.anthropic.com") + "/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      // Org-level keys (not scoped to a workspace) must name one.
      ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}),
    },
    body: JSON.stringify({ ...payload, stream: true }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error("anthropic " + res.status);
    err.status = res.status;
    err.detail = detail;
    if (res.status === 400 && /prompt is too long|too many tokens|max_tokens/i.test(detail)) err.kind = "too_large";
    throw err;
  }
  // The caller decides what a cut-off answer is worth (salvageEdits).
  return await readMessageStream(res.body);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
