// Scan orchestration: walk files, run rules, compute motion score.
import { collectFiles } from "./walk.mjs";
import { runRules } from "./rules.mjs";

const WEIGHTS = { major: 8, warn: 4, minor: 1, info: 2 };
// Per-rule penalty caps so one noisy rule cannot zero the score.
const CAPS = { "hardcoded-duration": 15, "hover-without-transition": 20, "transition-all": 12, "untransitioned-overlay": 32 };

export function scan(root) {
  const files = collectFiles(root);
  const findings = runRules(files);

  const perRule = {};
  let penalty = 0;
  for (const f of findings) {
    const w = WEIGHTS[f.severity] || 1;
    perRule[f.rule] = (perRule[f.rule] || 0) + w;
  }
  for (const [rule, total] of Object.entries(perRule)) {
    penalty += Math.min(total, CAPS[rule] ?? total);
  }
  const score = Math.max(0, 100 - penalty);

  return {
    score,
    grade: grade(score),
    scannedFiles: files.length,
    findings,
    counts: countBy(findings, (f) => f.rule),
    severities: countBy(findings, (f) => f.severity),
  };
}

function grade(score) {
  if (score >= 90) return "smooth";
  if (score >= 75) return "decent";
  if (score >= 50) return "janky";
  return "static";
}

function countBy(arr, key) {
  const out = {};
  for (const x of arr) out[key(x)] = (out[key(x)] || 0) + 1;
  return out;
}
