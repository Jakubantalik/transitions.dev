// Transitions Agent fix service (Cloudflare Worker).
// Option C architecture: this service holds the Anthropic API key. Clients send
// findings + file contents with a license key; the service validates the
// license, meters monthly usage, asks Claude for fixed files, and returns them.
//
// Bindings (wrangler.toml):
//   KV  LICENSES  key: license key,        value: {"plan":"free"|"team","quota":10|200,"active":true}
//   KV  USAGE     key: "<license>:<YYYY-MM>", value: "<count>"
//                 also "<license>:d:<YYYY-MM-DD>" (free daily) and
//                 "global:free:<YYYY-MM>" (free-tier budget fuse)
//   KV  RECIPES   key: "recipe:<slug>",    value: {"slug","tier","variants":{css,react,...}}
//                 populated by pack-recipes.mjs (free + Pro recipe sources)
//   var FREE_GLOBAL_MONTHLY   total free-tier fixes across all users per month
//   secret ANTHROPIC_API_KEY
//
// Deploy: npx wrangler deploy   (route it under api.transitions.dev)
//
// Plans. free: polish only, haiku, 10 fixes/month, 2/day, shared monthly budget
// fuse. team: polish + revamp, sonnet, 200 fixes/month.

const MODELS = { free: "claude-haiku-4-5-20251001", paid: "claude-sonnet-5" };
const QUOTAS = { free: 10, paid: 200 };
const FREE_DAILY_LIMIT = 5;
const DEFAULT_FREE_GLOBAL_MONTHLY = 2000;
const MAX_BODY_BYTES = 600_000;

import { handleMcp } from "./mcp.mjs";
import { BASE_RULES, MODE_RULES } from "./guidance.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/agent/fix") {
      return handleFix(request, env);
    }
    // MCP (streamable HTTP): the user's own AI connects here and fixes on
    // its own tokens; this server serves guidance + recipe sources only.
    if (request.method === "POST" && url.pathname === "/v1/agent/mcp") {
      return handleMcp(request, env);
    }
    if (request.method === "GET" && url.pathname === "/v1/agent/mcp") {
      return new Response(null, { status: 405 }); // JSON-only transport, no SSE stream
    }
    return json({ error: "not found" }, 404);
  },
};

async function handleFix(request, env) {
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
  const { findings = [], files = [], mode = "polish" } = body;
  if (!files.length) return json({ error: "no files" }, 400);
  if (mode !== "polish" && mode !== "revamp") return json({ error: "bad mode" }, 400);
  if (mode === "revamp" && isFree) {
    return json({ error: "revamp requires team", detail: "Revamp mode (full recipe rewrites, Pro library) is part of the Business plan." }, 403);
  }

  const month = new Date().toISOString().slice(0, 7);
  const usageKey = `${license}:${month}`;
  const used = parseInt((await env.USAGE.get(usageKey)) || "0", 10);
  const quota = record.quota || (isFree ? QUOTAS.free : QUOTAS.paid);
  if (used >= quota) return json({ error: "quota exceeded", used, quota }, 429);

  // Free-tier valves: per-day rate limit and a global monthly budget fuse.
  let dayKey, globalKey, dayUsed, globalUsed;
  if (isFree) {
    const day = new Date().toISOString().slice(0, 10);
    dayKey = `${license}:d:${day}`;
    dayUsed = parseInt((await env.USAGE.get(dayKey)) || "0", 10);
    if (dayUsed >= FREE_DAILY_LIMIT) {
      return json({ error: "daily limit", detail: `Free plan allows ${FREE_DAILY_LIMIT} fixes per day. Try again tomorrow or upgrade.` }, 429);
    }
    globalKey = `global:free:${month}`;
    globalUsed = parseInt((await env.USAGE.get(globalKey)) || "0", 10);
    const globalCap = parseInt(env.FREE_GLOBAL_MONTHLY || "", 10) || DEFAULT_FREE_GLOBAL_MONTHLY;
    if (globalUsed >= globalCap) {
      return json({ error: "free capacity", detail: "Free fix capacity for this month is used up. It resets on the 1st; Team plans are unaffected." }, 429);
    }
  }


  // Revamp rewrites against the real library source, Pro recipes included:
  // the license already paid for the fix, so tier does not gate the source here.
  const recipes = mode === "revamp" ? await loadRecipes(env, findings) : [];

  const model = isFree ? MODELS.free : MODELS.paid;
  // A model-side failure (rate limit, overload) is transient: surface it as a
  // clean 502 the CLI can explain, and do NOT count the fix against the quota.
  let fixed;
  try {
    fixed = await proposeFixes(env, findings, files, mode, recipes, model);
  } catch (e) {
    const detail = e?.detail || e?.message || "model error";
    console.error("[fix] model call failed:", detail);
    // Auth failures are our misconfiguration, not a blip: retrying cannot help.
    if (e?.status === 401 || e?.status === 403 || /credential|authentication|api.key/i.test(detail)) {
      return json({ error: "service_unavailable", detail: "The fix service is temporarily unavailable on our side. Nothing was counted against your quota; please try again later." }, 503);
    }
    return json({ error: "model_unavailable", detail: "The AI backend had a hiccup. Nothing was counted against your quota; try again in a minute." }, 502);
  }
  const ttl = { expirationTtl: 60 * 60 * 24 * 62 };
  await env.USAGE.put(usageKey, String(used + 1), ttl);
  if (isFree) {
    await env.USAGE.put(dayKey, String(dayUsed + 1), { expirationTtl: 60 * 60 * 48 });
    await env.USAGE.put(globalKey, String(globalUsed + 1), ttl);
  }

  return json({ ...fixed, usage: { used: used + 1, quota, plan: record.plan || "team" } });
}

const MAX_RECIPES = 4;

async function loadRecipes(env, findings) {
  const slugs = [...new Set(findings.map((f) => f.recipe).filter(Boolean))].slice(0, MAX_RECIPES);
  const recipes = [];
  for (const slug of slugs) {
    const rec = await env.RECIPES.get("recipe:" + slug, { type: "json" });
    if (rec) recipes.push(rec);
  }
  return recipes;
}

async function proposeFixes(env, findings, files, mode, recipes, model) {
  // polish: token-level adjustments only. revamp: full recipe rewrites allowed.
  // (Shared with the MCP server's fix_guidance tool - see guidance.mjs.)
  const system = [
    ...BASE_RULES,
    "You receive source files and a list of motion findings. Return the corrected files.",
    ...MODE_RULES[mode] || MODE_RULES.polish,
    'Respond with ONLY a JSON object: {"summary": "<short human summary>",',
    '"files": [{"path": "...", "content": "<full corrected file>"}]}.',
    "Include only files you actually changed.",
  ].join(" ");

  const user = JSON.stringify(recipes.length ? { findings, files, recipes } : { findings, files });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      // Org-level keys (not scoped to a workspace) must name one.
      ...(env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": env.ANTHROPIC_WORKSPACE_ID } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    const err = new Error("anthropic " + res.status);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { summary: "The model returned no changes.", files: [] };
  try {
    const parsed = JSON.parse(match[0]);
    return { summary: parsed.summary || "", files: parsed.files || [] };
  } catch {
    return { summary: "The model response could not be parsed.", files: [] };
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
