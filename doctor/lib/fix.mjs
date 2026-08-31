// Fix flow: send findings + files to the transitions.dev fix service (option C:
// the service holds the AI key), show proposed diffs, apply only after an
// explicit yes, optionally open a pull request after a second explicit yes.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import readline from "node:readline";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 40_000;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

export async function runFix(root, result, opts) {
  const { api, license, yes, pr } = opts;
  const fixable = result.findings.filter((f) => f.path !== "(project)");
  if (!fixable.length && !result.findings.length) {
    console.log(c.green("Nothing to fix."));
    return 0;
  }

  const paths = [...new Set(fixable.map((f) => f.path))].slice(0, MAX_FILES);
  const dropped = [...new Set(fixable.map((f) => f.path))].length - paths.length;
  const files = [];
  for (const p of paths) {
    try {
      const content = readFileSync(join(root, p), "utf8");
      if (Buffer.byteLength(content) <= MAX_FILE_BYTES) files.push({ path: p, content });
    } catch { /* file may be gone */ }
  }

  if (!license) {
    writePromptFallback(root, result, files);
    return 0;
  }

  console.log(c.dim(`Requesting fixes for ${files.length} files${dropped > 0 ? ` (${dropped} deferred to a later run)` : ""}...`));
  let res;
  try {
    res = await fetch(api + "/v1/doctor/fix", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + license },
      body: JSON.stringify({ findings: result.findings, files, score: result.score }),
    });
  } catch (e) {
    console.error(c.red("✗ ") + "Could not reach the fix service: " + e.message);
    return 1;
  }
  if (res.status === 401) { console.error(c.red("✗ ") + "License key not valid. Check TRANSITIONS_DOCTOR_LICENSE."); return 1; }
  if (res.status === 429) { console.error(c.red("✗ ") + "Monthly fix quota reached. Top up at transitions.dev/pro."); return 1; }
  if (!res.ok) { console.error(c.red("✗ ") + `Fix service error (${res.status}).`); return 1; }
  const data = await res.json();
  const proposed = (data.files || []).filter((f) => f.path && typeof f.content === "string");
  if (!proposed.length) { console.log(c.yellow("The service proposed no changes.")); return 0; }

  // Show each proposal as a diff. Nothing is written yet.
  for (const p of proposed) showDiff(root, p);
  if (data.summary) console.log("\n" + data.summary + "\n");
  if (data.usage) console.log(c.dim(`Fixes used this month: ${data.usage.used}/${data.usage.quota}`));

  const apply = yes || await confirm(`Apply these changes to ${proposed.length} files? [y/N] `);
  if (!apply) { console.log(c.dim("Nothing changed.")); return 0; }
  for (const p of proposed) writeFileSync(join(root, p.path), p.content);
  console.log(c.green("✓ ") + `Applied ${proposed.length} files.`);

  if (!pr) {
    console.log(c.dim("Review with git diff. Re-run with --pr to open a pull request."));
    return 0;
  }
  return openPr(root, result, proposed, { yes });
}

function showDiff(root, proposal) {
  // git diff --no-index gives a familiar colored diff without touching the repo.
  const tmp = mkdtempSync(join(tmpdir(), "tdoc-"));
  const tmpFile = join(tmp, "proposed");
  writeFileSync(tmpFile, proposal.content);
  const out = spawnSync("git", ["diff", "--no-index", "--color=always", "--", proposal.path, tmpFile], {
    cwd: root, encoding: "utf8", maxBuffer: 10_000_000,
  });
  console.log("\n" + c.bold(proposal.path));
  const body = (out.stdout || "").split("\n").slice(4).join("\n").trim();
  console.log(body || c.dim("(no change)"));
}

async function openPr(root, result, proposed, { yes }) {
  const go = yes || await confirm("Create a branch, commit, push, and open a pull request? [y/N] ");
  if (!go) { console.log(c.dim("Changes stay local. Commit them yourself when ready.")); return 0; }
  const branch = "transitions-doctor/fixes-" + new Date().toISOString().slice(0, 10);
  const title = `Fix UI transitions (motion score ${result.score} before fixes)`;
  const body = [
    "Automated motion fixes proposed by [Transitions Doctor](https://transitions.dev).",
    "",
    ...proposed.map((p) => `- \`${p.path}\``),
    "",
    "Every change was shown as a diff and confirmed in the terminal before this PR was opened.",
  ].join("\n");
  try {
    execFileSync("git", ["checkout", "-b", branch], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["add", ...proposed.map((p) => p.path)], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "fix(motion): apply transitions-doctor fixes"], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["push", "-u", "origin", branch], { cwd: root, stdio: "inherit" });
  } catch (e) {
    console.error(c.red("✗ ") + "Git step failed: " + (e.stderr?.toString() || e.message));
    return 1;
  }
  const gh = spawnSync("gh", ["pr", "create", "--title", title, "--body", body], { cwd: root, stdio: "inherit" });
  if (gh.status !== 0) {
    console.log(c.yellow("Could not open the PR automatically (is GitHub CLI installed?)."));
    console.log("Branch " + c.bold(branch) + " is pushed. Open the PR from GitHub with this description:\n\n" + body);
  }
  return 0;
}

function writePromptFallback(root, result, files) {
  // No license: hand the work to the user's own coding agent instead.
  const out = join(root, "transitions-doctor-fixes.md");
  const lines = [
    "# Fix these UI transition issues",
    "",
    "You are working in this repository. Apply fixes for the findings below using",
    "production-quality CSS transitions (respect prefers-reduced-motion, use motion",
    "tokens, animate transform and opacity rather than layout). Recipes: https://transitions.dev",
    "",
    "## Findings",
    ...result.findings.map((f) => `- ${f.path}${f.line ? ":" + f.line : ""} [${f.rule}] ${f.message}${f.recipe ? ` (recipe: https://transitions.dev/transitions/${f.recipe})` : ""}`),
    "",
    "Affected files: " + files.map((f) => f.path).join(", "),
  ];
  writeFileSync(out, lines.join("\n"));
  console.log(c.yellow("No license key found") + c.dim(" (set TRANSITIONS_DOCTOR_LICENSE for hosted fixes)."));
  console.log("Wrote " + c.bold("transitions-doctor-fixes.md") + ". Hand it to Claude Code or Cursor:");
  console.log(c.dim("  claude \"apply transitions-doctor-fixes.md\""));
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(/^y(es)?$/i.test(answer.trim())); });
  });
}
