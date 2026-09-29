// Tolerant CSS reader: flat rules with their at-rule context, keyframes, and
// value helpers for motion (durations, easings, transforms). Reads plain CSS,
// <style> blocks, CSS-in-JS template literals, and the nesting SCSS and modern
// CSS use. It never throws: anything it cannot read is skipped.

const STYLESHEET = new Set([".css", ".scss", ".less"]);
const MARKUP = new Set([".html", ".vue", ".svelte"]);
const JSXISH = new Set([".jsx", ".tsx", ".js", ".mjs", ".ts"]);

// CSS text inside a file, with its offset so findings keep real line numbers.
export function cssSources(file) {
  if (STYLESHEET.has(file.ext)) return [{ text: file.content, offset: 0 }];
  const out = [];
  if (MARKUP.has(file.ext) || JSXISH.has(file.ext)) {
    const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = styleRe.exec(file.content))) {
      out.push({ text: m[1], offset: m.index + m[0].indexOf(m[1]) });
    }
  }
  if (JSXISH.has(file.ext) || MARKUP.has(file.ext)) {
    for (const t of templateLiterals(file.content)) {
      if (!/[{;]/.test(t.text)) continue;
      if (!/(transition|animation|transform|opacity|@keyframes)\s*[:{\s]/.test(t.text)) continue;
      // `${...}` interpolations become blanks of the same length, so offsets hold.
      out.push({ text: blankInterpolations(t.text), offset: t.start });
    }
  }
  return out;
}

function templateLiterals(src) {
  const out = [];
  let mode = null;
  let start = 0;
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (mode === null) {
      if (c === "`") { mode = "`"; start = i + 1; depth = 0; }
      else if (c === "'" || c === '"') mode = c;
      else if (c === "/" && src[i + 1] === "/") mode = "line";
      else if (c === "/" && src[i + 1] === "*") { mode = "block"; i++; }
    } else if (mode === "`") {
      if (c === "\\") i++;
      else if (c === "$" && src[i + 1] === "{") { depth++; i++; }
      else if (c === "}" && depth > 0) depth--;
      else if (c === "`" && depth === 0) { out.push({ start, text: src.slice(start, i) }); mode = null; }
    } else if (mode === "'" || mode === '"') {
      if (c === "\\") i++;
      else if (c === mode || c === "\n") mode = null;
    } else if (mode === "line") {
      if (c === "\n") mode = null;
    } else if (mode === "block") {
      if (c === "*" && src[i + 1] === "/") { mode = null; i++; }
    }
  }
  return out;
}

function blankInterpolations(text) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (depth === 0 && text[i] === "$" && text[i + 1] === "{") { depth = 1; out += "  "; i++; continue; }
    if (depth > 0) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") depth--;
      out += text[i] === "\n" ? "\n" : " ";
      continue;
    }
    out += text[i];
  }
  return out;
}

// ── Parser ────────────────────────────────────────────────────────────────
// Returns { rules: [{ selector, decls, media, index }], keyframes: [{ name, frames, index }] }
// decls: [{ prop, value, important, index }]; indexes are offsets into `src`.
export function parseCss(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const rules = [];
  const keyframes = [];
  const stack = [];
  let seg = 0;

  const parentRule = () => {
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].type === "rule") return stack[k];
    return null;
  };
  const mediaOf = () => stack.filter((s) => s.type === "at").map((s) => s.prelude);
  const inKeyframes = () => stack.some((s) => s.type === "keyframes");

  const addDecl = (node, raw, at) => {
    if (!node || !raw.trim()) return;
    const m = raw.match(/^\s*(--[A-Za-z0-9_-]+|-?[A-Za-z][A-Za-z-]*)\s*:([\s\S]*)$/);
    if (!m) return;
    let value = m[2].trim();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, "").trim();
    const lead = raw.length - raw.trimStart().length;
    (node.decls = node.decls || []).push({ prop: m[1].toLowerCase(), value, important, index: at + lead });
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const q = c;
      for (i++; i < text.length && text[i] !== q && text[i] !== "\n"; i++) if (text[i] === "\\") i++;
      continue;
    }
    if (c === "{") {
      const raw = text.slice(seg, i);
      const prelude = raw.trim().replace(/\s+/g, " ");
      const index = seg + (raw.length - raw.trimStart().length);
      let node;
      if (/^@(-webkit-)?keyframes\b/i.test(prelude)) {
        node = { type: "keyframes", name: prelude.split(/\s+/)[1] || "", frames: [], index };
      } else if (inKeyframes()) {
        const keys = prelude.split(",").map((k) => k.trim().toLowerCase())
          .map((k) => (k === "from" ? 0 : k === "to" ? 100 : parseFloat(k))).filter((k) => !Number.isNaN(k));
        node = { type: "frame", keys, decls: [], index };
      } else if (prelude.startsWith("@")) {
        const kind = /^@(media|supports|layer|container|starting-style|scope|document)\b/i.test(prelude) ? "at" : "other";
        node = { type: kind, prelude, decls: [], index };
      } else {
        const parent = parentRule();
        node = { type: "rule", selector: parent ? nestSelector(parent.selector, prelude) : prelude, decls: [], media: mediaOf(), index };
      }
      stack.push(node);
      seg = i + 1;
      continue;
    }
    if (c === ";") {
      addDecl(stack[stack.length - 1], text.slice(seg, i), seg);
      seg = i + 1;
      continue;
    }
    if (c === "}") {
      addDecl(stack[stack.length - 1], text.slice(seg, i), seg);
      seg = i + 1;
      const node = stack.pop();
      if (!node) continue;
      if (node.type === "rule") rules.push(node);
      else if (node.type === "keyframes") keyframes.push(node);
      else if (node.type === "frame") {
        const kf = stack[stack.length - 1];
        if (kf && kf.type === "keyframes") kf.frames.push(node);
      } else if (node.type === "at" && node.decls && node.decls.length) {
        // Declarations straight inside an at-rule nested in a style rule:
        // `.x { @starting-style { opacity: 0 } }`.
        const parent = parentRule();
        if (parent) rules.push({ type: "rule", selector: parent.selector, decls: node.decls, media: [...mediaOf(), node.prelude], index: node.index });
      }
    }
  }
  return { rules, keyframes };
}

function nestSelector(parent, child) {
  const parents = splitList(parent);
  const children = splitList(child);
  const out = [];
  for (const p of parents) for (const ch of children) out.push(ch.includes("&") ? ch.replace(/&/g, p) : p + " " + ch);
  return out.join(", ");
}

// Split on top-level commas (not inside parentheses or brackets).
export function splitList(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

// ── Selectors ─────────────────────────────────────────────────────────────
// Compounds of a complex selector, split on combinators (outside brackets).
export function compounds(selector) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    if (depth === 0 && (c === " " || c === ">" || c === "+" || c === "~")) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// { element, classes, attrs, pseudos, pseudoElement } of one compound.
export function parseCompound(compound) {
  const out = { element: null, classes: [], attrs: [], pseudos: [], pseudoElement: null };
  const el = compound.match(/^([A-Za-z][A-Za-z0-9-]*)/);
  if (el) out.element = el[1].toLowerCase();
  const re = /\.((?:\\.|[A-Za-z0-9_-])+)|\[([^\]]+)\]|::([A-Za-z-]+)(\([^)]*\))?|:([A-Za-z-]+)(\((?:[^()]|\([^()]*\))*\))?/g;
  let m;
  while ((m = re.exec(compound))) {
    if (m[1]) out.classes.push(m[1].replace(/\\/g, ""));
    else if (m[2]) out.attrs.push(m[2].replace(/\s+/g, ""));
    else if (m[3]) out.pseudoElement = m[3].toLowerCase();
    else if (m[5]) out.pseudos.push((m[5] + (m[6] || "")).toLowerCase());
  }
  return out;
}

// ── Values ────────────────────────────────────────────────────────────────
// Custom properties from parsed rules. Reduced-motion overrides (which zero
// the tokens on purpose) are skipped so the real values win.
export function collectProps(parsedFiles) {
  const props = new Map();
  for (const pf of parsedFiles) {
    for (const r of pf.rules) {
      if (r.media.some((m) => /prefers-reduced-motion/i.test(m))) continue;
      for (const d of r.decls) {
        if (!d.prop.startsWith("--") || props.has(d.prop)) continue;
        props.set(d.prop, { value: d.value, path: pf.path, index: d.index, lineOf: pf.lineOf });
      }
    }
  }
  return props;
}

// Substitute var(--x, fallback) chains. Returns { value, via } where `via` is
// the outermost custom property the value came through (for reporting).
export function resolveVars(value, props, depth = 0) {
  let via = null;
  if (depth > 8 || !value.includes("var(")) return { value, via };
  let out = "";
  for (let i = 0; i < value.length; i++) {
    if (value.startsWith("var(", i)) {
      let d = 0;
      let j = i + 3;
      for (; j < value.length; j++) {
        if (value[j] === "(") d++;
        else if (value[j] === ")") { d--; if (d === 0) break; }
      }
      const inner = value.slice(i + 4, j);
      const comma = splitList(inner);
      const name = comma[0].trim();
      const fallback = inner.includes(",") ? inner.slice(inner.indexOf(",") + 1).trim() : "";
      const def = props.get(name);
      if (def) {
        const r = resolveVars(def.value, props, depth + 1);
        out += r.value;
        if (!via) via = { name, path: def.path, line: def.lineOf(def.index) };
      } else if (fallback) {
        out += resolveVars(fallback, props, depth + 1).value;
      } else {
        out += "var(" + inner + ")";
      }
      i = j;
      continue;
    }
    out += value[i];
  }
  return { value: out, via };
}

export function toMs(num, unit) {
  return unit === "s" ? parseFloat(num) * 1000 : parseFloat(num);
}

const EASING_RE = /\b(linear|ease-in-out|ease-in|ease-out|ease|step-start|step-end)\b|cubic-bezier\([^)]*\)|steps\([^)]*\)|linear\([^)]*\)/;

// transition shorthand -> [{ prop, ms, delay, ease }]
export function parseTransitionList(value) {
  const out = [];
  for (const part of splitList(value)) {
    const times = [...part.matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)].map((t) => toMs(t[1], t[2]));
    const easeM = part.match(EASING_RE);
    const rest = part.replace(EASING_RE, " ").replace(/(-?\d*\.?\d+)(ms|s)\b/g, " ").trim();
    const prop = (rest.split(/\s+/).find((w) => /^[a-z-]+$/i.test(w) && w !== "allow-discrete" && w !== "normal") || "all").toLowerCase();
    out.push({ prop, ms: times[0] ?? 0, delay: times[1] ?? 0, ease: easeM ? easeM[0] : "ease" });
  }
  return out;
}

// animation shorthand -> [{ name, ms, delay, ease, infinite }]
export function parseAnimationList(value) {
  const out = [];
  const KEYWORDS = /^(infinite|alternate|alternate-reverse|reverse|normal|forwards|backwards|both|none|running|paused|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|initial|inherit|unset)$/i;
  for (const part of splitList(value)) {
    const times = [...part.matchAll(/(-?\d*\.?\d+)(ms|s)\b/g)].map((t) => toMs(t[1], t[2]));
    const easeM = part.match(EASING_RE);
    const cleaned = part.replace(EASING_RE, " ").replace(/(-?\d*\.?\d+)(ms|s)\b/g, " ");
    const name = cleaned.split(/\s+/).find((w) => w && !KEYWORDS.test(w) && !/^\d/.test(w)) || "";
    out.push({ name, ms: times[0] ?? 0, delay: times[1] ?? 0, ease: easeM ? easeM[0] : "ease", infinite: /\binfinite\b/.test(part) });
  }
  return out;
}

// transform / scale / translate / filter values -> { scale, tx, ty, blur }
export function parseMotionValues(decls) {
  const out = {};
  for (const d of decls) {
    const v = d.value;
    if (d.prop === "transform") {
      const s = v.match(/scale(?:3d)?\(\s*(-?\d*\.?\d+)/);
      if (s) out.scale = parseFloat(s[1]);
      const sy = v.match(/scale[XY]\(\s*(-?\d*\.?\d+)/);
      if (sy && out.scale == null) out.scale = parseFloat(sy[1]);
      if (/\bnone\b/.test(v)) out.scale = out.scale ?? 1;
      const t = v.match(/translate(?:3d)?\(\s*(-?\d*\.?\d+)(px|%|rem|em)?\s*(?:,\s*(-?\d*\.?\d+)(px|%|rem|em)?)?/);
      if (t) { out.tx = px(t[1], t[2]); if (t[3] != null) out.ty = px(t[3], t[4]); }
      const tx = v.match(/translateX\(\s*(-?\d*\.?\d+)(px|%|rem|em)?/);
      if (tx) out.tx = px(tx[1], tx[2]);
      const ty = v.match(/translateY\(\s*(-?\d*\.?\d+)(px|%|rem|em)?/);
      if (ty) out.ty = px(ty[1], ty[2]);
    } else if (d.prop === "scale") {
      const s = v.match(/^(-?\d*\.?\d+)/);
      if (s) out.scale = parseFloat(s[1]);
    } else if (d.prop === "translate") {
      const t = v.match(/^(-?\d*\.?\d+)(px|%|rem|em)?(?:\s+(-?\d*\.?\d+)(px|%|rem|em)?)?/);
      if (t) { out.tx = px(t[1], t[2]); if (t[3] != null) out.ty = px(t[3], t[4]); }
    } else if (d.prop === "filter" || d.prop === "backdrop-filter") {
      const b = v.match(/blur\(\s*(\d*\.?\d+)px/);
      if (b && d.prop === "filter") out.blur = parseFloat(b[1]);
    } else if (d.prop === "opacity") {
      const o = parseFloat(v);
      if (!Number.isNaN(o)) out.opacity = o;
    }
  }
  return out;
}

function px(num, unit) {
  const n = parseFloat(num);
  if (unit === "rem" || unit === "em") return n * 16;
  if (unit === "%") return null; // relative travel: not comparable to the px scale
  return n;
}

// Line lookup that stays fast on big files.
export function lineIndex(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === "\n") starts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}
