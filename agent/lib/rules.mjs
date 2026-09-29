// Deterministic motion rules. Each rule returns findings:
//   { rule, severity, path, line, message, snippet?, recipe? }
// severity: "major" | "warn" | "minor" | "info"
import { lineOf } from "./walk.mjs";

const CSSISH = new Set([".css", ".scss", ".less", ".html", ".vue", ".svelte", ".jsx", ".tsx", ".js", ".mjs", ".ts"]);
const STYLESHEET = new Set([".css", ".scss", ".less"]);
const JSXISH = new Set([".jsx", ".tsx", ".js", ".mjs", ".ts"]);

// Matches "transition: opacity 300ms" / "animation-duration: .3s" with a literal time.
const DURATION_RE = /\b(transition|animation)(?:-duration)?\s*:\s*([^;}"']*\b\d*\.?\d+m?s\b[^;}"']*)/g;
const TIME_RE = /(\d*\.?\d+)(ms|s)\b/g;

// CSS vocabulary that also shows up in prose; excluded when counting "plain words".
const CSS_WORDS = new Set([
  "all", "ease", "linear", "opacity", "transform", "color", "background", "none",
  "both", "forwards", "backwards", "infinite", "alternate", "normal", "reverse",
  "running", "paused", "width", "height", "top", "left", "right", "bottom",
  "transition", "animation", "scale", "translate", "rotate", "filter", "visibility",
  "margin", "padding", "border", "shadow", "inherit", "initial", "unset",
]);

// Single-pass tokenizer: ranges of '...'/"..." string literals and //, /* */ comments
// in a JS-ish file. Template literals are tracked so their contents stay scannable
// (CSS-in-JS lives there) but are not reported as quoted strings.
function literalRanges(src) {
  const strings = [];
  const comments = [];
  let mode = null; // "'" | '"' | "`" | "line" | "block"
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (mode === null) {
      if (c === "'" || c === '"' || c === "`") { mode = c; start = i; }
      else if (c === "/" && src[i + 1] === "/") { mode = "line"; start = i; }
      else if (c === "/" && src[i + 1] === "*") { mode = "block"; start = i; i++; }
    } else if (mode === "'" || mode === '"') {
      if (c === "\\") i++;
      else if (c === mode) { strings.push({ start, end: i, text: src.slice(start + 1, i) }); mode = null; }
      else if (c === "\n") mode = null; // unterminated; bail on this literal
    } else if (mode === "`") {
      if (c === "\\") i++;
      else if (c === "`") mode = null;
    } else if (mode === "line") {
      if (c === "\n") { comments.push({ start, end: i }); mode = null; }
    } else if (mode === "block") {
      if (c === "*" && src[i + 1] === "/") { comments.push({ start, end: i + 1 }); mode = null; i++; }
    }
  }
  if (mode === "line") comments.push({ start, end: src.length });
  return { strings, comments };
}

function rangeAt(ranges, index) {
  for (const r of ranges) if (index >= r.start && index <= r.end) return r;
  return null;
}

// A quoted string is message text when it reads like prose rather than CSS:
// several non-CSS words, or sentence punctuation.
function isMessageText(text) {
  if (/[.!?]\s|[.!?]$/.test(text)) return true;
  const plain = text.split(/\s+/).filter((w) => {
    const bare = w.replace(/[.,!?:;()"']+$/, "");
    return /^[A-Za-z][A-Za-z']*$/.test(bare) && !CSS_WORDS.has(bare.toLowerCase());
  });
  return plain.length >= 4;
}

// True when a match in a JS-ish file sits inside a comment, or inside a quoted
// string that is clearly a human-facing message rather than real CSS.
function inNonCssLiteral(lits, index, { needsDuration = false } = {}) {
  if (rangeAt(lits.comments, index)) return true;
  const str = rangeAt(lits.strings, index);
  if (!str) return false;
  if (isMessageText(str.text)) return true;
  // e.g. a bare "transition: all" label with no time value animates nothing.
  if (needsDuration && !/\d\s*m?s\b/.test(str.text)) return true;
  return false;
}


// ── CSS custom properties ────────────────────────────────────────────────
// Durations are usually tokenized: `transition: opacity var(--menu-close)`.
// Resolving the token is the only way to see that --menu-close is 3s.
const CUSTOM_PROP_RE = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g;
const SLOW_MS = 1000;

function toMs(num, unit) {
  return unit === "s" ? parseFloat(num) * 1000 : parseFloat(num);
}

// First pass over all files: every `--name: value` declaration.
function collectCustomProps(files) {
  const props = new Map(); // name -> { value, path, line }
  for (const f of files) {
    if (!CSSISH.has(f.ext)) continue;
    CUSTOM_PROP_RE.lastIndex = 0;
    let m;
    while ((m = CUSTOM_PROP_RE.exec(f.content))) {
      // Skip usages like var(--x) - a declaration's name is not preceded by "(".
      if (f.content[m.index - 1] === "(") continue;
      if (!props.has(m[1])) props.set(m[1], { value: m[2].trim(), path: f.path, line: lineOf(f.content, m.index) });
    }
  }
  return props;
}

// Times in a declaration value, literal or via var() chains (with fallbacks).
// Returns [{ ms, via?: { name, path, line } }].
function resolveTimes(value, props, depth = 0) {
  const out = [];
  if (depth > 8) return out;
  const varRe = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
  let rest = value;
  let v;
  while ((v = varRe.exec(value))) {
    const def = props.get(v[1]);
    const inner = def ? resolveTimes(def.value, props, depth + 1) : (v[2] ? resolveTimes(v[2], props, depth + 1) : []);
    for (const t of inner) out.push({ ms: t.ms, via: t.via || (def ? { name: v[1], path: def.path, line: def.line } : null) });
    rest = rest.replace(v[0], " ");
  }
  const timeRe = /(\d*\.?\d+)(ms|s)\b/g;
  let t;
  while ((t = timeRe.exec(rest))) out.push({ ms: toMs(t[1], t[2]) });
  return out;
}

export function runRules(files) {
  const findings = [];
  const durations = []; // { value(ms), path, line }
  const props = collectCustomProps(files);
  const slowTokens = new Set(); // token names already reported at definition
  let hasAnimation = false;
  let hasReducedMotion = false;

  for (const f of files) {
    if (!CSSISH.has(f.ext)) continue;
    const src = f.content;
    const lits = JSXISH.has(f.ext) ? literalRanges(src) : null;

    if (/prefers-reduced-motion/.test(src)) hasReducedMotion = true;
    if (/@keyframes|\banimation(?:-name)?\s*:/.test(src)) hasAnimation = true;

    // hardcoded-duration + duration collection
    DURATION_RE.lastIndex = 0;
    let m;
    while ((m = DURATION_RE.exec(src))) {
      if (lits && inNonCssLiteral(lits, m.index)) continue;
      const valuePart = m[2];
      TIME_RE.lastIndex = 0;
      let t;
      let realTimes = 0;
      while ((t = TIME_RE.exec(valuePart))) {
        const ms = t[2] === "s" ? parseFloat(t[1]) * 1000 : parseFloat(t[1]);
        // Values of 20ms or less are effectively instant; they are almost always
        // prefers-reduced-motion overrides, not real motion.
        if (ms <= 20) continue;
        realTimes++;
        durations.push({ ms, path: f.path, line: lineOf(src, m.index) });
      }
      if (realTimes > 0 && !/var\(/.test(valuePart)) {
        findings.push({
          rule: "hardcoded-duration",
          severity: "minor",
          path: f.path,
          line: lineOf(src, m.index),
          message: `Literal duration in "${m[0].trim().slice(0, 60)}". Use a motion token (var(--duration-fast) etc. from the transitions.dev scale) so the whole app moves consistently.`,
          recipe: "motion-tokens",
        });
      }
    }

    // slow-duration: transitions resolving above SLOW_MS, literal or tokenized.
    const transDeclRe = /\btransition(?:-duration)?\s*:\s*([^;}"']+)/g;
    while ((m = transDeclRe.exec(src))) {
      if (lits && inNonCssLiteral(lits, m.index)) continue;
      const times = resolveTimes(m[1], props);
      for (const t of times) {
        if (t.via && t.ms > 20) durations.push({ ms: t.ms, path: f.path, line: lineOf(src, m.index) });
      }
      // The first time in each comma-separated transition is its duration;
      // later ones may be delays. Flag the slowest duration-like value.
      const slow = times.filter((t) => t.ms > SLOW_MS).sort((a, b) => b.ms - a.ms)[0];
      if (!slow) continue;
      const secs = (slow.ms / 1000).toFixed(slow.ms % 1000 ? 3 : 0).replace(/\.?0+$/, "");
      findings.push({
        rule: "slow-duration",
        severity: "warn",
        path: f.path,
        line: lineOf(src, m.index),
        message: slow.via
          ? `Transition runs ${secs}s via ${slow.via.name} (defined at ${slow.via.path}:${slow.via.line}). UI transitions should stay well under a second.`
          : `Transition runs ${secs}s. UI transitions should stay well under a second.`,
        recipe: "motion-tokens",
      });
      for (const t of times) {
        if (!(t.ms > SLOW_MS && t.via) || slowTokens.has(t.via.name)) continue;
        slowTokens.add(t.via.name);
        const tsecs = (t.ms / 1000).toFixed(t.ms % 1000 ? 3 : 0).replace(/\.?0+$/, "");
        findings.push({
          rule: "slow-duration",
          severity: "warn",
          path: t.via.path,
          line: t.via.line,
          message: `Motion token ${t.via.name} is ${tsecs}s - every transition using it drags. Bring it onto the duration scale (150-400ms).`,
          recipe: "motion-tokens",
        });
      }
    }

    // transition-all
    const allRe = /transition\s*:\s*all\b/g;
    while ((m = allRe.exec(src))) {
      if (lits && inNonCssLiteral(lits, m.index, { needsDuration: true })) continue;
      findings.push({
        rule: "transition-all",
        severity: "warn",
        path: f.path,
        line: lineOf(src, m.index),
        message: "\"transition: all\" animates every property including layout. Name the properties its states actually change (for example background-color, opacity, transform) for smoother, cheaper motion.",
      });
    }

    // untransitioned-overlay (JSX-ish files, per-file heuristic)
    if (JSXISH.has(f.ext) || f.ext === ".vue" || f.ext === ".svelte") {
      const overlay = src.match(/<(Modal|Dialog|Drawer|Sheet|Popover|Tooltip|Toast|Snackbar|Dropdown|DropdownMenu|Menu)\b/);
      const conditional = /\{\s*\w[\w.]*\s*&&\s*</.test(src) || /\bopen\s*[=?]/.test(src) || /\bisOpen\b/.test(src) || /\bshow\w*\s*[=?]/.test(src);
      const animated = /(framer-motion|AnimatePresence|motion\.|react-spring|transition|animate|@keyframes|data-\[state|data-state|duration-)/i.test(src);
      if (overlay && conditional && !animated) {
        findings.push({
          rule: "untransitioned-overlay",
          severity: "major",
          path: f.path,
          line: lineOf(src, overlay.index),
          message: `<${overlay[1]}> appears and disappears with no enter or exit transition. It pops instead of animating.`,
          recipe: /tooltip/i.test(overlay[1]) ? "tooltip" : /toast|snackbar/i.test(overlay[1]) ? "toast" : /drawer|sheet/i.test(overlay[1]) ? "panel-reveal" : /popover|dropdown|menu/i.test(overlay[1]) ? "menu-dropdown" : "modal",
        });
      }
    }
  }

  // no-reduced-motion (project-level)
  if (hasAnimation && !hasReducedMotion) {
    findings.push({
      rule: "no-reduced-motion",
      severity: "warn",
      path: "(project)",
      line: 0,
      message: "The project animates but never checks prefers-reduced-motion. Users who turn motion off in their OS still get full animation. Add one media query guard.",
      recipe: "motion-tokens",
    });
  }

  // inconsistent-durations (project-level)
  const unique = [...new Set(durations.map((d) => d.ms))].sort((a, b) => a - b);
  if (unique.length > 5) {
    findings.push({
      rule: "inconsistent-durations",
      severity: "info",
      path: "(project)",
      line: 0,
      message: `${unique.length} different animation durations in use (${unique.slice(0, 8).map((v) => v + "ms").join(", ")}${unique.length > 8 ? ", ..." : ""}). Consolidate to 2 or 3 motion tokens.`,
      recipe: "motion-tokens",
    });
  }

  return findings;
}
