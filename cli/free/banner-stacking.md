# Banner stacking

## When to use

Sonner-style banner / toast stacking. Each new banner rises in with the **toast** motion (rise + cross-blur + slight scale) while older banners push back — smaller, higher, dimmer — instead of leaving; the fourth arrival sends the oldest out. Hovering the stack fans it into a readable list.

Use over a single **toast** when notifications can overlap: the stack keeps the newest legible while acknowledging the queue behind it.

## HTML usage

```html
<div class="t-stack">
  <div class="t-stack-banner" data-depth="0">…</div>
</div>
```

Sonner-style. Append a new banner with .is-enter + data-depth
0, step every older banner's data-depth one back, force one
reflow, then remove .is-enter in the same task (a rAF hop is
skipped when the frame clock is throttled). A fourth banner
gets .is-leaving; remove it after --stack-close. Hover spread
is geometry in JS: pointer inside the collapsed stack box adds
.is-spread, and it holds until the pointer leaves the taller
spread column ((stack height + gap) * 2 above).

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--stack-open` | `350ms` | sourced from `--p34-open-dur` |
| `--stack-close` | `250ms` | sourced from `--p34-close-dur` |
| `--stack-rise` | `80px` | sourced from `--p34-distance` |
| `--stack-blur` | `2px` | sourced from `--p34-blur` |
| `--stack-scale` | `0.97` | sourced from `--p34-scale-in` |
| `--stack-peek` | `12px` | sourced from `--p34-peek` |
| `--stack-spread-gap` | `8px` | sourced from `--p34-spread-gap` |
| `--stack-depth-scale` | `0.06` | sourced from `--p34-depth-scale` |
| `--stack-depth-fade` | `0.4` | sourced from `--p34-depth-fade` |
| `--stack-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p34-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --stack-open: 350ms;
  --stack-close: 250ms;
  --stack-rise: 80px;
  --stack-blur: 2px;
  --stack-scale: 0.97;
  --stack-peek: 12px;
  --stack-spread-gap: 8px;
  --stack-depth-scale: 0.06;
  --stack-depth-fade: 0.4;
  --stack-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-stack { position: relative; }
.t-stack-banner {
  position: absolute;
  left: 0;
  bottom: 0;
  /* Centre origin so an arriving banner scales like a toast; the
     push-back depths switch to the bottom edge, which they can do
     freely because the swap happens at identity. */
  transform-origin: 50% 50%;
  /* Explicit blur(0) rather than an unset filter — blur → none is
     not reliably interpolated, and the cross-blur would snap. */
  filter: blur(0);
  will-change: transform, opacity, filter;
  transition:
    transform var(--stack-open) var(--stack-ease),
    opacity var(--stack-open) var(--stack-ease),
    filter var(--stack-open) var(--stack-ease);
}
.t-stack-banner[data-depth="0"] {
  z-index: 3;
  transform: translateY(0) scale(1);
  opacity: 1;
}
.t-stack-banner[data-depth="1"] {
  z-index: 2;
  transform-origin: 50% 100%;
  transform: translateY(calc(var(--stack-peek) * -1))
             scale(calc(1 - var(--stack-depth-scale)));
  opacity: calc(1 - var(--stack-depth-fade));
}
.t-stack-banner[data-depth="2"] {
  z-index: 1;
  transform-origin: 50% 100%;
  transform: translateY(calc(var(--stack-peek) * -2))
             scale(calc(1 - var(--stack-depth-scale) * 2));
  opacity: calc(1 - var(--stack-depth-fade) * 1.6);
}
/* Spread: newest stays put, older ones climb one banner height
   each (100% = the banner's own height). Driven by a class, not
   :hover — the gaps between spread banners belong to no element. */
.t-stack.is-spread .t-stack-banner[data-depth="1"],
.t-stack.is-spread .t-stack-banner[data-depth="2"] { opacity: 1; }
.t-stack.is-spread .t-stack-banner[data-depth="1"] {
  transform: translateY(calc((100% + var(--stack-spread-gap)) * -1)) scale(1);
}
.t-stack.is-spread .t-stack-banner[data-depth="2"] {
  transform: translateY(calc((100% + var(--stack-spread-gap)) * -2)) scale(1);
}
.t-stack-banner.is-enter {
  transition: none;
  transform: translateY(var(--stack-rise)) scale(var(--stack-scale));
  opacity: 0;
  filter: blur(var(--stack-blur));
}
.t-stack-banner.is-leaving {
  z-index: 0;
  transform-origin: 50% 100%;
  transform: translateY(calc(var(--stack-peek) * -3))
             scale(calc(1 - var(--stack-depth-scale) * 3));
  opacity: 0;
  filter: blur(var(--stack-blur));
  transition:
    transform var(--stack-close) var(--stack-ease),
    opacity var(--stack-close) var(--stack-ease),
    filter var(--stack-close) var(--stack-ease);
}

@media (prefers-reduced-motion: reduce) {
  .t-stack-banner { transition: none !important; transform: none !important; filter: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Stack management: a new banner arrives at depth 0, everything
// already stacked steps one depth back (pure data-depth swap — CSS
// transitions the rest), and a fourth banner pushes the oldest out.
const stack = document.querySelector(".t-stack");
let banners = []; // newest first

const ms = (name, fb) => {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name)
  );
  return Number.isFinite(v) ? v : fb;
};

function addBanner(contentHTML) {
  const el = document.createElement("div");
  el.className = "t-stack-banner is-enter";
  el.setAttribute("data-depth", "0");
  el.innerHTML = contentHTML;
  banners.unshift(el);
  stack.appendChild(el);
  banners.forEach((b, i) => {
    if (i === 0) return;
    if (i > 2) {
      if (!b.classList.contains("is-leaving")) {
        b.classList.add("is-leaving");
        setTimeout(() => b.remove(), ms("--stack-close", 250) + 60);
      }
    } else {
      b.setAttribute("data-depth", String(i));
    }
  });
  banners = banners.slice(0, 3)
    .concat(banners.slice(3).filter((b) => !b.classList.contains("is-leaving")));
  // Flush the pre-open rest state, then release it in the same task.
  // A rAF hop would be skipped whenever the frame clock is throttled,
  // and the banner would land with no motion at all.
  void el.offsetWidth;
  el.classList.remove("is-enter");
}

// Hover spread is geometry, not :hover — the gaps between spread
// banners belong to no element, and boundary events would also fire
// when a banner animates in under a still pointer.
const stage = stack.parentElement;
const spreadHeight = () =>
  (stack.offsetHeight + ms("--stack-spread-gap", 8)) * 2;
const within = (e, above) => {
  const r = stack.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right &&
    e.clientY <= r.bottom && e.clientY >= r.top - above;
};
stage.addEventListener("pointermove", (e) => {
  if (stack.classList.contains("is-spread")) {
    if (!within(e, spreadHeight())) stack.classList.remove("is-spread");
  } else if (within(e, 0)) {
    stack.classList.add("is-spread");
  }
});
stage.addEventListener("pointerleave", () => stack.classList.remove("is-spread"));
```

