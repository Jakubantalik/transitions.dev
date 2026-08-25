# Thinking states

## When to use

An AI status line that narrates what the agent is doing — "Setting up a workplace", "Running a command", "Browsing files". The line shimmers while a state holds (the same masked highlight as **shimmer text**), then swaps to the next state with the **text states swap** motion: the old line exits up through a small blur while the new one rises in from below.

Use this over a bare shimmer when the label changes while the work runs — the swap keeps the narration alive without a hard cut. Outgoing and incoming lines animate at the same time, so a swap costs one `--think-swap`, not two.

## HTML usage

```html
<span class="t-think" role="status">
  <span class="t-think-sizer" aria-hidden="true">Longest state here</span>
  <span class="t-think-text" data-text="Thinking…">Thinking…</span>
</span>
```

The shimmer runs on ::before (content: attr(data-text),
background-clip: text) while a state holds. JS swaps the line
every --think-hold: exit the outgoing copy (.is-exit) while
the incoming copy enters from below (.is-enter-start →
reflow → release), held back by --think-gap. Keep textContent
and data-text in sync so the shimmer copy always matches the
visible line.

The hidden sizer holds your longest state and is what gives
the box its width: lines are absolutely positioned across
that width, so every state centres in a box that never
resizes mid-swap. Drop the sizer if the line should hug
whatever state is showing, and set text-align: left on
.t-think if the states should share a left edge instead.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--think-hold` | `2000ms` | sourced from `--p28-hold` |
| `--think-swap` | `150ms` | sourced from `--p28-swap-dur` |
| `--think-gap` | `50ms` | sourced from `--p28-swap-gap` |
| `--think-distance` | `8px` | sourced from `--p28-swap-distance` |
| `--think-blur` | `2px` | sourced from `--p28-swap-blur` |
| `--think-shimmer` | `2000ms` | sourced from `--p28-shimmer-dur` |
| `--think-base` | `#7c7c7c` | sourced from `--p28-base` |
| `--think-highlight` | `#0d0d0d` | sourced from `--p28-highlight` |
| `--think-ease` | `ease-in-out` | sourced from `--p28-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --think-hold: 2000ms;
  --think-swap: 150ms;
  --think-gap: 50ms;
  --think-distance: 8px;
  --think-blur: 2px;
  --think-shimmer: 2000ms;
  --think-base: #7c7c7c;
  --think-highlight: #0d0d0d;
  --think-ease: ease-in-out;
}
```

## CSS

```css
/* Set your type on .t-think: the sizer only reports the right
   width if it is set in the same font as the line. */
.t-think { position: relative; display: inline-block; text-align: center; }
.t-think-sizer { display: block; visibility: hidden; white-space: nowrap; }
.t-think-text {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: block;
  color: var(--think-base);
  white-space: nowrap;
  transform: translateY(0);
  filter: blur(0);
  opacity: 1;
  transition:
    transform var(--think-swap) var(--think-ease),
    filter var(--think-swap) var(--think-ease),
    opacity var(--think-swap) var(--think-ease);
  will-change: transform, filter, opacity;
}
/* Shimmer sweeps the glyphs only (background-clip: text). */
.t-think-text::before {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(90deg,
    transparent 0%, transparent 40%,
    var(--think-highlight) 50%,
    transparent 60%, transparent 100%);
  background-size: 400% 100%;
  background-repeat: no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  -webkit-text-fill-color: transparent;
  animation: t-think-shimmer var(--think-shimmer) linear infinite;
}
@keyframes t-think-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: 0% 0; }
}
/* The outgoing line floats over the box so both halves animate. */
.t-think-text.is-exit {
  transform: translateY(calc(var(--think-distance) * -1));
  filter: blur(var(--think-blur));
  opacity: 0;
}
.t-think-text.is-enter-start {
  transition: none;
  transform: translateY(var(--think-distance));
  filter: blur(var(--think-blur));
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .t-think-text { transition: none !important; transform: none !important; filter: none !important; }
  .t-think-text::before { display: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Cycle the states: hold, then swap. Both lines are absolutely
// positioned, so the outgoing and incoming copies animate at the same
// time over a box the hidden sizer holds steady, and textContent +
// data-text move together so the shimmer's ::before copy always
// matches the visible line.
const box = document.querySelector(".t-think");
let live = box.querySelector(".t-think-text");
const STATES = ["Setting up a workplace", "Running a command", "Browsing files"];
let i = 0;

const ms = (name, fb) => {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name)
  );
  return Number.isFinite(v) ? v : fb;
};

(function cycle() {
  setTimeout(() => {
    const swap = ms("--think-swap", 150);
    const gap = ms("--think-gap", 50);
    const leaving = live;
    i = (i + 1) % STATES.length;

    leaving.classList.add("is-exit");

    const next = document.createElement("span");
    next.className = "t-think-text is-enter-start";
    next.textContent = STATES[i];
    next.setAttribute("data-text", STATES[i]);
    box.appendChild(next);
    live = next;

    const release = () => {
      void next.offsetWidth; // flush the enter-start rest state
      next.classList.remove("is-enter-start");
    };
    if (gap > 0) setTimeout(release, gap);
    else release();

    setTimeout(() => {
      leaving.remove();
      cycle();
    }, swap + gap);
  }, ms("--think-hold", 2000));
})();
```

