#!/usr/bin/env node
// transitions-agent: scan a codebase for missing or janky UI transitions.
//
//   npx transitions-agent                 scan + motion score + findings
//   npx transitions-agent fix             propose AI fixes as diffs, confirm, apply
//   npx transitions-agent fix --pr        after applying, open a pull request
//
// Flags:
//   --json               machine-readable report on stdout
//   --md                 GitHub-flavored markdown report on stdout
//   --min-score <n>      exit 2 when the score is below n (CI gate)
//   --dir <path>         project root to scan (default: cwd)
//   --license <key>      fix service license (or TRANSITIONS_AGENT_LICENSE)
//   --api <url>          fix service URL (default https://api.transitions.dev)
//   --yes                skip confirmation prompts (CI)
//
// No dependencies. Node 18+.
import { scan } from "../lib/scan.mjs";
import { renderTerminal, renderMarkdown } from "../lib/report.mjs";
import { runFix } from "../lib/fix.mjs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dir") flags.dir = args[++i];
  else if (args[i] === "--api") flags.api = args[++i];
  else if (args[i] === "--license") flags.license = args[++i];
  else if (args[i] === "--min-score") flags.minScore = parseInt(args[++i], 10);
  else if (args[i].startsWith("--")) flags[args[i].slice(2)] = true;
  else positional.push(args[i]);
}

const root = resolve(flags.dir || ".");
const command = positional[0] || "scan";
const result = scan(root);

if (command === "scan") {
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else if (flags.md) console.log(renderMarkdown(result));
  else console.log(renderTerminal(result));
  if (Number.isFinite(flags.minScore) && result.score < flags.minScore) {
    console.error(`Motion score ${result.score} is below the required minimum ${flags.minScore}.`);
    process.exit(2);
  }
  process.exit(0);
}

if (command === "fix") {
  console.log(renderTerminal(result));
  const code = await runFix(root, result, {
    api: (flags.api || process.env.TRANSITIONS_AGENT_API || "https://api.transitions.dev").replace(/\/$/, ""),
    license: flags.license || process.env.TRANSITIONS_AGENT_LICENSE || "",
    yes: !!flags.yes,
    pr: !!flags.pr,
  });
  process.exit(code);
}

console.error(`Unknown command "${command}". Use: transitions-agent [scan|fix]`);
process.exit(1);
