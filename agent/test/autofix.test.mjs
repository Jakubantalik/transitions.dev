import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, parseMarker, humanMotionChanges, pickMode } from "../action/autofix.mjs";
import { renderMarkdown, autofixLine } from "../lib/report.mjs";

const pr = (over = {}) => ({
  number: 12,
  head: { ref: "feature/menu", sha: "bbb", repo: { full_name: "acme/app" } },
  labels: [],
  ...over,
});
const base = { repo: "acme/app", action: "synchronize", license: "tra_x", defaultMode: "polish", minScore: 0, score: 72, fixable: 3, previous: null, headSha: "bbb", humanChanges: null };

test("a pull request with fixable findings and a license gets fixes", () => {
  assert.deepEqual(decide({ ...base, pr: pr() }), { run: true, mode: "polish" });
});

test("forks, fix branches, opt-out, and missing licenses are skipped", () => {
  assert.equal(decide({ ...base, pr: pr({ head: { ref: "x", sha: "b", repo: { full_name: "someone/app" } } }) }).reason, "fork");
  assert.equal(decide({ ...base, pr: pr({ head: { ref: "transitions-agent/pr-3", sha: "b", repo: { full_name: "acme/app" } } }) }).reason, "fix-branch");
  assert.equal(decide({ ...base, pr: pr({ labels: [{ name: "no-motion-fix" }] }) }).reason, "opt-out");
  assert.equal(decide({ ...base, pr: pr(), license: "" }).reason, "no-license");
});

test("labels pick the mode; unrelated label events do not spend a fix", () => {
  assert.equal(pickMode(pr({ labels: [{ name: "revamp" }] }), "polish"), "revamp");
  assert.equal(pickMode(pr({ labels: [{ name: "polish" }] }), "revamp"), "polish");
  assert.equal(decide({ ...base, pr: pr(), action: "labeled", label: "bug" }).reason, "label");
  assert.equal(decide({ ...base, pr: pr({ labels: [{ name: "revamp" }] }), action: "labeled", label: "revamp" }).run, true);
});

test("quota guards: at the gate, nothing fixable, same commit, or no new human changes", () => {
  assert.equal(decide({ ...base, pr: pr(), minScore: 70, score: 72 }).reason, "gate");
  assert.equal(decide({ ...base, pr: pr(), fixable: 0 }).reason, "nothing");
  assert.equal(decide({ ...base, pr: pr(), previous: { sha: "bbb", mode: "polish", pr: 13 } }).reason, "done");
  assert.equal(decide({ ...base, pr: pr(), previous: { sha: "aaa", mode: "polish", pr: 13 }, humanChanges: [] }).reason, "no-new-changes");
  assert.equal(decide({ ...base, pr: pr(), previous: { sha: "aaa", mode: "polish", pr: 13 }, humanChanges: ["src/menu.css"] }).run, true);
  // Switching to revamp re-runs even on the same commit.
  assert.equal(decide({ ...base, pr: pr({ labels: [{ name: "revamp" }] }), previous: { sha: "bbb", mode: "polish", pr: 13 } }).run, true);
});

test("the agent's own commits and merges are not new work", () => {
  const log = "\x1etransitions-agent\n\nsrc/menu.css\n\x1eJakub\n\nREADME.md\n\x1eJakub\n\nsrc/modal.tsx\n";
  assert.deepEqual(humanMotionChanges(log), ["src/modal.tsx"]);
  assert.deepEqual(humanMotionChanges("\x1etransitions-agent\n\nsrc/menu.css\n"), []);
});

test("the score comment links the fix pull request and keeps the marker", () => {
  const scanned = { score: 72, grade: "janky", scannedFiles: 3, findings: [{ rule: "off-scale", severity: "warn", path: "a.css", line: 3, message: "x" }], components: [] };
  const af = { status: "opened", mode: "polish", before: 72, after: 94, pr: { number: 13, url: "https://github.com/acme/app/pull/13" }, marker: { sha: "bbb", mode: "polish", pr: 13 } };
  const md = renderMarkdown(scanned, { autofix: af });
  assert.match(md, /\*\*Proposed fixes:\*\* \[#13\]\(https:\/\/github\.com\/acme\/app\/pull\/13\) \(polish, motion score 72 to 94\)\. Merge it to apply/);
  assert.deepEqual(parseMarker(md), { sha: "bbb", mode: "polish", pr: 13 });
  assert.match(autofixLine({ status: "skipped", existing: { number: 13, url: "u", state: "MERGED" } }), /Fixes applied/);
  assert.match(autofixLine({ status: "skipped", reason: "nothing", mode: "polish", recipeFindings: 2 }), /add the `revamp` label/);
  assert.match(autofixLine({ status: "failed", reason: "revamp needs the Business plan" }), /could not run/);
});
