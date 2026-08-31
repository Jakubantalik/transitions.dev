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

export function runRules(files) {
  const findings = [];
  const durations = []; // { value(ms), path, line }
  let hasAnimation = false;
  let hasReducedMotion = false;

  for (const f of files) {
    if (!CSSISH.has(f.ext)) continue;
    const src = f.content;

    if (/prefers-reduced-motion/.test(src)) hasReducedMotion = true;
    if (/@keyframes|\banimation(?:-name)?\s*:/.test(src)) hasAnimation = true;

    // hardcoded-duration + duration collection
    DURATION_RE.lastIndex = 0;
    let m;
    while ((m = DURATION_RE.exec(src))) {
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
          message: `Literal duration in "${m[0].trim().slice(0, 60)}". Use a motion token (var(--transition-fast) etc.) so the whole app moves consistently.`,
          recipe: "motion-tokens",
        });
      }
    }

    // transition-all
    const allRe = /transition\s*:\s*all\b/g;
    while ((m = allRe.exec(src))) {
      findings.push({
        rule: "transition-all",
        severity: "warn",
        path: f.path,
        line: lineOf(src, m.index),
        message: "\"transition: all\" animates every property including layout. Name the properties (opacity, transform) for smoother, cheaper motion.",
      });
    }

    // hover-without-transition (stylesheets only, heuristic)
    if (STYLESHEET.has(f.ext)) {
      const hoverRe = /([^{}\n]{1,120}?):hover[^{]*\{([^}]*)\}/g;
      while ((m = hoverRe.exec(src))) {
        const body = m[2];
        if (!/(transform|opacity|background|color|box-shadow|scale|translate|border)/.test(body)) continue;
        if (/transition/.test(body)) continue;
        const base = m[1].trim().split(/[\s>+~,]/).pop();
        if (!base || base.length < 2) continue;
        const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const baseHasTransition = new RegExp(esc + "[^{}]*\\{[^}]*transition", "s").test(src);
        if (!baseHasTransition) {
          findings.push({
            rule: "hover-without-transition",
            severity: "warn",
            path: f.path,
            line: lineOf(src, m.index),
            message: `"${m[1].trim().slice(0, 50)}:hover" changes visual state with no transition on the base selector. The change snaps instead of easing.`,
            recipe: "learn-more-hover",
          });
        }
      }
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
          recipe: overlay[1].toLowerCase().includes("tooltip") ? "tooltip" : "modal-open-close",
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
