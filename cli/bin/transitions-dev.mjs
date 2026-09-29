#!/usr/bin/env node
// transitions-dev — install transitions.dev recipes into your project.
//
//   npx transitions-dev list                 list free + Pro transitions
//   npx transitions-dev add card-resize       add a transition (free = instant)
//   npx transitions-dev add --free            add every free transition
//   npx transitions-dev add --pro             add everything incl. Pro (auto-login)
//   npx transitions-dev skill                 install the Pro agent skill (auto-login)
//   npx transitions-dev login                 authenticate (opens the browser)
//   npx transitions-dev logout                sign out
//   npx transitions-dev whoami                show login status
//
// Flags: --dir <path> (default ./transitions), --api <url> (default api.transitions.dev)
// No dependencies — Node 18+ (built-in fetch).

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CREDS_PATH = join(homedir(), ".transitions-dev.json");
// Credentials written while the package was still named transitions-pro.
// Read as a fallback so the rename does not sign existing users out.
const LEGACY_CREDS_PATH = join(homedir(), ".transitions-pro.json");

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir") flags.dir = args[++i];
  else if (args[i] === "--api") flags.api = args[++i];
  else if (args[i].startsWith("--")) flags[args[i].slice(2)] = true;
  else positional.push(args[i]);
}

const API = (flags.api || process.env.TRANSITIONS_API ||
  (/^(localhost|1)/.test(process.env.TRANSITIONS_LOCAL || "") ? "http://localhost:8787" : "https://api.transitions.dev"))
  .replace(/\/$/, "");
const OUT_DIR = flags.dir || "transitions";

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};
const log = (...a) => console.log(...a);
const die = (msg) => { console.error(c.red("✗ ") + msg); process.exit(1); };

function loadFreeManifest() {
  return JSON.parse(readFileSync(join(PKG_DIR, "free-manifest.json"), "utf8"));
}
function loadCreds() {
  try { return JSON.parse(readFileSync(CREDS_PATH, "utf8")); } catch { /* try legacy */ }
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_CREDS_PATH, "utf8"));
    saveCreds(legacy);   // migrate once, so logout and whoami see one file
    return legacy;
  } catch { return null; }
}
function saveCreds(obj) { writeFileSync(CREDS_PATH, JSON.stringify(obj, null, 2)); }

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { spawn(cmd, [url], { stdio: "ignore", detached: true }).unref(); } catch { /* user opens manually */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts) {
  const res = await fetch(API + path, opts);
  return res;
}

// ── commands ─────────────────────────────────────────────────────────────────

async function cmdList() {
  const free = loadFreeManifest();
  log(c.bold("\nFree transitions") + c.dim("  (no account needed)"));
  free.forEach((t) => log("  " + t.slug.padEnd(26) + c.dim(t.name)));

  let pro = [];
  try { pro = (await (await api("/catalog")).json()).pro || []; } catch { /* offline */ }
  if (pro.length) {
    const creds = loadCreds();
    log("\n" + c.bold("Pro transitions") + "  " + (creds ? c.green("(signed in)") : c.yellow("(run `transitions-dev login`)")));
    pro.forEach((t) => log("  " + t.id.padEnd(26) + c.blue("Pro") + c.dim("  " + (t.variants || []).join(", "))));
  }
  log("\n" + c.dim(`Add one:  npx transitions-dev add ${free[0]?.slug || "card-resize"}`) + "\n");
}

function writeRecipe(slug, variant, text) {
  const dir = join(OUT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, variant + ".md");
  writeFileSync(file, text);
  return file;
}

async function cmdAdd(slug) {
  // Bulk installs: `--free` grabs every free transition; `--pro` grabs
  // everything including Pro and triggers login when the terminal isn't
  // signed in yet. `--all` is the old spelling of `--free`, kept working
  // because it is printed in published docs, but it read as "including Pro"
  // and is no longer advertised.
  if (flags.free || flags.all || flags.pro) return cmdAddAll(!!flags.pro);

  if (!slug) die("Usage: transitions-dev add <name>   (or `--free` / `--pro`; see `transitions-dev list`)");
  const free = loadFreeManifest();
  const freeMatch = free.find((t) => t.slug === slug);

  if (freeMatch) {
    const md = readFileSync(join(PKG_DIR, "free", slug + ".md"), "utf8");
    const dir = join(OUT_DIR);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, slug + ".md");
    writeFileSync(file, md);
    log(c.green("✓ ") + `Added ${c.bold(freeMatch.name)} → ${c.dim(file)}`);
    return;
  }

  // Pro transition → needs auth. Confirm it exists in the catalog.
  let pro = [];
  try { pro = (await (await api("/catalog")).json()).pro || []; } catch { /* handled below */ }
  const proMatch = pro.find((t) => t.id === slug);
  if (!proMatch) die(`Unknown transition "${slug}". Run \`transitions-dev list\`.`);

  const creds = loadCreds();
  if (!creds || !creds.token) die("This is a Pro transition. Run `transitions-dev login` first.");

  const variants = proMatch.variants && proMatch.variants.length ? proMatch.variants : ["css"];
  let wrote = 0;
  for (const variant of variants) {
    const res = await api(`/content/${encodeURIComponent(slug)}/${encodeURIComponent(variant)}`, {
      headers: { Authorization: "Bearer " + creds.token },
    });
    if (res.status === 401 || res.status === 403) {
      die("Your session expired or your Pro plan isn't active. Run `transitions-dev login` again.");
    }
    if (!res.ok) { console.error(c.red("✗ ") + `${slug}/${variant}: ${res.status}`); continue; }
    const file = writeRecipe(slug, variant, await res.text());
    log(c.green("✓ ") + `Added ${c.bold(slug)} ${c.blue(variant)} → ${c.dim(file)}`);
    wrote++;
  }
  if (!wrote) die("Nothing was written.");
}

// Bulk install. Always writes every free transition; when `includePro` is
// set it also pulls all Pro recipes, running the login flow first if the
// terminal isn't authenticated yet.
async function cmdAddAll(includePro) {
  const free = loadFreeManifest();
  const dir = join(OUT_DIR);
  mkdirSync(dir, { recursive: true });
  let wrote = 0;
  for (const t of free) {
    const md = readFileSync(join(PKG_DIR, "free", t.slug + ".md"), "utf8");
    writeFileSync(join(dir, t.slug + ".md"), md);
    wrote++;
  }
  log(c.green("✓ ") + `Added ${c.bold(wrote + " free transitions")} → ${c.dim(dir + "/")}`);

  if (!includePro) {
    log(c.dim("Run `transitions-dev add --pro` to include the Pro transitions too."));
    return;
  }

  // Pro requires auth — sign in automatically if we aren't already.
  let creds = loadCreds();
  if (!creds || !creds.token) {
    log("\n" + c.yellow("Pro transitions need an account — signing you in…"));
    await cmdLogin();
    creds = loadCreds();
    if (!creds || !creds.token) die("Sign-in is required to add Pro transitions.");
  }

  let pro = [];
  try { pro = (await (await api("/catalog")).json()).pro || []; }
  catch { die("Couldn't reach the Pro catalog. Check your connection and try again."); }
  if (!pro.length) { log(c.dim("No Pro transitions available.")); return; }

  let proWrote = 0;
  for (const t of pro) {
    const variants = t.variants && t.variants.length ? t.variants : ["css"];
    for (const variant of variants) {
      const res = await api(`/content/${encodeURIComponent(t.id)}/${encodeURIComponent(variant)}`, {
        headers: { Authorization: "Bearer " + creds.token },
      });
      if (res.status === 401 || res.status === 403) {
        die("Your session expired or your Pro plan isn't active. Run `transitions-dev login` again.");
      }
      if (!res.ok) { console.error(c.red("✗ ") + `${t.id}/${variant}: ${res.status}`); continue; }
      writeRecipe(t.id, variant, await res.text());
      proWrote++;
    }
  }
  log(c.green("✓ ") + `Added ${c.bold(pro.length + " Pro transitions")} ${c.blue("(" + proWrote + " files)")} → ${c.dim(dir + "/")}`);
}

// Ensure the terminal is signed in, running the browser device-flow if not.
// Returns the credentials (with a download token) or dies.
async function ensureSignedIn(purpose) {
  let creds = loadCreds();
  if (!creds || !creds.token) {
    log("\n" + c.yellow(purpose + " needs an account — signing you in…"));
    await cmdLogin();
    creds = loadCreds();
    if (!creds || !creds.token) die("Sign-in is required.");
  }
  return creds;
}

// Fetch a single gated recipe; exits with a clear message on auth failure.
async function fetchRecipe(id, variant, token) {
  const res = await api(`/content/${encodeURIComponent(id)}/${encodeURIComponent(variant)}`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (res.status === 401 || res.status === 403) {
    die("Your session expired or your Pro plan isn't active. Run `transitions-dev login` again.");
  }
  if (!res.ok) { console.error(c.red("✗ ") + `${id}/${variant}: ${res.status}`); return null; }
  return res.text();
}

// `skill` — install the Pro transitions as an agent skill. Verifies entitlement
// (device-flow login), downloads every Pro recipe (all variants) into the skill's
// recipes/ folder, and writes a SKILL.md the agent can load. Delivery is gated;
// once written, the files are yours (matches the "keep what you download" terms).
async function cmdSkill() {
  const creds = await ensureSignedIn("The Pro skill");

  let pro = [];
  try { pro = (await (await api("/catalog")).json()).pro || []; }
  catch { die("Couldn't reach the Pro catalog. Check your connection and try again."); }
  if (!pro.length) die("No Pro transitions available.");

  // Default to the user-level Claude skills dir; --dir overrides (e.g. a project's
  // .claude/skills/transitions-pro for a repo-scoped install).
  const skillDir = flags.dir || join(homedir(), ".claude", "skills", "transitions-pro");
  const recipesDir = join(skillDir, "recipes");
  mkdirSync(recipesDir, { recursive: true });

  let files = 0;
  for (const t of pro) {
    const variants = t.variants && t.variants.length ? t.variants : ["css"];
    for (const variant of variants) {
      const text = await fetchRecipe(t.id, variant, creds.token);
      if (text == null) continue;
      const dir = join(recipesDir, t.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, variant + ".md"), text);
      files++;
    }
  }
  if (!files) die("Nothing was written.");

  writeFileSync(join(skillDir, "SKILL.md"), buildSkillMd(pro));
  log(c.green("✓ ") + `Installed the ${c.bold("Transitions Pro")} skill ${c.blue("(" + files + " recipes)")} → ${c.dim(skillDir)}`);
  log(c.dim("Reload your agent's skills to pick it up."));
}

function buildSkillMd(pro) {
  const list = pro
    .map((t) => `- **${t.id}** — \`recipes/${t.id}/\` (${(t.variants || []).join(", ")})`)
    .join("\n");
  return `---
name: transitions-pro
description: Premium transitions.dev recipes — production-ready UI transitions with CSS, React, and TypeScript variants. Use when building modals, panels, cards, image viewers, confetti bursts, and other polished motion.
---

# Transitions Pro

Premium transitions from transitions.dev. Each folder under \`recipes/\` holds a
transition's variants (\`css.md\`, \`react.md\`, \`typescript.md\`).

## Available transitions
${list}

## How to apply one
1. Pick the transition that matches the effect the user wants.
2. Open \`recipes/<id>/<variant>.md\` for the target framework.
3. Paste the snippet and set the documented \`--<name>-*\` custom properties / hook props.
4. Every recipe already guards \`prefers-reduced-motion\` — keep that intact.

Run \`npx transitions-dev skill\` again to refresh these recipes after updates.
`;
}

async function cmdLogin() {
  const start = await (await api("/device/code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ variants: ["css", "react"] }),
  })).json();
  if (!start.user_code || !start.device_secret) die("Couldn't start login. Is the service reachable?");

  log("\n" + c.bold("To sign in, open this page and confirm the code:"));
  log("  " + c.blue(start.verification_uri));
  log("  code  " + c.bold(start.user_code) + "\n");
  log(c.dim("Opening your browser…"));
  openBrowser(start.verification_uri);

  const interval = (start.interval || 3) * 1000;
  const deadline = Date.now() + (start.expires_in || 900) * 1000;
  process.stdout.write(c.dim("Waiting for approval"));
  while (Date.now() < deadline) {
    await sleep(interval);
    process.stdout.write(c.dim("."));
    const r = await (await api(`/device/token?device_secret=${encodeURIComponent(start.device_secret)}`)).json();
    if (r.status === "approved" && r.download_token) {
      saveCreds({ token: r.download_token, api: API, saved_at: Date.now() });
      log("\n" + c.green("✓ Signed in.") + c.dim("  Pro transitions are now available."));
      return;
    }
    if (r.status === "denied") die("\nAccess denied — this account doesn't have an active Pro plan.");
    if (r.status === "expired") die("\nThe login request expired. Run `transitions-dev login` again.");
  }
  die("\nTimed out waiting for approval.");
}

function cmdLogout() {
  const paths = [CREDS_PATH, LEGACY_CREDS_PATH].filter(existsSync);
  if (paths.length) { paths.forEach((f) => rmSync(f)); log(c.green("✓ Signed out.")); }
  else log(c.dim("Not signed in."));
}

function cmdWhoami() {
  const creds = loadCreds();
  if (creds && creds.token) log(c.green("Signed in") + c.dim(`  (credentials in ${CREDS_PATH})`));
  else log(c.yellow("Not signed in.") + c.dim("  Run `transitions-dev login`."));
}

function cmdHelp() {
  log(`
${c.bold("transitions-dev")} — install transitions.dev recipes into your project.

${c.bold("Commands")}
  list                     list free + Pro transitions
  add <name>               add a transition (free is instant; Pro needs login)
  add --free               add every free transition at once
  add --pro                add everything incl. Pro recipes (signs you in if needed)
  skill                    install the Pro transitions as an agent skill
  login                    sign in (opens the browser)
  logout                   sign out
  whoami                   show login status

${c.bold("Options")}
  --dir <path>             where to write (default: ./transitions)
  --api <url>              API base (default: https://api.transitions.dev)

${c.dim("Docs: https://transitions.dev")}`);
}

const [cmd, ...rest] = positional;
(async () => {
  try {
    switch (cmd) {
      case "list": await cmdList(); break;
      case "add": await cmdAdd(rest[0]); break;
      case "skill": await cmdSkill(); break;
      case "login": await cmdLogin(); break;
      case "logout": cmdLogout(); break;
      case "whoami": cmdWhoami(); break;
      case undefined:
      case "help":
      case "--help":
      case "-h": cmdHelp(); break;
      default: die(`Unknown command "${cmd}". Run \`transitions-dev help\`.`);
    }
  } catch (e) {
    die(e && e.message ? e.message : String(e));
  }
})();
