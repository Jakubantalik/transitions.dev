/*
 * transitions.dev / UI pixel generation
 *
 * Makes an element appear as if an agent is generating it pixel by pixel. Every pixel comes from the element's
 * own rendering: an SVG filter samples the real UI on a grid and blows each sample up into a block, so the colours,
 * images and text are the component's. Blocks materialise in a scattered, scan-led order, then the resolution
 * steps down (32px to 1px) with a scan sweep and flickering cells on every pass, until the real UI is crisp.
 *
 * Modes
 *   "pixel"         the pixel build with its HUD (corner brackets, pixel grid, resolution readout)
 *   "pixel-texts"   the same, plus a render log of every pass and a step line
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
function makeFilter(el, w, h, pad) {
  const id = "t-pxg-" + ++N, host = el.getRootNode() instanceof ShadowRoot ? el.getRootNode() : document.body;
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("width", "0"); s.setAttribute("height", "0"); s.setAttribute("aria-hidden", "true");
  s.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  s.innerHTML = `<filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="avg"/>
    <feFlood x="0" y="0" width="1" height="1" flood-color="#000"/>
    <feComposite x="${-pad}" y="${-pad}" width="8" height="8"/>
    <feTile result="grid"/>
    <feComposite in="avg" in2="grid" operator="in"/>
    <feMorphology operator="dilate" radius="4" result="px"/>
    <feTurbulence type="fractalNoise" baseFrequency="0 0.045" numOctaves="1" seed="1" result="noise"/>
    <feColorMatrix in="noise" type="matrix" values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1" result="bands"/>
    <feDisplacementMap in="px" in2="bands" scale="0" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
  host.appendChild(s);
  const [avg, flood, cell, , , grow, noise, , shift] = s.querySelector("filter").children;
  let B = 8;
  // block size b: the UI blurred to about a block's average, sampled at the middle of each b × b cell,
  // then dilated back to the full cell (a real downscale, so each block carries its area's colour)
  const set = (b) => {
    B = b;
    avg.setAttribute("stdDeviation", (b * 0.32).toFixed(2));
    flood.setAttribute("x", -pad + Math.floor(b / 2)); flood.setAttribute("y", -pad + Math.floor(b / 2));
    cell.setAttribute("width", b); cell.setAttribute("height", b);
    grow.setAttribute("radius", (b / 2).toFixed(2));
  };
  // the pixels move: the sample point drifts inside its cell (blocks shimmer and shift), and horizontal bands
  // of blocks slip sideways (a displacement driven by noise that only varies down the element)
  const motion = (jx, jy, glitch, seed) => {
    flood.setAttribute("x", -pad + Math.floor(B / 2) + jx); flood.setAttribute("y", -pad + Math.floor(B / 2) + jy);
    noise.setAttribute("seed", seed); shift.setAttribute("scale", glitch.toFixed(2));
  };
  return { id, svg: s, set, motion };
}

// ─── HUD canvas over the element: grid, flicker cells, scan line, brackets, readouts ───
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
    F = makeFilter(el, w, h, pad); HUD = makeHud(el, w, h, opts);
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
    let lastB = 0, lastMaskKey = "", lastStep = -1, t0 = performance.now();
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
      // pixel motion, stepped like a renderer's frames (every 70ms), strongest early and gone by the last pass
      const step = Math.floor(t / 70);
      if (b > 1 && step !== lastStep) {
        lastStep = step;
        const amp = 1 - smooth(0.3, 0.88, p), r1 = hashN(step * 1.7), r2 = hashN(step * 2.3 + 5), r3 = hashN(step * 3.1 + 9);
        F.motion(Math.round((r1 - 0.5) * b * 0.7 * amp), Math.round((r2 - 0.5) * b * 0.4 * amp), b * 2.4 * amp * (r3 > 0.55 ? 1 : 0.2), step % 97);
      }
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
      // pixel grid at the current block size, brightest where the scan front is
      if (!crisp && b >= 3) {
        ctx.globalAlpha = 0.22 * show; ctx.strokeStyle = line; ctx.lineWidth = 0.5; ctx.beginPath();
        for (let x = 0; x <= w; x += b) { ctx.moveTo(x + 0.25, 0); ctx.lineTo(x + 0.25, h); }
        for (let y = 0; y <= h; y += b) { ctx.moveTo(0, y + 0.25); ctx.lineTo(w, y + 0.25); }
        ctx.stroke();
      }
      // a scan sweep on each pass (and the materialise front), with cells flickering just behind it
      const passStart = pi >= 0 ? lerp(PH.passes[0], PH.passes[1], pi / opts.resolutions.length) : 0;
      const sq = p < PH.passes[0] ? mp : SMOOTH_OUT(clamp((p - passStart) / ((PH.passes[1] - PH.passes[0]) / opts.resolutions.length)));
      const sy = sq * h;
      if (sq > 0 && sq < 1) {
        const g = ctx.createLinearGradient(0, sy - 26, 0, sy);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, flash);
        ctx.globalAlpha = 0.35 * show; ctx.fillStyle = g; ctx.fillRect(0, sy - 26, w, 26);
        ctx.globalAlpha = 0.9 * show; ctx.fillStyle = strong; ctx.fillRect(-14, sy - 0.5, w + 28, 1);
        ctx.fillRect(-3, sy - 3, 6, 6); ctx.fillRect(w - 3, sy - 3, 6, 6);
        const cs = Math.max(3, b), tick = Math.floor(t / 70);
        for (let i = 0; i < 26; i++) {
          const x = Math.floor(hashN(i * 3.7 + tick) * (w / cs)) * cs, y = sy - cs - Math.floor(hashN(i * 9.1 + tick * 1.3) * 4) * cs;
          if (y < 0) continue;
          ctx.globalAlpha = (0.25 + 0.5 * hashN(i + tick)) * show; ctx.fillStyle = flash; ctx.fillRect(x, y, cs, cs);
        }
      }
      // generation lines: dotted guides along the edges, running past the corners, drawn out from each corner
      const gq = SMOOTH_OUT(win([0.02, 0.22], p)), E = 22;
      ctx.save(); ctx.globalAlpha = 0.55 * show; ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.setLineDash([1, 4]); ctx.lineCap = "round"; ctx.beginPath();
      [[-E, 0, w + E, 0], [w, -E, w, h + E], [w + E, h, -E, h], [0, h + E, 0, -E]].forEach(([x1, y1, x2, y2]) => { ctx.moveTo(x1, y1); ctx.lineTo(lerp(x1, x2, gq), lerp(y1, y2, gq)); });
      ctx.stroke(); ctx.restore();
      // ruler: a tick every block along the top and left edges, a coordinate every 64px
      if (!crisp) {
        ctx.save(); ctx.globalAlpha = 0.6 * show * gq; ctx.fillStyle = strong;
        for (let x = 0; x <= w; x += b) ctx.fillRect(x - 0.25, -4, 0.5, x % 64 < b ? 4 : 2);
        for (let y = 0; y <= h; y += b) ctx.fillRect(-4, y - 0.25, y % 64 < b ? 4 : 2, 0.5);
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
      // "+" markers flickering at grid points around the scan line
      if (sq > 0 && sq < 1 && b >= 5) {
        ctx.save(); ctx.strokeStyle = strong; ctx.lineWidth = 1;
        const row0 = Math.max(0, Math.floor(sy / b) - 3), fl = Math.floor(t / 90);
        for (let r = row0; r <= row0 + 4; r++) for (let c = 0; c <= Math.ceil(w / b); c++) {
          if (hashN(c * 3.3 + r * 7.7 + fl) > 0.16) continue;
          const x = c * b, y = r * b; if (y > h) continue;
          ctx.globalAlpha = 0.7 * show; ctx.beginPath(); ctx.moveTo(x - 2.5, y); ctx.lineTo(x + 2.5, y); ctx.moveTo(x, y - 2.5); ctx.lineTo(x, y + 2.5); ctx.stroke();
        }
        ctx.restore();
      }
      // targeting: a bracket locks onto a block behind the scan line, joined to the readout by an elbow line,
      // with the block's coordinates; it jumps to a new block every 160ms
      if (!crisp && sq > 0.05) {
        const jt = Math.floor(t / 160), cb = Math.max(b, 5), cols2 = Math.max(1, Math.floor(w / cb));
        const tc = Math.floor(hashN(jt * 6.1) * cols2), tr = Math.max(0, Math.floor(sy / cb) - 1 - Math.floor(hashN(jt * 2.9) * 3));
        const bx = tc * cb, by = tr * cb, L2 = Math.max(3, cb * 0.35);
        ctx.save(); ctx.globalAlpha = show; ctx.strokeStyle = strong; ctx.lineWidth = 1.2; ctx.beginPath();
        [[bx, by, 1, 1], [bx + cb, by, -1, 1], [bx + cb, by + cb, -1, -1], [bx, by + cb, 1, -1]].forEach(([x, y, dx, dy]) => { ctx.moveTo(x, y + dy * L2); ctx.lineTo(x, y); ctx.lineTo(x + dx * L2, y); });
        ctx.stroke();
        ctx.globalAlpha = 0.6 * show; ctx.lineWidth = 1; ctx.setLineDash([1, 3]); ctx.beginPath();
        ctx.moveTo(bx + cb / 2, by); ctx.lineTo(bx + cb / 2, -14); ctx.lineTo(Math.min(w, bx + cb / 2 + 26), -14); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 0.9 * show; ctx.fillStyle = strong;
        ctx.font = `500 7.5px ${css(el, "--pxg-font", "ui-monospace, SFMono-Regular, Menlo, monospace")}`; ctx.textBaseline = "middle";
        ctx.fillText(`${String(tc).padStart(2, "0")}:${String(tr).padStart(2, "0")}`, Math.min(w - 24, bx + cb / 2 + 30), -14);
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
  const play = (e) => generate(e, { mode: e.dataset.tPixelGenerate || "pixel", duration: +e.dataset.tPixelGenerateDuration || undefined, delay: +e.dataset.tPixelGenerateDelay || 0 });
  els.forEach((e) => { e.__tPxgAuto = true; e.__tPxgOpacity = e.style.opacity; e.style.opacity = 0; });
  if (!("IntersectionObserver" in window)) { els.forEach(play); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); play(en.target); } }), { threshold: 0.35 });
  els.forEach((e) => io.observe(e));
}

if (typeof window !== "undefined") window.UIPixelGeneration = { generate, auto };
