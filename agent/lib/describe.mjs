// What a fix changed, in plain language: what someone using the app will
// notice, grouped by component. Built from the scans before and after the fix,
// so it only claims what the scanner can see changed.
import { RECIPE_BY_SLUG, recipeUrl, words } from "./catalog.mjs";
import { compounds, parseCompound } from "./css.mjs";

const PROP_NAMES = {
  background: "background", "background-color": "background", color: "text color", "border-color": "border",
  border: "border", "box-shadow": "shadow", transform: "position", opacity: "opacity", filter: "filter",
  "outline-color": "outline", fill: "icon color", stroke: "icon color", "padding-left": "padding",
  "padding-right": "padding", "padding-top": "padding", "padding-bottom": "padding", padding: "padding",
  "margin-left": "margin", "margin-right": "margin", "margin-top": "margin", "margin-bottom": "margin", margin: "margin",
  "max-height": "height", "min-height": "height",
};
const STATE = /^(is-|has-)?(open|opened|active|visible|show|shown|closing|hover|focus|selected|checked|expanded|disabled)$/;

export function humanList(items) {
  const u = [...new Set(items.filter(Boolean))];
  if (u.length <= 1) return u[0] || "";
  if (u.length === 2) return u[0] + " and " + u[1];
  return u.slice(0, -1).join(", ") + ", and " + u[u.length - 1];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plainValue = (v) => String(v || "").replace(/\s*\(var\([^)]*\)\)/, "").replace(/^var\((--[a-z-]+)\)$/, "$1").trim();
const props = (list) => humanList((list || []).map((p) => PROP_NAMES[p] || p));

// ".dropdown-button:hover" -> "Dropdown button"; ".demo-menu button:hover" -> "Demo menu buttons".
export function elementName(selector) {
  const cs = compounds(String(selector || ""));
  if (!cs.length) return "Other";
  const subject = parseCompound(cs[cs.length - 1]);
  const own = subject.classes.filter((c) => !STATE.test(c));
  if (own.length) return cap(words(own[own.length - 1]).join(" "));
  const outer = cs.slice(0, -1).flatMap((c) => parseCompound(c).classes).filter((c) => !STATE.test(c) && !/^t-/.test(c)).pop();
  const el = subject.element ? subject.element + "s" : "elements";
  return outer ? cap(words(outer).join(" ") + " " + el) : cap(el);
}

function usageKind(usage) {
  const u = String(usage || "");
  for (const k of ["close scale", "close easing", "close delay", "scale", "easing", "delay", "travel", "open", "close"]) {
    if (u === k || u.endsWith(" " + k)) return k;
  }
  return null;
}

// One sentence per resolved finding, from the point of view of someone using the app.
function sentence(f, comp) {
  switch (f.rule) {
    case "off-scale": {
      const kind = usageKind(f.usage);
      const from = plainValue(f.from);
      const to = plainValue(f.to);
      const hover = /^hover /.test(f.usage || "");
      if (kind === "open") return `Opens in ${to} instead of ${from}.`;
      if (kind === "close") return `Closes in ${to} instead of ${from}.`;
      if (kind === "easing") {
        if (hover) return "Responds to the pointer right away instead of easing in slowly.";
        if (/^linear$/.test(from)) return "Moves with a smooth ease-out instead of a constant, mechanical speed.";
        if (/^ease-in$/.test(from)) return "Starts moving right away instead of easing in slowly.";
        return "Uses the library's smooth ease-out curve.";
      }
      if (kind === "close easing") return "Closes without a bounce.";
      if (kind === "scale") return parseFloat(from) < 0.9 ? `Scales in from ${to} instead of zooming in from ${from}.` : `Scales in from ${to} instead of ${from}.`;
      if (kind === "close scale") return `Scales down to ${to} when it closes instead of ${from}.`;
      if (kind === "travel") return `Travels ${to} instead of ${from}.`;
      if (kind === "delay") return `Waits ${to} before appearing, so a passing pointer does not set it off.`;
      if (kind === "close delay") return `Closes right away instead of waiting ${from}.`;
      return null;
    }
    case "recipe-mismatch": {
      const out = [];
      for (const issue of (comp && comp.issues) || []) {
        if (/no exit|unmounts instantly|hides with display/.test(issue)) out.push("Animates out when it closes instead of disappearing instantly.");
        else if (/pops|no transition|no enter/.test(issue)) out.push("Animates in and out instead of popping.");
        else if (/grid-template-rows/.test(issue)) out.push("Expands and collapses smoothly with the recipe's grid technique instead of animating its height.");
        else if (/\(layout\)/.test(issue)) {
          const moved = (issue.match(/animates (.+?) \(layout\)/) || [])[1] || "";
          out.push(`Moves with transform and opacity instead of animating its ${props(moved.split(/,\s*/))}, so the page no longer shifts around it.`);
        } else if (/center/.test(issue)) out.push("Grows from its trigger instead of from its center.");
      }
      return out.length ? out : null;
    }
    case "untransitioned-overlay": return "Animates in and out instead of appearing instantly.";
    case "hover-without-transition": {
      const what = props(f.props) || "change";
      return `On hover, the ${what} ${/ and /.test(what) ? "fade" : "fades"} instead of snapping.`;
    }
    case "layout-animation": return `On hover, it shifts with a transform instead of changing its ${props(f.props)}, so nothing around it jumps.`;
    case "transition-all": return "Transitions only the properties that change, instead of all of them.";
    case "slow-duration": return "Transitions that took over a second now finish quickly.";
    case "no-reduced-motion": return "Motion turns off for people who ask their system for reduced motion.";
    case "inconsistent-durations": return "Durations come from a small shared scale, so timing feels consistent.";
    default: return null;
  }
}

const keyOf = (f) => [f.rule, f.path, f.usage || f.selector || f.recipe || ""].join("|");

export function describeChanges(before, after, { mode = "polish" } = {}) {
  const count = (list) => {
    const m = new Map();
    for (const f of list || []) m.set(keyOf(f), (m.get(keyOf(f)) || 0) + 1);
    return m;
  };
  const afterCount = count(after.findings);
  const seen = new Map();
  const groups = new Map();
  let tokens = 0;
  const group = (key, init) => {
    if (!groups.has(key)) groups.set(key, { ...init, items: [] });
    return groups.get(key);
  };

  for (const f of before.findings || []) {
    const k = keyOf(f);
    seen.set(k, (seen.get(k) || 0) + 1);
    if (seen.get(k) <= (afterCount.get(k) || 0)) continue; // still there after the fix
    if (f.rule === "hardcoded-duration") { tokens++; continue; }
    const r = f.recipe && RECIPE_BY_SLUG.get(f.recipe);
    const componentRule = ["off-scale", "recipe-mismatch", "recipe-available", "untransitioned-overlay"].includes(f.rule) && r && !/^hover /.test(f.usage || "");
    let g;
    let comp = null;
    if (componentRule) {
      comp = (before.components || []).find((c) => c.recipe === r.slug && c.path === f.path) || (before.components || []).find((c) => c.recipe === r.slug) || null;
      g = group("comp|" + r.slug + "|" + (comp ? comp.path : f.path), { title: comp ? comp.name : r.label, file: comp ? comp.path : f.path, slug: r.slug });
    } else if (f.selector) {
      g = group("el|" + elementName(f.selector) + "|" + f.path, { title: elementName(f.selector), file: f.path });
    } else {
      g = group("general", { title: "Across the app", file: null });
    }
    const s = sentence(f, comp);
    for (const line of [].concat(s || [])) if (!g.items.includes(line)) g.items.push(line);
  }
  if (tokens) {
    group("general", { title: "Across the app", file: null }).items.push(`Timing uses the shared motion tokens (${tokens} place${tokens === 1 ? "" : "s"}), so the app moves consistently.`);
  }

  // A component that now follows its library recipe says so in its title.
  for (const g of groups.values()) {
    if (!g.slug) continue;
    const now = (after.components || []).find((c) => c.recipe === g.slug && c.path === g.file) || (after.components || []).find((c) => c.recipe === g.slug);
    const was = (before.components || []).find((c) => c.recipe === g.slug && c.path === g.file);
    if (mode === "revamp" && now && ["matches", "available"].includes(now.status) && !(was && was.status === "matches")) {
      const r = RECIPE_BY_SLUG.get(g.slug);
      g.recipe = { name: r.label, url: recipeUrl(r), tier: r.tier };
    }
    if (!g.items.length) g.items.push(g.recipe ? `Uses the transitions.dev ${g.recipe.name} recipe instead of hand-written motion.` : "Motion tuned to the library recipe.");
  }

  // What is still left after the fix, in the same plain words.
  const remaining = [];
  for (const c of after.components || []) {
    if (c.status === "mismatch" && c.issues && c.issues.length) {
      remaining.push(`${c.name} still ${humanList(c.issues.map(stillIssue))}.` + (mode === "polish" ? " Revamp installs the library recipe for it." : ""));
    }
  }
  let hardcoded = 0;
  for (const f of after.findings || []) {
    if (f.severity === "info" || f.rule === "recipe-mismatch") continue;
    if (f.rule === "hardcoded-duration") { hardcoded++; continue; }
    const line = stillFinding(f, after);
    if (line && !remaining.includes(line)) remaining.push(line);
  }
  if (hardcoded) remaining.push(`${hardcoded} duration${hardcoded === 1 ? " is" : "s are"} still hardcoded instead of using the motion tokens.`);

  // Components first, then single elements, then app-wide changes.
  const rank = (g) => (g.slug ? 0 : g.title === "Across the app" ? 2 : 1);
  const ordered = [...groups.values()].sort((a, b) => rank(a) - rank(b));
  return { mode, before: before.score, after: after.score, groups: ordered, remaining };
}

function stillIssue(issue) {
  if (/no exit|unmounts instantly|hides with display/.test(issue)) return "disappears instantly when it closes";
  if (/pops|no transition|no enter/.test(issue)) return "pops in and out with no animation";
  if (/grid-template-rows/.test(issue)) return "animates its height instead of using the grid technique";
  if (/\(layout\)/.test(issue)) {
    const moved = (issue.match(/animates (.+?) \(layout\)/) || [])[1] || "";
    return `animates its ${props(moved.split(/,\s*/))}, which shifts the page`;
  }
  if (/center/.test(issue)) return "grows from its center instead of its trigger";
  return issue;
}

function stillFinding(f, after) {
  const who = f.selector ? elementName(f.selector) : null;
  const comp = f.recipe && (after.components || []).find((c) => c.recipe === f.recipe);
  switch (f.rule) {
    case "off-scale": {
      const kind = usageKind(f.usage);
      if (/^hover /.test(f.usage || "")) return `${who || "A hover"}: still eases in slowly (${plainValue(f.from)}).`;
      const name = comp ? comp.name : cap(String(f.usage || "").replace(/ [a-z]+$/, ""));
      return `${name}: ${kind || "value"} is ${plainValue(f.from)}, the recipe uses ${plainValue(f.to)}.`;
    }
    case "hover-without-transition": return `${who || "A hover"}: still snaps its ${props(f.props)} on hover.`;
    case "layout-animation": return `${who || "A hover"}: still shifts its ${props(f.props)} on hover.`;
    case "untransitioned-overlay": return `${comp ? comp.name : "An overlay"} still pops in and out.`;
    case "transition-all": return "Some transitions still animate every property.";
    case "slow-duration": return "Some transitions still take over a second.";
    case "no-reduced-motion": return "There is no reduced-motion guard yet.";
    default: return null;
  }
}

export function changesMarkdown(desc) {
  const lines = [];
  for (const g of desc.groups) {
    const where = g.file ? ` (\`${g.file}\`)` : "";
    const recipe = g.recipe ? `: now built on the transitions.dev [${g.recipe.name}](https://${g.recipe.url}) recipe${g.recipe.tier === "pro" ? " (Pro)" : ""}` : "";
    lines.push(`**${g.title}**${where}${recipe}`);
    for (const item of g.items) lines.push("- " + item);
    lines.push("");
  }
  if (desc.remaining.length) {
    lines.push("**Still open**");
    for (const r of desc.remaining) lines.push("- " + r);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function changesText(desc) {
  const lines = [];
  for (const g of desc.groups) {
    lines.push("  " + g.title + (g.file ? `  (${g.file})` : "") + (g.recipe ? `: now built on the transitions.dev ${g.recipe.name} recipe` : ""));
    for (const item of g.items) lines.push("    - " + item);
  }
  if (desc.remaining.length) {
    lines.push("  Still open");
    for (const r of desc.remaining) lines.push("    - " + r.replace(/`/g, ""));
  }
  return lines.join("\n");
}

// Short bullets for the score comment on the original pull request.
export function changesHighlights(desc, max = 4) {
  return desc.groups.slice(0, max).map((g) => {
    const first = g.recipe ? `now built on the ${g.recipe.name} recipe` : g.items[0].replace(/\.$/, "");
    return `**${g.title}**: ${first.charAt(0).toLowerCase() + first.slice(1)}`;
  });
}
