#!/usr/bin/env node
// transitions-agent: scan a codebase for missing or janky UI transitions.
//
//   npx transitions-agent                 scan + motion score + findings
//   npx transitions-agent signup          free plan: sign up in the browser
//   npx transitions-agent signup you@x.co  free plan: license key by email
//   npx transitions-agent fix             propose AI fixes as diffs, confirm, apply
//   npx transitions-agent fix --pr        after applying, open a pull request
//
// Fix modes (--mode):
//   polish (default)   small safe adjustments only: motion tokens, reduced-motion
//                      guard, named transition properties. Never restructures.
//   revamp             full rewrite where a finding matches a transitions.dev
//                      recipe (modals, tooltips, dropdowns, hovers).
//
// Flags:
//   --json               machine-readable report on stdout
//   --md                 GitHub-flavored markdown report on stdout
//   --min-score <n>      exit 2 when the score is below n (CI gate)
//   --dir <path>         project root to scan (default: cwd)
//   --license <key>      fix service license (or TRANSITIONS_AGENT_LICENSE)
//   --api <url>          fix service URL (default https://api.transitions.dev)
//   --yes                skip confirmation prompts (CI)
//
// No dependencies. Node 18+.
import { scan } from "../lib/scan.mjs";
import { renderTerminal, renderMarkdown } from "../lib/report.mjs";
import { runFix } from "../lib/fix.mjs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const CREDS_PATH = join(homedir(), ".transitions-agent.json");
function loadCreds() {
  try { return JSON.parse(readFileSync(CREDS_PATH, "utf8")); } catch { return null; }
}
function saveCreds(obj) { writeFileSync(CREDS_PATH, JSON.stringify(obj, null, 2)); }
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try { spawn(cmd, [url], { stdio: "ignore", detached: true }).unref(); } catch { /* user opens manually */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir") flags.dir = args[++i];
  else if (args[i] === "--mode") flags.mode = args[++i];
  else if (args[i] === "--api") flags.api = args[++i];
  else if (args[i] === "--license") flags.license = args[++i];
  else if (args[i] === "--min-score") flags.minScore = parseInt(args[++i], 10);
  else if (args[i].startsWith("--")) flags[args[i].slice(2)] = true;
  else positional.push(args[i]);
}

const root = resolve(flags.dir || ".");
const command = positional[0] || "scan";
const api = (flags.api || process.env.TRANSITIONS_AGENT_API || "https://api.transitions.dev").replace(/\/$/, "");

if (command === "signup") {
  const email = (positional[1] || "").trim();
  if (!email) {
    // Browser signup - works even when this terminal cannot ask questions
    // (a coding agent's shell): the human types their email in the browser
    // and this process polls until the key exists, then stores it.
    let start;
    try {
      const res = await fetch(api + "/agent/signup/start", { method: "POST" });
      if (!res.ok) throw new Error("start failed (" + res.status + ")");
      start = await res.json();
    } catch (e) {
      console.error("Could not start browser signup: " + e.message);
      console.error("Fallback: npx transitions-agent signup you@email.com");
      process.exit(1);
    }
    console.log("Opening your browser to finish sign-up (code " + start.code + ").");
    console.log("If it does not open: " + start.url);
    openBrowser(start.url);
    const deadline = Date.now() + (start.expires_in || 900) * 1000;
    while (Date.now() < deadline) {
      await sleep((start.interval || 3) * 1000);
      let poll;
      try { poll = await fetch(api + "/agent/signup/poll?secret=" + encodeURIComponent(start.secret)); }
      catch { continue; }
      if (poll.status === 202) continue;
      const data = await poll.json().catch(() => ({}));
      if (data.status === "ready" && data.license) {
        saveCreds({ license: data.license, plan: data.plan || "free" });
        console.log("\u2713 License key received and saved to " + CREDS_PATH);
        console.log("You are set: npx transitions-agent fix");
        process.exit(0);
      }
      if (data.status === "expired") break;
    }
    console.error("Sign-up timed out. Try again, or: npx transitions-agent signup you@email.com");
    process.exit(1);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("Usage: transitions-agent signup [you@company.com]");
    process.exit(1);
  }
  let res;
  try {
    res = await fetch(api + "/agent/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch (e) {
    console.error("Could not reach " + api + ": " + e.message);
    process.exit(1);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("Signup failed: " + (err.error || res.status));
    process.exit(1);
  }
  console.log(`Check ${email} for your free license key (10 hosted polish fixes/month).`);
  console.log("Then: export TRANSITIONS_AGENT_LICENSE=<key from the email>");
  process.exit(0);
}

const result = scan(root);

if (command === "scan") {
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (flags.md) console.log(renderMarkdown(result));
  else console.log(renderTerminal(result));
  if (Number.isFinite(flags.minScore) && result.score < flags.minScore) {
    console.error(`Motion score ${result.score} is below the required minimum ${flags.minScore}.`);
    process.exit(2);
  }
  process.exit(0);
}

if (command === "fix") {
  let mode = flags.mode;
  if (mode && mode !== "polish" && mode !== "revamp") {
    console.error(`Unknown mode "${mode}". Use --mode polish or --mode revamp.`);
    process.exit(1);
  }
  console.log(renderTerminal(result));
  // No explicit mode + a human at the keyboard + a license that could use
  // either: ask. Agents and CI pass --mode (or get the polish default).
  const license = flags.license || process.env.TRANSITIONS_AGENT_LICENSE || (loadCreds() || {}).license || "";
  if (!mode && license && process.stdin.isTTY && !flags.yes) {
    const readline = await import("node:readline");
    const answer = await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(
        "  Fix mode:  [1] polish - small safe adjustments to motion tokens (default)\n" +
        "             [2] revamp - everything polish does, plus recipe rewrites where a transitions.dev recipe matches (Business)\n" +
        "  Choose [1/2]: ",
        (a) => { rl.close(); resolve(a.trim()); }
      );
    });
    mode = answer === "2" || /^r/i.test(answer) ? "revamp" : "polish";
  }
  mode = mode || "polish";
  const code = await runFix(root, result, {
    mode,
    api,
    license,
    yes: !!flags.yes,
    pr: !!flags.pr,
  });
  process.exit(code);
}

console.error(`Unknown command "${command}". Use: transitions-agent [scan|fix|signup]`);
process.exit(1);
