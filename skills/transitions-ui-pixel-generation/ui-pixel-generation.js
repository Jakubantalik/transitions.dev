/*
 * transitions.dev / UI pixel generation
 *
 * Makes an element appear as if an agent is generating it pixel by pixel. Every pixel comes from the element's
 * own rendering: an SVG filter samples the real UI on a grid and blows each sample up into a block, so the colours,
 * images and text are the component's. Blocks materialise in a scattered, top-down order with rows and columns
 * of blocks turned out of place like a Rubik's cube face, turning home one block at a time, then the resolution
 * steps down (32px to 5px) pass by pass, with a few turns on each, until the real UI is crisp.
 *
 * Modes
 *   "pixel"         the pixel build with its HUD (corner brackets, pixel grid, resolution readout)
 *   "pixel-texts"   the same, plus a render log of every pass and a step line
 *
 * Motion
 *   "slide"         turned rows and columns slide home flat, one block at a time (default)
 *   "cube"          every block is a little cube; turning rows and columns rotate in 3D like a Rubik's cube layer
 *
 * Usage
 *   import { generate } from "./ui-pixel-generation.js";
 *   const run = generate(el, { mode: "pixel" });
 *   await run.finished;
 *   run.cancel();
 *
 *   <div data-t-pixel-generate="pixel"> ... </div>   + UIPixelGeneration.auto()
 *
 * No dependencies, any framework. Respects prefers-reduced-motion (a plain fade instead).
 */

const NS = "http://www.w3.org/2000/svg";

const DEFAULTS = {
  mode: "pixel",          // "pixel" | "pixel-texts"
  duration: 2200,         // ms for the whole build
  delay: 0,               // ms before it starts
  resolutions: [32, 20, 12, 8, 5], // block sizes, coarse to fine; after the last one the UI is crisp
  motion: "slide",        // "slide" (turned rows and columns slide home flat) | "cube" (every block turns in 3D, like a Rubik's cube)
  steps: ["Sampling pixels", "Resolving layout", "Sharpening detail", "Final pass"],
  done: "Ready",
  onDone: null,
};

// phases as fractions of `duration`
const PH = { hud: [0, 0.14], materialize: [0.04, 0.46], passes: [0.42, 0.9], settle: [0.9, 1] };

const clamp = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, p) => a + (b - a) * p;
const smooth = (a, b, x) => { const q = clamp((x - a) / (b - a)); return q * q * (3 - 2 * q); };
const win = (r, p) => clamp((p - r[0]) / (r[1] - r[0]));
const hashN = (x) => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function bezier(x1, y1, x2, y2) {
  const cx = (t) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3;
  const cy = (t) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3;
  return (x) => { if (x <= 0) return 0; if (x >= 1) return 1; let lo = 0, hi = 1, m = 0.5; for (let i = 0; i < 28; i++) { m = (lo + hi) / 2; if (cx(m) < x) lo = m; else hi = m; } return cy(m); };
}
const SMOOTH_OUT = bezier(0.22, 1, 0.36, 1); // --ease-smooth-out
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const css = (el, name, fb) => { const v = getComputedStyle(el).getPropertyValue(name).trim(); return v || fb; };

let N = 0;

// does `node` contain `el`, across shadow roots? (web components and shadow hosts count as containers)
function holds(node, el) { for (let x = el; x; x = x.parentNode || x.host) if (x === node) return true; return false; }
// is this viewport rect empty page? The HUD never counts: it takes no input.
function isFree(el, x0, y0, x1, y1) {
  if (x0 < 0 || y0 < 0 || x1 > innerWidth || y1 > innerHeight + 400) return false;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 4; j++) { // dense enough to catch a short caption
    const hit = document.elementFromPoint(lerp(x0, x1, i / 8), Math.min(innerHeight - 1, lerp(y0, y1, j / 4)));
    if (hit && hit !== document.body && hit !== document.documentElement && !holds(hit, el)) return false;
  }
  return true;
}

// ─── the pixelate filter: samples the element on a grid and grows each sample into a block ───
// It lives in the element's own tree (the document, or its shadow root) so `filter: url(#…)` resolves.
function makeFilter(el, w, h, pad, cube) {
  const id = "t-pxg-" + ++N, host = el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document.body;
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("width", "0"); s.setAttribute("height", "0"); s.setAttribute("aria-hidden", "true");
  s.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  // the puzzle: two displacement maps (columns, then rows) move whole blocks before they are sampled, so a
  // turned row or column shows the real blocks in new places. Each map is a neutral flood with one flood per
  // displaced stretch on top; a band uses two (the part that slid and the part that wrapped round)
  const pool = (k) => Array.from({ length: POOL }, (_, i) => `<feFlood data-k="${k}" flood-opacity="0" x="0" y="0" width="1" height="1" result="${k}${i}"/>`).join("")
    + `<feMerge result="${k}map"><feMergeNode in="${k}base"/>${Array.from({ length: POOL }, (_, i) => `<feMergeNode in="${k}${i}"/>`).join("")}</feMerge>`;
  const fn = (k) => ["R", "G", "B"].map((c) => `<feFunc${c} data-k="${k}" type="linear" slope="1"/>`).join("");
  // cube motion: the state one turn on ("to") is the current state shifted one block along each turning band
  // (a third displacement map, "s"), sampled into a second mosaic. Inside the turning bands every block shows
  // two faces: the current block shrinking away and the next one turning in, split by a tiled stripe one block
  // wide, each shaded for its angle. Blocks are flat colour, so a face only needs its width, never a stretch.
  const cubeFx = !cube ? "" : `
    <feFlood flood-color="rgb(128,128,0)" result="sbase"/>${pool("s")}
    <feMerge result="sreg">${Array.from({ length: POOL }, (_, i) => `<feMergeNode in="s${i}"/>`).join("")}</feMerge>
    <feDisplacementMap data-k="smove" in="a2" in2="smap" scale="0" xChannelSelector="R" yChannelSelector="G" result="a3"/>
    <feComposite in="a3" in2="grid" operator="in"/>
    <feMorphology data-k="grow2" operator="dilate" radius="4" result="pxTo"/>
    <feComponentTransfer in="pxTo" result="toS">${fn("lb")}</feComponentTransfer>
    <feComponentTransfer in="pxFrom" result="fromS">${fn("la")}</feComponentTransfer>
    <feFlood data-k="stripe" flood-opacity="0" x="0" y="0" width="1" height="1" flood-color="#000"/>
    <feComposite data-k="scell" x="${-pad}" y="${-pad}" width="8" height="8"/>
    <feTile result="stripes"/>
    <feComposite in="toS" in2="stripes" operator="in" result="bF"/>
    <feComposite in="fromS" in2="stripes" operator="out" result="aF"/>
    <feMerge result="faces"><feMergeNode in="aF"/><feMergeNode in="bF"/></feMerge>
    <feComposite in="faces" in2="sreg" operator="in" result="mov"/>
    <feComposite in="pxFrom" in2="sreg" operator="out" result="rest"/>
    <feMerge><feMergeNode in="rest"/><feMergeNode in="mov"/></feMerge>`;
  s.innerHTML = `<filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="avg"/>
    <feFlood flood-color="rgb(128,128,0)" result="cbase"/>${pool("c")}
    <feDisplacementMap data-k="cmove" in="avg" in2="cmap" scale="0" xChannelSelector="R" yChannelSelector="G" result="a1"/>
    <feFlood flood-color="rgb(128,128,0)" result="rbase"/>${pool("r")}
    <feDisplacementMap data-k="rmove" in="a1" in2="rmap" scale="0" xChannelSelector="R" yChannelSelector="G" result="a2"/>
    <feFlood data-k="dot" x="0" y="0" width="1" height="1" flood-color="#000"/>
    <feComposite data-k="cell" x="${-pad}" y="${-pad}" width="8" height="8"/>
    <feTile result="grid"/>
    <feComposite in="a2" in2="grid" operator="in"/>
    <feMorphology data-k="grow" operator="dilate" radius="4" result="pxFrom"/>${cubeFx}
  </filter>`;
  host.appendChild(s);
  const q = (k) => s.querySelector(`[data-k="${k}"]`), avg = s.querySelector("feGaussianBlur"), flood = q("dot"), cell = q("cell"), grow = q("grow");
  const all = (k) => [...s.querySelectorAll(`[data-k="${k}"]`)];
  const slots = { c: all("c"), r: all("r"), s: all("s") }, move = { c: q("cmove"), r: q("rmove"), s: q("smove") };
  const grow2 = q("grow2"), stripe = q("stripe"), scell = q("scell"), shadeA = all("la"), shadeB = all("lb");
  // block size b: the UI blurred to about a block's average, sampled at the middle of each b × b cell,
  // then dilated back to the full cell (a real downscale, so each block carries its area's colour)
  const set = (b) => {
    avg.setAttribute("stdDeviation", (b * 0.32).toFixed(2));
    flood.setAttribute("x", -pad + Math.floor(b / 2)); flood.setAttribute("y", -pad + Math.floor(b / 2));
    cell.setAttribute("width", b); cell.setAttribute("height", b);
    grow.setAttribute("radius", (b / 2).toFixed(2));
    if (cube) { grow2.setAttribute("radius", (b / 2).toFixed(2)); scell.setAttribute("width", b); scell.setAttribute("height", b); }
  };
  // band `bd` turned by n blocks: output block k (from the band's first block) shows source block (k - n) mod N
  const band = (bd, slot, n) => {
    const [fa, fb] = [slots[bd.k][slot * 2], slots[bd.k][slot * 2 + 1]], m = ((n % bd.N) + bd.N) % bd.N;
    if (!m) { fa.setAttribute("flood-opacity", "0"); fb.setAttribute("flood-opacity", "0"); return; }
    const a = -pad + bd.i0 * bd.b, c = -pad + bd.j * bd.b, v = (d) => Math.round(255 * clamp(0.5 + d / bd.S));
    [[fa, a, m * bd.b, (bd.N - m) * bd.b], [fb, a + m * bd.b, (bd.N - m) * bd.b, -m * bd.b]].forEach(([f, x, len, d]) => {
      const col = bd.k === "r" ? `rgb(${v(d)},128,0)` : `rgb(128,${v(d)},0)`;
      if (bd.k === "r") { f.setAttribute("x", x); f.setAttribute("y", c); f.setAttribute("width", len); f.setAttribute("height", bd.b); }
      else { f.setAttribute("x", c); f.setAttribute("y", x); f.setAttribute("width", bd.b); f.setAttribute("height", len); }
      f.setAttribute("flood-color", col); f.setAttribute("flood-opacity", "1");
    });
  };
  // cube: band `bd` (now turned by n) is one turn into its next state; its "to" blocks are its current blocks one
  // along, wrapping round: output block k shows current block k + sign(n)
  const step = (bd, slot, n) => {
    const [fa, fb] = [slots.s[slot * 2], slots.s[slot * 2 + 1]];
    if (!n) { fa.setAttribute("flood-opacity", "0"); fb.setAttribute("flood-opacity", "0"); return; }
    const g = Math.sign(n), a = -pad + bd.i0 * bd.b, c = -pad + bd.j * bd.b, v = (d) => Math.round(255 * clamp(0.5 + d / bd.S));
    // the wrapping block: the last one (moving to lower indices) or the first
    const wrapAt = g > 0 ? a + (bd.N - 1) * bd.b : a, restAt = g > 0 ? a : a + bd.b;
    [[fa, wrapAt, bd.b, -g * (bd.N - 1) * bd.b], [fb, restAt, (bd.N - 1) * bd.b, g * bd.b]].forEach(([f, x, len, d]) => {
      if (bd.k === "r") { f.setAttribute("x", x); f.setAttribute("y", c); f.setAttribute("width", len); f.setAttribute("height", bd.b); f.setAttribute("flood-color", `rgb(${v(d)},128,0)`); }
      else { f.setAttribute("x", c); f.setAttribute("y", x); f.setAttribute("width", bd.b); f.setAttribute("height", len); f.setAttribute("flood-color", `rgb(128,${v(d)},0)`); }
      f.setAttribute("flood-opacity", "1");
    });
  };
  // the turn: angle e (0 to 1 of a quarter turn), the incoming face on the side the blocks come from
  const turn = (k, g, e, b) => {
    const th = e * Math.PI / 2, sn = Math.sin(th), cs = Math.cos(th), wB = b * sn / (sn + cs);
    if (wB < 0.5) { stripe.setAttribute("flood-opacity", "0"); }
    else {
      const off = g > 0 ? b - wB : 0; // moving to lower indices: the next block turns in from the far side
      stripe.setAttribute("flood-opacity", "1");
      if (k === "r") { stripe.setAttribute("x", -pad + off); stripe.setAttribute("y", -pad); stripe.setAttribute("width", wB); stripe.setAttribute("height", b); }
      else { stripe.setAttribute("x", -pad); stripe.setAttribute("y", -pad + off); stripe.setAttribute("width", b); stripe.setAttribute("height", wB); }
    }
    shadeA.forEach((f) => f.setAttribute("slope", (1 - 0.2 * sn).toFixed(3)));
    shadeB.forEach((f) => f.setAttribute("slope", (0.8 + 0.2 * sn).toFixed(3)));
  };
  const scale = (k, S) => move[k] && move[k].setAttribute("scale", S);
  const reset = () => { [...slots.c, ...slots.r, ...slots.s].forEach((f) => f.setAttribute("flood-opacity", "0")); scale("c", 0); scale("r", 0); scale("s", 0); };
  return { id, svg: s, set, band, step, turn, scale, reset };
}

// ─── the puzzle plan: which rows and columns start turned on each pass, by how many blocks, and when they turn home ───
const POOL = 16, MAXBANDS = POOL / 2, TURN = 0.018, TURN3 = 0.04; // one block per turn: about 40ms flat, a quarter turn of about 90ms as a cube
function plan(w, h, pad, res, passT, cube) {
  const T = cube ? TURN3 : TURN;
  return res.map((b, i) => {
    if (i === res.length - 1) return [];
    const a = i === 0 ? PH.materialize[0] : passT[i], z = passT[i + 1], light = i > 0 && i === res.length - 2;
    // cube turns run one axis at a time, every band of it the same way round and in step, like a Rubik's layer
    const axes = i === 0 || (light && !cube) ? ["r", "c"] : [i % 2 ? "c" : "r"], out = [];
    axes.forEach((k) => {
      // cells along the turn (the band wraps within them) and the bands across it; only whole cells inside the
      // element turn, so no block of the UI ever lands on the shadow outside its edge
      const along = k === "r" ? w : h, across = k === "r" ? h : w;
      const i0 = Math.ceil(pad / b), N = Math.floor((pad + along) / b) - i0, j0 = Math.ceil(pad / b), nb = Math.floor((pad + across) / b) - j0;
      if (N < 3) return;
      const count = Math.min(light ? 3 : MAXBANDS, Math.max(1, Math.round(nb * 0.6)));
      const pick = Array.from({ length: nb }, (_, j) => j0 + j).sort((x, y) => hashN(x * 5.3 + b + (k === "r" ? 0 : 3.7)) - hashN(y * 5.3 + b + (k === "r" ? 0 : 3.7))).slice(0, count);
      const maxN = i === 0 ? 3 : light || cube ? 1 : 2, way = hashN(b * 2.7 + (k === "r" ? 1 : 2)) < 0.5 ? -1 : 1;
      pick.forEach((j, s) => {
        const r1 = hashN(j * 9.7 + b * 1.3 + (k === "r" ? 0 : 50)), r2 = hashN(j * 3.1 + b * 7.7 + (k === "r" ? 20 : 70));
        const n0 = (cube ? way : r1 < 0.5 ? -1 : 1) * Math.min(N - 1, 1 + Math.floor(r2 * maxN));
        // pass one: rows turn home first, then columns; later passes turn early in the pass so they land before the next
        let ps = i === 0 ? (k === "r" ? lerp(0.08, cube ? 0.14 : 0.26, r2) : lerp(cube ? 0.29 : 0.22, cube ? 0.34 : 0.36, r1)) : a + (z - a) * (cube ? 0.02 : 0.05 + 0.4 * hashN(j * 4.1 + b));
        if (cube) ps = Math.ceil(ps / T) * T; // on the shared beat, so every turning band is at the same angle
        out.push({ k, b, i0, N, j, n0, ps, T, slot: s, S: 2 * N * b + 4 });
      });
    });
    return out;
  });
}
const turned = (bd, p) => (p < bd.ps ? bd.n0 : Math.sign(bd.n0) * Math.max(0, Math.abs(bd.n0) - Math.floor((p - bd.ps) / TURN) - 1));
// cube: whole turns done so far (the band's state) and how far into the current quarter turn it is
const turnedCube = (bd, p) => {
  if (p < bd.ps) return { n: bd.n0, e: 0 };
  const q = (p - bd.ps) / bd.T, done = Math.floor(q), n = Math.sign(bd.n0) * Math.max(0, Math.abs(bd.n0) - done);
  return { n, e: n ? q - done : 0 };
};

// ─── HUD canvas over the element: grid, turning bands, brackets, markers, readouts ───
function makeHud(el, w, h, opts) {
  const R = el.getBoundingClientRect(), M = 40, dpr = Math.min(2, devicePixelRatio || 1);
  const layer = document.createElement("div");
  layer.className = "t-pxg" + (opts.mode === "pixel-texts" ? " t-pxg--texts" : "");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, { left: (R.left + scrollX - M) + "px", top: (R.top + scrollY - M) + "px", width: (w + 2 * M) + "px", height: (h + 2 * M) + "px" });
  const cv = document.createElement("canvas");
  cv.width = Math.round((w + 2 * M) * dpr); cv.height = Math.round((h + 2 * M) * dpr);
  cv.style.width = (w + 2 * M) + "px"; cv.style.height = (h + 2 * M) + "px";
  layer.appendChild(cv); document.body.appendChild(layer);
  const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
  return { layer, cv, ctx, M, R };
}

// a mask that shows only the blocks that have materialised (scan front from the top, scattered ahead of it)
function maskURL(mc, w, h, b, p, pad) {
  // drawn at the element's own size (a scaled-up tiny mask would blur the block edges); the grid lines up with the filter's
  const W = Math.ceil(w + 2 * pad), H = Math.ceil(h + 2 * pad), cols = Math.ceil(W / b), rows = Math.ceil(H / b);
  if (mc.width !== W || mc.height !== H) { mc.width = W; mc.height = H; }
  const g = mc.getContext("2d"); g.clearRect(0, 0, W, H); g.fillStyle = "#000";
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const y = (r + 0.5) / rows, n = hashN(c * 12.9898 + r * 78.233 + b * 3.1);
    if (n * 0.55 + y * 0.45 < p * 1.12) g.fillRect(c * b, r * b, b, b); // the front sweeps down; noise lets blocks pop in ahead of it
  }
  return mc.toDataURL();
}

export function generate(el, options = {}) {
  const opts = Object.assign({}, DEFAULTS, options);
  if (typeof el === "string") el = document.querySelector(el);
  if (!el) throw new Error("UIPixelGeneration: no element");
  if (el.__tPxg) el.__tPxg.cancel();
  const prevOpacity = el.__tPxgOpacity !== undefined ? el.__tPxgOpacity : el.style.opacity;
  const prev = { opacity: prevOpacity, filter: el.style.filter, mask: el.style.maskImage, wmask: el.style.webkitMaskImage, msize: el.style.maskSize, mpos: el.style.maskPosition, mrep: el.style.maskRepeat, transition: el.style.transition };
  const restore = () => {
    Object.assign(el.style, { opacity: prev.opacity, filter: prev.filter, maskImage: prev.mask, webkitMaskImage: prev.wmask, maskSize: prev.msize, webkitMaskSize: prev.msize, maskPosition: prev.mpos, webkitMaskPosition: prev.mpos, maskRepeat: prev.mrep, webkitMaskRepeat: prev.mrep, transition: prev.transition });
  };
  let resolve, raf = 0, timer = 0, F = null, HUD = null, stopped = false;
  const finished = new Promise((r) => (resolve = r));
  const finish = () => { if (stopped) return; stopped = true; cancelAnimationFrame(raf); clearTimeout(timer); if (F) F.svg.remove(); if (HUD) HUD.layer.remove(); restore(); el.__tPxg = null; if (opts.onDone) opts.onDone(el); resolve(el); };
  const run = { finished, cancel: finish, element: el };
  el.__tPxg = run;

  if (reduced()) {
    el.style.opacity = 0;
    timer = setTimeout(() => { el.style.transition = "opacity 200ms ease-out"; el.style.opacity = prev.opacity || ""; timer = setTimeout(finish, 220); }, opts.delay);
    return run;
  }
  el.style.opacity = 0;
  timer = setTimeout(() => requestAnimationFrame(() => {
    if (stopped) return;
    try { start(); } catch (e) { console.warn("UIPixelGeneration: could not start, showing the element", e); finish(); }
  }), opts.delay);

  function start() {
    const w = el.offsetWidth, h = el.offsetHeight, pad = 48, D = Math.max(800, +opts.duration || DEFAULTS.duration);
    const res = opts.resolutions.slice(), mc = document.createElement("canvas");
    const cube = opts.motion === "cube";
    F = makeFilter(el, w, h, pad, cube); HUD = makeHud(el, w, h, opts);
    const line = css(el, "--pxg-line", "#9a9a9a"), strong = css(el, "--pxg-strong", "#6c6c6c"), flash = css(el, "--pxg-flash", "rgba(255,255,255,0.75)");
    // the element: pixelated through the filter, its blocks masked in as they materialise (the mask also covers its shadow)
    Object.assign(el.style, { filter: `url(#${F.id})`, maskRepeat: "no-repeat", webkitMaskRepeat: "no-repeat",
      maskSize: `${w + 2 * pad}px ${h + 2 * pad}px`, webkitMaskSize: `${w + 2 * pad}px ${h + 2 * pad}px`, maskPosition: `${-pad}px ${-pad}px`, webkitMaskPosition: `${-pad}px ${-pad}px` });
    // texts
    let logEl = null, stepEl = null;
    if (opts.mode === "pixel-texts") {
      // the log goes left of the element and the step line under it, only where the page is empty
      const r = el.getBoundingClientRect();
      logEl = document.createElement("div"); logEl.className = "t-pxg-log"; HUD.layer.appendChild(logEl);
      if (!isFree(el, r.left - 230, r.top, r.left - 8, r.bottom)) logEl.style.display = "none";
      stepEl = document.createElement("div"); stepEl.className = "t-pxg-steps"; HUD.layer.appendChild(stepEl);
      if (!isFree(el, r.left, r.bottom + 12, r.right, r.bottom + 44)) stepEl.style.display = "none";
      stepEl.innerHTML = [...opts.steps, opts.done].map(() => `<div class="t-pxg-step"><i></i><span></span></div>`).join("");
      [...stepEl.children].forEach((d, i) => (d.lastChild.textContent = [...opts.steps, opts.done][i]));
    }
    // resolution passes across the passes phase; the first block size also covers the materialise phase
    const passT = res.map((_, i) => lerp(PH.passes[0], PH.passes[1], i / res.length));
    const plans = plan(w, h, pad, res, passT, cube);
    let lastB = 0, lastMaskKey = "", lastPi = -1, t0 = performance.now();
    const tick = (now) => {
      if (stopped) return;
      const t = now - t0, p = t / D;
      const pi = Math.max(0, passT.filter((x) => p >= x).length - 1), crisp = p >= PH.passes[1];
      const b = crisp ? 1 : res[pi];
      // the filter: the current block size (none once crisp)
      if (b !== lastB) { lastB = b; if (b > 1) F.set(b); el.style.filter = b > 1 ? `url(#${F.id})` : prev.filter; }
      // the mask: blocks materialise during the first phase; all in after it
      const mp = SMOOTH_OUT(win(PH.materialize, p)), mb = res[0];
      const key = mp >= 1 ? "all" : Math.round(mp * 60) + "";
      if (key !== lastMaskKey) {
        lastMaskKey = key;
        if (mp >= 1) { el.style.maskImage = el.style.webkitMaskImage = prev.mask || ""; }
        else { const u = `url(${maskURL(mc, w, h, mb, mp, pad)})`; el.style.maskImage = el.style.webkitMaskImage = u; }
      }
      // the puzzle: this pass's turned rows and columns step home one block at a time
      if (pi !== lastPi) { lastPi = pi; F.reset(); (plans[pi] || []).forEach((bd) => { bd.last = 0; bd.moving = false; bd.stepN = 0; }); }
      const live = { r: 0, c: 0, s: 0 };
      let spin = null;
      if (!crisp) (plans[pi] || []).forEach((bd) => {
        const { n, e } = cube ? turnedCube(bd, p) : { n: turned(bd, p), e: 0 };
        if (n) live[bd.k] = bd.S;
        if (n !== bd.last) { bd.last = n; F.band(bd, bd.slot, n); }
        // cube: a band mid-turn gets its next state and the shared angle (one axis turns at a time)
        const moving = cube && p >= bd.ps && n !== 0;
        if (cube && moving !== bd.moving) { bd.moving = moving; F.step(bd, bd.slot, moving ? n : 0); }
        else if (moving && n !== bd.stepN) F.step(bd, bd.slot, n);
        bd.stepN = moving ? n : 0;
        if (moving) { live.s = Math.max(live.s, bd.S); if (!spin) spin = { k: bd.k, g: Math.sign(n), e, b: bd.b }; }
      });
      F.scale("r", live.r); F.scale("c", live.c);
      if (cube) { F.scale("s", live.s); if (spin) F.turn(spin.k, spin.g, smooth(0, 1, spin.e), spin.b); else F.turn("r", 1, 0, b); }
      el.style.opacity = p < PH.materialize[0] ? 0 : "";
      hud(p, t, b, pi, mp, crisp);
      if (logEl) texts(p, pi, crisp);
      if (p >= 1) return finish();
      raf = requestAnimationFrame(tick);
    };
    const hud = (p, t, b, pi, mp, crisp) => {
      const { ctx, M } = HUD, W = w + 2 * M, H = h + 2 * M;
      ctx.clearRect(0, 0, W, H);
      const show = smooth(PH.hud[0], PH.hud[1], p) * (1 - smooth(PH.settle[0], PH.settle[1], p));
      if (show <= 0) return;
      ctx.save(); ctx.translate(M, M);
      // pixel grid at the current block size, on the filter's own block edges
      const g0 = ((-pad % b) + b) % b;
      if (!crisp && b >= 3) {
        ctx.globalAlpha = 0.22 * show; ctx.strokeStyle = line; ctx.lineWidth = 0.5; ctx.beginPath();
        for (let x = g0; x <= w; x += b) { ctx.moveTo(x + 0.25, 0); ctx.lineTo(x + 0.25, h); }
        for (let y = g0; y <= h; y += b) { ctx.moveTo(0, y + 0.25); ctx.lineTo(w, y + 0.25); }
        ctx.stroke();
      }
      // turning bands: brackets on the ends of the row or column while it turns, a flash on every block step,
      // chevrons outside the edge it turns towards and its label (R07, C03)
      if (!crisp) (plans[pi] || []).forEach((bd) => {
        const turns = Math.abs(bd.n0), q = (p - bd.ps) / (turns * bd.T);
        if (q < 0 || q > 1.25) return;
        const fade = q > 1 ? 1 - (q - 1) / 0.25 : 1, st = (p - bd.ps) / bd.T, fl = q > 1 || cube ? 0 : 1 - (st - Math.floor(st));
        const a = Math.max(0, -pad + bd.i0 * bd.b), c0 = -pad + bd.j * bd.b, row = bd.k === "r";
        const z = Math.min(row ? w : h, -pad + (bd.i0 + bd.N) * bd.b), u0 = Math.max(0, c0), u1 = Math.min(row ? h : w, c0 + bd.b);
        if (u1 <= u0) return;
        const [x, y, rw, rh] = row ? [a, u0, z - a, u1 - u0] : [u0, a, u1 - u0, z - a];
        ctx.save();
        ctx.globalAlpha = 0.3 * fl * fade * show; ctx.fillStyle = flash; ctx.fillRect(x, y, rw, rh);
        // cube: a bright edge where each block's two faces meet
        if (cube && q < 1) {
          const e = smooth(0, 1, st - Math.floor(st)), th = e * Math.PI / 2, wB = bd.b * Math.sin(th) / (Math.sin(th) + Math.cos(th));
          if (wB > 0.5 && wB < bd.b - 0.5) {
            const g = Math.sign(bd.n0), off = g > 0 ? bd.b - wB : wB, n = Math.round((row ? rw : rh) / bd.b);
            ctx.globalAlpha = 0.8 * fade * show * Math.sin(th * 2); ctx.fillStyle = flash;
            for (let k = 0; k < n; k++) { const at = (row ? x : y) + k * bd.b + off; if (row) ctx.fillRect(at - 0.5, y, 1, rh); else ctx.fillRect(x, at - 0.5, rw, 1); }
          }
        }
        // brackets on the band's two ends
        const L3 = Math.min(6, bd.b * 0.4);
        ctx.globalAlpha = 0.85 * fade * show; ctx.strokeStyle = strong; ctx.lineWidth = 1; ctx.beginPath();
        [[x, y, 1, 1], [x + rw, y, -1, 1], [x + rw, y + rh, -1, -1], [x, y + rh, 1, -1]].forEach(([px, py, dx, dy]) => { ctx.moveTo(px + 0.5 * dx, py + dy * L3); ctx.lineTo(px + 0.5 * dx, py + 0.5 * dy); ctx.lineTo(px + dx * L3, py + 0.5 * dy); });
        ctx.stroke();
        // content slides towards the lower index when n0 > 0
        const dir = -Math.sign(bd.n0), mid = (u0 + u1) / 2, edge = dir < 0 ? -9 : (row ? w : h) + 9;
        ctx.beginPath();
        for (let k = 0; k < 2; k++) {
          const e = edge + dir * k * 4;
          if (row) { ctx.moveTo(e - dir * 3, mid - 3); ctx.lineTo(e, mid); ctx.lineTo(e - dir * 3, mid + 3); }
          else { ctx.moveTo(mid - 3, e - dir * 3); ctx.lineTo(mid, e); ctx.lineTo(mid + 3, e - dir * 3); }
        }
        ctx.stroke();
        ctx.fillStyle = strong; ctx.font = `500 7.5px ${css(el, "--pxg-font", "ui-monospace, SFMono-Regular, Menlo, monospace")}`; ctx.textBaseline = "middle";
        const label = (row ? "R" : "C") + String(bd.j).padStart(2, "0");
        if (row) { ctx.textAlign = dir < 0 ? "right" : "left"; ctx.fillText(label, edge + dir * 10, mid); }
        else { ctx.textAlign = "center"; ctx.fillText(label, mid, edge + dir * 12); }
        ctx.restore();
      });
      // generation lines: dotted guides along the edges, running past the corners, drawn out from each corner
      const gq = SMOOTH_OUT(win([0.02, 0.22], p)), E = 22;
      ctx.save(); ctx.globalAlpha = 0.55 * show; ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([1, 4]); ctx.lineCap = "round"; ctx.beginPath();
      [[-E, 0, w + E, 0], [w, -E, w, h + E], [w + E, h, -E, h], [0, h + E, 0, -E]].forEach(([x1, y1, x2, y2]) => { ctx.moveTo(x1, y1); ctx.lineTo(lerp(x1, x2, gq), lerp(y1, y2, gq)); });
      ctx.stroke(); ctx.restore();
      // ruler: a tick every block along the top and left edges, a coordinate every 64px
      if (!crisp) {
        ctx.save(); ctx.globalAlpha = 0.6 * show * gq; ctx.fillStyle = strong;
        for (let x = g0; x <= w; x += b) ctx.fillRect(x - 0.25, -4, 0.5, x % 64 < b ? 4 : 2);
        for (let y = g0; y <= h; y += b) ctx.fillRect(-4, y - 0.25, y % 64 < b ? 4 : 2, 0.5);
        ctx.restore();
      }
      // incoming pixels: tiny squares fly in from around the element and land where blocks are appearing
      if (p < PH.materialize[1] + 0.02) {
        ctx.save(); ctx.fillStyle = strong;
        for (let k = 0; k < 42; k++) {
          const s0 = PH.materialize[0] + (k / 42) * (PH.materialize[1] - PH.materialize[0] - 0.08), s1 = s0 + 0.09, q = clamp((p - s0) / (s1 - s0));
          if (q <= 0 || q >= 1) continue;
          const cb = res[0], tx = Math.floor(hashN(k * 4.3) * (w / cb)) * cb + cb / 2, ty = SMOOTH_OUT(win(PH.materialize, s1)) * h;
          const ang = hashN(k * 7.9) * Math.PI * 2, dist = 40 + 60 * hashN(k * 2.2), e = SMOOTH_OUT(q), sz = 2 + Math.round(hashN(k * 5.5) * 2);
          ctx.globalAlpha = show * Math.min(1, q * 4) * (1 - smooth(0.85, 1, q));
          ctx.fillRect(Math.round(lerp(tx + Math.cos(ang) * dist, tx, e)) - sz / 2, Math.round(lerp(ty + Math.sin(ang) * dist, ty, e)) - sz / 2, sz, sz);
        }
        ctx.restore();
      }
      // "+" markers flickering at block corners across the element
      if (!crisp && b >= 5 && p > PH.materialize[0] + 0.04) {
        ctx.save(); ctx.strokeStyle = strong; ctx.lineWidth = 1; ctx.globalAlpha = 0.7 * show; ctx.beginPath();
        const fl = Math.floor(t / 90), nc = Math.floor((w - g0) / b) + 1, nr = Math.floor((h - g0) / b) + 1;
        for (let i = 0; i < 9; i++) {
          const x = g0 + Math.floor(hashN(i * 3.3 + fl * 1.7) * nc) * b, y = g0 + Math.floor(hashN(i * 7.7 + fl * 2.9) * nr) * b;
          ctx.moveTo(x - 2.5, y); ctx.lineTo(x + 2.5, y); ctx.moveTo(x, y - 2.5); ctx.lineTo(x, y + 2.5);
        }
        ctx.stroke(); ctx.restore();
      }
      // targeting: a bracket locks onto a block with its coordinates, jumping to a new block every 160ms
      if (!crisp && p > PH.materialize[0] + 0.06) {
        const jt = Math.floor(t / 160), cb = Math.max(b, 5), nc = Math.max(1, Math.floor((w - g0) / cb)), nr = Math.max(1, Math.floor((h - g0) / cb));
        const tc = Math.floor(hashN(jt * 6.1) * nc), tr = Math.floor(hashN(jt * 2.9 + 4) * Math.min(nr, Math.ceil(nr * Math.max(0.2, mp))));
        const bx = g0 + tc * cb, by = g0 + tr * cb, L2 = Math.max(3, cb * 0.35);
        ctx.save(); ctx.globalAlpha = show; ctx.strokeStyle = strong; ctx.lineWidth = 1.2; ctx.beginPath();
        [[bx, by, 1, 1], [bx + cb, by, -1, 1], [bx + cb, by + cb, -1, -1], [bx, by + cb, 1, -1]].forEach(([x, y, dx, dy]) => { ctx.moveTo(x, y + dy * L2); ctx.lineTo(x, y); ctx.lineTo(x + dx * L2, y); });
        ctx.stroke();
        ctx.globalAlpha = 0.9 * show; ctx.fillStyle = strong;
        ctx.font = `500 7.5px ${css(el, "--pxg-font", "ui-monospace, SFMono-Regular, Menlo, monospace")}`; ctx.textBaseline = "bottom";
        ctx.textAlign = bx + cb + 30 > w ? "right" : "left";
        ctx.fillText(`${String(tc).padStart(2, "0")}:${String(tr).padStart(2, "0")}`, bx + cb + 30 > w ? bx + cb : bx, by - 3);
        ctx.restore();
      }
      // corner brackets and readouts
      ctx.globalAlpha = show; ctx.strokeStyle = strong; ctx.lineWidth = 1.2; ctx.lineCap = "round";
      const L = 10, o = -6; ctx.beginPath();
      [[o, o, 1, 1], [w - o, o, -1, 1], [w - o, h - o, -1, -1], [o, h - o, 1, -1]].forEach(([x, y, dx, dy]) => { ctx.moveTo(x, y + dy * L); ctx.lineTo(x, y); ctx.lineTo(x + dx * L, y); });
      ctx.stroke();
      ctx.font = `500 9px ${css(el, "--pxg-font", "ui-monospace, SFMono-Regular, Menlo, monospace")}`; ctx.fillStyle = strong; ctx.textBaseline = "bottom";
      const cols = Math.ceil(w / Math.max(1, b)), rows = Math.ceil(h / Math.max(1, b));
      ctx.fillText(`RES ${String(crisp ? 1 : b).padStart(2, "0")}PX   ${cols}×${rows}   PASS ${Math.min(pi + 1, opts.resolutions.length)}/${opts.resolutions.length}`, 0, o - 22);
      ctx.textAlign = "right"; ctx.fillText(`${Math.round(Math.min(1, p) * 100)}%`, w, o - 22);
      ctx.restore();
    };
    const texts = (p, pi, crisp) => {
      const vis = smooth(0.03, 0.12, p) * (1 - smooth(0.92, 1, p));
      logEl.style.opacity = vis.toFixed(3);
      const rows = [];
      opts.resolutions.forEach((rb, i) => {
        if (p < passT[i] && !(i === 0 && p > PH.materialize[0])) return;
        const done = i < pi || crisp, blocks = Math.ceil(w / rb) * Math.ceil(h / rb);
        rows.push(`PASS ${String(i + 1).padStart(2, "0")}  ${String(rb).padStart(2, " ")}PX  ${String(blocks).padStart(5, " ")} BLOCKS  ${done ? "[ ok ]" : "[ .. ]"}`);
      });
      const html = `<div class="t-pxg-log-head">RENDER.LOG // ${w}×${h}</div>` + rows.map((r) => `<div>${r}</div>`).join("");
      if (logEl.__h !== html) { logEl.__h = html; logEl.innerHTML = html; }
      const n = stepEl.children.length;
      [...stepEl.children].forEach((s, i) => {
        const a = i < n - 1 ? (i / (n - 1)) * 0.92 : 0.92, b = i < n - 1 ? ((i + 1) / (n - 1)) * 0.92 : Infinity;
        const qi = SMOOTH_OUT(clamp((p - a) / 0.06)), qo = SMOOTH_OUT(clamp((p - b) / 0.05)), q = qi * (1 - qo) * (1 - smooth(0.97, 1, p));
        s.style.opacity = q.toFixed(3); s.style.transform = `translate(-50%, ${(5 * (1 - qi) - 5 * qo).toFixed(2)}px)`;
        s.classList.toggle("is-done", i === n - 1);
      });
    };
    raf = requestAnimationFrame(tick);
  }
  return run;
}

export function auto(root = document) {
  const els = [...root.querySelectorAll("[data-t-pixel-generate]")].filter((e) => !e.__tPxgAuto);
  const play = (e) => generate(e, { mode: e.dataset.tPixelGenerate || "pixel", motion: e.dataset.tPixelGenerateMotion || "slide", duration: +e.dataset.tPixelGenerateDuration || undefined, delay: +e.dataset.tPixelGenerateDelay || 0 });
  els.forEach((e) => { e.__tPxgAuto = true; e.__tPxgOpacity = e.style.opacity; e.style.opacity = 0; });
  if (!("IntersectionObserver" in window)) { els.forEach(play); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); play(en.target); } }), { threshold: 0.35 });
  els.forEach((e) => io.observe(e));
}

if (typeof window !== "undefined") window.UIPixelGeneration = { generate, auto };
