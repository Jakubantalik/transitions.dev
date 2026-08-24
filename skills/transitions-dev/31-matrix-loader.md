# Matrix dot loader

## When to use

Tiny inline loaders built from a 4×4 matrix of 2px dots. All four variants share one colour-pulse keyframe; a per-dot delay table gives each its motion character — a column scan, a randomized-looking twinkle, a perimeter orbit, a centre-out pulse. Rounded variants drop the four corner dots.

Use where a spinner would be too loud: alongside a status line, inside a compact button, in a table cell. The loader whispers.

## HTML usage

```html
<div class="t-matrix" data-variant="scan"></div>
```

JS builds sixteen <i> dots per loader and hands each a --d
delay (ms) into the shared colour-pulse cycle — the variant is
just a delay table. scan: col * cycle/10. twinkle: the order
[7,2,11,5,14,9,0,12,3,15,6,10,13,1,8,4] * cycle/16. orbit: the
ring [1,2,7,11,14,13,8,4] * cycle/8, centre holds steady.
pulse: inner [5,6,9,10] first, the rest cycle*0.16 behind.
Rounded variants mark the corners [0,3,12,15] .is-gap so they
render nothing.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--matrix-cycle` | `1200ms` | sourced from `--p33-cycle` |
| `--matrix-base` | `#d9d9d9` | sourced from `--p33-base` |
| `--matrix-active` | `#85858f` | sourced from `--p33-active` |
| `--matrix-ease` | `ease-in-out` | sourced from `--p33-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --matrix-cycle: 1200ms;
  --matrix-base: #d9d9d9;
  --matrix-active: #85858f;
  --matrix-ease: ease-in-out;
}
```

## CSS

```css
.t-matrix {
  display: grid;
  grid-template-columns: repeat(4, 2px);
  grid-auto-rows: 2px;
  gap: 2px;
}
.t-matrix i {
  display: block;
  background: var(--matrix-base);
  animation: t-matrix-pulse var(--matrix-cycle) var(--matrix-ease) infinite;
  animation-delay: calc(var(--d, 0) * 1ms);
}
/* Hole positions (rounded variants) render nothing. */
.t-matrix i.is-gap { visibility: hidden; animation: none; }
@keyframes t-matrix-pulse {
  0%, 45%, 100% { background-color: var(--matrix-base); }
  15%           { background-color: var(--matrix-active); }
}

@media (prefers-reduced-motion: reduce) {
  .t-matrix i { animation: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Build 16 dots per loader and hand each a --d delay (ms) into the
// shared pulse cycle — the variant is just a delay table.
const CORNERS = [0, 3, 12, 15];
// Clockwise perimeter (corner-less ring), then centre cells.
const RING = [1, 2, 7, 11, 14, 13, 8, 4];
const INNER = [5, 6, 9, 10];
const TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

const cycle = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--matrix-cycle")
) || 1200;

document.querySelectorAll(".t-matrix").forEach((loader) => {
  const variant = loader.getAttribute("data-variant");
  const rounded = loader.getAttribute("data-rounded") === "true";
  for (let idx = 0; idx < 16; idx++) {
    const dot = document.createElement("i");
    const col = idx % 4;
    if (rounded && CORNERS.includes(idx)) {
      dot.className = "is-gap";
    } else if (variant === "scan") {
      dot.style.setProperty("--d", String(Math.round(col * (cycle / 10))));
    } else if (variant === "twinkle") {
      dot.style.setProperty("--d", String(Math.round(TWINKLE[idx] * (cycle / 16))));
    } else if (variant === "orbit") {
      const k = RING.indexOf(idx);
      if (k !== -1) {
        dot.style.setProperty("--d", String(Math.round(k * (cycle / 8))));
      } else {
        dot.style.animation = "none"; // centre holds steady under the ring
      }
    } else if (variant === "pulse") {
      const ring = INNER.includes(idx) ? 0 : 1;
      dot.style.setProperty("--d", String(Math.round(ring * (cycle * 0.16))));
    }
    loader.appendChild(dot);
  }
});
```

