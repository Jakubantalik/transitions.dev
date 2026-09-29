// Report rendering: terminal (colored) and GitHub-flavored markdown.

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const RULE_TITLES = {
  "untransitioned-overlay": "Overlays with no enter/exit transition",
  "hover-without-transition": "Hover states that snap",
  "transition-all": "transition: all",
  "hardcoded-duration": "Hardcoded durations (no motion tokens)",
  "slow-duration": "Slow transitions (over 1s, incl. via tokens)",
  "no-reduced-motion": "No prefers-reduced-motion guard",
  "inconsistent-durations": "Inconsistent duration scale",
};

const SEV_ICON = { major: c.red("●"), warn: c.yellow("●"), minor: c.dim("●"), info: c.cyan("●") };

export function renderTerminal(result, opts = {}) {
  const { footer = true } = opts;
  const lines = [];
  const scoreColor = result.score >= 90 ? c.green : result.score >= 75 ? c.cyan : result.score >= 50 ? c.yellow : c.red;
  lines.push("");
  lines.push(c.bold("  transitions-agent") + c.dim(`  scanned ${result.scannedFiles} files`));
  lines.push("");
  lines.push("  Motion score  " + scoreColor(c.bold(`${result.score} / 100`)) + c.dim(`  (${result.grade})`));
  // Gauge: 20 cells, filled portion in the score color.
  const filled = Math.round(result.score / 5);
  lines.push("  " + scoreColor("█".repeat(filled)) + c.dim("░".repeat(20 - filled)));
  lines.push("");
  if (!result.findings.length) {
    lines.push(c.green("  No issues found. Your motion is in good shape."));
    lines.push("");
    return lines.join("\n");
  }
  const byRule = groupBy(result.findings, (f) => f.rule);
  for (const [rule, list] of Object.entries(byRule)) {
    lines.push("  " + SEV_ICON[list[0].severity] + " " + c.bold(RULE_TITLES[rule] || rule) + c.dim(`  (${list.length})`));
    for (const f of list.slice(0, 5)) {
      const loc = f.line ? `${f.path}:${f.line}` : f.path;
      lines.push(c.dim("      " + loc) + "  " + f.message.slice(0, 110));
      if (f.recipe) lines.push(c.dim("      fix recipe: ") + c.cyan(`transitions.dev/transitions/${f.recipe}`));
    }
    if (list.length > 5) lines.push(c.dim(`      ... and ${list.length - 5} more`));
    lines.push("");
  }
  if (!footer) return lines.join("\n");
  lines.push(c.bold("  Fix these?") + c.dim("  pick a mode"));
  lines.push("  polish   small safe fixes, free plan    npx transitions-agent fix --yes");
  lines.push("  revamp   polish + recipe rewrites       npx transitions-agent fix --mode revamp --yes");
  lines.push(c.dim("  No account yet, or switching accounts: npx transitions-agent signup (opens the browser, free)"));
  lines.push("");
  lines.push(c.bold("  Question for the user: fix these now with polish or revamp, sign in first, or leave them?"));
  lines.push(c.dim("  Agents: present these options, end your turn, and wait for the user's answer. Do not run fix on your own."));
  lines.push("");
  return lines.join("\n");
}

export function renderMarkdown(result, opts = {}) {
  const { previousScore } = opts;
  const lines = [];
  lines.push("<!-- transitions-agent -->");
  lines.push(`### ✨ Transitions Agent`);
  lines.push("");
  const delta = previousScore != null ? ` (was ${previousScore})` : "";
  lines.push(`**Motion score: ${result.score} / 100** (${result.grade})${delta}, scanned ${result.scannedFiles} files.`);
  lines.push("");
  if (!result.findings.length) {
    lines.push("No motion issues found. 🎉");
    return lines.join("\n");
  }
  const byRule = groupBy(result.findings, (f) => f.rule);
  lines.push("| Issue | Count | Where |");
  lines.push("|---|---|---|");
  for (const [rule, list] of Object.entries(byRule)) {
    const where = list.slice(0, 3).map((f) => f.line ? `\`${f.path}:${f.line}\`` : `\`${f.path}\``).join("<br>");
    lines.push(`| ${RULE_TITLES[rule] || rule} | ${list.length} | ${where}${list.length > 3 ? "<br>..." : ""} |`);
  }
  lines.push("");
  lines.push("Run `npx transitions-agent` locally for details, or `npx transitions-agent fix` to get fixes as a pull request.");
  if (opts.licenseCta) {
    lines.push("");
    lines.push("**Want these fixed automatically?** Add a `TRANSITIONS_AGENT_LICENSE` repo secret and the [fix workflow](https://github.com/Jakubantalik/transitions.dev/blob/main/agent/templates/transitions-fix.yml) - free key: `npx transitions-agent signup` · [plans](https://transitions.dev/pro.html)");
  }
  return lines.join("\n");
}

function groupBy(arr, key) {
  const out = {};
  for (const x of arr) (out[key(x)] ||= []).push(x);
  return out;
}
