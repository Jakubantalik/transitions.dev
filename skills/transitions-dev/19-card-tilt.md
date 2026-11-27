# Card hover tilt

## When to use

A card / tile / media surface that tilts in 3D toward the pointer while hovered, with a soft light "glare" tracking the cursor across it. Use for product cards, credit / membership cards, feature tiles, cover art — anything that should feel physical and reactive on hover. Pointer-only (skips touch) and flattens under reduced motion.

The pointer is tracked on an **outer flat wrapper** (`.t-tilt`) that never transforms, so the tilting card can't rotate its own edges out from under the cursor (which causes hover flicker). The inner `.t-tilt-card` is the element that actually rotates.

## HTML usage

```html
<div class="t-tilt">                <!-- flat hit area -->
  <div class="t-tilt-card">       <!-- the element that tilts -->
    … card content …
    <div class="t-tilt-glare"></div>
  </div>
</div>
```

Track the pointer on the OUTER `.t-tilt` (it never
transforms) and write four custom properties from JS:
  el.style.setProperty('--tilt-rx', rxDeg + 'deg');
  el.style.setProperty('--tilt-ry', ryDeg + 'deg');
  el.style.setProperty('--tilt-gx', gxPct + '%');
  el.style.setProperty('--tilt-gy', gyPct + '%');
Add `.is-tilting` while moving (fast follow) and
`.is-hover` to fade the glare in; remove both on leave.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--tilt-perspective` | `1000px` | sourced from `--p19-perspective` |
| `--tilt-return` | `1000ms` | sourced from `--p19-return-dur` |
| `--tilt-return-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p19-return-ease` |
| `--tilt-follow` | `400ms` | sourced from `--p19-follow-dur` |
| `--tilt-follow-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p19-follow-ease` |
| `--tilt-glare-opacity` | `0.32` | sourced from `--p19-glare-opacity` |
| `--tilt-glare-fade` | `300ms` | sourced from `--p19-glare-fade` |
| `--tilt-glare-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p19-glare-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --tilt-perspective: 1000px;
  --tilt-return: 1000ms;
  --tilt-return-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --tilt-follow: 400ms;
  --tilt-follow-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --tilt-glare-opacity: 0.32;
  --tilt-glare-fade: 300ms;
  --tilt-glare-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
/* The outer wrapper is the flat hit area; touch-action:none
   lets a finger drag tilt the card instead of scrolling the
   page, so tap-hold-drag works on mobile. */
.t-tilt { touch-action: none; }
/* The card tilts toward the pointer via rotateX/rotateY fed
   from JS; on leave it eases back to flat. A separate
   .is-tilting class swaps in a short linear follow while the
   pointer moves so the tilt tracks the cursor 1:1. */
.t-tilt-card {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  transform:
    perspective(var(--tilt-perspective))
    rotateX(var(--tilt-rx, 0deg))
    rotateY(var(--tilt-ry, 0deg));
  transform-style: preserve-3d;
  transition: transform var(--tilt-return) var(--tilt-return-ease);
  will-change: transform;
}
.t-tilt-card.is-tilting {
  transition: transform var(--tilt-follow) var(--tilt-follow-ease);
}
/* Cursor-tracked glare: layered soft circles that add like
   light (screen blend) at the pointer position. */
.t-tilt-glare {
  position: absolute;
  inset: 0;
  /* Clip the glare to the card's rounded corners. Safari skips
     the parent's overflow clip for composited children under
     preserve-3d, painting square corners on hover otherwise. */
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  mix-blend-mode: screen;
  background:
    radial-gradient(circle 95px at var(--tilt-gx, 50%) var(--tilt-gy, 50%),
      rgba(255,255,255,0.48), rgba(255,255,255,0.06) 52%, rgba(255,255,255,0) 84%),
    radial-gradient(circle 200px at var(--tilt-gx, 50%) var(--tilt-gy, 50%),
      rgba(255,255,255,0.22), rgba(255,255,255,0.04) 58%, rgba(255,255,255,0) 78%),
    radial-gradient(circle 360px at var(--tilt-gx, 50%) var(--tilt-gy, 50%),
      rgba(255,255,255,0.10), rgba(255,255,255,0) 88%);
  transition: opacity var(--tilt-glare-fade) var(--tilt-glare-ease);
}
.t-tilt.is-hover .t-tilt-glare { opacity: var(--tilt-glare-opacity); }

@media (prefers-reduced-motion: reduce) {
  .t-tilt-card { transform: none !important; transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Track the pointer on the OUTER .t-tilt (never transforms) and write
// rotation + glare position onto the inner card. Works for mouse
// (hover) and touch / pen (tap-hold-drag) — a touch pointermove only
// fires while a finger is down, so the press naturally drives the tilt.
const tilt = document.querySelector(".t-tilt");
const card = tilt.querySelector(".t-tilt-card");
const reduce = matchMedia("(prefers-reduced-motion: reduce)");

const MAX = 14; // peak tilt in degrees at the card edges (raise for a stronger lean)

function reset() {
  tilt.classList.remove("is-hover");
  card.classList.remove("is-tilting");
  card.style.setProperty("--tilt-rx", "0deg");
  card.style.setProperty("--tilt-ry", "0deg");
}

function track(e) {
  if (reduce.matches) return;
  const r = tilt.getBoundingClientRect();
  const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  tilt.classList.add("is-hover");
  card.classList.add("is-tilting");
  card.style.setProperty("--tilt-ry", ((px - 0.5) * MAX).toFixed(2) + "deg");
  card.style.setProperty("--tilt-rx", ((0.5 - py) * MAX).toFixed(2) + "deg");
  card.style.setProperty("--tilt-gx", (px * 100).toFixed(1) + "%");
  card.style.setProperty("--tilt-gy", (py * 100).toFixed(1) + "%");
}

tilt.addEventListener("pointerdown", (e) => {
  // Touch / pen: capture so the drag keeps targeting the card even if
  // the finger drifts past its edge. Pair with touch-action: none on
  // .t-tilt so the drag tilts instead of scrolling the page.
  if (e.pointerType !== "mouse") {
    try { tilt.setPointerCapture(e.pointerId); } catch (_) {}
  }
});
tilt.addEventListener("pointermove", track);
tilt.addEventListener("pointerup", reset);
tilt.addEventListener("pointercancel", reset);
tilt.addEventListener("pointerleave", (e) => {
  // Mouse: leaving the card flattens it. Touch already reset on up.
  if (e.pointerType === "mouse") reset();
});
```

### Peak tilt angle

The rotation magnitude is a JS constant (`MAX`, in degrees), not a CSS variable — the orchestration writes `--tilt-rx` / `--tilt-ry` from the pointer position scaled by `MAX`. Raise it for a stronger lean (the live demo goes up to ~40°); 10–16° reads as a subtle, tasteful tilt.

### Why the pointer is tracked on the flat wrapper

Bind `pointermove` to the outer `.t-tilt` (which never transforms), not the `.t-tilt-card` that rotates. If you track the tilting element, its rotating edges slip out from under the cursor near the borders and the hover flickers on and off.

### Touch / mobile

Because it uses Pointer Events, the tilt also works on touch: tap-hold-drag on the card and it follows your finger (a touch `pointermove` only fires while pressed). Two pieces make this reliable — `touch-action: none` on `.t-tilt` so the drag tilts instead of scrolling the page, and `setPointerCapture` on `pointerdown` so the gesture keeps targeting the card even if the finger drifts past its edge.

