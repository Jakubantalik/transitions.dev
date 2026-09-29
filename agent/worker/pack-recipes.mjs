#!/usr/bin/env node
// Pack transitions.dev recipe sources (free + Pro) into a KV bulk file for the
// fix service. Revamp mode feeds these sources to the model so rewrites match
// the library exactly instead of the model's memory of it.
//
// Run from the repository root:
//   node agent/worker/pack-recipes.mjs [--pro <dir>] [--out <file>]
//
// Free recipes:  cli/free/<slug>.md
// Pro recipes:   ../transitions-pro/content/transitions/<slug>/{meta.json,css/recipe.md,react/recipe.md}
//
// Upload (ids in wrangler.toml):
//   npx wrangler kv bulk put recipes-kv.json --namespace-id <RECIPES id>
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i === -1 ? dflt : args[i + 1];
};
const PRO_DIR = flag("--pro", "../transitions-pro/content/transitions");
const OUT = flag("--out", "recipes-kv.json");
const FREE_DIR = "cli/free";
const MAX_VARIANT_BYTES = 14_000;

// Findings reference site slugs; some free files use a shorter name.
const SITE_ALIASES = {
  "modal-open-close": "modal", "dropdown-menu-morph": "plus-menu-morph", "tooltip-open-close": "tooltip",
  "toast-open-close": "toast", "3d-tilt": "card-tilt", "input-clear-with-dissolve": "input-clear-dissolve",
  "skeleton-loader-and-reveal": "skeleton-reveal", "matrix-dot-loader": "matrix-loader",
};

const entries = [];
const seen = new Set();

function put(slug, value) {
  if (seen.has(slug)) return;
  seen.add(slug);
  entries.push({ key: "recipe:" + slug, value: JSON.stringify(value) });
}

const clip = (s) => (Buffer.byteLength(s) > MAX_VARIANT_BYTES ? s.slice(0, MAX_VARIANT_BYTES) + "\n[truncated]" : s);

// Free recipes.
const freeSlugs = new Map();
for (const file of readdirSync(FREE_DIR).filter((f) => f.endsWith(".md"))) {
  freeSlugs.set(basename(file, ".md"), join(FREE_DIR, file));
}
for (const [slug, path] of freeSlugs) {
  put(slug, { slug, tier: "free", variants: { css: clip(readFileSync(path, "utf8")) } });
}
for (const [siteSlug, freeSlug] of Object.entries(SITE_ALIASES)) {
  if (freeSlugs.has(freeSlug)) {
    put(siteSlug, { slug: siteSlug, tier: "free", variants: { css: clip(readFileSync(freeSlugs.get(freeSlug), "utf8")) } });
  }
}

// Pro recipes.
let proCount = 0;
if (existsSync(PRO_DIR)) {
  for (const dir of readdirSync(PRO_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const base = join(PRO_DIR, dir.name);
    let meta = {};
    try { meta = JSON.parse(readFileSync(join(base, "meta.json"), "utf8")); } catch { /* optional */ }
    const variants = {};
    for (const variant of ["css", "react", "typescript"]) {
      const p = join(base, variant, "recipe.md");
      if (existsSync(p)) variants[variant] = clip(readFileSync(p, "utf8"));
    }
    if (!Object.keys(variants).length) continue;
    put(dir.name, { slug: dir.name, name: meta.name || dir.name, tier: "pro", variants });
    proCount++;
  }
} else {
  console.error(`warning: Pro directory not found at ${PRO_DIR}; packing free recipes only.`);
}

// Index the catalog for the MCP list_recipes tool.
const index = entries.map((e) => {
  const v = JSON.parse(e.value);
  return { slug: v.slug, name: v.name || v.slug, tier: v.tier };
});
entries.push({ key: "recipe-index", value: JSON.stringify(index) });

writeFileSync(OUT, JSON.stringify(entries, null, 2));
console.log(`Packed ${entries.length} recipes (${proCount} Pro) into ${OUT}.`);
console.log(`Upload: npx wrangler kv bulk put ${OUT} --namespace-id <RECIPES id from wrangler.toml>`);
