// Fix flow: send findings + files to the transitions.dev fix service (option C:
// the service holds the AI key), show proposed diffs, apply only after an
// explicit yes, optionally open a pull request after a second explicit yes.
// Keyless runs point to signup - the hosted service is the only fix path.
import { readFileSync, writeFileSync, mkdtempSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import readline from "node:readline";
import { isInteractive, runByAgent, sandboxNoNetwork, NETWORK_HELP } from "./env.mjs";
import { scan } from "./scan.mjs";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 40_000;

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

  // Revamp also needs the markup/JS that drives a component (open and close
  // classes, unmount timing), not only its stylesheet.
  const wanted = [...new Set([
    ...fixable.map((f) => f.path),
    ...(mode === "revamp" ? fixable.flatMap((f) => f.related || []) : []),
  ])];
  const paths = wanted.slice(0, MAX_FILES);
  const dropped = wanted.length - paths.length;
  const files = [];
  for (const p of paths) {
    try {
      const content = readFileSync(join(root, p), "utf8");
      if (Buffer.byteLength(content) <= MAX_FILE_BYTES) files.push({ path: p, content });
    } catch { /* file may be gone */ }
  }

  if (!license) {
    await offerSignup(api);
    console.log("Hosted fixes need a license key. Free plan: 10 polish fixes/month.");
    console.log("Get yours: " + c.bold("npx transitions-agent signup") + c.dim(" (opens the browser)") + " - then re-run fix.");
    return done(1, "no-license", "no license key");
  }

  console.log(c.dim(`Requesting ${mode} fixes for ${files.length} files${dropped > 0 ? ` (${dropped} deferred to a later run)` : ""}...`));
  let res;
  try {
    res = await fetch(api + "/v1/agent/fix", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + license },
      body: JSON.stringify({
        mode, findings, files, score: result.score,
        components: (result.components || []).filter((x) => x.status !== "matches" && paths.includes(x.path)),
      }),
    });
  } catch (e) {
    console.error(c.red("✗ ") + "Could not reach the fix service: " + e.message);
    if (sandboxNoNetwork() || runByAgent()) console.error(NETWORK_HELP);
    ciSummary("Could not reach the fix service: " + e.message);
    return done(1, "unreachable", "could not reach the fix service");
  }
  if (res.status === 401) {
    console.error(c.red("✗ ") + "License key not valid. Check TRANSITIONS_AGENT_LICENSE.");
    ciSummary("License key not valid. Check the `TRANSITIONS_AGENT_LICENSE` repo secret.");
    return done(1, "invalid-license", "the license key is not valid");
  }
  if (res.status === 403 || res.status === 429) {
    const err = await res.json().catch(() => ({}));
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
  if (res.status === 503) {
    const err = await res.json().catch(() => ({}));
    console.error(c.yellow("The fix service is down on our side.") + " " + (err.detail || "Please try again later."));
    ciSummary("The fix service is down on our side. Re-run this workflow later.");
    return done(1, "service-down", "the fix service is down on our side");
  }
  if (res.status === 502) {
    const err = await res.json().catch(() => ({}));
    console.error(c.yellow("The fix service could not reach the AI backend.") + " " + (err.detail || "Try again in a minute."));
    return done(1, "model-failed", "the fix service could not reach its AI backend; nothing was counted");
  }
  if (!res.ok) { console.error(c.red("✗ ") + `Fix service error (${res.status}).`); return done(1, "error", `fix service error ${res.status}`); }
  const data = await res.json();
  report.summary = data.summary || "";
  report.usage = data.usage || null;
  const proposed = (data.files || []).filter((f) => f.path && typeof f.content === "string");
  if (!proposed.length) { console.log(c.yellow("The service proposed no changes.")); return done(0, "no-changes", "the service proposed no changes"); }

  // Show each proposal as a diff. Nothing is written yet.
  for (const p of proposed) showDiff(root, p);
  if (data.summary) console.log("\n" + data.summary + "\n");
  if (data.usage) console.log(c.dim(`Fixes used this month: ${data.usage.used}/${data.usage.quota}`));

  const apply = yes || await confirm(`Apply these changes to ${proposed.length} files? [y/N] `);
  if (!apply) { console.log(c.dim("Nothing changed.")); return done(0, "declined"); }
  for (const p of proposed) {
    const dest = join(root, p.path);
    let original = "";
    try { original = readFileSync(dest, "utf8"); } catch { /* new file */ }
    const content = original.endsWith("\n") && !p.content.endsWith("\n") ? p.content + "\n" : p.content;
    writeFileSync(dest, content);
  }
  const after = scan(root).score;
  report.after = after;
  report.applied = proposed.map((p) => p.path);
  console.log(c.green("✓ ") + `Applied ${proposed.length} files. Motion score ${result.score} to ${after}.`);

  if (!pr) {
    console.log(c.dim("Review with git diff. Re-run with --pr to open a pull request."));
    return done(0, "applied");
  }
  const code = await openPr(root, result, proposed, { ...opts, yes, mode, after, summary: data.summary || "" });
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
  const custom = (v) => (typeof v === "function" ? v({ before: result.score, after, files: proposed.map((p) => p.path), summary: opts.summary }) : v);
  const title = custom(opts.title) || (mode === "revamp"
    ? `Revamp UI transitions with transitions.dev recipes (motion score ${result.score} to ${after})`
    : `Polish UI transitions (motion score ${result.score} to ${after})`);
  const body = custom(opts.body) || [
    `Automated ${mode} pass by [Transitions Agent](https://transitions.dev).`,
    "",
    `**Motion score: ${result.score} to ${after} / 100**`,
    "",
    ...proposed.map((p) => `- \`${p.path}\``),
    "",
    "Every change was shown as a diff and confirmed in the terminal before this PR was opened.",
  ].join("\n");
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
