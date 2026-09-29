// Scan orchestration: walk files, run the rules and the component review,
// compute the motion score.
import { collectFiles } from "./walk.mjs";
import { runRules } from "./rules.mjs";
import { analyzeComponents } from "./components.mjs";
import { RECIPE_BY_SLUG, recipeUrl } from "./catalog.mjs";

const WEIGHTS = { major: 8, warn: 4, minor: 1, info: 2 };
// Per-rule penalty caps so one noisy rule cannot zero the score.
const CAPS = {
  "slow-duration": 16, "hardcoded-duration": 15, "hover-without-transition": 20, "transition-all": 12,
  "untransitioned-overlay": 32, "off-scale": 28, "recipe-mismatch": 32, "layout-animation": 12,
  // A hand-rolled component the library covers is a suggestion, not a defect.
  "recipe-available": 0,
};

export function scan(root) {
  const files = collectFiles(root);
  const { components, findings: componentFindings } = analyzeComponents(files);
  const findings = merge(runRules(files), componentFindings, components);

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
    components,
    counts: countBy(findings, (f) => f.rule),
    severities: countBy(findings, (f) => f.severity),
  };
}

// One finding per place and meaning: a component-aware finding replaces the
// generic one on the same line, and a token shared by a surface and its
// backdrop is reported once.
function merge(ruleFindings, componentFindings, components) {
  const out = [];
  const seen = new Set();
  const offLines = new Set(componentFindings.filter((f) => f.rule === "off-scale").map((f) => f.path + ":" + f.line));
  for (const f of componentFindings) {
    const key = f.rule + "|" + f.path + ":" + f.line + "|" + (f.rule === "off-scale" ? f.usage.split(" ").pop() : f.message);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  for (const f of ruleFindings) {
    if ((f.rule === "hardcoded-duration" || f.rule === "slow-duration") && offLines.has(f.path + ":" + f.line)) continue;
    if (f.rule === "untransitioned-overlay") {
      const r = RECIPE_BY_SLUG.get(f.recipe);
      if (r && !components.some((c) => c.path === f.path && c.recipe === r.slug)) {
        components.push({
          recipe: r.slug, name: r.label, tier: r.tier, url: recipeUrl(r), path: f.path, line: f.line, selector: null,
          status: "mismatch", usesRecipe: false, issues: ["appears and disappears with no transition"], offScale: [],
          motion: { open: null, close: null, ease: null, scale: null, exit: false, layout: [] },
          recipeSpec: r.spec ? { open: r.spec.open, close: r.spec.close, scale: r.spec.preScale, ease: r.spec.ease } : null,
        });
      }
    }
    out.push(f);
  }
  return out;
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
