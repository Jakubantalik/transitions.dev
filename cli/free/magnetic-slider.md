# Magnetic slider

## When to use

Sliders with named stops rather than a continuous range: quality levels, text size, playback speed, zoom steps. While held the thumb tracks the pointer exactly; on release it flies to the nearest stop and overshoots it by a hair, which is what makes the stops feel magnetic rather than merely marked.

Thumb and fill are written from one position value and carry the same spring, so they arrive as one object.

## HTML usage

```html
<div class="t-mslider" role="slider" tabindex="0"
     aria-valuemin="1" aria-valuemax="5" aria-valuenow="3">
  <div class="t-mslider-track">
    <span class="t-mslider-dots"></span>
    <span class="t-mslider-fill"></span>
    <span class="t-mslider-dots t-mslider-dots--on"></span>
  </div>
  <span class="t-mslider-thumb"></span>
</div>
```

Two layers move together: the thumb on a translate (--x) and the
fill on a clip-path inset (--cut), both written from the same
position, so they cannot drift apart.

While held the slider carries `.is-grabbed`, which drops every
transition so the thumb tracks the pointer exactly. On release it
carries `.is-snapping` and one spring takes thumb and fill to the
nearest stop, overshooting slightly: that overshoot is what makes
the stops feel magnetic rather than merely marked.

`.is-min` collapses the fill at the first stop, otherwise its
rounded cap shows to the left of the thumb on an empty track.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--mslider-snap` | `380ms` | sourced from `--p38-snap-dur` |
| `--mslider-grab` | `180ms` | sourced from `--p38-grab-dur` |
| `--mslider-grab-scale` | `1.06` | sourced from `--p38-grab-scale` |
| `--mslider-h` | `32px` | sourced from `--p38-h` |
| `--mslider-thumb` | `32px` | sourced from `--p38-thumb` |
| `--mslider-inset` | `0px` | sourced from `--p38-inset` |
| `--mslider-track` | `#e8e8ea` | sourced from `--p38-track-bg` |
| `--mslider-fill` | `#17181c` | sourced from `--p38-fill-bg` |
| `--mslider-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p38-ease` |
| `--mslider-snap-ease` | `cubic-bezier(0.34, 1.45, 0.64, 1)` | sourced from `--p38-snap-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --mslider-snap: 380ms;
  --mslider-grab: 180ms;
  --mslider-grab-scale: 1.06;
  --mslider-h: 32px;
  --mslider-thumb: 32px;
  --mslider-inset: 0px;
  --mslider-track: #e8e8ea;
  --mslider-fill: #17181c;
  --mslider-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --mslider-snap-ease: cubic-bezier(0.34, 1.45, 0.64, 1);
}
```

## CSS

```css
.t-mslider {
  position: relative;
  height: var(--mslider-h);
  touch-action: none;
  cursor: grab;
}
.t-mslider:active { cursor: grabbing; }
.t-mslider-track {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--mslider-track);
  overflow: hidden;
}
/* The fill is a full-width layer the clip path eats into, so the
   rounded cap survives: animating width would squash it. Only the
   outer end is rounded, because the cut end sits under the thumb and
   a radius there shows as a notch when the thumb moves off it. */
.t-mslider-fill,
.t-mslider-dots--on {
  position: absolute;
  inset: 0;
  clip-path: inset(0 var(--cut, 50%) 0 0 round 999px 0 0 999px);
}
.t-mslider-fill { background: var(--mslider-fill); }
.t-mslider-thumb {
  position: absolute;
  top: 50%;
  left: var(--mslider-inset);
  width: var(--mslider-thumb);
  height: var(--mslider-thumb);
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 3px 8px rgba(0, 0, 0, 0.13);
  transform: translate(var(--x, 0px), -50%) scale(1);
  transition: transform var(--mslider-grab) var(--mslider-ease);
}
/* Held: no transition anywhere, or the thumb lags the finger. */
.t-mslider.is-grabbed .t-mslider-thumb {
  transform: translate(var(--x, 0px), -50%) scale(var(--mslider-grab-scale));
  transition: none;
}
.t-mslider.is-grabbed .t-mslider-fill,
.t-mslider.is-grabbed .t-mslider-dots--on { transition: none; }
/* Released: thumb and fill run the same spring to the stop. */
.t-mslider.is-snapping .t-mslider-thumb {
  transition: transform var(--mslider-snap) var(--mslider-snap-ease);
}
.t-mslider.is-snapping .t-mslider-fill,
.t-mslider.is-snapping .t-mslider-dots--on {
  transition: clip-path var(--mslider-snap) var(--mslider-snap-ease);
}
.t-mslider.is-min .t-mslider-fill,
.t-mslider.is-min .t-mslider-dots--on {
  clip-path: inset(0 100% 0 0 round 999px 0 0 999px);
}

@media (prefers-reduced-motion: reduce) {
  .t-mslider-thumb,
  .t-mslider-fill,
  .t-mslider-dots--on { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Magnetic slider. While held, position is the pointer: no transition,
// so the thumb cannot lag the finger. On release the nearest stop wins
// and one spring carries thumb and fill there together.
const slider = document.querySelector(".t-mslider");
const STOPS = ["Off", "Low", "Medium", "High", "Max"];
const last = STOPS.length - 1;
let index = 2;
let dragging = false;

const px = (name) =>
  parseFloat(getComputedStyle(slider).getPropertyValue(name)) || 0;
const travel = () =>
  slider.getBoundingClientRect().width - px("--mslider-thumb") - px("--mslider-inset") * 2;

// One writer for both layers: the fill is cut to the thumb's centre, so
// the colour always ends under it however the two are sized.
function paint(ratio) {
  const w = slider.getBoundingClientRect().width;
  const x = travel() * ratio;
  const centre = px("--mslider-inset") + x + px("--mslider-thumb") / 2;
  slider.style.setProperty("--x", x.toFixed(2) + "px");
  slider.style.setProperty("--cut", (100 - (centre / w) * 100).toFixed(2) + "%");
  // At the first stop the fill would still show its rounded cap beside
  // the thumb, so collapse it entirely.
  slider.classList.toggle("is-min", ratio <= 0.0005);
}

function commit(i) {
  index = Math.max(0, Math.min(last, i));
  paint(index / last);
  slider.setAttribute("aria-valuenow", String(index + 1));
  slider.setAttribute("aria-valuetext", STOPS[index]);
}

function ratioFrom(e) {
  const r = slider.getBoundingClientRect();
  const x = e.clientX - r.left - px("--mslider-inset") - px("--mslider-thumb") / 2;
  return Math.max(0, Math.min(1, x / travel()));
}

slider.addEventListener("pointerdown", (e) => {
  dragging = true;
  try { slider.setPointerCapture(e.pointerId); } catch {}
  slider.classList.remove("is-snapping");
  slider.classList.add("is-grabbed");
  paint(ratioFrom(e));
});
slider.addEventListener("pointermove", (e) => {
  if (dragging) paint(ratioFrom(e));
});

function release(e) {
  if (!dragging) return;
  dragging = false;
  slider.classList.remove("is-grabbed");
  slider.classList.add("is-snapping");
  commit(Math.round(ratioFrom(e) * last));
  const dur = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--mslider-snap")
  ) || 380;
  setTimeout(() => slider.classList.remove("is-snapping"), dur + 40);
}
slider.addEventListener("pointerup", release);
slider.addEventListener("pointercancel", release);

// Keyboard: one stop per press, same spring as a release.
slider.addEventListener("keydown", (e) => {
  const step =
    e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 :
    e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  slider.classList.add("is-snapping");
  commit(index + step);
  setTimeout(() => slider.classList.remove("is-snapping"), 420);
});

commit(index);
addEventListener("resize", () => paint(index / last));
```

