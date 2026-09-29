// Recursive file walker with sensible defaults. Zero dependencies.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";

const SCAN_EXTS = new Set([".css", ".scss", ".less", ".html", ".jsx", ".tsx", ".js", ".mjs", ".ts", ".vue", ".svelte"]);
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", ".nuxt", ".output",
  "coverage", "vendor", ".cache", ".turbo", ".vercel", "storybook-static", ".claude",
]);
// Test scaffolding is not product UI; its deliberately-bad samples are noise.
const FIXTURE_DIRS = new Set(["__fixtures__", "__tests__", "__mocks__", "__snapshots__"]);
const TEST_FILE_RE = /\.(test|spec)\./;
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
      if (IGNORE_DIRS.has(e.name) || FIXTURE_DIRS.has(e.name)) continue;
      if (e.name === "fixtures" && /^tests?$/.test(basename(dir))) continue;
      if (isVendoredScanner(full)) continue;
      walk(root, full, files, depth + 1);
      continue;
    }
    const ext = extname(e.name);
    if (!SCAN_EXTS.has(ext)) continue;
    if (/\.min\.(js|css)$/.test(e.name) || /\.d\.ts$/.test(e.name)) continue;
    if (TEST_FILE_RE.test(e.name)) continue;
    let size;
    try { size = statSync(full).size; } catch { continue; }
    if (size > MAX_FILE_BYTES) continue;
    let content;
    try { content = readFileSync(full, "utf8"); } catch { continue; }
    files.push({ path: relative(root, full), ext, content });
  }
}

// A repo that vendors this package should never scan the scanner itself.
function isVendoredScanner(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return pkg && pkg.name === "transitions-agent";
  } catch {
    return false;
  }
}

export function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}
