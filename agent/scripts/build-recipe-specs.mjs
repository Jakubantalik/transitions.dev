#!/usr/bin/env node
// Regenerates lib/recipe-specs.json from the transitions.dev skill files, so the
// scanner compares projects against the library's real tunable defaults.
//
//   node agent/scripts/build-recipe-specs.mjs     (run from the repo root)
//
// Reads skills/transitions-dev/NN-<slug>.md: the "When to use" paragraph and
// the "Tunable variables" table. Slugs match cli/free/<slug>.md, which is also
// how the fix service's recipe store is keyed.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(here, "..", "..", "skills", "transitions-dev");
const TOKENS_CSS = join(here, "..", "..", "skills", "transitions-polish", "_root.css");
const OUT = join(here, "..", "lib", "recipe-specs.json");

const specs = {};
for (const file of readdirSync(SKILL_DIR).sort()) {
  const m = file.match(/^\d+-(.+)\.md$/);
  if (!m) continue;
  const slug = m[1];
  const src = readFileSync(join(SKILL_DIR, file), "utf8");
  const name = (src.match(/^#\s+(.+)$/m) || [])[1]?.trim() || slug;
  const when = (src.match(/## When to use\s+([\s\S]*?)\n\n/) || [])[1]?.replace(/\s+/g, " ").trim() || "";
  const vars = {};
  const table = (src.match(/## Tunable variables[\s\S]*?\n\n([\s\S]*?)\n\n/) || [])[1] || "";
  for (const row of table.split("\n")) {
    const cells = row.split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
    if (cells.length > 3 && cells[1].startsWith("--")) vars[cells[1]] = cells[2];
  }
  const usage = (src.match(/## HTML usage([\s\S]*?)\n## /) || [])[1] || "";
  const hook = (usage.match(/class="(t-[a-z0-9-]+)/) || [])[1] || null;
  const first = when.split(/(?<=\.)\s/)[0].replace(/\s*\u2014\s*/g, ": ").replace(/\*\*/g, "");
  specs[slug] = { name, when: first, hook, vars };
}

// The shared motion-token scale, with each token's documented usage.
const tokens = [];
for (const m of readFileSync(TOKENS_CSS, "utf8").matchAll(/(--[a-z-]+):\s*([^;]+);\s*\/\*\s*(.*?)\s*\*\//g)) {
  tokens.push({ name: m[1], value: m[2].trim(), usage: m[3] });
}

writeFileSync(OUT, JSON.stringify({ tokens, recipes: specs }, null, 2) + "\n");
console.log(`Wrote ${Object.keys(specs).length} recipe specs and ${tokens.length} tokens to ${OUT}`);
