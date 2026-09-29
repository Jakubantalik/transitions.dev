#!/usr/bin/env node
// Turn a transitions-agent JSON report into the PR comment markdown.
// Usage: node comment.mjs report.json [previous-score] [autofix.json]
import { readFileSync } from "node:fs";
import { renderMarkdown } from "../lib/report.mjs";

const [reportPath, previous, autofixPath] = process.argv.slice(2);
const result = JSON.parse(readFileSync(reportPath, "utf8"));
let autofix = null;
try { if (autofixPath) autofix = JSON.parse(readFileSync(autofixPath, "utf8")); } catch { /* auto-fix off or did not run */ }
console.log(renderMarkdown(result, {
  previousScore: previous ? Number(previous) : undefined,
  licenseCta: process.env.TA_HAS_LICENSE !== "1",
  autofix,
}));
