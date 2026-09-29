/* Brand mark hover: the logo build from the Transitions Agent launch
   video's end card, run on the site's own mark.

   The video (transitions-agent-video/video.html, logoAt) builds the
   symbol from a dot: the dot stretches into the three centre arms, one
   wavefront travels out from the hub drawing each spoke and then its
   arrow head, and the whole symbol turns in from -90deg while scaling
   up from 0.42. On hover the mark folds that build back 40% of the way
   (the arrow heads tuck in, the spokes shorten, the mark shrinks a
   little) while it starts to spin, then grows back out on the video's
   own timeline (its 1.5x logo speed). The spin is one full turn: it
   picks up speed through the fold, peaks at the turnaround and settles
   exactly as the regrowth lands.

   The resting mark is left exactly as authored. The script only splits
   the arrows path into its six arrows and adds the masks and arms the
   build needs, all inert until a hover, so nothing changes until the
   pointer arrives. Reduced motion: no animation. */
(function () {
  "use strict";
  if (window.tdevBrandMark) return;

  var NS = "http://www.w3.org/2000/svg";

  /* ── Easing: the video's bezier solver ─────────────────────────── */
  function bez(x1, y1, x2, y2) {
    function cx(t) { return 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t; }
    function cy(t) { return 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, m = 0;
      for (var i = 0; i < 40; i++) { m = (lo + hi) / 2; if (cx(m) < x) lo = m; else hi = m; }
      return cy(m);
    };
  }
  /* The video's RE, transitions.dev --ease. Its y handles are both 1, so
     y(t) = 1 - (1 - t)^3 and the inverse is closed form. */
  var E = bez(0.22, 1, 0.36, 1);
  function Einv(y) {
    if (y <= 0) return 0;
    if (y >= 1) return 1;
    var t = 1 - Math.cbrt(1 - y);
    return 3 * 0.22 * t * (1 - t) * (1 - t) + 3 * 0.36 * t * t * (1 - t) + t * t * t;
  }
  /* Collapse: moves off at once, lands softly on the dot. */
  var GATHER = bez(0.4, 0, 0.2, 1);
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, p) { return a + (b - a) * p; }

  /* ── Timeline (ms), the video's at its 1.5x logo speed ─────────── */
  var K = 1 / 1.5;
  var T_DOT = 260 * K;   // the dot has popped, the wavefront has not left
  var T_WAVE = 1250 * K; // wavefront travel, hub to the arrow tips
  var T_GROW = 1600 * K; // turn and scale settle
  var T_FADE = 450 * K;  // symbol fade-in
  var T_END = T_GROW;
  var W_FOLD = 0.6;      // fold back 40% of the wavefront's reach
  var FOLD_MS = 320;     // the fold, soft landing at the turnaround
  var SPIN_DEG = 360;    // one full turn across fold + regrowth

  /* ── Geometry from the mark's own paths ────────────────────────── */
  /* Absolute M/L/H/V/Z polygons (the brand paths use nothing else). */
  function polys(d) {
    if (/[^MLHVZ\d\s.,eE+-]/.test(d)) return null;
    var out = [], cur = null, x = 0, y = 0, re = /([MLHVZ])([^MLHVZ]*)/g, m;
    while ((m = re.exec(d))) {
      var c = m[1], n = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number), i;
      if (c === "M") { cur = []; out.push(cur); for (i = 0; i < n.length; i += 2) { x = n[i]; y = n[i + 1]; cur.push([x, y]); } }
      else if (c === "L") { for (i = 0; i < n.length; i += 2) { x = n[i]; y = n[i + 1]; cur.push([x, y]); } }
      else if (c === "H") { for (i = 0; i < n.length; i++) { x = n[i]; cur.push([x, y]); } }
      else if (c === "V") { for (i = 0; i < n.length; i++) { y = n[i]; cur.push([x, y]); } }
    }
    out.forEach(function (p) {
      var a = p[0], b = p[p.length - 1];
      if (p.length > 1 && Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4) p.pop();
    });
    return out;
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function unit(a, b) { var l = dist(a, b) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; }
  function add(a, v, k) { return [a[0] + v[0] * k, a[1] + v[1] * k]; }
  function f(n) { return (+n).toFixed(4); }

  /* The centre Y: its hub, stroke width, and the three arm directions. */
  function yGeom(p) {
    var hub = [0, 0];
    p.forEach(function (v) { hub[0] += v[0] / p.length; hub[1] += v[1] / p.length; });
    var idx = p.map(function (v, i) { return i; }).sort(function (a, b) { return dist(p[b], hub) - dist(p[a], hub); });
    var far = idx.slice(0, 6), n = p.length, pairs = [];
    far.forEach(function (i) {
      var j = (i + 1) % n;
      if (far.indexOf(j) !== -1) pairs.push([p[i], p[j]]);
    });
    if (pairs.length !== 3) return null;
    var w = dist(pairs[0][0], pairs[0][1]);
    var ends = pairs.map(function (pr) { return [(pr[0][0] + pr[1][0]) / 2, (pr[0][1] + pr[1][1]) / 2]; });
    var extent = dist(ends[0], hub);
    return { hub: hub, w: w, arm: extent - w / 2, dirs: ends.map(function (e) { return unit(hub, e); }) };
  }

  /* Each arrow: a spoke from its inner end out to the chevron's apex,
     and the chevron's two arms running along the hexagon edges. */
  function arrowGeom(list, Y) {
    var hub = Y.hub, apexIn = (Y.w / 2) / Math.sin(Math.PI / 3);
    var tips = list.map(function (p) {
      return p.reduce(function (best, v) { return dist(v, hub) > dist(best, hub) ? v : best; }, p[0]);
    });
    var ang = tips.map(function (t) { return Math.atan2(t[1] - hub[1], t[0] - hub[0]); });
    function gap(a, b) { return Math.abs(Math.atan2(Math.sin(ang[a] - ang[b]), Math.cos(ang[a] - ang[b]))); }
    return list.map(function (p, i) {
      var near = p.slice().sort(function (a, b) { return dist(a, hub) - dist(b, hub); });
      var inner = [(near[0][0] + near[1][0]) / 2, (near[0][1] + near[1][1]) / 2];
      var tip = tips[i], apex = add(tip, unit(tip, hub), apexIn);
      var nb = tips.map(function (t, j) { return j; }).filter(function (j) { return j !== i; })
        .sort(function (a, b) { return gap(a, i) - gap(b, i); }).slice(0, 2);
      var heads = nb.map(function (j) {
        var len = dist(tips[j], tip) * 0.42;
        return { a: apex, b: add(apex, unit(tip, tips[j]), len), L: len };
      });
      var rOut = dist(apex, hub);
      return {
        shaft: { a: inner, b: apex, L: dist(inner, apex) },
        heads: heads,
        rIn: dist(inner, hub),
        rOut: rOut,
        /* heads start just before their spoke lands, as in the video */
        s0: rOut - 1.2 * (Y.w / 2.9016),
        hL: Math.max(heads[0].L, heads[1].L)
      };
    });
  }

  /* ── Enhance one mark: split, add masks and arms (all inert) ───── */
  var seq = 0;
  function build(mark) {
    var svg = mark.querySelector("svg");
    if (!svg) return null;
    var paths = Array.prototype.filter.call(svg.children, function (c) { return c.tagName.toLowerCase() === "path"; });
    if (paths.length !== 2) return null;
    var arrowsP = polys(paths[0].getAttribute("d") || ""), yP = polys(paths[1].getAttribute("d") || "");
    if (!arrowsP || arrowsP.length !== 6 || !yP || yP.length !== 1) return null;
    var Y = yGeom(yP[0]);
    if (!Y) return null;
    var A = arrowGeom(arrowsP, Y);
    var id = "tdbm" + (++seq);
    var maskW = Y.w * (5.2 / 2.9016); // the video's mask stroke, to scale
    var dot = Y.w * (6.6 / 2.9016);   // the video's dot, to scale

    var fill = paths[0].getAttribute("fill") || "currentColor";
    var defs = document.createElementNS(NS, "defs");
    var all = document.createElementNS(NS, "g");
    all.style.transformBox = "view-box";
    all.style.transformOrigin = f(Y.hub[0]) + "px " + f(Y.hub[1]) + "px";

    var vb = (svg.getAttribute("viewBox") || "0 0 18 20.2947").split(/[\s,]+/).map(Number);
    var subs = (paths[0].getAttribute("d") || "").split(/(?=M)/).map(function (s) { return s.trim(); }).filter(Boolean);

    var arrows = A.map(function (g, i) {
      var mask = document.createElementNS(NS, "mask");
      mask.setAttribute("id", id + "-a" + i);
      mask.setAttribute("maskUnits", "userSpaceOnUse");
      mask.setAttribute("x", f(vb[0] - 6)); mask.setAttribute("y", f(vb[1] - 6));
      mask.setAttribute("width", f(vb[2] + 12)); mask.setAttribute("height", f(vb[3] + 12));
      var lines = [g.shaft].concat(g.heads).map(function (s) {
        var l = document.createElementNS(NS, "path");
        l.setAttribute("d", "M" + f(s.a[0]) + " " + f(s.a[1]) + " L" + f(s.b[0]) + " " + f(s.b[1]));
        l.setAttribute("fill", "none");
        l.setAttribute("stroke", "#fff");
        l.setAttribute("stroke-width", f(maskW));
        l.setAttribute("stroke-linecap", "round");
        l.style.strokeDasharray = f(s.L) + " " + f(s.L + 1);
        l.style.strokeDashoffset = f(s.L);
        l.style.visibility = "hidden";
        mask.appendChild(l);
        return { el: l, L: s.L };
      });
      defs.appendChild(mask);
      var el = document.createElementNS(NS, "path");
      el.setAttribute("d", subs[i]);
      el.setAttribute("fill", fill);
      el.setAttribute("fill-rule", "evenodd");
      el.setAttribute("clip-rule", "evenodd");
      all.appendChild(el);
      return { el: el, mask: "url(#" + id + "-a" + i + ")", shaft: lines[0], heads: [lines[1], lines[2]], g: g };
    });

    var yEl = paths[1];
    all.appendChild(yEl);
    var armsG = document.createElementNS(NS, "g");
    armsG.setAttribute("fill", "none");
    armsG.setAttribute("stroke", fill);
    armsG.setAttribute("stroke-linecap", "round");
    armsG.style.opacity = "0";
    var arms = Y.dirs.map(function (d) {
      var a = document.createElementNS(NS, "path");
      a.setAttribute("d", "M" + f(Y.hub[0]) + " " + f(Y.hub[1]) + " L" + f(Y.hub[0]) + " " + f(Y.hub[1]));
      armsG.appendChild(a);
      return { el: a, d: d };
    });
    all.appendChild(armsG);

    paths[0].remove();
    svg.setAttribute("overflow", "visible");
    svg.insertBefore(defs, svg.firstChild);
    svg.appendChild(all);

    var sMax = Math.max.apply(null, A.map(function (g) { return Math.max(g.rOut, g.s0 + g.hL); }));
    return { all: all, arrows: arrows, y: yEl, armsG: armsG, arms: arms, Y: Y, dot: dot, sMax: sMax,
             phase: "idle", t: T_END, raf: 0 };
  }

  /* ── One frame of the video's build at timeline time t ─────────── */
  function draw(line, q) {
    line.el.style.visibility = q > 0 ? "visible" : "hidden";
    line.el.style.strokeDashoffset = f(line.L * (1 - q));
  }
  function renderAt(S, t, rot) {
    var Y = S.Y;
    var s = E(clamp(t / T_GROW));
    var r = rot == null ? lerp(-90, 0, s) : rot;
    S.all.style.transform = "rotate(" + r.toFixed(3) + "deg) scale(" + lerp(0.42, 1, s).toFixed(4) + ")";
    S.all.style.opacity = E(clamp(t / T_FADE)).toFixed(3);
    var wave = E(clamp((t - T_DOT) / T_WAVE)) * S.sMax;
    /* the dot: three zero-length round-capped arms; as the wavefront
       passes they lengthen and thin to the stroke width, becoming the Y */
    var mp = clamp(wave / (Y.arm + Y.w / 2));
    var width = lerp(S.dot, Y.w, mp), len = Y.arm * mp, done = mp >= 0.999;
    S.arms.forEach(function (a) {
      a.el.setAttribute("d", "M" + f(Y.hub[0]) + " " + f(Y.hub[1]) + " L" + f(Y.hub[0] + a.d[0] * len) + " " + f(Y.hub[1] + a.d[1] * len));
    });
    S.armsG.setAttribute("stroke-width", f(width));
    S.armsG.style.opacity = done ? "0" : "1";
    S.y.style.opacity = done ? "1" : "0";
    /* each spoke draws outward as the wavefront reaches it, then flows
       on into its arrow head from the apex */
    S.arrows.forEach(function (ar) {
      var g = ar.g;
      var qs = clamp((wave - g.rIn) / (g.rOut - g.rIn));
      var qh = clamp((wave - g.s0) / g.hL);
      draw(ar.shaft, qs);
      draw(ar.heads[0], qh);
      draw(ar.heads[1], qh);
      ar.el.style.opacity = qs > 0 ? "1" : "0";
      if (qs >= 0.999 && qh >= 0.999) ar.el.removeAttribute("mask");
      else ar.el.setAttribute("mask", ar.mask);
    });
  }
  /* Back to the authored mark: no transform, no masks, the exact Y. */
  function rest(S) {
    renderAt(S, T_END);
    S.all.style.transform = "";
    S.all.style.opacity = "";
    S.arrows.forEach(function (ar) { ar.el.removeAttribute("mask"); ar.el.style.opacity = ""; });
    S.y.style.opacity = "";
    S.armsG.style.opacity = "0";
  }

  /* ── Playback ──────────────────────────────────────────────────── */
  /* Timeline point where the wavefront has folded back to W_FOLD. */
  var T_FOLD = T_DOT + T_WAVE * Einv(W_FOLD);
  var GROW_MS = T_END - T_FOLD;
  /* The spin: ease-in through the fold, ease-out through the regrowth,
     split so the angular speed is continuous at the turnaround. */
  var A_FOLD = 3 * SPIN_DEG * FOLD_MS / (2 * GROW_MS + 3 * FOLD_MS);
  function spinAt(e) {
    if (e <= FOLD_MS) { var p = e / FOLD_MS; return A_FOLD * p * p; }
    var q = clamp((e - FOLD_MS) / GROW_MS);
    return A_FOLD + (SPIN_DEG - A_FOLD) * (1 - Math.pow(1 - q, 3));
  }
  function tick(S) {
    S.raf = requestAnimationFrame(function (now) {
      var e = now - S.t0;
      if (e < FOLD_MS) {
        var w = 1 - (1 - W_FOLD) * GATHER(e / FOLD_MS);
        S.t = T_DOT + T_WAVE * Einv(w);
      } else {
        S.t = Math.min(T_END, T_FOLD + (e - FOLD_MS));
      }
      renderAt(S, S.t, spinAt(e));
      if (e >= FOLD_MS + GROW_MS) { S.phase = "idle"; rest(S); return; }
      tick(S);
    });
  }
  function play(S) {
    /* one full cycle per hover; a hover mid-cycle lets it finish */
    if (S.phase === "run") return;
    S.phase = "run";
    S.t0 = performance.now();
    cancelAnimationFrame(S.raf);
    tick(S);
  }

  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function stateFor(mark) {
    if (!mark.__tdbm) mark.__tdbm = build(mark) || "none";
    return mark.__tdbm === "none" ? null : mark.__tdbm;
  }
  function wire(mark) {
    var trigger = mark.closest("a, button") || mark;
    function go(e) {
      if (reduce && reduce.matches) return;
      if (e && e.pointerType === "touch") return;
      var S = stateFor(mark);
      if (S) play(S);
    }
    trigger.addEventListener("pointerenter", go);
    trigger.addEventListener("focus", function () {
      var fv = false;
      try { fv = trigger.matches(":focus-visible"); } catch (err) { fv = false; }
      if (fv) go();
    });
  }
  function init() {
    var marks = Array.prototype.slice.call(document.querySelectorAll(".brand-mark"));
    marks.forEach(wire);
    /* build the masks while the page is idle so the first hover starts
       on the very next frame */
    var prebuild = function () { marks.forEach(stateFor); };
    if (window.requestIdleCallback) requestIdleCallback(prebuild, { timeout: 1500 });
    else setTimeout(prebuild, 300);
  }

  window.tdevBrandMark = {
    play: function (mark) { var S = stateFor(mark); if (S) play(S); },
    renderAt: function (mark, t) { var S = stateFor(mark); if (S) renderAt(S, t); },
    rest: function (mark) { var S = stateFor(mark); if (S) rest(S); },
    T_DOT: T_DOT,
    T_END: T_END
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
