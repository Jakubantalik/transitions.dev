# Donut chart

## When to use

A donut or ring chart whose segments have even gaps and softly rounded corners, and that morphs to new values when its data changes (a Week / Month / Year switch, a filter): every segment eases from its old share to its new one in the same chart, nothing is re-rendered or slid. Each segment is a filled ring sector drawn with straight, parallel gap edges, so the gaps are the same width from the inner edge to the outer one, and its corners take the smallest radius of the design system (2px by default).

## HTML usage

```html
<div class="t-donut" data-thickness="14">
  <svg viewBox="0 0 140 140" aria-hidden="true"></svg>
  <div class="t-donut-center">
    <span class="t-text-soft">$2,140</span>
    <span>Total</span>
  </div>
</div>
```

Driven by JS (`donut(el, colors)` returns `set(values)`):
  - The viewBox matches the chart's size in px, so the gap and the
    corner radius are real pixels; data-thickness is the ring width.
  - `set(values)` draws the segments the first time, and later
    tweens every segment from its old share to the new one over
    --chart-morph-dur with --chart-morph-ease.
  - Change the values in the center and the legend with Text swap
    soft at the same time.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--chart-morph-dur` | `400ms` | segments easing to new values |
| `--chart-morph-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | read by the JS tween |
| `--chart-gap` | `3px` | even gap between segments |
| `--chart-corner` | `2px` | the smallest radius of the design system |

Drop the `:root` defaults into your global stylesheet once; every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --chart-morph-dur: 400ms;
  --chart-morph-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --chart-gap: 3px;
  --chart-corner: 2px;
}
```

## CSS

```css
.t-donut {
  position: relative;
  width: 140px;
  height: 140px;
}
.t-donut svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
/* Each segment is filled and stroked in its color with a round join:
   the stroke (twice the corner radius wide) rounds the corners. */
.t-donut-seg {
  stroke-linejoin: round;
  transition: opacity 150ms cubic-bezier(0.22, 1, 0.36, 1);
}
.t-donut-seg.is-dim { opacity: 0.2; }
.t-donut-center {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .t-donut-seg { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required; keep it. The JS below also skips the tween for those users and draws the new values at once.

## JavaScript orchestration

```js
// Donut chart: ring sectors with even gaps and rounded corners that morph
// to new values. Angles run clockwise from the top.
const root = document.documentElement;
const token = (name) => getComputedStyle(root).getPropertyValue(name).trim();

// The CSS cubic-bezier, for the JS tween.
function bezier(x1, y1, x2, y2) {
  return (t) => {
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 24; i++) {
      u = (lo + hi) / 2;
      const x = 3 * u * (1 - u) * (1 - u) * x1 + 3 * u * u * (1 - u) * x2 + u * u * u;
      if (x < t) lo = u; else hi = u;
    }
    return 3 * u * (1 - u) * (1 - u) * y1 + 3 * u * u * (1 - u) * y2 + u * u * u;
  };
}
function easeOf(value) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(value);
  if (!m) return (t) => t;
  const [a, b, c, d] = m[1].split(",").map(parseFloat);
  return bezier(a, b, c, d);
}

// One ring sector from angle a0 to a1, inset by the corner radius (the
// round-joined stroke adds it back) and by half the gap measured straight
// across, so both gap edges stay parallel.
function ringPath(cx, cy, ro, ri, a0, a1, gap, cr) {
  const Ro = ro - cr, Ri = ri + cr, h = gap / 2 + cr;
  if (Ro <= Ri) return "";
  const dO = Math.asin(Math.min(1, h / Ro)), dI = Math.asin(Math.min(1, h / Ri));
  const o0 = a0 + dO, o1 = a1 - dO, i0 = a0 + dI, i1 = a1 - dI;
  if (i1 - i0 <= 0 || o1 - o0 <= 0) return ""; // too small to draw
  const pt = (r, a) => (cx + r * Math.sin(a)).toFixed(3) + " " + (cy - r * Math.cos(a)).toFixed(3);
  const lo = o1 - o0 > Math.PI ? 1 : 0, li = i1 - i0 > Math.PI ? 1 : 0;
  return "M" + pt(Ro, o0) + "A" + Ro + " " + Ro + " 0 " + lo + " 1 " + pt(Ro, o1) +
    "L" + pt(Ri, i1) + "A" + Ri + " " + Ri + " 0 " + li + " 0 " + pt(Ri, i0) + "Z";
}

function donut(el, colors) {
  const svg = el.querySelector("svg");
  const vb = svg.viewBox.baseVal, cx = vb.width / 2, cy = vb.height / 2;
  const ro = Math.min(cx, cy), ri = ro - (parseFloat(el.dataset.thickness) || 14);
  const segs = colors.map((color) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "t-donut-seg");
    p.style.fill = color;
    p.style.stroke = color;
    svg.appendChild(p);
    return p;
  });
  let current = null, raf = 0;

  function draw(values) {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const gap = parseFloat(token("--chart-gap")) || 0;
    const cr = parseFloat(token("--chart-corner")) || 0;
    let a = 0;
    values.forEach((v, k) => {
      const span = (v / total) * Math.PI * 2;
      segs[k].setAttribute("d", ringPath(cx, cy, ro, ri, a, a + span, gap, cr));
      segs[k].style.strokeWidth = 2 * cr;
      a += span;
    });
  }

  return function set(values) {
    cancelAnimationFrame(raf);
    const from = current, to = values.slice();
    current = to;
    const dur = parseFloat(token("--chart-morph-dur")) || 0;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!from || !dur || reduce) { draw(to); return; }
    const ease = easeOf(token("--chart-morph-ease"));
    const t0 = performance.now();
    (function step(now) {
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      draw(from.map((f, k) => f + (to[k] - f) * e));
      if (t < 1) raf = requestAnimationFrame(step);
    })(t0);
  };
}

// const setSpend = donut(document.querySelector(".t-donut"), ["#1C5FFB", "#B01CFB", "#EF8121", "#1EBB26"]);
// setSpend([640, 480, 300, 720]);   // first draw
// setSpend([168, 142, 96, 80]);     // later: morphs to the new shares
```

Keep the segments in the same order for every data set so each one morphs into its own new share; dim the others with `.is-dim` when a legend row is hovered.
