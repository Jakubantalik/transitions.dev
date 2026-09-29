#!/usr/bin/env node
// transitions-agent: scan a codebase for missing or janky UI transitions.
//
//   npx transitions-agent                 scan + motion score + findings
//   npx transitions-agent init-ci         set up GitHub Actions (workflows, secret, PR permission)
//   npx transitions-agent skill           install the agent skill (Claude Code)
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
import { isInteractive, runByAgent } from "../lib/env.mjs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const CREDS_PATH = join(homedir(), ".transitions-agent.json");
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
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

// One-command experience: a plain scan on a machine that uses Claude Code
// (~/.claude/skills exists) quietly installs the agent skill, so from the
// second conversation on, "check this app's motion" does everything.
// Keyless scan in a human terminal: one keystroke to the free plan.
async function maybeOfferSignup() {
  try {
    const hasKey = flags.license || process.env.TRANSITIONS_AGENT_LICENSE || (loadCreds() || {}).license;
    if (hasKey || !isInteractive()) return;
    const readline = await import("node:readline");
    const answer = await new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question("  Sign up free for hosted fixes? 10 polish fixes/month, key via your browser. [Y/n] ",
        (a) => { rl.close(); resolve(a.trim()); });
    });
    if (answer === "" || /^y/i.test(answer)) await browserSignup();
  } catch { /* the scan already succeeded; never fail on the offer */ }
}

function maybeInstallSkill() {
  // Notices go to stderr so --json / piped stdout stays clean.
  const note = (line) => console.error(line);
  try {
    const packaged = readFileSync(join(PKG_DIR, "skill", "SKILL.md"), "utf8");
    const skillsDir = join(homedir(), ".claude", "skills");
    const dest = join(skillsDir, "transitions-agent");
    const destFile = join(dest, "SKILL.md");
    if (existsSync(skillsDir)) {
      let installed = null;
      try { installed = readFileSync(destFile, "utf8"); } catch { /* not installed yet */ }
      // A stale copy keeps steering agents with outdated instructions, so
      // refresh it whenever it differs from this version's SKILL.md.
      if (installed !== packaged) {
        mkdirSync(dest, { recursive: true });
        writeFileSync(destFile, packaged);
        if (installed === null) {
          note("  ✓ Claude Code skill installed (" + dest + ")");
          note("    Remove anytime by deleting that folder.");
        } else {
          note("  ✓ Claude Code skill refreshed to this version (" + dest + ")");
        }
      }
    }
    const codexDir = join(homedir(), ".codex");
    const agentsFile = join(codexDir, "AGENTS.md");
    const START = "<!-- transitions-agent:start -->";
    const END = "<!-- transitions-agent:end -->";
    let existing = "";
    try { existing = readFileSync(agentsFile, "utf8"); } catch { /* none yet */ }
    if (existsSync(codexDir)) {
      const body = packaged.replace(/^---[\s\S]*?---\n/, "").trim();
      const block = START + "\n" + body + "\n" + END;
      const fresh = !existing.includes(START);
      let next = null;
      if (fresh) {
        next = (existing ? existing.trimEnd() + "\n\n" : "") + block + "\n";
      } else {
        const s = existing.indexOf(START);
        const e = existing.indexOf(END);
        if (e > s && existing.slice(s, e + END.length) !== block) {
          next = existing.slice(0, s) + block + existing.slice(e + END.length);
        }
      }
      if (next !== null) {
        try {
          writeFileSync(agentsFile, next);
          if (fresh) {
            note("  ✓ Codex instructions added (" + agentsFile + ", managed block)");
            note("    Remove anytime by deleting the transitions-agent block.");
          } else {
            note("  ✓ Codex instructions refreshed to this version (" + agentsFile + ")");
          }
        } catch {
          // Codex's sandbox only allows writes inside the project, so this is
          // the expected path when Codex itself ran the scan.
          note("  Codex setup needs one step outside Codex's sandbox. In your own terminal:");
          note("    npx transitions-agent skill --codex");
        }
      }
    }
  } catch { /* never let convenience break the scan */ }
}

if (command === "init-ci") {
  await initCi();
}

// Full CI setup, not just files: writes both workflows, then checks (and,
// with consent, finishes) the GitHub side - the license secret and the repo
// setting that lets Actions open pull requests - and ends with a checklist
// of whatever is still left.
async function initCi() {
  const run = (cmd, argv, input) => {
    try {
      const r = spawnSync(cmd, argv, { cwd: root, encoding: "utf8", input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
      return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
    } catch { return { ok: false, out: "", err: "" }; }
  };
  const OK = "\u2713", TODO = "\u2022";
  const todo = [];

  // 1. Workflow files. The fix workflow only runs when triggered from the
  // Actions tab, so writing it by default costs nothing.
  const wfDir = join(root, ".github", "workflows");
  mkdirSync(wfDir, { recursive: true });
  const minScore = Number.isFinite(flags.minScore) ? String(flags.minScore) : null;
  const files = [
    { name: "transitions-agent.yml", what: "motion score on every pull request",
      transform: (b) => b.replace('min-score: "0"', 'min-score: "' + (minScore || "0") + '"') },
    ...(flags["score-only"] ? [] : [{ name: "transitions-fix.yml", what: "fix pull requests from the Actions tab" }]),
  ];
  console.log("Transitions Agent CI setup");
  console.log("");
  for (const f of files) {
    const dest = join(wfDir, f.name);
    const rel = ".github/workflows/" + f.name;
    let body = readFileSync(join(PKG_DIR, "templates", f.name), "utf8");
    if (f.transform) body = f.transform(body);
    if (!existsSync(dest) || flags.force) {
      writeFileSync(dest, body);
      console.log("  " + OK + " " + rel + " written (" + f.what + ")");
      continue;
    }
    const current = readFileSync(dest, "utf8");
    if (minScore && f.name === "transitions-agent.yml" && /min-score: "\d+"/.test(current)) {
      const updated = current.replace(/min-score: "\d+"/, 'min-score: "' + minScore + '"');
      if (updated !== current) {
        writeFileSync(dest, updated);
        console.log("  " + OK + " " + rel + " merge gate set to " + minScore);
        continue;
      }
    }
    console.log("  " + OK + " " + rel + (current === body ? " already set up" : " already set up (your edits kept; --force replaces it)"));
  }

  // 2. Git: workflows only run once GitHub has them.
  const inGit = run("git", ["rev-parse", "--is-inside-work-tree"]).ok;
  if (inGit) {
    const paths = files.map((f) => ".github/workflows/" + f.name);
    const dirty = run("git", ["status", "--porcelain", "--", ...paths]).out;
    const originHead = run("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"]);
    const head = originHead.ok && originHead.out.startsWith("origin/") ? originHead.out
      : run("git", ["rev-parse", "--verify", "-q", "origin/master"]).ok ? "origin/master" : "origin/main";
    const onDefault = paths.every((p) => run("git", ["cat-file", "-e", head + ":" + p]).ok);
    if (dirty) {
      console.log("  " + TODO + " Workflow files not committed yet");
      todo.push("Commit and push the workflow files. The fix workflow appears in the Actions tab once it is on " + head.replace(/^origin\//, "") + ".");
    } else if (!onDefault) {
      console.log("  " + TODO + " Workflow files committed, not on " + head + " yet");
      todo.push("Push and merge the workflow files into " + head.replace(/^origin\//, "") + ".");
    } else {
      console.log("  " + OK + " Workflow files are on " + head);
    }
  } else {
    todo.push("Commit the workflow files to your GitHub repository.");
  }

  // 3. GitHub side, through the gh CLI when it is installed and signed in.
  const wantsFix = files.some((f) => f.name === "transitions-fix.yml");
  const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const license = flags.license || process.env.TRANSITIONS_AGENT_LICENSE || (loadCreds() || {}).license || "";
  const MANUAL_SECRET = "Add a repository secret named TRANSITIONS_AGENT_LICENSE with your license key (GitHub repo > Settings > Secrets and variables > Actions), or run: gh secret set TRANSITIONS_AGENT_LICENSE";
  const MANUAL_PRS = "Allow Actions to open pull requests: GitHub repo > Settings > Actions > General > Workflow permissions > check \"Allow GitHub Actions to create and approve pull requests\".";
  if (!repo.ok) {
    console.log("  " + TODO + " GitHub settings not checked (gh CLI not installed, not signed in, or no GitHub remote)");
    todo.push(license ? MANUAL_SECRET : "Get a license key (npx transitions-agent signup), then: " + MANUAL_SECRET);
    if (wantsFix) todo.push(MANUAL_PRS);
  } else {
    const slug = repo.out;
    const secrets = run("gh", ["secret", "list", "--json", "name", "-q", ".[].name"]);
    const hasSecret = secrets.ok && secrets.out.split("\n").includes("TRANSITIONS_AGENT_LICENSE");
    const perms = run("gh", ["api", "repos/" + slug + "/actions/permissions/workflow"]);
    let permState = null;
    try { permState = JSON.parse(perms.out); } catch { /* unknown */ }
    const prsAllowed = !wantsFix || (permState && permState.can_approve_pull_request_reviews === true);

    const pending = [];
    if (!hasSecret && license) pending.push("secret");
    if (!prsAllowed && permState) pending.push("prs");

    let apply = !!flags.yes;
    if (pending.length && !apply && isInteractive()) {
      const what = pending.map((p) => p === "secret" ? "add your license key as the TRANSITIONS_AGENT_LICENSE secret" : "allow Actions to open pull requests").join(" and ");
      const readline = await import("node:readline");
      const answer = await new Promise((res) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question("  On " + slug + ": " + what + "? [Y/n] ", (a) => { rl.close(); res(a.trim()); });
      });
      apply = answer === "" || /^y/i.test(answer);
    }

    if (hasSecret) {
      console.log("  " + OK + " Secret TRANSITIONS_AGENT_LICENSE is set on " + slug);
    } else if (!license) {
      console.log("  " + TODO + " No license key on this machine for the TRANSITIONS_AGENT_LICENSE secret");
      todo.push("Get a license key: npx transitions-agent signup (free covers polish, Business adds revamp). Then re-run npx transitions-agent init-ci --yes to add it as the secret.");
    } else if (apply) {
      const set = run("gh", ["secret", "set", "TRANSITIONS_AGENT_LICENSE", "--repo", slug], license);
      if (set.ok) console.log("  " + OK + " Secret TRANSITIONS_AGENT_LICENSE added to " + slug);
      else {
        console.log("  " + TODO + " Could not add the secret (" + (set.err.split("\n")[0] || "gh failed") + ")");
        todo.push(MANUAL_SECRET);
      }
    } else {
      console.log("  " + TODO + " Secret TRANSITIONS_AGENT_LICENSE not set on " + slug);
    }

    if (wantsFix) {
      if (prsAllowed) {
        console.log("  " + OK + " Actions may open pull requests on " + slug);
      } else if (!permState) {
        console.log("  " + TODO + " Could not read the Actions permissions (admin access needed)");
        todo.push(MANUAL_PRS);
      } else if (apply) {
        const put = run("gh", ["api", "-X", "PUT", "repos/" + slug + "/actions/permissions/workflow",
          "-f", "default_workflow_permissions=" + (permState.default_workflow_permissions || "read"),
          "-F", "can_approve_pull_request_reviews=true"]);
        if (put.ok) console.log("  " + OK + " Actions may now open pull requests on " + slug);
        else {
          console.log("  " + TODO + " Could not change the Actions permissions (an organization policy may block it)");
          todo.push(MANUAL_PRS);
        }
      } else {
        console.log("  " + TODO + " Actions may not open pull requests on " + slug + " yet");
      }
    }

    if (!apply && pending.length) {
      todo.push("Finish the GitHub side in one step: npx transitions-agent init-ci --yes (" +
        pending.map((p) => p === "secret" ? "adds the license secret" : "allows Actions to open pull requests").join(", ") + ")");
    }
  }

  console.log("");
  if (!todo.length) {
    console.log("CI is fully set up. Every pull request gets a motion score; run \"Transitions Agent fix\" from the Actions tab for a fix pull request.");
  } else {
    console.log("Left to do:");
    todo.forEach((t, i) => console.log("  " + (i + 1) + ". " + t));
    if (runByAgent() && todo.some((t) => t.includes("init-ci --yes"))) {
      console.log("");
      console.log("\x1b[1mQuestion for the user: finish the GitHub setup now (license secret and pull request permission)?\x1b[0m");
    }
  }
  console.log("Docs: https://transitions.dev/agent.html#get-started");
  process.exit(0);
}

if (command === "skill") {
  // Install the agent workflow into the agent's TRUSTED context (the
  // react.doctor move), in each tool's native format:
  //   default        Claude Code skill (~/.claude/skills/transitions-agent)
  //   --codex        managed block in ~/.codex/AGENTS.md
  //   --cursor       .cursor/rules/transitions-agent.mdc in this project
  const skillSrc = readFileSync(join(PKG_DIR, "skill", "SKILL.md"), "utf8");
  const body = skillSrc.replace(/^---[\s\S]*?---\n/, ""); // frontmatter is Claude-specific

  if (flags.codex) {
    const file = join(homedir(), ".codex", "AGENTS.md");
    mkdirSync(dirname(file), { recursive: true });
    const START = "<!-- transitions-agent:start -->", END = "<!-- transitions-agent:end -->";
    let existing = "";
    try { existing = readFileSync(file, "utf8"); } catch { /* new file */ }
    const block = START + "\n" + body.trim() + "\n" + END;
    const next = existing.includes(START)
      ? existing.replace(new RegExp(START + "[\\s\\S]*?" + END), block)
      : (existing ? existing.trimEnd() + "\n\n" : "") + block + "\n";
    writeFileSync(file, next);
    console.log("\u2713 Installed for Codex: " + file + " (managed block, re-run to update)");
    process.exit(0);
  }
  if (flags.cursor) {
    const dir = resolve(".cursor", "rules");
    mkdirSync(dir, { recursive: true });
    const rule = "---\ndescription: UI motion scanning and fixing with transitions-agent. Apply when the user asks about UI transitions, animations, motion quality, a motion score, or runs npx transitions-agent.\nalwaysApply: false\n---\n\n" + body.trim() + "\n";
    writeFileSync(join(dir, "transitions-agent.mdc"), rule);
    console.log("\u2713 Installed for Cursor: .cursor/rules/transitions-agent.mdc (this project)");
    process.exit(0);
  }
  const dest = resolve(flags.dir || join(homedir(), ".claude", "skills", "transitions-agent"));
  mkdirSync(dest, { recursive: true });
  copyFileSync(join(PKG_DIR, "skill", "SKILL.md"), join(dest, "SKILL.md"));
  console.log("\u2713 Skill installed to " + dest + " (Claude Code)");
  console.log("Codex: npx transitions-agent skill --codex    Cursor: npx transitions-agent skill --cursor");
  process.exit(0);
}

// Browser signup - works even when this terminal cannot ask questions
// (a coding agent's shell): the human types their email in the browser
// and this process polls until the key exists, then stores it.
async function browserSignup() {
  let start;
  try {
    const res = await fetch(api + "/agent/signup/start", { method: "POST" });
    if (!res.ok) throw new Error("start failed (" + res.status + ")");
    start = await res.json();
  } catch (e) {
    console.error("Could not start browser signup: " + e.message);
    console.error("Fallback: npx transitions-agent signup you@email.com");
    return false;
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
      try {
        saveCreds({ license: data.license, plan: data.plan || "free" });
        console.log("\u2713 License key received and saved to " + CREDS_PATH);
        console.log("You are set: npx transitions-agent fix");
      } catch {
        // Sandboxed agents (Codex) cannot write to the home folder.
        console.log("\u2713 License key received: " + data.license);
        console.log("Could not save it here (sandboxed). Pass it on each fix:");
        console.log("  npx transitions-agent fix --yes --license " + data.license);
        console.log("A copy is in your email; for a permanent setup run in your own terminal:");
        console.log("  export TRANSITIONS_AGENT_LICENSE=" + data.license);
      }
      return true;
    }
    if (data.status === "expired") break;
  }
  console.error("Sign-up timed out. Try again, or: npx transitions-agent signup you@email.com");
  return false;
}

if (command === "signup") {
  const email = (positional[1] || "").trim();
  if (!email) {
    process.exit((await browserSignup()) ? 0 : 1);
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
  else {
    console.log(renderTerminal(result));
    maybeInstallSkill();
    await maybeOfferSignup();
  }
  let code = 0;
  if (Number.isFinite(flags.minScore) && result.score < flags.minScore) {
    console.error(`Motion score ${result.score} is below the required minimum ${flags.minScore}.`);
    code = 2;
  }
  // Exit only after stdout drains: a bare process.exit() truncated large
  // --json output at the pipe buffer (~64KB) when an agent piped it.
  process.stdout.write("", () => process.exit(code));
  await new Promise(() => {});
}

if (command === "fix") {
  let mode = flags.mode;
  if (mode && mode !== "polish" && mode !== "revamp") {
    console.error(`Unknown mode "${mode}". Use --mode polish or --mode revamp.`);
    process.exit(1);
  }
  console.log(renderTerminal(result, { footer: false }));
  // No explicit mode + a human at the keyboard + a license that could use
  // either: ask. Agents and CI pass --mode (or get the polish default).
  const license = flags.license || process.env.TRANSITIONS_AGENT_LICENSE || (loadCreds() || {}).license || "";
  if (!mode && license && isInteractive() && !flags.yes) {
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

console.error(`Unknown command "${command}". Use: transitions-agent [scan|fix|signup|skill|init-ci]`);
process.exit(1);
