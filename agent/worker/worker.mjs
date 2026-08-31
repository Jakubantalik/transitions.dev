// Transitions Agent fix service (Cloudflare Worker).
// Option C architecture: this service holds the Anthropic API key. Clients send
// findings + file contents with a license key; the service validates the
// license, meters monthly usage, asks Claude for fixed files, and returns them.
//
// Bindings (wrangler.toml):
//   KV  LICENSES  key: license key,        value: {"plan":"team","quota":200,"active":true}
//   KV  USAGE     key: "<license>:<YYYY-MM>", value: "<count>"
//   secret ANTHROPIC_API_KEY
//
// Deploy: npx wrangler deploy   (route it under api.transitions.dev)

const MODEL = "claude-sonnet-5";
const DEFAULT_QUOTA = 200;
const MAX_BODY_BYTES = 600_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/v1/agent/fix") {
      return handleFix(request, env);
    }
    return json({ error: "not found" }, 404);
  },
};

async function handleFix(request, env) {
  const license = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!license) return json({ error: "missing license" }, 401);

  const record = await env.LICENSES.get(license, { type: "json" });
  if (!record || record.active === false) return json({ error: "invalid license" }, 401);

  const month = new Date().toISOString().slice(0, 7);
  const usageKey = `${license}:${month}`;
  const used = parseInt((await env.USAGE.get(usageKey)) || "0", 10);
  const quota = record.quota || DEFAULT_QUOTA;
  if (used >= quota) return json({ error: "quota exceeded", used, quota }, 429);

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  const { findings = [], files = [] } = body;
  if (!files.length) return json({ error: "no files" }, 400);

  const fixed = await proposeFixes(env, findings, files);
  await env.USAGE.put(usageKey, String(used + 1), { expirationTtl: 60 * 60 * 24 * 62 });

  return json({ ...fixed, usage: { used: used + 1, quota } });
}

async function proposeFixes(env, findings, files) {
  const system = [
    "You are Transitions Agent, an expert in production UI motion.",
    "You receive source files and a list of motion findings. Return the corrected files.",
    "Rules: animate transform and opacity, never layout properties. Keep durations on",
    "a small token scale. Always respect prefers-reduced-motion. Change as little as",
    "possible; never touch logic, only motion. Style guidance: https://transitions.dev.",
    'Respond with ONLY a JSON object: {"summary": "<short human summary>",',
    '"files": [{"path": "...", "content": "<full corrected file>"}]}.',
    "Include only files you actually changed.",
  ].join(" ");

  const user = JSON.stringify({ findings, files });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Response(JSON.stringify({ error: "model error", detail }), { status: 502 });
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
