/*
 * transitions.dev / text and image generation
 *
 * The dotted "agent is generating this" drawing, made for large bold type and images. Every glyph of a headline
 * is traced along its real outline in small flowing dots (each character is drawn in the element's own font on a
 * canvas and traced with marching squares), over typographic guides (cap height, x-height, baseline, descender).
 * Every image is drawn as a halftone of its own pixels inside a dotted frame. Then the ink rises into each glyph
 * and each image wipes in under a scan line.
 *
 * Modes
 *   "trace"         the dotted drawing and the ink
 *   "trace-texts"   the same, plus generation texts: an agent log of every glyph and image, and a step line
 *
 * Usage
 *   import { generate } from "./text-image-generation.js";
 *   const run = generate(el, { mode: "trace" });   // el: a headline, an image, or a block holding both
 *   await run.finished;
 *   run.cancel();
 *
 *   <section data-t-trace="trace"> ... </section>   + TextImageGeneration.auto()   (plays when it scrolls into view)
 *
 * No dependencies, any framework. Respects prefers-reduced-motion (a plain fade instead).
 */

const NS = "http://www.w3.org/2000/svg";

const DEFAULTS = {
  mode: "trace",            // "trace" | "trace-texts"
  duration: 3000,           // ms for the build; the whole run is about duration × 1.06
  delay: 0,                 // ms before it starts
  display: 32,              // px: text this size or larger is traced glyph by glyph, smaller text as lines
  maxGlyphs: 140,           // most glyphs traced (the rest only ink in)
  steps: ["Setting type", "Tracing glyphs", "Sampling images", "Inking"],
  done: "Ready",
  onDone: null,
};

// phases as fractions of `duration`
const PH = { guides: [0, 0.26], glyphs: [0.06, 0.76], lines: [0.12, 0.78], images: [0.04, 0.2], ink: 0.14, clean: [0.86, 1.04] };
const HALFTONE = 0.36, WIPE = 0.28; // an image's halftone sweep, then its wipe (fractions of duration)
const END = 1.06;

const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, p) => a + (b - a) * p;
const smooth = (a, b, x) => { const q = clamp((x - a) / (b - a)); return q * q * (3 - 2 * q); };
const f2 = (n) => (+n).toFixed(2);
const hashN = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function bezier(x1, y1, x2, y2) {
  const cx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const cy = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, m = 0.5; for (let i = 0; i < 28; i++) { m = (lo + hi) / 2; if (cx(m) < x) lo = m; else hi = m; } return cy(m); };
}
const OUT = bezier(0.16, 1, 0.3, 1);          // drawing: a soft, quick-settling ease-out
const SMOOTH_OUT = bezier(0.22, 1, 0.36, 1);  // ink and wipes: --ease-smooth-out
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (el, name, fb) => { const v = getComputedStyle(el).getPropertyValue(name).trim(); return v || fb; };

function svg(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
// half a rounded rect, from top centre to bottom centre, clockwise (dir 1) or counter-clockwise (dir 0)
function rrHalf(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const X = (v) => f2(x + v), Y = (v) => f2(y + v), R = f2(r);
  return dir
    ? `M${X(w / 2)} ${Y(0)}H${X(w - r)}A${R} ${R} 0 0 1 ${X(w)} ${Y(r)}V${Y(h - r)}A${R} ${R} 0 0 1 ${X(w - r)} ${Y(h)}H${X(w / 2)}`
    : `M${X(w / 2)} ${Y(0)}H${X(r)}A${R} ${R} 0 0 0 ${X(0)} ${Y(r)}V${Y(h - r)}A${R} ${R} 0 0 0 ${X(r)} ${Y(h)}H${X(w / 2)}`;
}
// does `node` contain `el`, across shadow roots?
function holds(node, el) { for (let x = el; x; x = x.parentNode || x.host) if (x === node) return true; return false; }
// is this viewport rect empty page (nothing but the element's own containers)?
function isFree(el, x0, y0, x1, y1) {
  if (x0 < 0 || y0 < 0 || x1 > innerWidth || y1 > innerHeight + 400) return false;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 4; j++) {
    const hit = document.elementFromPoint(lerp(x0, x1, i / 6), Math.min(innerHeight - 1, lerp(y0, y1, j / 4)));
    if (hit && hit !== document.body && hit !== document.documentElement && !holds(hit, el)) return false;
  }
  return true;
}

// ─── 1. glyph outlines: marching squares over a character drawn alone in its own font ───
// a: alpha 0..255, W × H; returns closed loops of [x, y] in pixel units
function marching(a, W, H) {
  const T = 128, at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : a[y * W + x]);
  const pts = new Map(), adj = new Map();
  const pt = (key, x0, y0, v0, x1, y1, v1) => { if (!pts.has(key)) { const t = (T - v0) / (v1 - v0); pts.set(key, [x0 + (x1 - x0) * t + 0.5, y0 + (y1 - y0) * t + 0.5]); } return key; };
  const link = (p, q) => { (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); };
  for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
    const A = at(x, y), B = at(x + 1, y), C = at(x + 1, y + 1), D = at(x, y + 1);
    const i = (A >= T ? 8 : 0) | (B >= T ? 4 : 0) | (C >= T ? 2 : 0) | (D >= T ? 1 : 0);
    if (i === 0 || i === 15) continue;
    const top = () => pt(`h${x},${y}`, x, y, A, x + 1, y, B), bottom = () => pt(`h${x},${y + 1}`, x, y + 1, D, x + 1, y + 1, C);
    const left = () => pt(`v${x},${y}`, x, y, A, x, y + 1, D), right = () => pt(`v${x + 1},${y}`, x + 1, y, B, x + 1, y + 1, C);
    switch (i) {
      case 1: case 14: link(left(), bottom()); break;
      case 2: case 13: link(bottom(), right()); break;
      case 3: case 12: link(left(), right()); break;
      case 4: case 11: link(top(), right()); break;
      case 6: case 9: link(top(), bottom()); break;
      case 7: case 8: link(left(), top()); break;
      case 5: link(top(), right()); link(left(), bottom()); break;
      case 10: link(left(), top()); link(bottom(), right()); break;
    }
  }
  const loops = [], seen = new Set();
  for (const k of adj.keys()) {
    if (seen.has(k)) continue;
    const loop = []; let prev = null, cur = k;
    while (cur && !seen.has(cur)) {
      seen.add(cur); loop.push(pts.get(cur));
      const nb = adj.get(cur), nx = nb.find((n) => n !== prev && !seen.has(n)) || null;
      prev = cur; cur = nx;
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}
function rdp(p, eps) {
  if (p.length < 3) return p;
  const [ax, ay] = p[0], [bx, by] = p[p.length - 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  let idx = 0, dmax = 0;
  for (let i = 1; i < p.length - 1; i++) { const d = Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / L; if (d > dmax) { dmax = d; idx = i; } }
  return dmax <= eps ? [p[0], p[p.length - 1]] : [...rdp(p.slice(0, idx + 1), eps).slice(0, -1), ...rdp(p.slice(idx), eps)];
}
function simplifyLoop(p, eps) {
  let far = 0, d = 0; p.forEach(([x, y], i) => { const k = (x - p[0][0]) ** 2 + (y - p[0][1]) ** 2; if (k > d) { d = k; far = i; } });
  return [...rdp(p.slice(0, far + 1), eps).slice(0, -1), ...rdp([...p.slice(far), p[0]], eps).slice(0, -1)];
}
let CV = null;
function glyphLoops(g) {
  const S = g.size < 64 ? 2 : 1, px = Math.ceil(g.size * 0.35), py = Math.ceil(g.size * 0.25);
  const W = Math.ceil((g.w + 2 * px) * S), H = Math.ceil((g.h + 2 * py) * S);
  if (!CV) CV = document.createElement("canvas");
  CV.width = W; CV.height = H;
  const ctx = CV.getContext("2d", { willReadFrequently: true });
  ctx.setTransform(S, 0, 0, S, 0, 0); ctx.font = g.font; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#000";
  ctx.fillText(g.ch, px, py + g.base - g.y);
  const d = ctx.getImageData(0, 0, W, H).data, a = new Uint8Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return marching(a, W, H)
    .map((l) => simplifyLoop(l.map(([x, y]) => [g.x - px + x / S, g.y - py + y / S]), 0.3))
    .filter((l) => l.length > 2)
    .map((l) => { const xs = l.map((q) => q[0]), ys = l.map((q) => q[1]); return { l, size: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) }; })
    .filter((o) => o.size > 1.5)
    .sort((m, n) => n.size - m.size) // outer shapes first, then counters
    .map((o) => "M" + o.l.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L") + "Z");
}

// ─── 2. read the element: display glyphs, smaller text lines, images, and the blocks that hold them ───
function measure(el, opts) {
  const R = el.getBoundingClientRect(), rel = (r) => ({ x: r.left - R.left, y: r.top - R.top, w: r.width, h: r.height });
  const hidden = (n) => { for (let x = n; x && x !== el.parentNode; x = x.parentElement) { const cs = getComputedStyle(x); if (cs.display === "none" || cs.visibility === "hidden") return true; } return false; };
  const glyphs = [], lines = [], images = [], hosts = [], metrics = new Map();
  // the block a text node is revealed through: its nearest non-inline ancestor inside el (or el)
  const hostOf = (n) => { let x = n.parentElement; while (x && x !== el && getComputedStyle(x).display.startsWith("inline")) x = x.parentElement; return x && holds(el, x) ? x : el; };
  const addHost = (h) => { if (!hosts.includes(h)) hosts.push(h); return h; };
  const mctx = document.createElement("canvas").getContext("2d");
  const metric = (font) => {
    if (metrics.has(font)) return metrics.get(font);
    mctx.font = font; const m = mctx.measureText("Hxgp");
    const v = { asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent, cap: mctx.measureText("H").actualBoundingBoxAscent, xh: mctx.measureText("x").actualBoundingBoxAscent, low: mctx.measureText("gjpqy").actualBoundingBoxDescent };
    metrics.set(font, v); return v;
  };
  // images
  const imgs = el.matches("img, video, canvas") ? [el] : [...el.querySelectorAll("img, video, canvas")];
  for (const im of imgs) {
    if (im.closest("[data-t-trace-skip]") || hidden(im)) continue;
    const r = im.getBoundingClientRect(); if (r.width < 40 || r.height < 40) continue;
    const cs = getComputedStyle(im);
    images.push({ el: im, ...rel(r), r: Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.width / 2, r.height / 2), fit: cs.objectFit, pos: cs.objectPosition });
  }
  // text
  if (!el.matches("img, video, canvas")) {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (!n.nodeValue.trim() || n.parentElement.closest("script, style, noscript, template, svg, [data-t-trace-skip]") || hidden(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const rg = document.createRange();
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const cs = getComputedStyle(n.parentElement), size = parseFloat(cs.fontSize), host = addHost(hostOf(n));
      if (size >= opts.display) {
        const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, m = metric(font), s = n.nodeValue, tt = cs.textTransform;
        for (let i = 0; i < s.length;) {
          const len = s.codePointAt(i) > 0xffff ? 2 : 1, ch = s.substr(i, len); i += len;
          if (/\s/.test(ch)) continue;
          rg.setStart(n, i - len); rg.setEnd(n, i);
          const r = rg.getClientRects()[0]; if (!r || !r.width) continue;
          const b = rel(r), base = b.y + (b.h - (m.asc + m.desc)) / 2 + m.asc, c = tt === "uppercase" ? ch.toUpperCase() : tt === "lowercase" ? ch.toLowerCase() : ch;
          mctx.font = font; const k = mctx.measureText(c); // the glyph's own ink box, so its ink never reaches the line above or below
          b.ink = { x0: b.x - k.actualBoundingBoxLeft, x1: b.x + k.actualBoundingBoxRight, y0: base - k.actualBoundingBoxAscent, y1: base + k.actualBoundingBoxDescent };
          glyphs.push({ ch: tt === "uppercase" ? ch.toUpperCase() : tt === "lowercase" ? ch.toLowerCase() : ch, ...b, base, font, size, m, host, family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(), weight: cs.fontWeight, lh: parseFloat(cs.lineHeight) || size * 1.2 });
        }
      } else {
        rg.selectNodeContents(n);
        for (const q of rg.getClientRects()) {
          const last = lines[lines.length - 1], y = q.top - R.top;
          if (last && last.host === host && Math.abs(last.y - y) < 2 && q.left - R.left - last.x2 < size) last.x2 = Math.max(last.x2, q.right - R.left);
          else lines.push({ x: q.left - R.left, x2: q.right - R.left, y, h: q.height, host });
        }
      }
    }
  }
  // display lines: glyphs that share a baseline in the same block get one set of type guides
  const rows = [];
  for (const g of glyphs) {
    let row = rows.find((r) => r.host === g.host && Math.abs(r.base - g.base) < 2 && r.font === g.font);
    if (!row) rows.push((row = { host: g.host, base: g.base, font: g.font, m: g.m, x0: g.x, x1: g.x + g.w, size: g.size, family: g.family, weight: g.weight, lh: g.lh }));
    row.x0 = Math.min(row.x0, g.x); row.x1 = Math.max(row.x1, g.x + g.w);
  }
  return { w: R.width, h: R.height, glyphs, lines, images, hosts, rows };
}

// ─── 3. an image's halftone: one dot per cell, sized by how dark its own pixels are there ───
function halftone(im, cell, light) {
  const cols = Math.max(1, Math.floor(im.w / cell)), rows = Math.max(1, Math.floor(im.h / cell));
  const ox = (im.w - cols * cell) / 2, oy = (im.h - rows * cell) / 2;
  let lum = null;
  try {
    const c = document.createElement("canvas"); c.width = cols; c.height = rows;
    const g = c.getContext("2d", { willReadFrequently: true }), src = im.el;
    const sw = src.naturalWidth || src.videoWidth || src.width, sh = src.naturalHeight || src.videoHeight || src.height;
    if (sw && sh) {
      // object-fit: cover (the common case), contain and fill; object-position from its percentages
      let sx = 0, sy = 0, cw = sw, ch = sh, dx = 0, dy = 0, dw = cols, dh = rows;
      const [px, py] = String(im.pos || "50% 50%").split(" ").map((v) => (/%$/.test(v) ? parseFloat(v) / 100 : 0.5));
      if (im.fit === "cover") { const k = Math.max(im.w / sw, im.h / sh); cw = im.w / k; ch = im.h / k; sx = (sw - cw) * px; sy = (sh - ch) * (py ?? 0.5); }
      else if (im.fit === "contain") { const k = Math.min(im.w / sw, im.h / sh); dw = (sw * k) / cell; dh = (sh * k) / cell; dx = (cols - dw) * px; dy = (rows - dh) * (py ?? 0.5); }
      g.drawImage(src, sx, sy, cw, ch, dx, dy, dw, dh);
      const d = g.getImageData(0, 0, cols, rows).data; lum = new Float32Array(cols * rows);
      let lo = 1, hi = 0;
      for (let i = 0; i < lum.length; i++) { const a = d[i * 4 + 3] / 255, v = a ? (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255 : 1; lum[i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
      for (let i = 0; i < lum.length; i++) lum[i] = (lum[i] - lo) / Math.max(0.1, hi - lo); // stretched, so a soft photo still reads
    }
  } catch (e) { lum = null; } // a cross-origin image without CORS can't be read: an even dot screen instead
  const dots = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const v = lum ? lum[r * cols + c] : 0.55 + 0.1 * hashN(r * 7.1 + c * 3.3), dark = Math.pow(light ? v : 1 - v, 0.85); // light dots on a dark page grow with brightness
    if (dark < 0.06) continue;
    const y = oy + (r + 0.5) * cell;
    dots.push({ x: im.x + ox + (c + 0.5) * cell, y: im.y + y, r: Math.max(0.5, cell * 0.5 * dark), at: 0.72 * (y / im.h) + 0.28 * hashN(r * 12.9 + c * 78.2) });
  }
  return dots;
}

// ─── 4. the overlay ───
function build(el, M, opts) {
  const R = el.getBoundingClientRect(), w = M.w, h = M.h, DOT_GAP = 4.6;
  const layer = document.createElement("div");
  layer.className = "t-tig" + (opts.mode === "trace-texts" ? " t-tig--texts" : "");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { left: f2(R.left + scrollX) + "px", top: f2(R.top + scrollY) + "px", width: f2(w) + "px", height: f2(h) + "px" });
  const dpr = Math.min(2, devicePixelRatio || 1), cv = document.createElement("canvas");
  cv.className = "t-tig-canvas"; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = f2(w) + "px"; cv.style.height = f2(h) + "px";
  layer.appendChild(cv);
  const root = svg("svg", { class: "t-tig-svg", width: f2(w), height: f2(h), viewBox: `0 0 ${f2(w)} ${f2(h)}` }, layer);
  document.body.appendChild(layer); el.__tTigLayer = layer; // in the page first: SVG lengths only measure once rendered
  const G = { el, layer, root, cv, ctx: cv.getContext("2d"), w, h, M, glyphs: [], lines: [], images: [], rows: [] };
  G.ctx.scale(dpr, dpr);
  G.ink = css(el, "--tig-ink", "rgba(13, 13, 13, 0.5)"); G.lit = css(el, "--tig-strong", "#6c6c6c");
  const rgb = (G.ink.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number); G.light = rgb[0] + rgb[1] + rgb[2] > 384;
  const stroke = (d, parent, cls = "t-tig-wire", gap = DOT_GAP) => { const e = svg("path", { d, class: cls }, parent); return { el: e, L: e.getTotalLength(), gap }; };
  const head = (parent, r = 2.2) => svg("circle", { r, class: "t-tig-head", opacity: 0 }, parent);
  const wires = svg("g", { class: "t-tig-wireframe" }, root);

  // type guides: cap height, x-height, baseline and descender for each display line, past both ends
  M.rows.forEach((row, i) => {
    // the first line of each block carries the labels; the lines under it only their guides
    const first = M.rows.findIndex((r) => r.host === row.host && r.font === row.font) === i, E = 26, ys = [["CAP", row.base - row.m.cap], ["X", row.base - row.m.xh], ["BASE", row.base], ["DESC", row.base + row.m.low]];
    const g = svg("g", { opacity: 0 }, root);
    const guides = ys.map(([name, y], k) => ({ ...stroke(`M${f2(row.x0 - E)} ${f2(y)}H${f2(row.x1 + E)}`, g, "t-tig-guide", 6), name, y,
      label: Object.assign(svg("text", { x: f2(row.x1 + E + 6), y: f2(y + 3), class: "t-tig-label t-tig-label--small" }, g), { textContent: first ? `${name} ${Math.round(Math.abs(row.base - y)) || ""}`.trim() : "" }), k }));
    const spec = Object.assign(svg("text", { x: f2(row.x0 - E), y: f2(row.base - row.m.cap - 9), class: "t-tig-label" }, g), { textContent: first ? `${row.family.toUpperCase()} ${row.weight}  ${Math.round(row.size)}/${Math.round(row.lh)}` : "" });
    G.rows.push({ g, guides, spec, t0: PH.guides[0] + i * 0.035, row });
  });

  // glyphs: their own outlines, traced loop by loop
  const traced = M.glyphs.slice(0, opts.maxGlyphs), n = M.glyphs.length, span = PH.glyphs[1] - PH.glyphs[0], dur = Math.min(0.16, span * 0.45);
  M.glyphs.forEach((g, i) => {
    const t0 = PH.glyphs[0] + (n > 1 ? (span - dur) * (i / (n - 1)) : 0), gg = svg("g", {}, wires);
    let strokes = [];
    if (traced.includes(g)) { try { strokes = glyphLoops(g).map((d) => stroke(d, gg)); } catch (e) { strokes = []; } }
    strokes.forEach((s, k) => { s.idx = k; s.head = head(gg); });
    strokes.n = strokes.length;
    G.glyphs.push({ g: gg, strokes, b: g, t0, t1: t0 + dur, ti: t0 + dur * 0.8, host: g.host });
  });

  // smaller text: a dotted line through each line of it, like the wireframe skill
  const nl = M.lines.length, lspan = PH.lines[1] - PH.lines[0], ldur = Math.min(0.14, lspan * 0.5);
  M.lines.forEach((ln, i) => {
    const y = ln.y + ln.h * 0.56, s = stroke(`M${f2(ln.x)} ${f2(y)}H${f2(ln.x2)}`, wires);
    s.head = head(wires, 1.8); s.idx = 0;
    const t0 = PH.lines[0] + (nl > 1 ? (lspan - ldur) * (i / (nl - 1)) : 0);
    G.lines.push({ s, b: ln, t0, t1: t0 + ldur, ti: t0 + ldur * 0.7, host: ln.host });
  });

  // images: a dotted frame drawn from the top in both directions, a placeholder cross, handles, size label, halftone
  const cell = Math.max(5, Math.min(8, Math.round(Math.sqrt(Math.max(...M.images.map((m) => m.w * m.h), 1)) / 70)));
  M.images.forEach((im, i) => {
    const t0 = M.images.length > 1 ? lerp(PH.images[0], PH.images[1], i / (M.images.length - 1)) : PH.images[0];
    const frame = [1, 0].map((dir) => Object.assign(stroke(rrHalf(im.x, im.y, im.w, im.h, im.r, dir), wires), { head: head(wires, 2.6) }));
    const cross = [`M${f2(im.x)} ${f2(im.y)}L${f2(im.x + im.w)} ${f2(im.y + im.h)}`, `M${f2(im.x + im.w)} ${f2(im.y)}L${f2(im.x)} ${f2(im.y + im.h)}`].map((d) => stroke(d, wires, "t-tig-guide", 6));
    const handles = [[im.x, im.y], [im.x + im.w, im.y], [im.x + im.w, im.y + im.h], [im.x, im.y + im.h]].map(([x, y]) => ({ el: svg("rect", { x: -2.5, y: -2.5, width: 5, height: 5, class: "t-tig-handle", transform: `translate(${f2(x)} ${f2(y)}) scale(0)` }, root), x, y }));
    const label = svg("text", { x: f2(im.x), y: f2(im.y - 8), class: "t-tig-label", opacity: 0 }, root);
    const scan = svg("g", { opacity: 0 }, root);
    svg("path", { d: `M${f2(im.x - 14)} 0H${f2(im.x + im.w + 14)}`, class: "t-tig-guide t-tig-guide--scan" }, scan);
    svg("circle", { cx: f2(im.x), cy: 0, r: 2.3, class: "t-tig-head" }, scan); svg("circle", { cx: f2(im.x + im.w), cy: 0, r: 2.3, class: "t-tig-head" }, scan);
    G.images.push({ im, frame, cross, handles, label, scan, dots: halftone(im, cell, G.light), t0, th: t0 + 0.08, tr: t0 + 0.08 + HALFTONE, cell,
      prev: { clipPath: im.el.style.clipPath, filter: im.el.style.filter } });
  });

  // reticle on the glyph being traced, coordinate readout on its moving dot, particles landing on each glyph
  G.ret = svg("path", { class: "t-tig-reticle", opacity: 0 }, root); G.tag = svg("text", { class: "t-tig-label t-tig-label--tag", opacity: 0 }, root);
  G.read = svg("text", { class: "t-tig-label t-tig-label--small", opacity: 0 }, root);
  G.flyers = G.glyphs.filter((g) => g.strokes.length).map((g, i) => {
    const pt = g.strokes[0].el.getPointAtLength(0), ang = hashN(i * 9.1) * Math.PI * 2, dist = 28 + 50 * hashN(i * 4.7);
    return { el: svg("circle", { r: 1.6, class: "t-tig-flyer", opacity: 0 }, root), x0: pt.x + Math.cos(ang) * dist, y0: pt.y + Math.sin(ang) * dist, x1: pt.x, y1: pt.y, arr: g.t0, s0: g.t0 - 0.08 };
  });

  // the blocks the text is revealed through, with their own clip
  G.hosts = M.hosts.map((hel) => { const r = hel.getBoundingClientRect(); return { el: hel, x: r.left - R.left, y: r.top - R.top, prev: hel.style.clipPath }; });
  G.inkEnd = Math.max(0, ...G.glyphs.map((g) => g.ti + PH.ink), ...G.lines.map((l) => l.ti + PH.ink));
  if (opts.mode === "trace-texts") buildTexts(G, el, opts);
  return G;
}

function buildTexts(G, el, opts) {
  // the log goes beside the element where that space is empty, else under it; the step line under it
  const r = el.getBoundingClientRect(), PW = 230, gap = 40;
  const mk = (cls) => { const d = document.createElement("div"); d.className = cls; G.layer.appendChild(d); return d; };
  const where = isFree(el, r.left - gap - PW, r.top, r.left - gap, Math.min(r.bottom, r.top + 220)) ? "left"
    : isFree(el, r.right + gap, r.top, r.right + gap + PW, Math.min(r.bottom, r.top + 220)) ? "right"
    : isFree(el, r.left, r.bottom + 64, r.right, r.bottom + 170) ? "below" : null;
  if (where) {
    G.logEl = mk("t-tig-panel t-tig-panel--" + where);
    if (where === "left") G.logEl.style.right = `calc(100% + ${gap}px)`;
    if (where === "right") G.logEl.style.left = `calc(100% + ${gap}px)`;
  }
  G.stepEl = mk("t-tig-steps");
  if (!isFree(el, r.left, r.bottom + 16, r.right, r.bottom + 50)) G.stepEl.style.display = "none";
  G.steps = [...opts.steps, opts.done].filter(Boolean);
  G.stepEl.innerHTML = G.steps.map(() => `<div class="t-tig-step"><i></i><span></span></div>`).join("");
  [...G.stepEl.children].forEach((d, i) => (d.lastChild.textContent = G.steps[i]));
  const hex = (k) => "0x" + Math.floor(hashN(k * 5.3 + 17.1) * 65535).toString(16).padStart(4, "0");
  const sz = (b) => `${String(Math.round(b.w)).padStart(3, "0")}×${String(Math.round(b.h)).padStart(3, "0")}`;
  G.log = [
    ...G.images.map((m, i) => ({ head: `${hex(i + 90)}  image  ${sz(m.im)}  ${String(m.dots.length).padStart(5, " ")} DOTS  `, t0: m.t0, t1: m.tr })),
    ...G.glyphs.map((g, i) => ({ head: `${hex(i)}  glyph  "${g.b.ch}"  ${sz(g.b)}  ${String(g.strokes.length).padStart(2, " ")} PATHS  `, t0: g.t0, t1: g.t1 })),
    ...G.lines.map((l, i) => ({ head: `${hex(i + 50)}  line   ${sz({ w: l.b.x2 - l.b.x, h: l.b.h })}  `, t0: l.t0, t1: l.t1 })),
  ].sort((a, b) => a.t0 - b.t0);
}

// ─── 5. one frame: p = progress (0 → END), t = ms since start ───
const FLOW = 0.016;
function drawStroke(s, q, t) {
  const on = q > 0; s.el.style.opacity = on ? 1 : 0;
  if (on) {
    const n = Math.floor((s.L * Math.min(1, q)) / s.gap) + 1;
    if (n !== s.n) { s.n = n; s.el.style.strokeDasharray = `${`0 ${f2(s.gap)} `.repeat(n - 1)}0 ${f2(s.L + 10)}`; }
    s.el.style.strokeDashoffset = f2(-(t * FLOW) % s.gap);
  }
  if (s.head) {
    const live = (s.live = q > 0 && q < 1); s.head.setAttribute("opacity", live ? 1 : 0);
    if (live) { s.pt = s.el.getPointAtLength(Math.floor((s.L * q) / s.gap) * s.gap); s.head.setAttribute("cx", f2(s.pt.x)); s.head.setAttribute("cy", f2(s.pt.y)); }
  }
}
const rect = (x, y, w, h) => (w > 0.2 && h > 0.2 ? `M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}Z` : "");

function frame(G, p, t, D) {
  const clean = 1 - smooth(PH.clean[0], PH.clean[1], p), ink = (x) => SMOOTH_OUT(clamp((p - x) / PH.ink));

  // type guides: drawn out early, gone once their line has its ink
  for (const R of G.rows) {
    const out = 1 - smooth(0.7, 0.9, p);
    R.g.setAttribute("opacity", f2(p > R.t0 ? out : 0));
    R.guides.forEach((g) => { const q = OUT(clamp((p - R.t0 - g.k * 0.025) / 0.18)); drawStroke(g, q, t); g.label.setAttribute("opacity", f2(smooth(0.6, 1, q))); });
    R.spec.setAttribute("opacity", f2(smooth(R.t0 + 0.04, R.t0 + 0.12, p)));
  }
  // glyphs: traced loop by loop, then the dots fade as the ink rises in
  let cur = null;
  for (const g of G.glyphs) {
    const q = clamp((p - g.t0) / (g.t1 - g.t0)), iq = ink(g.ti);
    g.strokes.forEach((s) => drawStroke(s, OUT(clamp(q * g.strokes.n - s.idx * 0.75)), t));
    g.g.setAttribute("opacity", f2((1 - 0.85 * smooth(0.2, 1, iq)) * clean));
    if (p >= g.t0 && p < g.t1 + 0.04) cur = g;
  }
  for (const l of G.lines) {
    drawStroke(l.s, OUT(clamp((p - l.t0) / (l.t1 - l.t0))), t);
    if (l.s.el.style.opacity === "1") l.s.el.style.opacity = f2((1 - 0.85 * ink(l.ti)) * clean);
  }

  // the text blocks: each glyph's ink rises from its descender, smaller lines wipe in left to right
  for (const H of G.hosts) {
    if (p >= G.inkEnd) { if (!H.done) { H.done = true; H.el.style.clipPath = H.prev; } continue; }
    let d = "";
    for (const g of G.glyphs) {
      if (g.host !== H.el) continue;
      const iq = ink(g.ti); if (iq <= 0) continue;
      const k = g.b.ink, y0 = k.y0 - 2, y1 = k.y1 + 2;
      d += rect(k.x0 - 2 - H.x, y1 - (y1 - y0) * iq - H.y, k.x1 - k.x0 + 4, (y1 - y0) * iq);
    }
    for (const l of G.lines) {
      if (l.host !== H.el) continue;
      const iq = ink(l.ti); if (iq <= 0) continue;
      d += rect(l.b.x - 3 - H.x, l.b.y - 4 - H.y, (l.b.x2 - l.b.x + 6) * iq, l.b.h + 8);
    }
    // images inside the block keep their own wipe
    for (const m of G.images) if (holds(H.el, m.im.el)) d += rect(m.im.x - H.x - 2, m.im.y - H.y - 2, m.im.w + 4, m.im.h + 4);
    H.el.style.clipPath = d ? `path("${d}")` : "polygon(0 0, 0 0, 0 0)";
  }

  // images: frame, cross and handles, then the halftone of their own pixels, then the photo wipes in under a scan line
  const { ctx } = G; ctx.clearRect(0, 0, G.w, G.h);
  for (const m of G.images) {
    const fq = OUT(clamp((p - m.t0) / 0.22)), wq = SMOOTH_OUT(clamp((p - m.tr) / WIPE)), gone = 1 - smooth(0.55, 1, wq), es = m.im.el.style;
    m.frame.forEach((s) => { drawStroke(s, fq, t); if (s.el.style.opacity === "1") s.el.style.opacity = f2(gone * clean); });
    m.cross.forEach((s, k) => { const q = OUT(clamp((p - m.t0 - 0.04 - k * 0.03) / 0.2)); drawStroke(s, q, t); s.el.style.opacity = q > 0 ? f2(0.55 * (1 - smooth(0, 0.5, clamp((p - m.th) / HALFTONE))) * clean) : 0; });
    m.handles.forEach((hd) => hd.el.setAttribute("transform", `translate(${f2(hd.x)} ${f2(hd.y)}) scale(${f2(OUT(clamp((p - m.t0 - 0.06) / 0.1)) * gone)})`));
    m.label.setAttribute("opacity", f2(smooth(m.t0, m.t0 + 0.06, p) * gone));
    m.label.textContent = `IMAGE ${Math.round(m.im.w * fq)}×${Math.round(m.im.h * fq)}  ${m.im.fit === "fill" ? "" : m.im.fit.toUpperCase()}  ${m.cell}PX SCREEN`;
    // halftone: dots arrive top down (scattered a little), pop large and dark, then settle; the wipe takes them
    const hq = (p - m.th) / HALFTONE, yWipe = m.im.y + wq * (m.im.h + 4) - 2;
    if (hq > 0 && wq < 1) {
      for (const pass of [0, 1]) {
        ctx.beginPath(); ctx.fillStyle = pass ? G.lit : G.ink;
        for (const d of m.dots) {
          if (d.y < yWipe) continue;
          const a = clamp((hq - d.at * 0.85) / 0.15); if (a <= 0 || (a < 1) !== !!pass) continue;
          const r = d.r * (a < 1 ? OUT(a) * (1 + 0.5 * (1 - a)) : 1);
          ctx.moveTo(d.x + r, d.y); ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
    m.scan.setAttribute("opacity", f2(wq > 0 && wq < 1 ? smooth(0, 0.1, wq) * (1 - smooth(0.85, 1, wq)) : 0));
    m.scan.setAttribute("transform", `translate(0 ${f2(yWipe)})`);
    if (wq >= 1) { if (!m.done) { m.done = true; Object.assign(es, m.prev); } }
    else {
      es.clipPath = wq <= 0 ? "inset(0 0 100% 0)" : `inset(0 0 ${f2((1 - wq) * 100)}% 0${m.im.r ? ` round ${f2(m.im.r)}px` : ""})`;
      es.filter = wq > 0 ? `blur(${f2(5 * (1 - wq))}px)` : m.prev.filter;
    }
    if (p >= m.t0 && p < m.tr) cur = cur || { b: { ch: null, ...m.im }, image: true };
  }

  // reticle and readouts on whatever is being drawn now
  const rOp = cur ? 1 - smooth(0.78, 0.86, p) : 0;
  G.ret.setAttribute("opacity", f2(rOp)); G.tag.setAttribute("opacity", f2(rOp));
  if (cur) {
    const b = cur.b, P = 4, X = b.x - P, Y = (cur.image ? b.y : b.base - b.m.cap) - P, RW = b.w + 2 * P, RH = (cur.image ? b.h : b.m.cap) + 2 * P, l = Math.min(7, RW / 3, RH / 3);
    G.ret.setAttribute("d", `M${f2(X)} ${f2(Y + l)}V${f2(Y)}H${f2(X + l)}M${f2(X + RW - l)} ${f2(Y)}H${f2(X + RW)}V${f2(Y + l)}M${f2(X + RW)} ${f2(Y + RH - l)}V${f2(Y + RH)}H${f2(X + RW - l)}M${f2(X + l)} ${f2(Y + RH)}H${f2(X)}V${f2(Y + RH - l)}`);
    G.tag.setAttribute("x", f2(X)); G.tag.setAttribute("y", f2(Y + RH + 10));
    G.tag.textContent = cur.image ? "" : `"${b.ch}" ${Math.round(b.w)}×${Math.round(b.m.cap)}`;
  }
  let live = null; for (const g of G.glyphs) for (const s of g.strokes) if (s.live) live = s;
  G.read.setAttribute("opacity", live ? 1 : 0);
  if (live) { G.read.setAttribute("x", f2(live.pt.x + 6)); G.read.setAttribute("y", f2(live.pt.y - 5)); G.read.textContent = `${String(Math.round(live.pt.x)).padStart(3, "0")}·${String(Math.round(live.pt.y)).padStart(3, "0")}`; }
  for (const q of G.flyers) {
    const k = clamp((p - q.s0) / (q.arr - q.s0)), on = p >= q.s0 && p < q.arr + 0.01;
    q.el.setAttribute("opacity", on ? f2(smooth(0, 0.25, k)) : 0);
    if (on) { const e = OUT(k); q.el.setAttribute("cx", f2(lerp(q.x0, q.x1, e))); q.el.setAttribute("cy", f2(lerp(q.y0, q.y1, e))); }
  }
  if (G.steps) texts(G, p, t);
}

function texts(G, p, t) {
  const vis = smooth(0.03, 0.1, p) * (1 - smooth(0.9, 1.04, p));
  if (G.logEl) {
    G.logEl.style.opacity = f2(vis);
    const shown = G.log.filter((l) => p >= l.t0), done = G.log.filter((l) => p >= l.t1).length;
    const rows = shown.slice(-11).map((l) => {
      const k = clamp((p - l.t0) / 0.03), prog = clamp((p - l.t0) / (l.t1 - l.t0)), full = l.head + (prog >= 1 ? "[  ok  ]" : `[${"#".repeat(Math.round(prog * 6)).padEnd(6, ".")}]`);
      return full.slice(0, Math.ceil(full.length * k));
    });
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const html = `<div class="t-tig-panel-head">AGENT.LOG // ${String(done).padStart(2, "0")}/${String(G.log.length).padStart(2, "0")}</div>` + rows.map((r) => `<div>${esc(r)}</div>`).join("");
    if (G.logSig !== html) { G.logSig = html; G.logEl.innerHTML = html; }
  }
  const n = G.steps.length, gone = smooth(0.98, 1.05, p);
  [...G.stepEl.children].forEach((s, i) => {
    const t0 = i < n - 1 ? (i / (n - 1)) * 0.92 : 0.92, t1 = i < n - 1 ? ((i + 1) / (n - 1)) * 0.92 : Infinity;
    const qi = OUT(clamp((p - t0) / 0.06)), qs = OUT(clamp((p - t1) / 0.05)), q = qi * (1 - Math.max(qs, gone));
    s.style.opacity = f2(q); s.style.transform = `translate(-50%, ${f2(5 * (1 - qi) - 5 * qs)}px)`;
    s.style.filter = q > 0.01 && q < 0.99 ? `blur(${f2(2 * (1 - q))}px)` : "none";
    s.classList.toggle("is-done", i === n - 1);
  });
}

// ─── 6. run ───
export function generate(el, options = {}) {
  const opts = Object.assign({}, DEFAULTS, options);
  if (typeof el === "string") el = document.querySelector(el);
  if (!el) throw new Error("TextImageGeneration: no element");
  if (el.__tTig) el.__tTig.cancel();
  const prev = { opacity: el.__tTigOpacity !== undefined ? el.__tTigOpacity : el.style.opacity, transition: el.style.transition };
  let resolve, raf = 0, timer = 0, G = null, stopped = false;
  const finished = new Promise((r) => (resolve = r));
  const finish = () => {
    if (stopped) return; stopped = true; cancelAnimationFrame(raf); clearTimeout(timer);
    if (el.__tTigLayer) el.__tTigLayer.remove();
    if (G) { G.hosts.forEach((H) => (H.el.style.clipPath = H.prev)); G.images.forEach((m) => Object.assign(m.im.el.style, m.prev)); }
    Object.assign(el.style, prev); el.__tTig = null; if (opts.onDone) opts.onDone(el); resolve(el);
  };
  const run = { finished, cancel: finish, element: el };
  el.__tTig = run;

  if (reduced()) {
    el.style.opacity = 0;
    timer = setTimeout(() => { el.style.transition = "opacity 200ms ease-out"; el.style.opacity = prev.opacity || ""; timer = setTimeout(finish, 220); }, opts.delay);
    return run;
  }
  el.style.opacity = 0; // hidden until its drawing starts
  timer = setTimeout(() => requestAnimationFrame(() => {
    if (stopped) return;
    const D = Math.max(800, +opts.duration || DEFAULTS.duration);
    try {
      G = build(el, measure(el, opts), opts);
      frame(G, 0, 0, D); // text blocks and images hidden behind their clips before the element shows
      el.style.opacity = prev.opacity || "";
    } catch (e) { console.warn("TextImageGeneration: could not build the drawing, showing the element", e); return finish(); }
    const t0 = performance.now();
    const tick = (now) => {
      if (stopped) return;
      const t = now - t0, p = t / D;
      frame(G, p, t, D);
      if (p >= END) return finish();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }), opts.delay);
  return run;
}

// Plays every [data-t-trace] element once it scrolls into view.
// data-t-trace="trace" | "trace-texts", optional data-t-trace-duration / -delay (ms).
export function auto(root = document) {
  const els = [...root.querySelectorAll("[data-t-trace]")].filter((e) => !e.__tTigAuto);
  const play = (e) => generate(e, { mode: e.dataset.tTrace || "trace", duration: +e.dataset.tTraceDuration || undefined, delay: +e.dataset.tTraceDelay || 0 });
  els.forEach((e) => { e.__tTigAuto = true; e.__tTigOpacity = e.style.opacity; e.style.opacity = 0; });
  if (!("IntersectionObserver" in window)) { els.forEach(play); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); play(en.target); } }), { threshold: 0.3 });
  els.forEach((e) => io.observe(e));
}

if (typeof window !== "undefined") window.TextImageGeneration = { generate, auto };
