#!/usr/bin/env node
// Turn a transitions-agent JSON report into the PR comment markdown.
// Usage: node comment.mjs report.json [previous-score]
import { readFileSync } from "node:fs";
import { renderMarkdown } from "../lib/report.mjs";

const [reportPath, previous] = process.argv.slice(2);
const result = JSON.parse(readFileSync(reportPath, "utf8"));
console.log(renderMarkdown(result, {
  previousScore: previous ? Number(previous) : undefined,
  licenseCta: process.env.TA_HAS_LICENSE !== "1",
}));
