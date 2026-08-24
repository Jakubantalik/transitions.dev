# Reasoning stream

## When to use

An agent "thinking out loud" — a small card plays back a stream of reasoning by stepping the transcript up two lines at a time, holding between steps. Soft mask fades at the top and bottom edges sell "more above, more below", and the transcript is cloned once so the loop wraps without a visible jump.

Use for reasoning previews, live log tickers, changelog streams — any tall text that should scroll by inside a fixed viewport on its own clock.

## HTML usage

```html
<div class="t-reason">
  <div class="t-reason-viewport">
    <div class="t-reason-scroll">
      <div class="t-reason-text">
        <p>…transcript…</p>
      </div>
    </div>
  </div>
</div>
```

The card clips a tall transcript; JS steps the scroll up
--reason-lines lines every --reason-hold and clones
.t-reason-text once so the offset can wrap by one copy's
height mid-hold — the loop never shows a jump. The edge fades
are a mask on the viewport (not gradients painted over the
text), so the card background can be anything.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--reason-hold` | `840ms` | sourced from `--p29-hold` |
| `--reason-step` | `500ms` | sourced from `--p29-step-dur` |
| `--reason-lines` | `2` | sourced from `--p29-lines` |
| `--reason-fade` | `28px` | sourced from `--p29-fade` |
| `--reason-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p29-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --reason-hold: 840ms;
  --reason-step: 500ms;
  --reason-lines: 2;
  --reason-fade: 28px;
  --reason-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-reason { position: relative; overflow: hidden; }
.t-reason-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  /* Edge fades are a mask, not painted gradients, so the card
     background can be anything. */
  -webkit-mask-image: linear-gradient(
    transparent 0,
    black var(--reason-fade),
    black calc(100% - var(--reason-fade)),
    transparent 100%);
  mask-image: linear-gradient(
    transparent 0,
    black var(--reason-fade),
    black calc(100% - var(--reason-fade)),
    transparent 100%);
}
.t-reason-scroll {
  position: absolute;
  left: 0;
  right: 0;
  transform: translateY(0);
  will-change: transform;
}
/* JS drives the tween:
     scroll.style.transition = 'transform var(--reason-step) var(--reason-ease)';
     scroll.style.transform  = 'translateY(-' + offset + 'px)';
   and wraps the offset by one copy's height with transition: none. */

@media (prefers-reduced-motion: reduce) {
  .t-reason-scroll { transition: none !important; transform: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Clone the transcript once so the wrap is seamless, then step the
// scroll up --reason-lines lines every --reason-hold. The offset
// wraps by one copy's height the moment a step lands past it — the
// clone underneath makes the jump invisible.
const scroll = document.querySelector(".t-reason-scroll");
const text = scroll.querySelector(".t-reason-text");
scroll.appendChild(text.cloneNode(true));

const num = (name, fb) => {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name)
  );
  return Number.isFinite(v) ? v : fb;
};

let offset = 0;
(function step() {
  setTimeout(() => {
    const lineH = parseFloat(getComputedStyle(text).lineHeight) || 18;
    const stepPx = lineH * num("--reason-lines", 2);
    const dur = num("--reason-step", 500);
    const ease = getComputedStyle(document.documentElement)
      .getPropertyValue("--reason-ease").trim() || "ease-out";
    offset += stepPx;
    scroll.style.transition = "transform " + dur + "ms " + ease;
    scroll.style.transform = "translateY(" + (-offset) + "px)";
    setTimeout(() => {
      const copyH = text.offsetHeight;
      if (offset >= copyH) {
        offset -= copyH;
        scroll.style.transition = "none";
        scroll.style.transform = "translateY(" + (-offset) + "px)";
        void scroll.offsetWidth; // flush before the next tween
      }
      step();
    }, dur + 30);
  }, num("--reason-hold", 1200));
})();
```

