#!/usr/bin/env node
// Automatic fixes on pull requests. Runs inside the Transitions Motion Agent Action
// after the scan: when a pull request has fixable motion findings and a
// license, it gets fixes from the fix service and opens (or updates) one fix
// pull request into the pull request's own branch, never into main. The score
// comment links it: merge to apply the fixes, close to reject them.
//
// Usage: node autofix.mjs <scan.json> <out.json>
// Env:   TA_LICENSE, TA_MODE (polish | revamp), TA_MIN_SCORE, TA_DIR, TA_API,
//        GH_TOKEN, GITHUB_EVENT_PATH, GITHUB_REPOSITORY
//
// Quota guards: one fix run per pull request state. It runs again only when a
// person changes style or component files (commits by transitions-agent and
// merges do not count), or when a label switches the mode. Forks, the fix
// branches themselves, and pull requests already at the score gate are skipped.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER = "<!-- transitions-agent -->";
const AUTHOR = "transitions-agent";
// Commits that are the fixes coming back: ours, or a squash-merge of the fix
// pull request credited to the Actions bot.
const BOT_AUTHORS = new Set([AUTHOR, "github-actions[bot]", "github-actions"]);
const MOTION_FILE = /\.(css|scss|sass|less|html|jsx|tsx|js|mjs|cjs|ts|vue|svelte|astro)$/;

const labelsOf = (pr) => (pr && pr.labels || []).map((l) => (typeof l === "string" ? l : l.name));

// A `revamp` or `polish` label on the pull request overrides the workflow's mode.
export function pickMode(pr, defaultMode) {
  const labels = labelsOf(pr);
  if (labels.includes("revamp")) return "revamp";
  if (labels.includes("polish")) return "polish";
  return defaultMode === "revamp" ? "revamp" : "polish";
}

// Pure decision: should this run ask for fixes? Returns { run, reason, mode, quiet }.
export function decide(ctx) {
  const { pr, repo, action, label, license, defaultMode, minScore, score, fixable, previous, headSha, humanChanges } = ctx;
  if (!pr) return { run: false, reason: "not-pr", quiet: true };
  if (pr.head && pr.head.repo && repo && pr.head.repo.full_name !== repo) return { run: false, reason: "fork" };
  if (pr.head && /^transitions-agent\//.test(pr.head.ref)) return { run: false, reason: "fix-branch", quiet: true };
  if (labelsOf(pr).includes("no-motion-fix")) return { run: false, reason: "opt-out", quiet: true };
  const mode = pickMode(pr, defaultMode);
  if (action === "labeled" && !["revamp", "polish"].includes(label)) return { run: false, reason: "label", mode, quiet: true };
  if (!license) return { run: false, reason: "no-license", mode, quiet: true };
  if (minScore > 0 && score >= minScore) return { run: false, reason: "gate", mode, quiet: true };
  if (!fixable) return { run: false, reason: "nothing", mode };
  if (previous && previous.mode === mode) {
    if (previous.sha === headSha) return { run: false, reason: "done", mode, quiet: true };
    if (Array.isArray(humanChanges) && humanChanges.length === 0) return { run: false, reason: "no-new-changes", mode, quiet: true };
  }
  return { run: true, mode };
}

export function parseMarker(body) {
  const m = String(body || "").match(/<!-- transitions-agent:autofix sha=([0-9a-f]*) mode=(\w*) pr=(\d*) -->/);
  return m ? { sha: m[1] || null, mode: m[2] || null, pr: m[3] ? Number(m[3]) : null } : null;
}

// Files a person changed since `from`: commits by the agent and merge commits
// (merging a fix pull request) are not new work to fix.
export function humanMotionChanges(logText) {
  const files = new Set();
  for (const entry of logText.split("\x1e").slice(1)) {
    const [author, ...rest] = entry.split("\n");
    if (BOT_AUTHORS.has(author.trim())) continue;
    for (const f of rest) if (f.trim() && MOTION_FILE.test(f.trim())) files.add(f.trim());
  }
  return [...files];
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

async function main() {
  const [scanPath, outPath] = process.argv.slice(2);
  const out = { status: "skipped", reason: null, marker: null };
  const save = () => writeFileSync(outPath, JSON.stringify(out, null, 2));
  try {
    const scanned = JSON.parse(readFileSync(scanPath, "utf8"));
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const pr = event.pull_request;
    const repo = process.env.GITHUB_REPOSITORY;
    const root = resolve(process.env.TA_DIR || ".");
    const { findingsForMode } = await import("../lib/fix.mjs");

    // What the last run did, from the sticky score comment.
    let previous = null;
    if (pr) {
      const comments = spawnSync("gh", ["api", `repos/${repo}/issues/${pr.number}/comments`, "--paginate", "--jq", `.[] | select(.body | contains("${MARKER}")) | .body`], { encoding: "utf8" });
      previous = parseMarker(comments.stdout);
    }
    out.marker = previous;

    // Human changes since the last fix run (null = unknown, e.g. after a force-push).
    let humanChanges = null;
    let headSha = pr && pr.head ? pr.head.sha : null;
    if (pr) {
      try {
        spawnSync("git", ["fetch", "--no-tags", "origin", `+refs/heads/${pr.head.ref}:refs/remotes/origin/${pr.head.ref}`], { stdio: "ignore" });
        headSha = sh("git", ["rev-parse", `origin/${pr.head.ref}`]);
        if (previous && previous.sha) {
          sh("git", ["merge-base", "--is-ancestor", previous.sha, headSha]);
          humanChanges = humanMotionChanges(sh("git", ["log", "--no-merges", "--format=%x1e%an", "--name-only", `${previous.sha}..${headSha}`]));
        }
      } catch { humanChanges = null; }
    }

    const mode0 = pickMode(pr, process.env.TA_MODE);
    const decision = decide({
      pr, repo, action: event.action, label: event.label && event.label.name,
      license: process.env.TA_LICENSE, defaultMode: process.env.TA_MODE,
      minScore: Number(process.env.TA_MIN_SCORE || 0), score: scanned.score,
      fixable: findingsForMode(scanned.findings || [], mode0).filter((f) => f.path !== "(project)").length,
      previous, headSha, humanChanges,
    });
    out.mode = decision.mode;
    out.reason = decision.reason || null;
    out.quiet = !!decision.quiet;
    out.recipeFindings = (scanned.findings || []).length - findingsForMode(scanned.findings || [], "polish").length;
    if (!decision.run) {
      out.status = "skipped";
      if (previous && previous.pr) out.existing = prState(previous.pr);
      return save();
    }

    // Fix the pull request's own branch, on a branch of our own.
    const branch = `transitions-agent/pr-${pr.number}`;
    sh("git", ["config", "user.name", AUTHOR]);
    sh("git", ["config", "user.email", "agent@transitions.dev"]);
    sh("git", ["checkout", "--force", "-B", branch, `origin/${pr.head.ref}`]);
    const { scan } = await import("../lib/scan.mjs");
    const { runFix, fixPrBody } = await import("../lib/fix.mjs");
    const { changesHighlights } = await import("../lib/describe.mjs");
    const result = scan(root);
    const report = {};
    const mode = decision.mode;
    await runFix(root, result, {
      api: (process.env.TA_API || "https://api.transitions.dev").replace(/\/$/, ""),
      license: process.env.TA_LICENSE, yes: true, pr: true, mode, report,
      base: pr.head.ref, branch,
      commitMessage: `fix(motion): transitions-agent ${mode} fixes for #${pr.number}`,
      title: ({ before, after }) => `Motion fixes for #${pr.number} (${mode}, score ${before} → ${after})`,
      body: ({ before, after, files, summary, changes }) => fixPrBody({
        intro: `[Transitions Motion Agent](https://transitions.dev/agent.html) reviewed the motion in #${pr.number} and proposes the changes below. **Merge** this pull request to apply them to #${pr.number}, or **close** it to keep #${pr.number} as it is. It targets \`${pr.head.ref}\`, never your default branch.`,
        mode, before, after, changes, summary, files,
        footer: mode === "polish" && changes && changes.remaining.some((r) => /Revamp installs/.test(r))
          ? [`Want the library recipes installed too? Add the \`revamp\` label to #${pr.number} (Business plan).`, ""]
          : [],
      }),
    });
    out.before = report.before;
    out.after = report.after;
    out.applied = report.applied || [];
    if (report.changes) out.highlights = changesHighlights(report.changes);
    if (report.pr) {
      out.status = report.pr.created ? "opened" : "updated";
      out.pr = report.pr;
      out.marker = { sha: headSha, mode, pr: report.pr.number };
    } else if (report.status === "nothing" || report.status === "no-changes") {
      out.status = "skipped";
      out.reason = "nothing";
      out.marker = { sha: headSha, mode, pr: previous ? previous.pr : null };
    } else if (report.status === "applied") {
      out.status = "failed";
      out.reason = `the fixes are on branch \`${branch}\`, but the pull request could not be opened. Allow GitHub Actions to create pull requests (Settings > Actions > General > Workflow permissions)`;
    } else {
      out.status = "failed";
      out.reason = report.status === "pr-failed"
        ? "could not push the fix branch. The workflow needs `contents: write` permission"
        : report.reason || report.status || "unknown error";
    }
    return save();
  } catch (e) {
    out.status = "failed";
    out.reason = e.message.split("\n")[0];
    return save();
  }
}

function prState(number) {
  const r = spawnSync("gh", ["pr", "view", String(number), "--json", "number,url,state"], { encoding: "utf8" });
  try { return JSON.parse(r.stdout); } catch { return { number }; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0), () => process.exit(0));
}
