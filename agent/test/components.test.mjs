import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scan } from "../lib/scan.mjs";
import { findingsForMode } from "../lib/fix.mjs";
import { recipeForName, RECIPES } from "../lib/catalog.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "components");
const run = (name) => scan(join(DIR, name));
const comp = (result, recipe) => result.components.find((c) => c.recipe === recipe);
const has = (result, rule, re) => result.findings.some((f) => f.rule === rule && re.test(f.message));

test("every library recipe is in the catalog", () => {
  assert.equal(RECIPES.filter((r) => r.tier === "free").length, 32);
  assert.equal(RECIPES.filter((r) => r.tier === "pro").length, 11);
});

test("names map to recipes the way the skill's decision rules do", () => {
  const cases = {
    "modal-content": "modal", "dropdown-menu": "menu-dropdown", "popover": "menu-dropdown", "tooltip": "tooltip",
    "toast": "toast", "snackbar": "toast", "accordion-panel": "accordion", "tab-indicator": "tabs-sliding",
    "bottom-sheet": "panel-reveal", "switch-thumb": "toggle", "skeleton": "skeleton-reveal", "confetti-piece": "confetti-burst",
    "t-modal": "modal", "t-tt": "tooltip", "t-like-heart": "like-button", "toaster": "banner-stacking", "fab": "plus-menu-morph",
  };
  for (const [name, slug] of Object.entries(cases)) assert.equal(recipeForName(name)?.slug, slug, name);
  assert.equal(recipeForName("nav-menu"), null);
});

test("a library modal with changed tunables is off the recipe at its variables", () => {
  const r = run("modal-tuned");
  assert.equal(comp(r, "modal").status, "off");
  assert.ok(has(r, "off-scale", /--modal-open-dur\): 500ms -> 250ms/));
  assert.ok(has(r, "off-scale", /--modal-close-dur\): 300ms -> 150ms/));
  assert.ok(has(r, "off-scale", /--modal-scale\): 0\.8 -> 0\.96/));
  assert.ok(r.score < 90, "score " + r.score);
});

test("a dropdown that animates height and unmounts instantly needs the recipe", () => {
  const r = run("dropdown-mount");
  const d = comp(r, "menu-dropdown");
  assert.equal(d.status, "mismatch");
  assert.ok(d.issues.some((i) => /no exit/.test(i)));
  assert.ok(d.issues.some((i) => /height, top \(layout\)/.test(i)));
  assert.ok(has(r, "off-scale", /easing: linear/));
  assert.ok(has(r, "hover-without-transition", /dropdown-button:hover" changes background, border-color/));
  assert.ok(has(r, "layout-animation", /padding-left/));
});

test("library code at its defaults matches, with no findings on it", () => {
  const r = run("library-defaults");
  assert.equal(comp(r, "menu-dropdown").status, "matches");
  assert.equal(comp(r, "modal").status, "matches");
  assert.ok(!r.findings.some((f) => f.rule === "off-scale" || f.rule === "recipe-mismatch"));
});

test("shadcn dialog: Tailwind motion is read, the overlay is the backdrop", () => {
  const r = run("shadcn-dialog");
  const m = r.components.filter((c) => c.recipe === "modal");
  assert.equal(m.length, 1);
  assert.equal(m[0].motion.open, 200);
  assert.equal(m[0].motion.scale, 0.95);
  assert.ok(has(r, "off-scale", /modal close: 200ms -> 150ms/));
});

test("Framer Motion modal: duration, easing, and scale by usage", () => {
  const r = run("framer-modal");
  assert.ok(has(r, "off-scale", /modal open: 600ms -> 250ms/));
  assert.ok(has(r, "off-scale", /modal easing: linear/));
  assert.ok(has(r, "off-scale", /modal scale: 0\.5 -> 0\.96/));
});

test("tooltip: timing, scale, and intent delay from the tooltip recipe", () => {
  const r = run("tooltip");
  assert.ok(has(r, "off-scale", /tooltip open: 300ms -> 150ms/));
  assert.ok(has(r, "off-scale", /tooltip close: 300ms -> 50ms/));
  assert.ok(has(r, "off-scale", /tooltip delay: 0ms -> 80ms/));
  assert.ok(!r.findings.some((f) => f.rule === "hover-without-transition"), "parent hover over a transitioned child is covered");
});

test("accordion on max-height needs the grid-rows recipe", () => {
  const r = run("accordion");
  assert.ok(has(r, "recipe-mismatch", /max-height \(layout\); animate grid-template-rows/));
});

test("toast, toggle, tabs: each against its own recipe", () => {
  assert.ok(has(run("toast"), "off-scale", /toast open: 800ms -> 350ms/));
  assert.ok(has(run("toast"), "off-scale", /toast easing: ease-in/));
  assert.ok(has(run("toggle"), "off-scale", /toggle easing: linear/));
  assert.ok(has(run("tabs"), "recipe-mismatch", /animates left \(layout\)/));
});

test("Pro and loop recipes are recognized as available", () => {
  assert.equal(comp(run("pro-confetti"), "confetti-burst").status, "available");
  assert.equal(comp(run("skeleton"), "skeleton-reveal").status, "available");
});

test("polish takes values, revamp adds recipe installs", () => {
  const r = run("dropdown-mount");
  const polish = new Set(findingsForMode(r.findings, "polish").map((f) => f.rule));
  const revamp = new Set(findingsForMode(r.findings, "revamp").map((f) => f.rule));
  assert.ok(polish.has("off-scale") && polish.has("hover-without-transition"));
  assert.ok(!polish.has("recipe-mismatch"));
  assert.ok(revamp.has("recipe-mismatch"));
});
