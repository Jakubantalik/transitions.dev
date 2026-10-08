// Transitions Motion Agent MCP server (streamable HTTP, JSON responses).
// The user's own AI (Claude Code, Cursor, claude.ai, CI via claude-code-action)
// connects here and does the fixing on its own tokens; this server supplies
// what it cannot know: the scanner contract, the fix guidance, and the real
// recipe sources (Pro included, license-gated). No model is ever called here.
//
// Connect: claude mcp add --transport http transitions-agent \
//            https://api.transitions.dev/v1/agent/mcp \
//            --header "Authorization: Bearer <license key>"
//
// Metering: pro-tier recipe fetches count against a monthly allowance
// (generous; it protects the content, not the margin - serving KV is free).

import { logEvent } from "./events.mjs";
import { BASE_RULES, MODE_RULES, SCAN_INSTRUCTIONS } from "./guidance.mjs";

const PROTOCOL = "2025-06-18";
const PRO_FETCHES_PER_MONTH = 2000;

const TOOLS = [
  {
    name: "scan_instructions",
    description: "How to scan the current repository for motion issues (deterministic CLI, no AI) and what the findings mean.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "fix_guidance",
    description: "The transitions.dev rules for fixing motion findings. mode 'polish' = small token-level adjustments; 'revamp' = full rewrites from library recipes.",
    inputSchema: {
      type: "object",
      properties: { mode: { type: "string", enum: ["polish", "revamp"] } },
      required: ["mode"],
    },
  },
  {
    name: "list_recipes",
    description: "List every transitions.dev recipe (slug, name, tier). Use get_recipe for the source.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_recipe",
    description: "Fetch the authoritative source of a transitions.dev recipe (markdown with CSS and usage; Pro recipes also have react/typescript variants). Use the exact source when revamping motion.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "Recipe slug, e.g. modal-open-close" },
        variant: { type: "string", enum: ["css", "react", "typescript"], description: "Preferred variant; defaults to css" },
      },
      required: ["slug"],
    },
  },
];

export async function handleMcp(request, env, ctx) {
  let msg;
  try { msg = await request.json(); } catch { return rpcError(null, -32700, "parse error"); }
  const { id, method, params = {} } = msg;

  // Notifications need no body; 202 keeps the stream contract happy.
  if (method && method.startsWith("notifications/")) return new Response(null, { status: 202 });

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: params.protocolVersion || PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "transitions-agent", version: "0.1.0" },
        instructions:
          "Transitions Motion Agent: scan a repo for janky UI motion (scan_instructions), then fix findings following fix_guidance, pulling exact library sources with get_recipe. A transitions.dev license key goes in the Authorization header; get one with: npx transitions-agent signup you@email.com. Licensing: interactive editor/terminal use is included in every paid plan; automated CI fixing on your own model keys requires an Enterprise license (Business plans use the hosted CI workflow) - https://transitions.dev/terms.html",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call":
      return toolCall(id, params, request, env, ctx);
    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

async function toolCall(id, params, request, env, ctx) {
  const name = params.name;
  const args = params.arguments || {};
  const logged = logMcp(request, env, ctx, name, args);
  if (ctx?.waitUntil) ctx.waitUntil(logged);
  try {
    if (name === "scan_instructions") return toolText(id, SCAN_INSTRUCTIONS);
    if (name === "fix_guidance") {
      const mode = args.mode === "revamp" ? "revamp" : "polish";
      return toolText(id, [...BASE_RULES, "", ...MODE_RULES[mode]].join("\n"));
    }
    if (name === "list_recipes") {
      const index = (await env.RECIPES.get("recipe-index", { type: "json" })) || [];
      const lines = index.map((r) => `${r.slug}  [${r.tier}]  ${r.name || ""}`.trim());
      return toolText(id, lines.length ? lines.join("\n") : "Recipe index is empty; run pack-recipes.mjs.");
    }
    if (name === "get_recipe") return getRecipe(id, args, request, env);
    return toolError(id, `unknown tool: ${name}`);
  } catch (e) {
    return toolError(id, "tool failed: " + (e?.message || "unknown"));
  }
}

async function getRecipe(id, args, request, env) {
  const slug = String(args.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) return toolError(id, "missing slug");
  const recipe = await env.RECIPES.get("recipe:" + slug, { type: "json" });
  if (!recipe) return toolError(id, `no recipe named "${slug}"; call list_recipes for valid slugs`);

  if (recipe.tier === "pro") {
    const license = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!license) {
      return toolError(id, "Pro recipe: add your license key as an Authorization: Bearer header. Free key: npx transitions-agent signup you@email.com");
    }
    const record = await env.LICENSES.get(license, { type: "json" });
    if (!record || record.active === false) return toolError(id, "license key not valid");
    // Pro recipe sources flow to every paying tier: Pro subscribers
    // (record.pro, set at signup), Business, and Enterprise. Only the free
    // plan is limited to free recipes.
    const paid = record.plan === "team" || record.plan === "enterprise" || record.pro === true;
    if (!paid) {
      return toolError(id, `"${slug}" is a Pro recipe; Pro, Business and Enterprise plans include the full library (https://transitions.dev/pro.html). Free recipes work without limits.`);
    }
    const month = new Date().toISOString().slice(0, 7);
    const key = `${license}:r:${month}`;
    const used = parseInt((await env.USAGE.get(key)) || "0", 10);
    if (used >= PRO_FETCHES_PER_MONTH) return toolError(id, "monthly Pro recipe allowance reached; it resets on the 1st");
    await env.USAGE.put(key, String(used + 1), { expirationTtl: 60 * 60 * 24 * 62 });
  }

  const variant = ["css", "react", "typescript"].includes(args.variant) ? args.variant : "css";
  const source = recipe.variants?.[variant] || recipe.variants?.css;
  if (!source) return toolError(id, `recipe "${slug}" has no ${variant} variant`);
  const others = Object.keys(recipe.variants || {}).filter((v) => v !== variant);
  return toolText(id, `# ${recipe.name || slug} (${variant}${others.length ? `; also available: ${others.join(", ")}` : ""})\n\n${source}`);
}

// --- JSON-RPC plumbing -----------------------------------------------------

const toolText = (id, text) => rpcResult(id, { content: [{ type: "text", text }] });
const toolError = (id, text) => rpcResult(id, { content: [{ type: "text", text }], isError: true });

function rpcResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    headers: { "content-type": "application/json" },
  });
}
function rpcError(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Which tools people's own AIs call, and for get_recipe which recipe. The key
// is optional on MCP, so anonymous calls are kept too (email NULL).
async function logMcp(request, env, ctx, name, args) {
  try {
    const license = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const record = license ? await env.LICENSES.get(license, { type: "json" }) : null;
    const slug = name === "get_recipe" ? String(args.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "") : "";
    logEvent(env, ctx, { event: "mcp", record, mode: name === "fix_guidance" ? (args.mode === "revamp" ? "revamp" : "polish") : null,
      detail: slug ? `${name}:${slug}` : name });
  } catch (e) {
    console.error("[events] mcp log failed:", e?.message);
  }
}
