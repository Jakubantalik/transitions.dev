// Report rendering: terminal (colored) and GitHub-flavored markdown.
import { RECIPE_BY_SLUG, recipeUrl } from "./catalog.mjs";

// Findings name recipes by file slug; the site uses its own page slugs.
export function recipeLink(slug) {
  const r = RECIPE_BY_SLUG.get(slug) || RECIPE_BY_SLUG.get({ "modal-open-close": "modal", "tooltip-open-close": "tooltip", "toast-open-close": "toast" }[slug]);
  if (r) return recipeUrl(r);
  if (slug === "motion-tokens") return "transitions.dev (Motion tokens tab)";
  return "transitions.dev/transitions/" + slug;
}

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
  "off-scale": "Off the motion scale for its usage (polish)",
  "recipe-mismatch": "Motion built wrong for the component (revamp)",
  "recipe-available": "Library recipe available (revamp)",
  "layout-animation": "Animates layout properties",
};

const STATUS = {
  matches: { icon: c.green("✓"), text: "matches the recipe" },
  off: { icon: c.yellow("●"), text: "off the motion scale" },
  mismatch: { icon: c.red("✗"), text: "needs the recipe" },
  available: { icon: c.cyan("○"), text: "hand-rolled, recipe available" },
};

function motionSummary(comp) {
  const m = comp.motion || {};
  const parts = [];
  if (m.open != null) parts.push("open " + m.open + "ms");
  if (m.close != null && m.close !== m.open) parts.push("close " + m.close + "ms");
  if (m.scale != null) parts.push("scale " + m.scale);
  if (m.ease && /linear|ease-in$/.test(m.ease)) parts.push(m.ease);
  if (m.layout && m.layout.length) parts.push("animates " + m.layout.join("/"));
  if (m.open != null && m.exit === false) parts.push("no exit");
  return parts.join(" · ");
}

// Every recognized component, matched to its transitions.dev recipe.
function renderComponents(components, lines) {
  if (!components || !components.length) return;
  const n = components.length;
  const ok = components.filter((x) => x.status === "matches").length;
  lines.push(c.bold("  Components") + c.dim(`  ${n} recognized, ${ok} match the transitions.dev recipe`));
  for (const comp of components.slice(0, 12)) {
    const st = STATUS[comp.status] || STATUS.available;
    const where = comp.path + ":" + comp.line;
    const summary = comp.status === "matches" ? st.text : (motionSummary(comp) || st.text);
    lines.push("  " + st.icon + " " + c.bold(comp.name.padEnd(18)) + " " + c.dim(where.padEnd(26)) + " " + summary);
    if (comp.status !== "matches") lines.push(c.dim("      recipe: ") + c.cyan(comp.url) + (comp.tier === "pro" ? c.dim(" (Pro)") : ""));
  }
  if (n > 12) lines.push(c.dim(`    ... and ${n - 12} more`));
  lines.push("");
}

const SEV_ICON = { major: c.red("●"), warn: c.yellow("●"), minor: c.dim("●"), info: c.cyan("●") };

export function renderTerminal(result, opts = {}) {
  const { footer = true } = opts;
  const lines = [];
  const scoreColor = result.score >= 90 ? c.green : result.score >= 75 ? c.cyan : result.score >= 50 ? c.yellow : c.red;
  lines.push("");
  lines.push(c.bold("  transitions-agent") + c.dim(`${result.version ? " " + result.version : ""}  scanned ${result.scannedFiles} files`));
  lines.push("");
  lines.push("  Motion score  " + scoreColor(c.bold(`${result.score} / 100`)) + c.dim(`  (${result.grade})`));
  // Gauge: 20 cells, filled portion in the score color.
  const filled = Math.round(result.score / 5);
  lines.push("  " + scoreColor("█".repeat(filled)) + c.dim("░".repeat(20 - filled)));
  lines.push("");
  renderComponents(result.components, lines);
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
      const text = wrap(f.message, 96);
      lines.push(c.dim("      " + loc) + "  " + text[0]);
      for (const more of text.slice(1)) lines.push("      " + " ".repeat(loc.length + 2) + more);
      if (f.recipe) lines.push(c.dim("      fix recipe: ") + c.cyan(recipeLink(f.recipe)));
    }
    if (list.length > 5) lines.push(c.dim(`      ... and ${list.length - 5} more`));
    lines.push("");
  }
  if (!footer) return lines.join("\n");
  lines.push(c.bold("  Fix these?") + c.dim("  pick a mode"));
  lines.push("  polish   tune values onto the motion scale, free plan    npx transitions-agent fix --yes");
  lines.push("  revamp   polish + install library recipes (Business)    npx transitions-agent fix --mode revamp --yes");
  lines.push(c.dim("  No account yet: npx transitions-agent signup (opens the browser, free)"));
  lines.push("");
  lines.push(c.bold("  Question for the user: fix these now with polish or revamp, or leave them?"));
  lines.push("");
  return lines.join("\n");
}

export function renderMarkdown(result, opts = {}) {
  const { previousScore } = opts;
  const lines = [];
  lines.push("<!-- transitions-agent -->");
  lines.push(`### ✨ Transitions Motion Agent`);
  lines.push("");
  const delta = previousScore != null ? ` (was ${previousScore})` : "";
  lines.push(`**Motion score: ${result.score} / 100** (${result.grade})${delta}, scanned ${result.scannedFiles} files.`);
  lines.push("");
  if (!result.findings.length) {
    lines.push("No motion issues found. 🎉");
    const af = autofixLine(opts.autofix);
    if (af) { lines.push(""); lines.push(af); }
    return withMarker(lines, opts.autofix);
  }
  const comps = result.components || [];
  if (comps.length) {
    lines.push("| Component | Where | Motion | transitions.dev recipe |");
    lines.push("|---|---|---|---|");
    const icon = { matches: "✅", off: "🟡", mismatch: "❌", available: "⚪" };
    for (const comp of comps.slice(0, 10)) {
      const recipe = `[${comp.recipe}](https://${comp.url})${comp.tier === "pro" ? " (Pro)" : ""}`;
      const motion = comp.status === "matches" ? "matches the recipe" : (motionSummaryPlain(comp) || "hand-rolled");
      lines.push(`| ${icon[comp.status] || ""} ${comp.name} | \`${comp.path}:${comp.line}\` | ${motion} | ${recipe} |`);
    }
    if (comps.length > 10) lines.push(`| ... ${comps.length - 10} more | | | |`);
    lines.push("");
  }
  const byRule = groupBy(result.findings, (f) => f.rule);
  lines.push("| Issue | Count | Where |");
  lines.push("|---|---|---|");
  for (const [rule, list] of Object.entries(byRule)) {
    const where = list.slice(0, 3).map((f) => f.line ? `\`${f.path}:${f.line}\`` : `\`${f.path}\``).join("<br>");
    lines.push(`| ${RULE_TITLES[rule] || rule} | ${list.length} | ${where}${list.length > 3 ? "<br>..." : ""} |`);
  }
  lines.push("");
  const af = autofixLine(opts.autofix);
  if (af) {
    lines.push(af);
  } else {
    lines.push("Run `npx transitions-agent` locally for details, or `npx transitions-agent fix` to get fixes as a pull request.");
  }
  if (opts.licenseCta) {
    lines.push("");
    lines.push("**Want these fixed automatically?** Add a `TRANSITIONS_AGENT_LICENSE` repo secret and the Agent proposes fixes on every pull request, as a pull request into its branch. Free key: `npx transitions-agent signup` · [plans](https://transitions.dev/pro.html)");
  }
  return withMarker(lines, opts.autofix);
}

// The hidden record of the last fix run, read back by the next run so fixes
// are requested once per change, not on every push.
function withMarker(lines, autofix) {
  const m = autofix && autofix.marker;
  if (m && (m.sha || m.pr)) lines.push(`<!-- transitions-agent:autofix sha=${m.sha || ""} mode=${m.mode || ""} pr=${m.pr || ""} -->`);
  return lines.join("\n");
}

// One line in the score comment about automatic fixes.
export function autofixLine(af) {
  if (!af) return null;
  const link = (p) => `[#${p.number}](${p.url})`;
  if (af.status === "opened" || af.status === "updated") {
    const score = af.before != null && af.after != null ? `, motion score ${af.before} → ${af.after}` : "";
    const bullets = (af.highlights || []).map((h) => "- " + h);
    return [
      `**Proposed fixes:** ${link(af.pr)} (${af.mode}${score})${af.status === "updated" ? ", updated for your latest changes" : ""}`,
      ...bullets,
      "",
      "Merge it to apply the fixes to this pull request, or close it to reject them.",
    ].join("\n");
  }
  if (af.status === "failed") return `**Automatic fixes could not run:** ${af.reason}.`;
  const ex = af.existing;
  if (ex && ex.url) {
    if (ex.state === "MERGED") return `**Fixes applied:** ${link(ex)} was merged into this pull request.`;
    if (ex.state === "CLOSED") return `Proposed fixes ${link(ex)} were closed. Change a style or component file to get a fresh proposal.`;
    return `**Proposed fixes:** ${link(ex)} is open. Merge it to apply the fixes to this pull request, or close it to reject them.`;
  }
  if (af.reason === "fork") return "_No automatic fixes on pull requests from forks: they cannot read the license secret._";
  if (af.reason === "nothing" && af.mode === "polish" && af.recipeFindings > 0) {
    return `Polish has nothing left to fix. ${af.recipeFindings} finding${af.recipeFindings === 1 ? "" : "s"} need the library recipes: add the \`revamp\` label to install them (Business plan).`;
  }
  return null;
}

function wrap(text, width) {
  const out = [];
  let line = "";
  for (const w of String(text).split(/\s+/)) {
    if (line && (line + " " + w).length > width) { out.push(line); line = w; }
    else line = line ? line + " " + w : w;
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}

function motionSummaryPlain(comp) {
  return motionSummary(comp).replace(/\x1b\[[0-9;]*m/g, "");
}

function groupBy(arr, key) {
  const out = {};
  for (const x of arr) (out[key(x)] ||= []).push(x);
  return out;
}
