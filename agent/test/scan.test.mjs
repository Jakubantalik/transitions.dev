import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRules } from "../lib/rules.mjs";
import { collectFiles } from "../lib/walk.mjs";
import { scan } from "../lib/scan.mjs";
import { renderTerminal } from "../lib/report.mjs";
import { findingsForMode } from "../lib/fix.mjs";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = (name, ext) => ({ path: name, ext, content: readFileSync(join(FIXTURES, name), "utf8") });

test("bad.css triggers duration, transition-all, hover, and reduced-motion rules", () => {
  const findings = runRules([load("bad.css", ".css")]);
  const rules = new Set(findings.map((f) => f.rule));
  assert.ok(rules.has("hardcoded-duration"));
  assert.ok(rules.has("transition-all"));
  assert.ok(rules.has("hover-without-transition"));
  assert.ok(rules.has("no-reduced-motion"));
});

test("BadModal.jsx triggers untransitioned-overlay", () => {
  const findings = runRules([load("BadModal.jsx", ".jsx")]);
  assert.ok(findings.some((f) => f.rule === "untransitioned-overlay"));
});

test("good.css is clean", () => {
  const findings = runRules([load("good.css", ".css")]);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("scan of fixtures directory produces a bounded score", () => {
  const result = scan(FIXTURES);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.scannedFiles >= 3);
  assert.ok(result.findings.length > 0);
});

test("polish mode skips structural findings, revamp keeps them", () => {
  const findings = runRules([load("bad.css", ".css"), load("BadModal.jsx", ".jsx")]);
  const polish = findingsForMode(findings, "polish");
  const revamp = findingsForMode(findings, "revamp");
  assert.ok(!polish.some((f) => f.rule === "untransitioned-overlay"));
  assert.ok(polish.some((f) => f.rule === "hardcoded-duration"));
  assert.equal(revamp.length, findings.length);
});

test("message strings and comments in JS do not trigger CSS rules", () => {
  const findings = runRules([load("messages.mjs", ".mjs")]);
  assert.equal(findings.length, 0, JSON.stringify(findings, null, 2));
});

test("real CSS in template literals is still flagged", () => {
  const findings = runRules([load("styled.mjs", ".mjs")]);
  const rules = new Set(findings.map((f) => f.rule));
  assert.ok(rules.has("transition-all"));
  assert.ok(rules.has("hardcoded-duration"));
});

test("walker skips fixture dirs, test files, and a vendored scanner package", () => {
  const paths = collectFiles(FIXTURES).map((f) => f.path);
  assert.ok(paths.includes("bad.css"));
  assert.ok(!paths.some((p) => p.includes("__fixtures__")), paths.join(", "));
  assert.ok(!paths.some((p) => p.includes("vendored")), paths.join(", "));
  assert.ok(!paths.some((p) => p.includes("skipped.test")), paths.join(", "));
  assert.ok(!paths.some((p) => p.includes("deep-bad")), paths.join(", "));
});

test("slow durations resolve through CSS custom properties", () => {
  const findings = runRules([load("slow-tokens.css", ".css")]).filter((f) => f.rule === "slow-duration");
  const msgs = findings.map((f) => f.message).join("\n");
  // Usage via a var() chain (--dd-fade -> --dd-close) and the 3.475s token are caught...
  assert.ok(msgs.includes("3.475s"), msgs);
  assert.ok(findings.some((f) => /--dd-stagger|--dd-close|--dd-fade/.test(f.message)), msgs);
  // ...the token definition itself is reported once...
  assert.ok(findings.some((f) => f.message.startsWith("Motion token")), msgs);
  // ...var() fallbacks are resolved when the token is undefined...
  assert.ok(msgs.includes("Transition runs 2s"), msgs);
  // ...and fast tokens are not flagged.
  assert.ok(!msgs.includes("--dd-open"), msgs);
});

test("scan footer offers sign-in and tells agents to wait for the user", () => {
  const out = renderTerminal(scan(FIXTURES));
  assert.match(out, /switching accounts: npx transitions-agent signup/);
  assert.match(out, /fix these now with polish or revamp, sign in first, or leave them\?/);
  assert.match(out, /end your turn, and wait for the user's answer/);
});

test("plain scan refreshes a stale installed Claude Code skill", () => {
  const home = mkdtempSync(join(tmpdir(), "ta-home-"));
  const dest = join(home, ".claude", "skills", "transitions-agent");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "SKILL.md"), "stale instructions from an old version\n");
  const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const r = spawnSync(process.execPath, [join(pkgDir, "bin", "transitions-agent.mjs"), "--dir", FIXTURES], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const packaged = readFileSync(join(pkgDir, "skill", "SKILL.md"), "utf8");
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), packaged);
  assert.match(r.stderr, /skill refreshed/);
});

test("reduced-motion guard anywhere in project silences the project rule", () => {
  const findings = runRules([load("bad.css", ".css"), load("good.css", ".css")]);
  assert.ok(!findings.some((f) => f.rule === "no-reduced-motion"));
});
