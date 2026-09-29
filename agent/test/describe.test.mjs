import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scan } from "../lib/scan.mjs";
import { describeChanges, changesMarkdown, elementName, humanList } from "../lib/describe.mjs";
import { fixPrBody } from "../lib/fix.mjs";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "describe");
const before = scan(join(DIR, "before"));

test("revamp: plain sentences per component, recipe named, leftovers listed", () => {
  const d = describeChanges(before, scan(join(DIR, "revamped")), { mode: "revamp" });
  const menu = d.groups[0];
  assert.equal(menu.title, "Dropdown menu");
  assert.equal(menu.recipe.name, "Dropdown menu");
  assert.ok(menu.items.includes("Animates out when it closes instead of disappearing instantly."));
  assert.ok(menu.items.some((i) => /instead of animating its height and top/.test(i)));
  assert.ok(menu.items.includes("Moves with a smooth ease-out instead of a constant, mechanical speed."));
  const button = d.groups.find((g) => g.title === "Dropdown button");
  assert.deepEqual(button.items, ["On hover, the background and border fade instead of snapping."]);
  assert.ok(d.remaining.includes("Dropdown button: still eases in slowly (ease-in)."));
});

test("polish: no recipe claim, the structural problem is left for revamp", () => {
  const d = describeChanges(before, scan(join(DIR, "polished")), { mode: "polish" });
  assert.ok(!d.groups.some((g) => g.recipe));
  assert.ok(d.remaining.some((r) => /Dropdown menu still disappears instantly when it closes/.test(r) && /Revamp installs/.test(r)));
});

test("the fix pull request body leads with what changes and folds the notes", () => {
  const d = describeChanges(before, scan(join(DIR, "revamped")), { mode: "revamp" });
  const body = fixPrBody({ intro: "Intro.", mode: "revamp", before: 74, after: 99, changes: d, summary: "rAF replay, keyed selectors", files: ["test.html"] });
  assert.ok(body.indexOf("### What changes") < body.indexOf("<details>"));
  assert.match(body, /\*\*Motion score: 74 → 99\*\* · revamp: installs transitions\.dev recipes/);
  assert.match(body, /\*\*Dropdown menu\*\* \(`test\.html`\): now built on the transitions\.dev \[Dropdown menu\]/);
  assert.match(body, /<summary>Technical notes<\/summary>\n\nrAF replay/);
  assert.equal(changesMarkdown(d).includes("—"), false);
});

test("element names and lists read like prose", () => {
  assert.equal(elementName(".dropdown-button:hover"), "Dropdown button");
  assert.equal(elementName("#menu .demo-menu button:hover"), "Demo menu buttons");
  assert.equal(humanList(["background", "border", "shadow"]), "background, border, and shadow");
});
