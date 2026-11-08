/*
 * transitions.dev / UI generation
 *
 * Plays an "agent is generating this" animation over any element, built from the element's own structure:
 * a dot field ripples out, construction guides and corner handles appear, the outline and every part
 * (boxes, text lines, icon paths) are traced in small flowing dots, then the real UI is revealed behind a
 * scan line with a fade and a smooth ease-out.
 *
 * Variants (variant option)
 *   "ui"              the default: the component's dotted wireframe (outline, boxes, text lines, icons), then the reveal
 *   "text"            big type: every glyph traced along its real outline, then fading in    } handled by
 *   "small-text"      a dotted line through each line of text, the characters fading in      } text-image-generation.js,
 *   "image"           a frame, a tone sketch, a halftone of its pixels, colour dots, the photo } which ships alongside
 *   "auto"            text by size and images, in one block                                  }
 *   "transform"       one version of a UI regenerating into the next: transform(oldEl, newEl) or { variant: "transform", to }
 *
 * Modes
 *   "skeleton"        the dotted drawing and the reveal
 *   "skeleton-texts"  the same, plus generation texts: an agent log, the motion CSS being written, a step line
 *
 * Usage
 *   import { generate } from "./ui-generation.js";
 *   const run = generate(el, { mode: "skeleton-texts" });
 *   await run.finished;          // resolves when the real UI is fully in
 *   run.cancel();                // stops and shows the element as it is
 *
 *   <div data-t-generate="skeleton"> ... </div>   + UIGeneration.auto()   (plays when it scrolls into view)
 *
 * No dependencies. Works with any framework: call it after the element has rendered.
 * Respects prefers-reduced-motion (a plain fade instead).
 */

import * as TIG from "./text-image-generation.js";

const NS = "http://www.w3.org/2000/svg";
const TEXT_IMAGE = ["text", "small-text", "image", "auto"]; // the variants text-image-generation.js draws
// the text and image variants take the same modes: skeleton → trace, skeleton-texts → trace-texts
const toTrace = (o) => Object.assign({}, o, { mode: /texts$/.test(o.mode || "") ? "trace-texts" : "trace" });
// a scrubbable build of the text and image variants (seek(ms)), for video tools: see 03-text.md
export const timeline = (el, options = {}) => TIG.timeline(el, toTrace(Object.assign({ variant: "text" }, options)));

// ─── timing: phases of a build, as fractions of `duration` (the reveal runs a little past 1) ───
const PH = {
  dots: [0, 0.3], probe: [0.02, 0.24], guides: [0.04, 0.3], outline: [0.1, 0.42],
  parts: [0.28, 0.74], reveal: [0.74, 1.055], clean: [0.84, 1.04],
};
const END = 1.09; // the build is over (and the overlay removed) at duration × END

const DEFAULTS = {
  mode: "skeleton",          // "skeleton" | "skeleton-texts"
  duration: 2400,            // ms for the drawing; the whole run is about duration × 1.09
  delay: 0,                  // ms before it starts
  steps: ["Planning layout", "Drawing structure", "Writing styles", "Adding motion"],
  done: "Ready",             // last step, shown when the UI is in (skeleton-texts)
  code: null,                // lines for the motion CSS panel; null = derived from the element
  title: null,               // name used in the generated CSS header; null = from aria-label / heading
  maxParts: 60,              // most parts traced (largest first when there are more)
  keys: 5,                   // key elements that get guides, handles and a size label
  onDone: null,
};

// ─── small math ───
const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, p) => a + (b - a) * p;
const smooth = (a, b, x) => { const q = clamp((x - a) / (b - a)); return q * q * (3 - 2 * q); };
const win = (r, p) => clamp((p - r[0]) / (r[1] - r[0]));
const f2 = (n) => (+n).toFixed(2);
const hashN = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function bezier(x1, y1, x2, y2) {
  const cx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const cy = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, m = 0.5; for (let i = 0; i < 28; i++) { m = (lo + hi) / 2; if (cx(m) < x) lo = m; else hi = m; } return cy(m); };
}
const OUT = bezier(0.16, 1, 0.3, 1);          // drawing: a soft, quick-settling ease-out
const SMOOTH_OUT = bezier(0.22, 1, 0.36, 1);  // reveal: --ease-smooth-out

function svg(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
function rrPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f2(x + r)} ${f2(y)}H${f2(x + w - r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w)} ${f2(y + r)}V${f2(y + h - r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w - r)} ${f2(y + h)}H${f2(x + r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x)} ${f2(y + h - r)}V${f2(y + r)}A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + r)} ${f2(y)}Z`;
}
// half an outline, from top centre to bottom centre, clockwise (dir 1) or counter-clockwise (dir 0)
function rrHalf(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const X = (v) => f2(x + v), Y = (v) => f2(y + v), R = f2(r);
  return dir
    ? `M${X(w / 2)} ${Y(0)}H${X(w - r)}A${R} ${R} 0 0 1 ${X(w)} ${Y(r)}V${Y(h - r)}A${R} ${R} 0 0 1 ${X(w - r)} ${Y(h)}H${X(w / 2)}`
    : `M${X(w / 2)} ${Y(0)}H${X(r)}A${R} ${R} 0 0 0 ${X(0)} ${Y(r)}V${Y(h - r)}A${R} ${R} 0 0 0 ${X(r)} ${Y(h)}H${X(w / 2)}`;
}
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// ─── 1. read the element: boxes, text lines, icon geometry, key elements ───
function measure(el, opts) {
  const R = el.getBoundingClientRect(), area = R.width * R.height, parts = [];
  const rel = (r) => ({ x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height });
  const alpha = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return c && c !== "transparent" ? 1 : 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? +p[3] : 1; };
  // (el itself is hidden while it builds, so the walk stops at it)
  const hidden = (n) => { for (let x = n; x && x !== el; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity < 0.05) return true; } return false; };
  // the card's radius: its own, or that of a child that fills it
  let radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  const walk = (node) => {
    for (const c of node.children) {
      if (c.matches("script, style, template, [data-t-generate-skip]") || hidden(c)) continue;
      const r = c.getBoundingClientRect(), cs = getComputedStyle(c);
      if (!r.width || !r.height) { walk(c); continue; }
      if (Math.abs(r.width - R.width) < 2 && Math.abs(r.height - R.height) < 2) radius = Math.max(radius, parseFloat(cs.borderTopLeftRadius) || 0);
      if (c instanceof SVGSVGElement) {
        if (r.width <= 120 && r.height <= 120) {
          const paths = [];
          for (const g of c.querySelectorAll("path, circle, ellipse, rect, line, polyline, polygon")) {
            if (g.closest("defs, clipPath, mask, symbol") || hidden(g)) continue;
            const m = g.getScreenCTM(); if (!m) continue;
            const attrs = {}; for (const a of ["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points"]) if (g.hasAttribute(a)) attrs[a] = g.getAttribute(a);
            paths.push({ tag: g.tagName.toLowerCase(), attrs, m: [m.a, m.b, m.c, m.d, m.e - R.left, m.f - R.top] });
          }
          if (paths.length) parts.push({ kind: "icon", ...rel(r), paths, name: "svg" });
        }
        continue;
      }
      const big = r.width * r.height > area * 0.6, blurred = /blur/.test(cs.filter);
      const boxy = !big && !blurred && (alpha(cs.backgroundColor) > 0.02 || parseFloat(cs.borderTopWidth) > 0 || /^(IMG|CANVAS|VIDEO|INPUT|BUTTON|TEXTAREA|SELECT)$/.test(c.tagName) || cs.backgroundImage !== "none");
      if (boxy) {
        const interactive = /^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(c.tagName) || /button|tab|switch|checkbox|slider/.test(c.getAttribute("role") || "");
        const name = c.tagName === "INPUT" || c.tagName === "TEXTAREA" ? "input" : c.tagName === "BUTTON" || c.getAttribute("role") === "button" ? "button" : /^(IMG|CANVAS|VIDEO)$/.test(c.tagName) ? "image" : "frame";
        parts.push({ kind: "box", ...rel(r), r: Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2), interactive, name, el: c });
      }
      for (const n of c.childNodes) {
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n); const lines = [];
        for (const q of rg.getClientRects()) {
          const last = lines[lines.length - 1], y = q.top - R.top;
          if (last && Math.abs(last.y - y) < 2) last.x2 = Math.max(last.x2, q.right - R.left); else lines.push({ x: q.left - R.left, x2: q.right - R.left, y, h: q.height });
        }
        if (lines.length) parts.push({ kind: "text", lines, x: Math.min(...lines.map((l) => l.x)), y: lines[0].y, w: Math.max(...lines.map((l) => l.x2 - l.x)), h: lines.reduce((a, l) => a + l.h, 0), name: "text", el: c });
      }
      walk(c);
    }
  };
  walk(el);
  // the same box twice (a button and the span that fills it) is drawn once
  for (let i = parts.length - 1; i > 0; i--) {
    const p = parts[i]; if (p.kind !== "box") continue;
    if (parts.some((q, j) => j < i && q.kind === "box" && Math.abs(q.x - p.x) < 1.5 && Math.abs(q.y - p.y) < 1.5 && Math.abs(q.w - p.w) < 1.5 && Math.abs(q.h - p.h) < 1.5)) parts.splice(i, 1);
  }
  // too many parts: keep the largest, in document order
  if (parts.length > opts.maxParts) {
    const keep = new Set([...parts].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, opts.maxParts));
    for (let i = parts.length - 1; i >= 0; i--) if (!keep.has(parts[i])) parts.splice(i, 1);
  }
  // key elements: interactive boxes first, then the largest boxes
  const boxes = parts.filter((p) => p.kind === "box");
  [...boxes.filter((b) => b.interactive), ...boxes.filter((b) => !b.interactive).sort((a, b) => b.w * b.h - a.w * a.h)].slice(0, opts.keys).forEach((k) => (k.key = true));
  return { w: R.width, h: R.height, r: Math.min(radius, R.width / 2, R.height / 2), parts };
}

// ─── 2. the motion CSS the texts panel streams: the element's own values on the transitions.dev token scale ───
function deriveCode(el, M, title) {
  const hex = (c) => { const m = String(c).match(/[\d.]+/g); if (!m || (m[3] !== undefined && +m[3] === 0)) return null; return "#" + m.slice(0, 3).map((v) => Math.round(+v).toString(16).padStart(2, "0")).join(""); };
  const name = (title || el.getAttribute("aria-label") || (el.querySelector("h1,h2,h3,h4,strong,b") || {}).textContent || "component").trim().toLowerCase().slice(0, 32);
  const MOTION = { button: "transition: scale var(--duration-quick) var(--ease-smooth-out);", input: "transition: box-shadow var(--duration-fast) var(--ease-smooth-out);",
    text: "animation: rise-in var(--duration-fast) var(--ease-smooth-out);", image: "transition: opacity var(--duration-slow) var(--ease-in-out);", frame: "transition: opacity var(--duration-fast) var(--ease-smooth-out);" };
  const code = [`/* ${name} / motion */`, ":root {", "  --duration-quick: 150ms;", "  --duration-fast: 250ms;", "  --duration-slow: 400ms;", "  --ease-smooth-out: cubic-bezier(.22, 1, .36, 1);", "  --ease-in-out: ease-in-out;", "}"];
  M.parts.filter((p) => p.el && p.kind !== "icon").slice(0, 12).forEach((p, i) => {
    const cs = getComputedStyle(p.el), r = parseFloat(cs.borderTopLeftRadius) || 0;
    code.push(`.${p.name}-${String(i + 1).padStart(2, "0")} {`);
    if (p.kind === "box" && r) code.push(`  border-radius: ${r > 400 ? 999 : Math.round(r)}px;`);
    if (p.kind === "text") { code.push(`  font: ${parseFloat(cs.fontSize)}px/${Math.round(parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4)}px;`); const c = hex(cs.color); if (c) code.push(`  color: ${c};`); }
    const bg = p.kind === "box" && hex(cs.backgroundColor); if (bg) code.push(`  background: ${bg};`);
    code.push(`  ${MOTION[p.name] || MOTION.frame}`, "}");
  });
  return code;
}

// ─── 3. build the overlay ───
function buildOverlay(el, M, opts) {
  const R = el.getBoundingClientRect(), w = M.w, h = M.h, MG = 44, SP = 15, DOT_GAP = 4.8, GUIDE_GAP = 6.5;
  const layer = document.createElement("div");
  layer.className = "t-gen" + (opts.mode === "skeleton-texts" ? " t-gen--texts" : "");
  layer.setAttribute("aria-hidden", "true"); // decoration only: assistive tech reads the real element
  Object.assign(layer.style, { left: f2(R.left + scrollX) + "px", top: f2(R.top + scrollY) + "px", width: f2(w) + "px", height: f2(h) + "px" });
  const root = svg("svg", { class: "t-gen-svg", width: f2(w), height: f2(h), viewBox: `0 0 ${f2(w)} ${f2(h)}` }, layer);
  document.body.appendChild(layer); el.__tGenLayer = layer; // in the page first: SVG geometry can only be measured once it renders
  const G = { el, layer, root, w, h, M: MG, n: (buildOverlay.n = (buildOverlay.n || 0) + 1), parts: [], keys: [] };
  const defs = svg("defs", {}, root);

  // dot field + matrix rain columns
  const dots = svg("g", {}, root); G.dots = []; let maxD = 0;
  for (let x = -Math.floor(MG / SP) * SP; x <= w + MG; x += SP) for (let y = -Math.floor(MG / SP) * SP; y <= h + MG; y += SP) {
    const d = Math.hypot(x - w / 2, y - h / 2), out = Math.max(0, -x, x - w, -y, y - h), col = Math.round(x / SP);
    G.dots.push({ el: svg("circle", { cx: x, cy: y, r: 1.1, class: "t-gen-dot" }, dots), x, y, d, edge: 1 - clamp(out / MG), inside: out === 0,
      v: 0.07 + 0.09 * hashN(col * 7.13 + G.n * 31.7), ph: hashN(col * 3.71 + G.n * 11.3) * 900, tr: 50 + 70 * hashN(col * 1.91 + G.n) });
    maxD = Math.max(maxD, d);
  }
  G.maxD = maxD; G.span = h + 2 * MG;

  const stroke = (d, parent, cls = "t-gen-wire", extra = {}) => { const e = svg("path", Object.assign({ d, class: cls }, extra), parent); return { el: e, L: e.getTotalLength(), gap: cls === "t-gen-guide" ? GUIDE_GAP : DOT_GAP }; };
  const head = (parent, r = 2.4) => svg("circle", { r, class: "t-gen-head", opacity: 0 }, parent);

  // probe, guides, size label
  G.probe = svg("path", { d: `M0 ${-MG}V${f2(h + MG)}`, class: "t-gen-guide t-gen-guide--dashed", opacity: 0 }, root);
  G.guides = [[-MG, 0, w + MG, 0], [w, -MG, w, h + MG], [w + MG, h, -MG, h], [0, h + MG, 0, -MG]].map(([a, b, c, d]) => stroke(`M${f2(a)} ${f2(b)}L${f2(c)} ${f2(d)}`, root, "t-gen-guide"));
  G.dim = svg("text", { x: 0, y: -10, class: "t-gen-label" }, root);

  // wireframe: wiped away behind the scan line
  const clip = svg("clipPath", { id: "t-gen-clip-" + G.n }, defs);
  G.clipRect = svg("rect", { x: -MG - 10, y: -MG, width: w + 2 * MG + 20, height: h + 2 * MG }, clip);
  const glow = svg("linearGradient", { id: "t-gen-glow-" + G.n, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svg("stop", { offset: 0, class: "t-gen-glow-stop", "stop-opacity": 0 }, glow); svg("stop", { offset: 1, class: "t-gen-glow-stop", "stop-opacity": 0.12 }, glow);
  const wire = svg("g", { "clip-path": `url(#t-gen-clip-${G.n})`, class: "t-gen-wireframe" }, root); G.wire = wire;
  G.outline = [1, 0].map((dir) => Object.assign(stroke(rrHalf(0, 0, w, h, M.r, dir), wire), { head: head(wire, 2.8) }));

  for (const P of M.parts) {
    const strokes = [];
    if (P.kind === "box" && P.key) [1, 0].forEach((dir) => strokes.push(Object.assign(stroke(rrHalf(P.x, P.y, P.w, P.h, P.r, dir), wire), { together: true })));
    else if (P.kind === "box") strokes.push(stroke(rrPath(P.x, P.y, P.w, P.h, P.r), wire));
    if (P.kind === "text") for (const ln of P.lines) {
      const y = ln.y + ln.h * 0.56, s = stroke(`M${f2(ln.x)} ${f2(y)}H${f2(ln.x2)}`, wire);
      s.caps = [svg("circle", { cx: f2(ln.x), cy: f2(y), r: 1.7, class: "t-gen-head", opacity: 0 }, wire), svg("circle", { cx: f2(ln.x2), cy: f2(y), r: 1.7, class: "t-gen-head", opacity: 0 }, wire)];
      strokes.push(s);
    }
    if (P.kind === "icon") for (const src of P.paths) {
      const [a, b, c, d] = src.m, k = Math.sqrt(Math.abs(a * d - b * c)) || 1;
      const g = svg("g", { transform: `matrix(${src.m.map((v) => (+v).toFixed(3)).join(" ")})`, style: `stroke-width:${(1.8 / k).toFixed(3)}` }, wire);
      const e = svg(src.tag, Object.assign({}, src.attrs, { class: "t-gen-wire" }), g);
      strokes.push({ el: e, L: e.getTotalLength ? e.getTotalLength() : 0, gap: 3.6, k, local: g });
    }
    if (!strokes.length) continue;
    strokes.forEach((s) => (s.head = head(s.local || wire, 2.4 / (s.k || 1))));
    let ix = -1; strokes.forEach((s, i) => (s.idx = s.together && i > 0 && strokes[i - 1].together ? ix : ++ix)); strokes.n = ix + 1;
    G.parts.push({ strokes, b: { x: P.x, y: P.y, w: P.w, h: P.h }, name: P.name, key: !!P.key });
  }
  const N = G.parts.length, span = PH.parts[1] - PH.parts[0], dur = Math.min(0.2, span * 0.6);
  G.parts.forEach((pt, i) => { pt.t0 = PH.parts[0] + (N > 1 ? (span - dur) * (i / (N - 1)) : 0); pt.t1 = pt.t0 + dur; });

  // key elements: their own guides, corner handles and size label
  for (const pt of G.parts) {
    if (!pt.key) continue;
    const { x, y, w: bw, h: bh } = pt.b, E = 16;
    G.keys.push({ pt,
      guides: [[x - E, y, x + bw + E, y], [x + bw, y - E, x + bw, y + bh + E], [x + bw + E, y + bh, x - E, y + bh], [x, y + bh + E, x, y - E]].map(([a, b, c, d]) => stroke(`M${f2(a)} ${f2(b)}L${f2(c)} ${f2(d)}`, root, "t-gen-guide", { opacity: 0 })),
      handles: [[x, y], [x + bw, y], [x + bw, y + bh], [x, y + bh]].map(([hx, hy]) => ({ el: svg("rect", { x: -2, y: -2, width: 4, height: 4, class: "t-gen-handle", transform: `translate(${f2(hx)} ${f2(hy)}) scale(0)` }, root), x: hx, y: hy })),
      dim: svg("text", { x: f2(x), y: f2(y - 5), class: "t-gen-label t-gen-label--small", opacity: 0 }, root) });
  }

  // particles that land on the outline as it is drawn there
  const inv = (f) => { let lo = 0, hi = 1; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (OUT(m) < f) lo = m; else hi = m; } return lo; };
  G.flyers = [];
  for (let i = 0; i < 44; i++) {
    const half = G.outline[i % 2], f = 0.06 + 0.9 * (Math.floor(i / 2) / 21), pt = half.el.getPointAtLength(half.L * f);
    const ang = hashN(i * 9.1 + G.n) * Math.PI * 2, dist = 30 + 70 * hashN(i * 4.7 + G.n * 2), arr = PH.outline[0] + (PH.outline[1] - PH.outline[0]) * inv(f);
    G.flyers.push({ el: svg("circle", { r: 1.6, class: "t-gen-flyer", opacity: 0 }, root), x0: pt.x + Math.cos(ang) * dist, y0: pt.y + Math.sin(ang) * dist, x1: pt.x, y1: pt.y, arr, s0: arr - 0.09 });
  }

  // reticle, card handles, coordinate readout, scan line
  G.ret = svg("path", { class: "t-gen-reticle", opacity: 0 }, root); G.tag = svg("text", { class: "t-gen-label t-gen-label--tag", opacity: 0 }, root);
  G.handles = [[0, 0, 0.17], [w, 0, 0.17], [w, h, 0.37], [0, h, 0.37]].map(([x, y, at]) => ({ el: svg("rect", { x: -2.5, y: -2.5, width: 5, height: 5, class: "t-gen-handle", transform: `translate(${f2(x)} ${f2(y)}) scale(0)` }, root), x, y, at }));
  G.read = svg("text", { class: "t-gen-label t-gen-label--small", opacity: 0 }, root);
  G.scan = svg("g", { opacity: 0 }, root);
  svg("rect", { x: 0, y: -28, width: w, height: 28, fill: `url(#t-gen-glow-${G.n})` }, G.scan);
  G.scanLine = svg("path", { d: `M-18 0H${f2(w + 18)}`, class: "t-gen-guide t-gen-guide--scan" }, G.scan);
  svg("circle", { cx: 0, cy: 0, r: 2.3, class: "t-gen-head" }, G.scan); svg("circle", { cx: w, cy: 0, r: 2.3, class: "t-gen-head" }, G.scan);

  // generation texts
  if (opts.mode === "skeleton-texts") buildTexts(G, el, M, opts);
  return G;
}

// does `node` contain `el`, across shadow roots (so web components and shadow-DOM hosts count as containers)?
function holds(node, el) { for (let x = el; x; x = x.parentNode || x.host) if (x === node) return true; return false; }

// is this viewport rect empty page (nothing but the element's own containers)? Overlays never count: they take no input.
function isFree(el, x0, y0, x1, y1) {
  if (x0 < 0 || y0 < 0 || x1 > innerWidth || y1 > innerHeight + 400) return false;
  for (let i = 0; i <= 3; i++) for (let j = 0; j <= 4; j++) {
    const x = lerp(x0, x1, i / 3), y = Math.min(innerHeight - 1, lerp(y0, y1, j / 4)), hit = document.elementFromPoint(x, y);
    if (hit && hit !== document.body && hit !== document.documentElement && !holds(hit, el)) return false;
  }
  return true;
}

function buildTexts(G, el, M, opts) {
  // panels beside the element where that space is empty, else one strip under it, else only the step line
  const r = el.getBoundingClientRect(), PW = Math.min(260, (innerWidth - r.width) / 2 - G.M - 24), gap = G.M + 14;
  const side = PW >= 150 && isFree(el, r.left - gap - PW, r.top, r.left - gap, r.bottom) && isFree(el, r.right + gap, r.top, r.right + gap + PW, r.bottom);
  const below = !side && isFree(el, r.left, r.bottom + 20, r.right, r.bottom + 150);
  G.textMode = side ? "side" : below ? "below" : "steps";
  const hexId = (k) => "0x" + Math.floor(hashN(k * 5.3 + G.n * 17.1) * 65535).toString(16).padStart(4, "0");
  G.logLines = G.parts.map((pt, i) => ({ head: `${hexId(i)}  ${pt.name.padEnd(7, " ")} ${String(Math.round(pt.b.x)).padStart(3, "0")},${String(Math.round(pt.b.y)).padStart(3, "0")}  ${(Math.round(pt.b.w) + "×" + Math.round(pt.b.h)).padEnd(7, " ")}`, t0: pt.t0, t1: pt.t1 }));
  G.code = opts.code || deriveCode(el, M, opts.title); G.codeChars = G.code.reduce((a, l) => a + l.length + 1, 0);
  const mk = (cls) => { const d = document.createElement("div"); d.className = cls; G.layer.appendChild(d); return d; };
  if (side) {
    G.logEl = mk("t-gen-panel t-gen-panel--log"); G.codeEl = mk("t-gen-panel t-gen-panel--code");
    G.logEl.style.right = `calc(100% + ${G.M + 14}px)`; G.codeEl.style.left = `calc(100% + ${G.M + 14}px)`;
    G.logEl.style.maxWidth = G.codeEl.style.maxWidth = PW + "px";
  } else if (below) {
    G.logEl = mk("t-gen-panel t-gen-panel--below");
  }
  G.stepEl = mk("t-gen-steps");
  if (!side && !below && !isFree(el, r.left, r.bottom + 20, r.right, r.bottom + 50)) G.stepEl.style.display = "none"; // no room at all: the drawing speaks for itself
  G.steps = [...opts.steps, opts.done].filter(Boolean);
  G.stepEl.innerHTML = G.steps.map((s) => `<div class="t-gen-step"><i></i><span></span></div>`).join("");
  [...G.stepEl.children].forEach((d, i) => (d.lastChild.textContent = G.steps[i]));
}

// ─── 4. one frame of the build: p = progress (0 → END), t = ms since start ───
const FLOW = 0.016;
function drawStroke(s, q, t) {
  const on = q > 0; s.el.style.opacity = on ? 1 : 0;
  if (on) {
    const gap = s.gap / (s.k || 1), n = Math.floor((s.L * Math.min(1, q)) / gap) + 1;
    if (n !== s.n) { s.n = n; s.el.style.strokeDasharray = `${`0 ${f2(gap)} `.repeat(n - 1)}0 ${f2(s.L + 10)}`; }
    s.el.style.strokeDashoffset = f2(-((t * FLOW) / (s.k || 1)) % gap);
  }
  if (s.head) {
    const live = (s.live = q > 0 && q < 1); s.head.setAttribute("opacity", live ? 1 : 0);
    if (live) { const gap = s.gap / (s.k || 1); s.pt = s.el.getPointAtLength(Math.floor((s.L * q) / gap) * gap); s.head.setAttribute("cx", f2(s.pt.x)); s.head.setAttribute("cy", f2(s.pt.y)); }
  }
  if (s.caps) { s.caps[0].setAttribute("opacity", on ? 1 : 0); s.caps[1].setAttribute("opacity", q >= 1 ? 1 : 0); }
}

function frame(G, p, t, D) {
  const { w, h } = G, clean = 1 - smooth(PH.clean[0], PH.clean[1], p);
  // the real element: wiped in behind the scan line, fading and sharpening on a smooth ease-out
  const sq = SMOOTH_OUT(win(PH.reveal, p)), y = sq * (h + 6) - 3, fq = SMOOTH_OUT(win([PH.reveal[0], PH.reveal[1] + 0.03], p)), es = G.el.style;
  const pad = 80; // keeps the element's own shadow inside the clip
  es.opacity = p < PH.reveal[0] ? 0 : f2(fq);
  // past the bottom edge as the scan finishes, so the shadow below the element comes in with it (no pop when the clip goes)
  const yc = y + smooth(0.6, 1, sq) * pad;
  es.clipPath = p >= PH.reveal[1] ? G.prev.clipPath : `inset(-${pad}px -${pad}px ${f2(h - yc - 1)}px -${pad}px)`;
  es.filter = fq > 0 && fq < 0.99 ? `blur(${f2(3 * (1 - fq))}px)` : G.prev.filter;
  G.clipRect.setAttribute("y", f2(p < PH.reveal[0] ? -999 : y)); G.clipRect.setAttribute("height", f2(h + 999));
  G.wire.setAttribute("opacity", f2(1 - 0.6 * fq));
  G.scan.setAttribute("opacity", f2(p >= PH.reveal[0] && p < PH.reveal[1] ? smooth(0, 0.12, sq) * (1 - smooth(0.85, 1, sq)) : 0));
  G.scan.setAttribute("transform", `translate(0 ${f2(y)})`);
  G.scanLine.style.strokeDashoffset = f2(-(t * FLOW * 2) % 5);

  // dot field: ripple from the centre, matrix rain down the columns, lit by the probe and the reticle
  const R = OUT(win(PH.dots, p)) * (G.maxD + 60), rainOn = smooth(0.04, 0.2, p) * (1 - smooth(0.62, 0.86, p));
  const pw = win(PH.probe, p), probeX = lerp(-G.M, w + G.M, OUT(pw)), probeOp = pw > 0 && pw < 1 ? smooth(0, 0.1, pw) * (1 - smooth(0.85, 1, pw)) : 0;
  G.probe.setAttribute("transform", `translate(${f2(probeX)} 0)`); G.probe.setAttribute("opacity", f2(probeOp * 0.8));
  let rb = null, rOp = 0;
  const at = G.parts.reduce((k, pt, i) => (p >= pt.t0 ? i : k), -1);
  if (at >= 0 && p < PH.reveal[0] + 0.06) {
    const pt = G.parts[at], from = at ? G.parts[at - 1].b : { x: 0, y: 0, w, h }, q = OUT(clamp((p - pt.t0) / 0.05)), P = 5;
    rb = { x: lerp(from.x, pt.b.x, q) - P, y: lerp(from.y, pt.b.y, q) - P, w: lerp(from.w, pt.b.w, q) + 2 * P, h: lerp(from.h, pt.b.h, q) + 2 * P };
    rOp = smooth(PH.parts[0], PH.parts[0] + 0.04, p) * (1 - smooth(PH.reveal[0], PH.reveal[0] + 0.06, p));
    const l = Math.min(7, rb.w / 3, rb.h / 3), { x: X, y: Y, w: RW, h: RH } = rb;
    G.ret.setAttribute("d", `M${f2(X)} ${f2(Y + l)}V${f2(Y)}H${f2(X + l)}M${f2(X + RW - l)} ${f2(Y)}H${f2(X + RW)}V${f2(Y + l)}M${f2(X + RW)} ${f2(Y + RH - l)}V${f2(Y + RH)}H${f2(X + RW - l)}M${f2(X + l)} ${f2(Y + RH)}H${f2(X)}V${f2(Y + RH - l)}`);
    G.tag.setAttribute("x", f2(X)); G.tag.setAttribute("y", f2(Y - 4)); G.tag.textContent = `${pt.name} ${Math.round(pt.b.w)}×${Math.round(pt.b.h)}`;
  }
  G.ret.setAttribute("opacity", f2(rOp)); G.tag.setAttribute("opacity", f2(rOp));
  for (const d of G.dots) {
    const lag = R - d.d, env = clamp(lag / 50), front = p < PH.dots[1] + 0.05 ? Math.exp(-(((lag - 6) / 14) ** 2)) : 0;
    const headY = ((t * d.v + d.ph) % (G.span + d.tr)) - G.M, back = headY - d.y;
    const rain = back >= 0 && back < d.tr ? (1 - back / d.tr) ** 1.6 * rainOn * env * d.edge : 0;
    const near = rb ? Math.max(0, 1 - Math.max(rb.x - d.x, d.x - rb.x - rb.w, rb.y - d.y, d.y - rb.y - rb.h, 0) / 16) * (d.x > rb.x && d.x < rb.x + rb.w && d.y > rb.y && d.y < rb.y + rb.h ? 1 : 0.6) : 0;
    const probe = probeOp > 0 ? Math.exp(-(((d.x - probeX) / 9) ** 2)) * probeOp * env : 0;
    const lit = Math.max(front, rain, near * rOp * 0.8, probe), under = d.inside && p >= PH.reveal[0] && d.y < y ? 0 : 1; // gone where the real UI is in
    d.el.setAttribute("opacity", f2(Math.max(env * 0.5 * d.edge, lit * d.edge) * clean * under));
    d.el.setAttribute("r", f2(1.05 + lit * 0.85));
    d.el.classList.toggle("is-lit", lit > 0.35);
  }

  // guides, size label, outline, card handles, particles
  const gOp = 0.5 * (1 - smooth(0.66, 0.92, p));
  G.guides.forEach((g, i) => { const q = OUT(clamp((p - PH.guides[0] - i * 0.03) / (PH.guides[1] - PH.guides[0] - 0.09))); drawStroke(g, q, t); g.el.style.opacity = q > 0 ? gOp : 0; });
  const oq = OUT(win(PH.outline, p));
  G.dim.textContent = `${Math.round(w * oq)} × ${Math.round(h * oq)}   t+${(Math.min(p, 1) * D / 1000).toFixed(2)}s`;
  G.dim.setAttribute("opacity", f2(p > PH.outline[0] ? (1 - smooth(0.66, 0.9, p)) * 0.9 : 0));
  G.outline.forEach((s) => drawStroke(s, oq, t));
  G.handles.forEach((hd) => hd.el.setAttribute("transform", `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(OUT(clamp((p - hd.at) / 0.1)) * (1 - smooth(0.82, 0.96, p)))})`));
  for (const q of G.flyers) {
    const k = clamp((p - q.s0) / (q.arr - q.s0)), on = p >= q.s0 && p < q.arr + 0.01;
    q.el.setAttribute("opacity", on ? f2(smooth(0, 0.25, k)) : 0);
    if (on) { const e = OUT(k); q.el.setAttribute("cx", f2(lerp(q.x0, q.x1, e))); q.el.setAttribute("cy", f2(lerp(q.y0, q.y1, e))); }
  }
  // every part traced in order, icons stroke by stroke; key elements get guides, handles and a size label
  for (const pt of G.parts) { const q = clamp((p - pt.t0) / (pt.t1 - pt.t0)); pt.strokes.forEach((s) => drawStroke(s, OUT(clamp(q * pt.strokes.n - s.idx * 0.75)), t)); }
  const kOut = 1 - smooth(PH.reveal[0] - 0.02, PH.reveal[0] + 0.1, p);
  for (const K of G.keys) {
    const t0 = K.pt.t0 - 0.03, hq = OUT(clamp((p - K.pt.t0 - 0.04) / 0.08)), oq2 = OUT(clamp((p - K.pt.t0) / (K.pt.t1 - K.pt.t0)));
    K.guides.forEach((g, i) => { const q = OUT(clamp((p - t0 - i * 0.012) / 0.1)); drawStroke(g, q, t); g.el.style.opacity = q > 0 ? f2(0.5 * kOut) : 0; });
    K.handles.forEach((hd) => hd.el.setAttribute("transform", `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(hq * kOut)})`));
    K.dim.setAttribute("opacity", f2(p > t0 ? 0.9 * kOut : 0)); K.dim.textContent = `${Math.round(K.pt.b.w * oq2)} × ${Math.round(K.pt.b.h * oq2)}`;
  }
  // coordinate readout on the line being drawn
  let cur = null; for (const s of [...G.outline, ...G.parts.flatMap((pt) => pt.strokes)]) if (s.live && !s.local) cur = s;
  G.read.setAttribute("opacity", cur ? 1 : 0);
  if (cur) { G.read.setAttribute("x", f2(cur.pt.x + 6)); G.read.setAttribute("y", f2(cur.pt.y - 5)); G.read.textContent = `${String(Math.round(cur.pt.x)).padStart(3, "0")}·${String(Math.round(cur.pt.y)).padStart(3, "0")}`; }

  if (G.logLines) texts(G, p, t, D);
}

function texts(G, p, t, D) {
  const vis = smooth(0.03, 0.1, p) * (1 - smooth(0.9, 1.04, p)), blink = Math.floor(t / 260) % 2;
  // agent log: one line per part with its own progress bar
  const rows = G.textMode === "side" ? Math.max(6, Math.floor(G.h / 11)) : 6, shown = G.logLines.filter((l) => p >= l.t0);
  const done = G.logLines.filter((l) => p >= l.t1).length;
  const logRows = shown.slice(-rows).map((l) => {
    const k = clamp((p - l.t0) / 0.035), prog = clamp((p - l.t0) / (l.t1 - l.t0)), full = l.head + (prog >= 1 ? "[  ok  ]" : `[${"#".repeat(Math.round(prog * 6)).padEnd(6, ".")}]`);
    return full.slice(full.length - Math.ceil(full.length * k));
  });
  const head = `AGENT.LOG // PARTS ${String(done).padStart(2, "0")}/${String(G.logLines.length).padStart(2, "0")}`;
  if (G.logEl) G.logEl.style.opacity = f2(vis);
  // motion CSS: streams at a steady rate through the drawing
  const sk = clamp((p - 0.12) / 0.72), typed = Math.floor(G.codeChars * sk); let left = typed; const lines = [];
  for (const ln of G.code) { if (left <= 0) break; lines.push(ln.slice(0, left)); left -= ln.length + 1; }
  const tok = Math.round(typed / 3.4), secs = Math.max(0.1, (Math.min(p, 1) - 0.12) * D / 1000), caret = sk > 0 && sk < 1 && blink ? "_" : "";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const codeHtml = lines.slice(-(G.textMode === "side" ? Math.max(8, Math.floor(G.h / 11)) : 4)).map((ln, i, a) => {
    const m = ln.match(/^(\s*)([\w-]+)(:)(.*)$/), c = i === a.length - 1 ? caret : "";
    return m ? `<div>${esc(m[1])}<b>${esc(m[2])}</b>:<em>${esc(m[4])}</em>${c}</div>` : `<div class="${/^\/\*/.test(ln) ? "is-comment" : /^[.:]/.test(ln) ? "is-selector" : ""}">${esc(ln)}${c}</div>`;
  }).join("");
  const foot = sk > 0 ? `${Math.round(tok / secs)} TOK/S · ${lines.length} LN · ${sk < 1 ? "WRITING" : "READY"}` : "";
  const logHtml = `<div class="t-gen-panel-head">${head}</div>` + logRows.map((r) => `<div>${esc(r)}</div>`).join("");
  if (G.codeEl) {
    G.codeEl.style.opacity = f2(vis);
    const sig = typed + "|" + caret; if (G.codeSig !== sig) { G.codeSig = sig; G.codeEl.innerHTML = `<div class="t-gen-panel-head">MOTION.CSS // ${String(tok).padStart(4, "0")} TOKENS</div>${codeHtml}<div class="t-gen-panel-foot">${foot}</div>`; }
    if (G.logSig !== logRows.join("|")) { G.logSig = logRows.join("|"); G.logEl.innerHTML = logHtml; }
  } else if (G.logEl) {
    const sig = logRows.join("|") + typed; if (G.logSig !== sig) { G.logSig = sig; G.logEl.innerHTML = logHtml + `<div class="t-gen-panel-foot">${foot}</div>`; }
  }
  // step line: each step for its share of the drawing, the last once the UI is in
  const n = G.steps.length, gone = smooth(0.98, 1.06, p);
  [...G.stepEl.children].forEach((s, i) => {
    const t0 = i < n - 1 ? (i / (n - 1)) * 0.95 : 0.95, t1 = i < n - 1 ? ((i + 1) / (n - 1)) * 0.95 : Infinity;
    const qi = OUT(clamp((p - t0) / 0.06)), qs = OUT(clamp((p - t1) / 0.05)), q = qi * (1 - Math.max(qs, gone));
    s.style.opacity = f2(q); s.style.transform = `translate(-50%, ${f2(5 * (1 - qi) - 5 * qs)}px)`;
    s.style.filter = q > 0.01 && q < 0.99 ? `blur(${f2(2 * (1 - q))}px)` : "none";
    s.classList.toggle("is-done", i === n - 1);
  });
}

// ─── 5. run ───
export function generate(el, options = {}) {
  if (TEXT_IMAGE.includes(options.variant)) return TIG.generate(el, toTrace(options));
  if (options.variant === "transform") return transform(el, options.to, options);
  const opts = Object.assign({}, DEFAULTS, options);
  if (typeof el === "string") el = document.querySelector(el);
  if (!el) throw new Error("UIGeneration: no element");
  if (el.__tGen) el.__tGen.cancel();
  const prev = { opacity: el.__tGenOpacity !== undefined ? el.__tGenOpacity : el.style.opacity, clipPath: el.style.clipPath, filter: el.style.filter, transition: el.style.transition };
  const restore = () => Object.assign(el.style, prev);
  let resolve, raf = 0, timer = 0, G = null, stopped = false;
  const finished = new Promise((r) => (resolve = r));
  const finish = () => { if (stopped) return; stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); if (G) G.layer.remove(); restore(); el.__tGen = null; if (opts.onDone) opts.onDone(el); resolve(el); };
  const run = { finished, cancel: finish, element: el };
  el.__tGen = run;

  // reduced motion: no drawing, a plain fade
  if (reduced()) {
    el.style.opacity = 0;
    timer = setTimeout(() => { el.style.transition = "opacity 200ms ease-out"; el.style.opacity = prev.opacity || ""; timer = setTimeout(finish, 220); }, opts.delay);
    return run;
  }
  el.style.opacity = 0; // hidden until its reveal
  timer = setTimeout(() => {
    requestAnimationFrame(() => {
      if (stopped) return;
      try { const M = measure(el, opts); G = buildOverlay(el, M, opts); G.prev = prev; }
      catch (e) { if (el.__tGenLayer) el.__tGenLayer.remove(); G = null; console.warn("UIGeneration: could not build the overlay, showing the element", e); return finish(); }
      const D = Math.max(400, +opts.duration || DEFAULTS.duration), t0 = performance.now();
      const tick = (now) => {
        if (stopped) return;
        const t = now - t0, p = t / D;
        frame(G, p, t, D);
        if (p >= END) return finish();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  }, opts.delay);
  return run;
}

// ─── transform: one version of a UI regenerating into the next ───
// The old version dissolves into its dotted wireframe behind a scan line, every part of it flows to where it sits in
// the new version (boxes move and resize, text lines grow or shrink, the card outline changes size), parts that are
// gone break up, new parts are traced in, then the new version comes in behind a second scan line.
//   transform(oldEl, newEl, { duration: 2800 })   or   generate(oldEl, { variant: "transform", to: newEl })
// Both versions must be laid out where they will be seen (for example stacked in one grid cell); the new one is hidden
// until its reveal, the old one is hidden at the end (hideFrom: false keeps it).
const TPH = { down: [0, 0.3], morph: [0.24, 0.72], up: [0.68, 1] };
const T_DEFAULTS = { duration: 2800, delay: 0, labels: true, versions: ["V1", "V2"], hideFrom: true, morph: true, onDone: null };
// the real morph: read the old version (dot field, probe, guides, reticle), morph, clean up
const TPH_M = { morph: [0.24, 0.84], clean: [0.86, 1] };
const MORPH_CURVE = [0.45, 0, 0.15, 1], MORPH_EASE = bezier(...MORPH_CURVE); // an in-out with a long, soft landing
let MORPH_N = 0;
// a version as shapes: its card outline, one box per box or icon, one line per line of text
function shapesOf(M, ox, oy) {
  const out = [];
  for (const P of M.parts) {
    if (P.kind === "text") for (const ln of P.lines) out.push({ kind: "line", x: ox + ln.x, x2: ox + ln.x2, y: oy + ln.y + ln.h * 0.56, name: "text" });
    else out.push({ kind: "box", x: ox + P.x, y: oy + P.y, w: P.w, h: P.h, r: P.kind === "icon" ? Math.min(P.w, P.h) / 2 : P.r, name: P.kind === "icon" ? "icon" : P.name });
  }
  return out;
}
// pairs each new shape with the old shape of the same kind (and role) that sat most nearly in the same place
function matchShapes(A, B, W, H) {
  const c = (s) => (s.kind === "line" ? [(s.x + s.x2) / 2, s.y, s.x2 - s.x, 0] : [s.x + s.w / 2, s.y + s.h / 2, s.w, s.h]);
  const cand = [];
  A.forEach((a, i) => B.forEach((b, j) => {
    if (a.kind !== b.kind) return;
    const [ax, ay, aw, ah] = c(a), [bx, by, bw, bh] = c(b);
    // like with like: a button stays a button, an icon an icon (a frame can still become a frame elsewhere)
    const cost = Math.hypot((ax - bx) / W, (ay - by) / H) + 0.35 * (Math.abs(aw - bw) / Math.max(aw, bw, 1) + Math.abs(ah - bh) / Math.max(ah, bh, 1)) + (a.name !== b.name ? 0.45 : 0);
    if (cost < 0.5) cand.push({ i, j, cost });
  }));
  cand.sort((p, q) => p.cost - q.cost);
  const ua = new Set(), ub = new Set(), pairs = [];
  for (const p of cand) if (!ua.has(p.i) && !ub.has(p.j)) { ua.add(p.i); ub.add(p.j); pairs.push([A[p.i], B[p.j]]); }
  return { pairs, gone: A.filter((_, i) => !ua.has(i)), added: B.filter((_, j) => !ub.has(j)) };
}
const shapeD = (s) => (s.kind === "line" ? `M${f2(s.x)} ${f2(s.y)}H${f2(Math.max(s.x, s.x2))}` : rrPath(s.x, s.y, Math.max(0.5, s.w), Math.max(0.5, s.h), s.r));
const mixShape = (a, b, q) => (a.kind === "line" ? { kind: "line", x: lerp(a.x, b.x, q), x2: lerp(a.x2, b.x2, q), y: lerp(a.y, b.y, q) } : { kind: "box", x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q), w: lerp(a.w, b.w, q), h: lerp(a.h, b.h, q), r: lerp(a.r, b.r, q) });
const shapeBox = (s) => (s.kind === "line" ? { x: s.x, y: s.y - 6, w: s.x2 - s.x, h: 12 } : s);

export function transform(fromEl, toEl, options = {}) {
  const opts = Object.assign({}, T_DEFAULTS, options);
  if (typeof fromEl === "string") fromEl = document.querySelector(fromEl);
  if (typeof toEl === "string") toEl = document.querySelector(toEl);
  if (!fromEl || !toEl) throw new Error("UIGeneration.transform: needs the old and the new element");
  for (const e of [fromEl, toEl]) if (e.__tGen) e.__tGen.cancel();
  const keep = (e) => ({ opacity: e.style.opacity, clipPath: e.style.clipPath, filter: e.style.filter, visibility: e.style.visibility, transition: e.style.transition });
  const prevA = keep(fromEl), prevB = keep(toEl);
  let resolve, raf = 0, timer = 0, layer = null, stopped = false;
  const finished = new Promise((r) => (resolve = r)), cleanups = [];
  const finish = () => {
    if (stopped) return; stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); if (layer) layer.remove(); cleanups.forEach((f) => f());
    Object.assign(fromEl.style, prevA); Object.assign(toEl.style, prevB);
    if (prevB.visibility === "hidden") toEl.style.visibility = ""; // the new version stays shown, however it waited
    if (opts.hideFrom) fromEl.style.visibility = "hidden";
    fromEl.__tGen = toEl.__tGen = null; if (opts.onDone) opts.onDone(toEl); resolve(toEl);
  };
  const run = { finished, cancel: finish, element: toEl };
  fromEl.__tGen = toEl.__tGen = run;
  toEl.style.visibility = "visible"; toEl.style.opacity = 0; // laid out, hidden until its reveal
  if (reduced()) { // a crossfade
    timer = setTimeout(() => {
      fromEl.style.transition = toEl.style.transition = "opacity 200ms ease-out";
      fromEl.style.opacity = 0; toEl.style.opacity = prevB.opacity || ""; timer = setTimeout(finish, 220);
    }, opts.delay);
    return run;
  }
  timer = setTimeout(() => requestAnimationFrame(() => {
    if (stopped) return;
    // a real morph where the browser has view transitions (morph: false keeps the dotted regeneration everywhere)
    const morph = opts.morph !== false && typeof document.startViewTransition === "function";
    try { (morph ? startMorph : start)(); } catch (e) { console.warn("UIGeneration.transform: could not build, swapping the versions", e); finish(); }
  }), opts.delay);

  function start() {
    const RA = fromEl.getBoundingClientRect(), RB = toEl.getBoundingClientRect(), mo = { maxParts: 80, keys: 0 };
    const A = measure(fromEl, mo), B = measure(toEl, mo), dx = RB.left - RA.left, dy = RB.top - RA.top;
    const SA = shapesOf(A, 0, 0), SB = shapesOf(B, dx, dy), W = Math.max(A.w, B.w), H = Math.max(A.h, B.h);
    const { pairs, gone, added } = matchShapes(SA, SB, W, H);
    const D = Math.max(1200, +opts.duration || T_DEFAULTS.duration), PAD = 80, DOT = 4.8;
    // overlay at the old version's place
    layer = document.createElement("div"); layer.className = "t-gen t-gen--transform"; layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, { left: f2(RA.left + scrollX) + "px", top: f2(RA.top + scrollY) + "px", width: f2(A.w) + "px", height: f2(A.h) + "px" });
    const root = svg("svg", { class: "t-gen-svg", width: f2(A.w), height: f2(A.h) }, layer);
    document.body.appendChild(layer);
    const n = Math.round(Math.random() * 1e6), defs = svg("defs", {}, root);
    const clip = svg("clipPath", { id: "t-gen-tclip-" + n }, defs), clipRect = svg("rect", { x: -PAD - 40, y: -PAD, width: Math.max(A.w, dx + B.w) + 2 * PAD + 80, height: 0 }, clip);
    const wire = svg("g", { class: "t-gen-wireframe", "clip-path": `url(#t-gen-tclip-${n})` }, root);
    const dotted = (parent = wire) => { const e = svg("path", { class: "t-gen-wire", style: `stroke-dasharray:0 ${DOT}` }, parent); return e; };
    // the shapes: morphing pairs, parts going, parts coming; each one's moment follows its place, top first
    const span = TPH.morph[1] - TPH.morph[0], at = (y, wdt) => TPH.morph[0] + (span - wdt) * clamp(y / Math.max(1, Math.max(A.h, dy + B.h)));
    const M = pairs.map(([a, b]) => ({ a, b, el: dotted(), t0: at((shapeBox(a).y + shapeBox(b).y) / 2, 0.24), changed: Math.abs(shapeBox(a).x - shapeBox(b).x) + Math.abs(shapeBox(a).y - shapeBox(b).y) + Math.abs(shapeBox(a).w - shapeBox(b).w) + Math.abs(shapeBox(a).h - shapeBox(b).h) > 3 }));
    const G = gone.map((a) => ({ a, g: svg("g", {}, wire), t0: at(shapeBox(a).y, 0.16) })); G.forEach((o) => (o.el = dotted(o.g)));
    const N = added.map((b) => ({ b, el: dotted(), head: svg("circle", { r: 2.3, class: "t-gen-head", opacity: 0 }, wire), t0: at(shapeBox(b).y, 0.22) + 0.04 }));
    N.forEach((o) => { o.el.setAttribute("d", shapeD(o.b)); o.L = o.el.getTotalLength(); o.el.style.strokeDasharray = "none"; });
    const outline = dotted();
    const handles = [0, 1, 2, 3].map(() => svg("rect", { x: -2.5, y: -2.5, width: 5, height: 5, class: "t-gen-handle" }, root));
    const ret = svg("path", { class: "t-gen-reticle", opacity: 0 }, root), tag = svg("text", { class: "t-gen-label t-gen-label--tag", opacity: 0 }, root);
    const head = svg("text", { class: "t-gen-label", x: 0, y: -12, opacity: 0 }, root), count = svg("text", { class: "t-gen-label t-gen-label--small", x: f2(A.w), y: -12, "text-anchor": "end", opacity: 0 }, root);
    const scans = [0, 1].map(() => { const g = svg("g", { opacity: 0 }, root); svg("path", { class: "t-gen-guide t-gen-guide--scan" }, g); svg("circle", { r: 2.3, class: "t-gen-head" }, g); svg("circle", { r: 2.3, class: "t-gen-head" }, g); return g; });
    const scanAt = (g, x, w, y, op) => { g.setAttribute("opacity", f2(op)); g.setAttribute("transform", `translate(0 ${f2(y)})`); const [l, c1, c2] = g.children; l.setAttribute("d", `M${f2(x - 18)} 0H${f2(x + w + 18)}`); c1.setAttribute("cx", f2(x)); c2.setAttribute("cx", f2(x + w)); };
    const t0 = performance.now(), A_ = fromEl.style, B_ = toEl.style;
    const tick = (now) => {
      if (stopped) return;
      const t = now - t0, p = t / D;
      // 1. the old version goes down into its wireframe behind a scan line
      const qd = SMOOTH_OUT(win(TPH.down, p)), yd = qd * (A.h + 6) - 3;
      A_.clipPath = qd >= 1 ? "inset(0 0 100% 0)" : `inset(${f2(Math.max(0, yd))}px -${PAD}px -${PAD}px -${PAD}px)`;
      A_.filter = qd > 0 && qd < 1 ? `blur(${f2(1.5 * qd)}px)` : prevA.filter;
      scanAt(scans[0], 0, A.w, yd, qd > 0 && qd < 1 ? smooth(0, 0.1, qd) * (1 - smooth(0.85, 1, qd)) : 0);
      // 3. the new version comes in behind a second scan line, wiping the wireframe away
      const qu = SMOOTH_OUT(win(TPH.up, p)), yu = qu * (B.h + 6) - 3, fq = SMOOTH_OUT(win([TPH.up[0], TPH.up[1] + 0.04], p));
      B_.opacity = qu <= 0 ? 0 : f2(fq);
      B_.clipPath = qu >= 1 ? prevB.clipPath : `inset(-${PAD}px -${PAD}px ${f2(Math.max(0, B.h - yu - 1 - smooth(0.6, 1, qu) * PAD))}px -${PAD}px)`;
      B_.filter = fq > 0 && fq < 0.99 ? `blur(${f2(3 * (1 - fq))}px)` : prevB.filter;
      scanAt(scans[1], dx, B.w, dy + yu, qu > 0 && qu < 1 ? smooth(0, 0.1, qu) * (1 - smooth(0.85, 1, qu)) : 0);
      // the wireframe shows above the first line, below the second
      const top = qu > 0 ? dy + yu : -PAD, bottom = qd >= 1 ? Math.max(A.h, dy + B.h) + PAD : yd;
      clipRect.setAttribute("y", f2(top)); clipRect.setAttribute("height", f2(Math.max(0, bottom - top)));
      wire.setAttribute("opacity", f2(1 - 0.5 * fq));
      const flow = f2(-(t * FLOW) % DOT);
      // 2. the card outline and every part flow to the new version
      const qo = OUT(win([TPH.morph[0], TPH.morph[0] + span * 0.7], p)), card = mixShape({ kind: "box", x: 0, y: 0, w: A.w, h: A.h, r: A.r }, { kind: "box", x: dx, y: dy, w: B.w, h: B.h, r: B.r }, qo);
      outline.setAttribute("d", shapeD(card)); outline.style.strokeDashoffset = flow;
      const hOp = smooth(0.04, 0.14, p) * (1 - smooth(TPH.up[0], TPH.up[0] + 0.12, p));
      [[card.x, card.y], [card.x + card.w, card.y], [card.x + card.w, card.y + card.h], [card.x, card.y + card.h]].forEach(([x, y], i) => { handles[i].setAttribute("transform", `translate(${f2(x)} ${f2(y)}) scale(${f2(hOp)})`); });
      let cur = null;
      for (const m of M) {
        const q = OUT(clamp((p - m.t0) / 0.24)), s = mixShape(m.a, m.b, q);
        m.el.setAttribute("d", shapeD(s)); m.el.style.strokeDashoffset = flow;
        if (m.changed && q > 0 && q < 1) cur = { m, s, q };
      }
      for (const o of G) { // parts that are gone shrink to their centre and fade
        const q = OUT(clamp((p - o.t0) / 0.16)), b = shapeBox(o.a), cx = b.x + b.w / 2, cy = b.y + b.h / 2, k = 1 - 0.7 * q;
        o.el.setAttribute("d", shapeD(o.a)); o.g.setAttribute("transform", `translate(${f2(cx)} ${f2(cy)}) scale(${f2(k)}) translate(${f2(-cx)} ${f2(-cy)})`); o.g.setAttribute("opacity", f2(1 - q));
        o.el.style.strokeDashoffset = flow;
      }
      for (const o of N) { // new parts traced in, dot by dot, with a moving head
        const q = OUT(clamp((p - o.t0) / 0.22)), cnt = Math.floor((o.L * q) / DOT) + 1;
        o.el.style.opacity = q > 0 ? 1 : 0;
        if (q > 0 && cnt !== o.n) { o.n = cnt; o.el.style.strokeDasharray = `${`0 ${DOT} `.repeat(cnt - 1)}0 ${f2(o.L + 10)}`; }
        const live = q > 0 && q < 1; o.head.setAttribute("opacity", live ? 1 : 0);
        if (live) { const pt = o.el.getPointAtLength(Math.floor((o.L * q) / DOT) * DOT); o.head.setAttribute("cx", f2(pt.x)); o.head.setAttribute("cy", f2(pt.y)); }
      }
      // a reticle on the part changing now, with its size before and after
      const rOp = cur && opts.labels ? 1 : 0; ret.setAttribute("opacity", rOp); tag.setAttribute("opacity", rOp);
      if (cur) {
        const b = shapeBox(cur.s), P = 4, x = b.x - P, y = b.y - P, w = b.w + 2 * P, h = b.h + 2 * P, l = Math.min(7, w / 3, h / 3);
        ret.setAttribute("d", `M${f2(x)} ${f2(y + l)}V${f2(y)}H${f2(x + l)}M${f2(x + w - l)} ${f2(y)}H${f2(x + w)}V${f2(y + l)}M${f2(x + w)} ${f2(y + h - l)}V${f2(y + h)}H${f2(x + w - l)}M${f2(x + l)} ${f2(y + h)}H${f2(x)}V${f2(y + h - l)}`);
        const sz = (s) => (s.kind === "line" ? `${Math.round(s.x2 - s.x)}` : `${Math.round(s.w)}×${Math.round(s.h)}`);
        tag.setAttribute("x", f2(x)); tag.setAttribute("y", f2(y - 4)); tag.textContent = `${cur.m.a.name} ${sz(cur.m.a)} → ${sz(cur.m.b)}`;
      }
      // what is happening, above the card
      const lOp = opts.labels ? smooth(0.02, 0.1, p) * (1 - smooth(0.9, 1, p)) : 0;
      head.setAttribute("opacity", f2(lOp)); count.setAttribute("opacity", f2(lOp));
      head.setAttribute("y", f2(Math.min(0, dy) - 12)); count.setAttribute("y", f2(Math.min(0, dy) - 12)); count.setAttribute("x", f2(Math.max(A.w, dx + B.w)));
      const [va, vb] = (opts.versions || T_DEFAULTS.versions).map((v) => String(v).toUpperCase());
      head.textContent = p < TPH.morph[0] ? `READING ${va}` : p < TPH.up[0] ? `REGENERATING ${va} → ${vb}` : `${vb} READY`;
      const done = (list) => list.filter((o) => p >= o.t0).length;
      count.textContent = `MOVED ${String(done(M)).padStart(2, "0")}  NEW ${String(done(N)).padStart(2, "0")}  OUT ${String(done(G)).padStart(2, "0")}  ${Math.round(card.w)}×${Math.round(card.h)}`;
      if (p >= 1.06) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  // the real UI morphs: every matched part (and the card) moves and resizes into its place in the new version
  // through a view transition, its content changing over in place, under the generation effect's overlay
  function startMorph() {
    const RA = fromEl.getBoundingClientRect(), RB = toEl.getBoundingClientRect(), mo = { maxParts: 60, keys: 0 };
    const A = measure(fromEl, mo), B = measure(toEl, mo), dx = RB.left - RA.left, dy = RB.top - RA.top;
    const D = Math.max(1600, +opts.duration || T_DEFAULTS.duration), W = Math.max(A.w, B.w), H = Math.max(A.h, B.h);
    // a button's own label moves with the button: text whose element is also a box is not matched on its own
    const own = (M) => { const boxes = new Set(M.parts.filter((p) => p.kind === "box").map((p) => p.el)); return M.parts.filter((p) => !(p.kind === "text" && boxes.has(p.el))); };
    const PA = own(A).map((p) => Object.assign({}, p)), PB = own(B).map((p) => Object.assign({}, p, { x: p.x + dx, y: p.y + dy, lines: p.lines && p.lines.map((l) => ({ x: l.x + dx, x2: l.x2 + dx, y: l.y + dy, h: l.h })) }));
    const { pairs, gone, added } = matchShapes(PA, PB, W, H);
    const N = ++MORPH_N, MP = TPH_M.morph, ML = (MP[1] - MP[0]) * D; // the morph window, in ms
    // overlay over both versions
    const UX = Math.min(0, dx), UY = Math.min(0, dy), UW = Math.max(A.w, dx + B.w) - UX, UH = Math.max(A.h, dy + B.h) - UY, M = 44, SP = 15;
    layer = document.createElement("div"); layer.className = "t-gen t-gen--morph"; layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, { left: f2(RA.left + scrollX) + "px", top: f2(RA.top + scrollY) + "px", width: f2(A.w) + "px", height: f2(A.h) + "px" });
    const root = svg("svg", { class: "t-gen-svg", width: f2(A.w), height: f2(A.h) }, layer);
    document.body.appendChild(layer);
    // dot field around both versions: a ripple from the centre, lit where the probe passes
    const field = svg("g", {}, root), dots = [], cx0 = UX + UW / 2, cy0 = UY + UH / 2; let maxD = 0;
    for (let x = UX - Math.floor(M / SP) * SP; x <= UX + UW + M; x += SP) for (let y = UY - Math.floor(M / SP) * SP; y <= UY + UH + M; y += SP) {
      const d = Math.hypot(x - cx0, y - cy0), out = Math.max(0, UX - x, x - UX - UW, UY - y, y - UY - UH);
      dots.push({ el: svg("circle", { cx: x, cy: y, r: 1.1, class: "t-gen-dot" }, field), x, y, d, edge: 1 - clamp(out / M) }); maxD = Math.max(maxD, d);
    }
    const probe = svg("path", { d: `M0 ${UY - M}V${f2(UY + UH + M)}`, class: "t-gen-guide t-gen-guide--dashed", opacity: 0 }, root);
    const wire = svg("g", { class: "t-gen-wireframe" }, root), DOT = 4.8;
    const dotted = (parent = wire) => svg("path", { class: "t-gen-wire", style: `stroke-dasharray:0 ${DOT}` }, parent);
    const guides = [0, 1, 2, 3].map(() => svg("path", { class: "t-gen-guide t-gen-guide--dashed" }, root));
    const outline = dotted(), handles = [0, 1, 2, 3].map(() => svg("rect", { x: -2.5, y: -2.5, width: 5, height: 5, class: "t-gen-handle" }, root));
    const dim = svg("text", { class: "t-gen-label", opacity: 0 }, root);
    const box = (p) => ({ kind: "box", x: p.x, y: p.y, w: p.w, h: p.h, r: p.kind === "icon" ? Math.min(p.w, p.h) / 2 : p.kind === "text" ? 3 : p.r || 0 });
    // each pair's morph starts a little later the lower it sits, so the card regenerates top first
    const delayOf = (y) => 0.28 * ML * clamp(y / Math.max(1, UY + UH));
    const MPR = pairs.map(([a, b]) => ({ a, b, el: dotted(), delay: delayOf(Math.min(a.y, b.y)) }));
    const GN = gone.map((a) => { const g = svg("g", {}, wire); return { a, g, el: dotted(g), at: MP[0] + delayOf(a.y) / D }; });
    const AD = added.map((b) => { const el = dotted(), s = box(b); el.setAttribute("d", rrPath(s.x, s.y, s.w, s.h, s.r)); const L = el.getTotalLength(); el.style.strokeDasharray = "none"; el.style.opacity = 0;
      return { b, el, L, head: svg("circle", { r: 2.3, class: "t-gen-head", opacity: 0 }, wire), at: MP[0] + 0.05 + 0.5 * (MP[1] - MP[0]) * clamp(b.y / Math.max(1, UY + UH)) }; });
    const fly = AD.map((o, i) => { const ang = hashN(i * 9.1 + N) * Math.PI * 2, dist = 40 + 50 * hashN(i * 4.7 + N), sx = o.b.x, sy = o.b.y;
      return { el: svg("circle", { r: 1.6, class: "t-gen-flyer", opacity: 0 }, root), x0: sx + Math.cos(ang) * dist, y0: sy + Math.sin(ang) * dist, x1: sx, y1: sy, arr: o.at, s0: o.at - 0.1 }; });
    const ret = svg("path", { class: "t-gen-reticle", opacity: 0 }, root), tag = svg("text", { class: "t-gen-label t-gen-label--tag", opacity: 0 }, root);
    const read = svg("text", { class: "t-gen-label t-gen-label--small", opacity: 0 }, root);
    const head = svg("text", { class: "t-gen-label", opacity: 0 }, root), count = svg("text", { class: "t-gen-label t-gen-label--small", "text-anchor": "end", opacity: 0 }, root);
    const qOf = (delay, p) => MORPH_EASE(clamp(((p - MP[0]) * D - delay) / Math.max(1, ML - delay)));
    let vt = null, style = null, started = false;
    const names = [];
    cleanups.push(() => { names.forEach((e) => (e.style.viewTransitionName = "")); if (style) style.remove(); if (vt && vt.skipTransition) try { vt.skipTransition(); } catch (e) {} });
    const begin = () => {
      started = true;
      // names: the card, each matched pair (an element once, whole elements only), the overlay (kept live on top)
      const used = new Set(), named = [];
      const whole = (e) => e && e.getClientRects().length === 1;
      MPR.forEach((m, i) => { const ea = m.a.el, eb = m.b.el; if (!ea || !eb || used.has(ea) || used.has(eb) || ea === fromEl || eb === toEl || !whole(ea) || !whole(eb)) return; used.add(ea); used.add(eb); m.name = `t-gen-${N}-${i}`; named.push(m); });
      const set = (e, n) => { e.style.viewTransitionName = n; if (n) names.push(e); };
      set(fromEl, `t-gen-${N}-card`); set(layer, `t-gen-${N}-ov`); named.forEach((m) => set(m.a.el, m.name));
      const ease = `cubic-bezier(${MORPH_CURVE.join(",")})`, dur = (ms, delay = 0) => `animation-duration:${Math.round(ms)}ms;animation-delay:${Math.round(delay)}ms;animation-timing-function:${ease};animation-fill-mode:both;`;
      style = document.createElement("style");
      style.textContent = [
        `::view-transition-group(t-gen-${N}-card),::view-transition-old(t-gen-${N}-card),::view-transition-new(t-gen-${N}-card){${dur(ML)}}`,
        ...named.map((m) => `::view-transition-group(${m.name}),::view-transition-old(${m.name}),::view-transition-new(${m.name}){${dur(ML - m.delay, m.delay)}}`),
        // text keeps its own size while it moves and changes over (stretched type looks broken); boxes, icons and the
        // card stretch with their group, which is what reads as a morph
        ...named.filter((m) => m.a.kind === "text").map((m) => `::view-transition-old(${m.name}),::view-transition-new(${m.name}){inline-size:auto;block-size:auto;object-fit:none}`),
        ...named.filter((m) => m.a.kind !== "text").map((m) => `::view-transition-old(${m.name}),::view-transition-new(${m.name}){inline-size:100%;block-size:100%;object-fit:fill}`),
        `::view-transition-old(t-gen-${N}-card),::view-transition-new(t-gen-${N}-card){inline-size:100%;block-size:100%;object-fit:fill}`,
        `::view-transition-old(t-gen-${N}-ov){display:none}::view-transition-group(t-gen-${N}-ov),::view-transition-new(t-gen-${N}-ov){animation:none}`,
        `::view-transition-old(root),::view-transition-new(root){animation-duration:${Math.round(ML)}ms}`,
      ].join("\n");
      document.head.appendChild(style);
      vt = document.startViewTransition(() => {
        named.forEach((m) => { m.a.el.style.viewTransitionName = ""; }); fromEl.style.viewTransitionName = "";
        fromEl.style.visibility = "hidden"; toEl.style.visibility = "visible"; toEl.style.opacity = prevB.opacity;
        set(toEl, `t-gen-${N}-card`); named.forEach((m) => set(m.b.el, m.name));
      });
      vt.finished.catch(() => {}).then(() => { names.forEach((e) => (e.style.viewTransitionName = "")); names.length = 0; if (style) { style.remove(); style = null; } });
    };
    const t0 = performance.now();
    const tick = (now) => {
      if (stopped) return;
      const t = now - t0, p = t / D, flow = f2(-(t * FLOW) % DOT), clean = 1 - smooth(TPH_M.clean[0], TPH_M.clean[1], p);
      if (!started && p >= MP[0]) begin();
      // dot field: ripple out, matrix-like shimmer while it works, lit under the probe
      const R = OUT(win([0, 0.3], p)) * (maxD + 60), pw = win([0.03, 0.26], p), probeX = lerp(UX - M, UX + UW + M, OUT(pw)), probeOp = pw > 0 && pw < 1 ? smooth(0, 0.1, pw) * (1 - smooth(0.85, 1, pw)) : 0;
      probe.setAttribute("transform", `translate(${f2(probeX)} 0)`); probe.setAttribute("opacity", f2(probeOp * 0.8));
      for (const d of dots) {
        const env = clamp((R - d.d) / 50), front = p < 0.35 ? Math.exp(-(((R - d.d - 6) / 14) ** 2)) : 0, lit = Math.max(front, probeOp > 0 ? Math.exp(-(((d.x - probeX) / 9) ** 2)) * probeOp : 0);
        d.el.setAttribute("opacity", f2(Math.max(env * 0.5, lit) * d.edge * clean)); d.el.setAttribute("r", f2(1.05 + lit * 0.85)); d.el.classList.toggle("is-lit", lit > 0.35);
      }
      // the card: outline, guides past its edges, corner handles and its size, all following the morph
      const qc = qOf(0, p), card = mixShape({ kind: "box", x: 0, y: 0, w: A.w, h: A.h, r: A.r }, { kind: "box", x: dx, y: dy, w: B.w, h: B.h, r: B.r }, qc), gIn = OUT(win([0.04, 0.24], p));
      outline.setAttribute("d", shapeD(card)); outline.style.strokeDashoffset = flow; outline.style.opacity = f2(gIn * clean);
      const E = 22, gl = [[card.x - E, card.y, card.x + card.w + E, card.y], [card.x + card.w, card.y - E, card.x + card.w, card.y + card.h + E], [card.x + card.w + E, card.y + card.h, card.x - E, card.y + card.h], [card.x, card.y + card.h + E, card.x, card.y - E]];
      guides.forEach((g, i) => { const [x1, y1, x2, y2] = gl[i]; g.setAttribute("d", `M${f2(x1)} ${f2(y1)}L${f2(lerp(x1, x2, gIn))} ${f2(lerp(y1, y2, gIn))}`); g.style.opacity = f2(0.5 * clean); g.style.strokeDashoffset = flow; });
      [[card.x, card.y], [card.x + card.w, card.y], [card.x + card.w, card.y + card.h], [card.x, card.y + card.h]].forEach(([x, y], i) => handles[i].setAttribute("transform", `translate(${f2(x)} ${f2(y)}) scale(${f2(OUT(win([0.1 + i * 0.02, 0.2 + i * 0.02], p)) * clean)})`));
      dim.setAttribute("x", f2(card.x)); dim.setAttribute("y", f2(card.y - 10)); dim.setAttribute("opacity", f2(gIn * clean * 0.9));
      dim.textContent = `${Math.round(card.w)} × ${Math.round(card.h)}   t+${(Math.min(p, 1) * D / 1000).toFixed(2)}s`;
      // every matched part: a dotted outline riding along with the real part as it morphs
      let cur = null;
      for (const m of MPR) {
        const q = qOf(m.delay, p), s = mixShape(box(m.a), box(m.b), q), traced = OUT(win([0.08, 0.26], p));
        m.el.setAttribute("d", shapeD(s)); m.el.style.strokeDashoffset = flow; m.el.style.opacity = f2(traced * 0.7 * (1 - smooth(0.85, 1, q)) * clean);
        if (q > 0 && q < 1) cur = { s, m };
      }
      // parts that are gone dissolve: their outline shrinks to dots and fades
      for (const o of GN) { const q = OUT(clamp((p - o.at) / 0.16)), s = box(o.a), cx = s.x + s.w / 2, cy = s.y + s.h / 2, k = 1 - 0.7 * q;
        o.el.setAttribute("d", shapeD(s)); o.g.setAttribute("transform", `translate(${f2(cx)} ${f2(cy)}) scale(${f2(k)}) translate(${f2(-cx)} ${f2(-cy)})`); o.g.setAttribute("opacity", f2(OUT(win([0.08, 0.2], p)) * (1 - q))); o.el.style.strokeDashoffset = flow; }
      // new parts: dots fly in, their outline is traced dot by dot, then the real part fades up inside it
      for (const o of AD) { const q = OUT(clamp((p - o.at) / 0.2)), cnt = Math.floor((o.L * q) / DOT) + 1;
        o.el.style.opacity = q > 0 ? f2(1 - 0.7 * smooth(0.85, 1, p)) : 0; if (q > 0 && cnt !== o.n) { o.n = cnt; o.el.style.strokeDasharray = `${`0 ${DOT} `.repeat(cnt - 1)}0 ${f2(o.L + 10)}`; }
        o.el.style.strokeDashoffset = flow; const live = q > 0 && q < 1; o.head.setAttribute("opacity", live ? 1 : 0);
        if (live) { const pt = o.el.getPointAtLength(Math.floor((o.L * q) / DOT) * DOT); o.head.setAttribute("cx", f2(pt.x)); o.head.setAttribute("cy", f2(pt.y)); if (!cur) cur = { s: box(o.b), m: { a: null, b: o.b }, pt }; } }
      for (const q of fly) { const k = clamp((p - q.s0) / (q.arr - q.s0)), on = p >= q.s0 && p < q.arr + 0.01; q.el.setAttribute("opacity", on ? f2(smooth(0, 0.25, k)) : 0);
        if (on) { const e = OUT(k); q.el.setAttribute("cx", f2(lerp(q.x0, q.x1, e))); q.el.setAttribute("cy", f2(lerp(q.y0, q.y1, e))); } }
      // the reticle: hopping over the old version's parts while it reads them, then on whatever is changing
      if (!cur && p < MP[0] && p > 0.06 && PA.length) { const k = Math.floor(t / 110) % PA.length; cur = { s: box(PA[k]), m: { a: PA[k], b: null } }; }
      const rOp = cur && opts.labels ? clean : 0; ret.setAttribute("opacity", f2(rOp)); tag.setAttribute("opacity", f2(rOp)); read.setAttribute("opacity", f2(rOp));
      if (cur) {
        const b = cur.s, P = 4, x = b.x - P, y = b.y - P, w = b.w + 2 * P, h = b.h + 2 * P, l = Math.min(7, w / 3, h / 3);
        ret.setAttribute("d", `M${f2(x)} ${f2(y + l)}V${f2(y)}H${f2(x + l)}M${f2(x + w - l)} ${f2(y)}H${f2(x + w)}V${f2(y + l)}M${f2(x + w)} ${f2(y + h - l)}V${f2(y + h)}H${f2(x + w - l)}M${f2(x + l)} ${f2(y + h)}H${f2(x)}V${f2(y + h - l)}`);
        const sz = (s) => `${Math.round(s.w)}×${Math.round(s.h)}`, nm = (cur.m.a || cur.m.b).name;
        tag.setAttribute("x", f2(x)); tag.setAttribute("y", f2(y - 4));
        tag.textContent = cur.m.a && cur.m.b ? `${nm} ${sz(cur.m.a)} → ${sz(cur.m.b)}` : cur.m.b ? `+ ${nm} ${sz(cur.m.b)}` : `${nm} ${sz(cur.m.a)}`;
        const pt = cur.pt || { x: b.x + b.w, y: b.y + b.h };
        read.setAttribute("x", f2(pt.x + 6)); read.setAttribute("y", f2(pt.y + 9)); read.textContent = `${String(Math.round(pt.x)).padStart(3, "0")}·${String(Math.round(pt.y)).padStart(3, "0")}`;
      }
      // what is happening, above the card
      const [va, vb] = (opts.versions || T_DEFAULTS.versions).map((v) => String(v).toUpperCase()), lOp = opts.labels ? smooth(0.02, 0.1, p) * clean : 0;
      head.setAttribute("opacity", f2(lOp)); count.setAttribute("opacity", f2(lOp));
      head.setAttribute("x", f2(UX)); head.setAttribute("y", f2(UY - 30)); count.setAttribute("x", f2(UX + UW)); count.setAttribute("y", f2(UY - 30));
      head.textContent = p < MP[0] ? `READING ${va}` : p < MP[1] ? `MORPHING ${va} → ${vb}` : `${vb} READY`;
      const n = (list, key = "at") => list.filter((o) => p >= (o[key] !== undefined ? o[key] : MP[0] + o.delay / D)).length;
      count.textContent = `MORPH ${String(n(MPR, "x")).padStart(2, "0")}  NEW ${String(n(AD)).padStart(2, "0")}  OUT ${String(n(GN)).padStart(2, "0")}`;
      if (p >= 1) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  return run;
}

// Plays every [data-t-generate] element once it scrolls into view.
// data-t-generate="skeleton" | "skeleton-texts", optional data-t-generate-variant (ui | text | small-text | image | auto)
// and data-t-generate-duration / -delay (ms).
export function auto(root = document) {
  const els = [...root.querySelectorAll("[data-t-generate]")].filter((e) => !e.__tGenAuto);
  const play = (e) => generate(e, { mode: e.dataset.tGenerate || "skeleton", variant: e.dataset.tGenerateVariant || "ui", duration: +e.dataset.tGenerateDuration || undefined, delay: +e.dataset.tGenerateDelay || 0 });
  els.forEach((e) => { e.__tGenAuto = true; e.__tGenOpacity = e.__tTigOpacity = e.style.opacity; e.style.opacity = 0; }); // hidden until it plays
  if (!("IntersectionObserver" in window)) { els.forEach(play); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); play(en.target); } }), { threshold: 0.35 });
  els.forEach((e) => io.observe(e));
}

if (typeof window !== "undefined") window.UIGeneration = { generate, auto, timeline, transform };
