# Number pop-in

## When to use

Counters, prices, balances, or any number that updates and the change should be noticed. Each changed digit swaps on a 3D drum: the old one leaves upward, the new one rises just after it, pulls back, and springs into place past 100%. Digits the old and new number share stay still, and the last two stagger so decimals feel alive without looking chaotic.

## HTML usage

```html
<span class="t-digit-group is-animating">
  <span class="t-digit" data-same>1</span>
  <span class="t-digit-slot">
    <span class="t-digit-old" aria-hidden="true">2</span>
    <span class="t-digit">3</span>
  </span>
  <span class="t-digit-slot" data-stagger="1">
    <span class="t-digit-old" aria-hidden="true">4</span>
    <span class="t-digit">5</span>
  </span>
</span>
```

Each changed digit gets a .t-digit-slot holding the old digit
(leaves upward) and the new one (rises just after it, pulls back,
springs into place past 100%). --digit-dur covers anticipation and
spring.

Replay:
  - Remove `.is-animating`, re-render the digits, force a reflow,
    then re-add `.is-animating`.
  - Use data-stagger="1", "2" on a slot to delay it by
    `n * var(--digit-stagger)`.
  - Mark the leading digits the old and new number share with
    data-same: they stay still and only the changed digits swap
    (1,299 to 1,305: "1," stays, "305" swaps).

Sizes: distances are in em and --digit-blur is a curve on the font
size, so the motion fits any number size with no changes.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--digit-dur` | `600ms` | sourced from `--p9-dur` |
| `--digit-exit-dur` | `155ms` | sourced from `--p9-exit-dur` |
| `--digit-enter-delay` | `50ms` | sourced from `--p9-enter-delay` |
| `--digit-stagger` | `40ms` | sourced from `--p9-stagger` |
| `--digit-distance` | `0.52em` | sourced from `--p9-distance` |
| `--digit-exit-distance` | `0.52em` | sourced from `--p9-exit-distance` |
| `--digit-blur` | `max(0.067em, 0.171em - 2.1px)` | sourced from `--p9-blur` |
| `--digit-lift` | `0.125em` | sourced from `--p9-lift` |
| `--digit-start-scale` | `0.7` | sourced from `--p9-start-scale` |
| `--digit-peak` | `1.03` | sourced from `--p9-peak` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --digit-dur: 600ms;
  --digit-exit-dur: 155ms;
  --digit-enter-delay: 50ms;
  --digit-stagger: 40ms;
  --digit-distance: 0.52em;
  --digit-exit-distance: 0.52em;
  --digit-blur: max(0.067em, 0.171em - 2.1px);
  --digit-lift: 0.125em;
  --digit-start-scale: 0.7;
  --digit-peak: 1.03;
}
```

## CSS

```css
.t-digit-group { display: inline-flex; align-items: baseline; }
.t-digit-slot { position: relative; display: inline-block; }
.t-digit-old { position: absolute; inset: 0; text-align: center; pointer-events: none; }
.t-digit { display: inline-block; will-change: transform, opacity, filter; }
.t-digit-group.is-animating .t-digit {
  animation: t-digit-in var(--digit-dur) linear both;
  animation-delay: calc(var(--digit-stagger) * var(--digit-i, 0) + var(--digit-enter-delay));
}
.t-digit-group.is-animating .t-digit-old {
  animation: t-digit-out var(--digit-exit-dur) linear both;
  animation-delay: calc(var(--digit-stagger) * var(--digit-i, 0));
}
.t-digit-group.is-animating [data-stagger="1"] { --digit-i: 1; }
.t-digit-group.is-animating [data-stagger="2"] { --digit-i: 2; }
/* Digits that did not change (the leading ones the old and new number
   share) stay still; only the digits that changed swap. */
.t-digit-group.is-animating .t-digit[data-same] { animation: none; }

@keyframes t-digit-in {
  0% { transform: translateY(calc(var(--digit-distance) * 1 + var(--digit-lift) * 0)) scale(var(--digit-start-scale)); opacity: 0; filter: blur(calc(var(--digit-blur) * 1)); }
  5% { transform: translateY(calc(var(--digit-distance) * 0.941 + var(--digit-lift) * 0.216)) scale(var(--digit-start-scale)); opacity: 0.059; filter: blur(calc(var(--digit-blur) * 1)); }
  10% { transform: translateY(calc(var(--digit-distance) * 0.755 + var(--digit-lift) * 0.648)) scale(var(--digit-start-scale)); opacity: 0.245; filter: blur(calc(var(--digit-blur) * 1)); }
  15% { transform: translateY(calc(var(--digit-distance) * 0.475 + var(--digit-lift) * 0.972)) scale(var(--digit-start-scale)); opacity: 0.525; filter: blur(calc(var(--digit-blur) * 1)); }
  20% { transform: translateY(calc(var(--digit-distance) * 0.206 + var(--digit-lift) * 0.792)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.792)); opacity: 0.794; filter: blur(calc(var(--digit-blur) * 0.9)); }
  25% { transform: translateY(calc(var(--digit-distance) * 0.041 + var(--digit-lift) * 0.392)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.392)); opacity: 0.959; filter: blur(calc(var(--digit-blur) * 0.75)); }
  30% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0.033)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.033)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.6)); }
  35% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * -0.194)) scale(calc(1 + (var(--digit-peak) - 1) * 0.711)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.45)); }
  40% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * -0.272)) scale(calc(1 + (var(--digit-peak) - 1) * 0.997)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.3)); }
  45% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * -0.238)) scale(calc(1 + (var(--digit-peak) - 1) * 0.87)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.15)); }
  50% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * -0.146)) scale(calc(1 + (var(--digit-peak) - 1) * 0.535)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  55% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * -0.05)) scale(calc(1 + (var(--digit-peak) - 1) * 0.183)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  60% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0.019)) scale(calc(1 + (var(--digit-peak) - 1) * -0.069)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  65% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0.05)) scale(calc(1 + (var(--digit-peak) - 1) * -0.185)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  70% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0.051)) scale(calc(1 + (var(--digit-peak) - 1) * -0.187)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  75% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0.035)) scale(calc(1 + (var(--digit-peak) - 1) * -0.128)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  80% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0.016)) scale(calc(1 + (var(--digit-peak) - 1) * -0.057)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  85% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0.002)) scale(calc(1 + (var(--digit-peak) - 1) * -0.007)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  90% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * -0.004)) scale(calc(1 + (var(--digit-peak) - 1) * 0.013)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  95% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * -0.003)) scale(calc(1 + (var(--digit-peak) - 1) * 0.011)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  100% { transform: translateY(calc(var(--digit-distance) * 0 + var(--digit-lift) * 0)) scale(1); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
}
@keyframes t-digit-out {
  0% { transform: translateY(calc(var(--digit-exit-distance) * 0)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0)); }
  10% { transform: translateY(calc(var(--digit-exit-distance) * -0.009)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.009)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.009)); }
  20% { transform: translateY(calc(var(--digit-exit-distance) * -0.042)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.042)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.042)); }
  30% { transform: translateY(calc(var(--digit-exit-distance) * -0.112)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.112)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.112)); }
  40% { transform: translateY(calc(var(--digit-exit-distance) * -0.252)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.252)); opacity: 1; filter: blur(calc(var(--digit-blur) * 0.252)); }
  50% { transform: translateY(calc(var(--digit-exit-distance) * -0.5)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.5)); opacity: 0.833; filter: blur(calc(var(--digit-blur) * 0.5)); }
  60% { transform: translateY(calc(var(--digit-exit-distance) * -0.748)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.748)); opacity: 0.42; filter: blur(calc(var(--digit-blur) * 0.748)); }
  70% { transform: translateY(calc(var(--digit-exit-distance) * -0.888)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.888)); opacity: 0.187; filter: blur(calc(var(--digit-blur) * 0.888)); }
  80% { transform: translateY(calc(var(--digit-exit-distance) * -0.958)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.958)); opacity: 0.069; filter: blur(calc(var(--digit-blur) * 0.958)); }
  90% { transform: translateY(calc(var(--digit-exit-distance) * -0.991)) scale(calc(1 + (var(--digit-start-scale) - 1) * 0.991)); opacity: 0.015; filter: blur(calc(var(--digit-blur) * 0.991)); }
  100% { transform: translateY(calc(var(--digit-exit-distance) * -1)) scale(calc(1 + (var(--digit-start-scale) - 1) * 1)); opacity: 0; filter: blur(calc(var(--digit-blur) * 1)); }
}

@media (prefers-reduced-motion: reduce) {
  .t-digit-group .t-digit { animation: none !important; }
  .t-digit-group .t-digit-old { display: none; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Swap to a new number: wrap each changed digit in a slot with the old digit,
// force a reflow, then re-add .is-animating. The leading characters the old and
// new number share are marked data-same and stay still. The last two characters
// ride 1× / 2× --digit-stagger behind the others.
const group = document.querySelector(".t-digit-group");
let current = group.textContent.replace(/\s+/g, "");

function setDigits(str) {
  let same = 0;
  while (same < current.length && same < str.length && current[same] === str[same]) same++;
  group.classList.remove("is-animating");
  group.replaceChildren();
  [...str].forEach((ch, i) => {
    const fresh = document.createElement("span");
    fresh.className = "t-digit";
    fresh.textContent = ch;
    if (i < same || !/\d/.test(ch)) {
      fresh.dataset.same = "";
      group.appendChild(fresh);
      return;
    }
    const slot = document.createElement("span");
    slot.className = "t-digit-slot";
    const fromEnd = str.length - 1 - i;
    if (fromEnd === 1) slot.dataset.stagger = "1";
    else if (fromEnd === 0) slot.dataset.stagger = "2";
    const oldCh = current[current.length - (str.length - i)];
    if (oldCh && /\d/.test(oldCh)) {
      const old = document.createElement("span");
      old.className = "t-digit-old";
      old.setAttribute("aria-hidden", "true");
      old.textContent = oldCh;
      slot.appendChild(old);
    }
    slot.appendChild(fresh);
    group.appendChild(slot);
  });
  current = str;
  void group.offsetHeight; // force reflow
  group.classList.add("is-animating");
}
```

