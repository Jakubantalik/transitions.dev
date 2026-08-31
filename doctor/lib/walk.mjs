// Recursive file walker with sensible defaults. Zero dependencies.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const SCAN_EXTS = new Set([".css", ".scss", ".less", ".html", ".jsx", ".tsx", ".js", ".mjs", ".ts", ".vue", ".svelte"]);
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".output",
  "coverage", "vendor", ".cache", ".turbo", ".vercel", "storybook-static", ".claude",
]);
const MAX_FILE_BYTES = 400_000;

export function collectFiles(root) {
  const files = [];
  walk(root, root, files, 0);
  return files;
}

function walk(root, dir, files, depth) {
  if (depth > 12) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIRS.has(e.name)) walk(root, full, files, depth + 1);
      continue;
    }
    const ext = extname(e.name);
    if (!SCAN_EXTS.has(ext)) continue;
    if (/\.min\.(js|css)$/.test(e.name) || /\.d\.ts$/.test(e.name)) continue;
    let size;
    try { size = statSync(full).size; } catch { continue; }
    if (size > MAX_FILE_BYTES) continue;
    let content;
    try { content = readFileSync(full, "utf8"); } catch { continue; }
    files.push({ path: relative(root, full), ext, content });
  }
}

export function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}
