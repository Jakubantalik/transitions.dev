# Text morph

## When to use

Changing a short label in place when the old and new text share letters at the start or the end: "Copy code" to "Copied", "Follow" to "Following", "Check in" to "Checked in", "Save" to "Saved". The shared letters stay where they are; only the part that differs cross-blurs, while its width eases to the new text, so the label (and the button or tooltip around it) grows or shrinks smoothly. When the two texts share nothing ("Processing" to "Done"), use Text states swap instead.

## HTML usage

```html
<button class="btn"><span class="t-morph">Copy code</span></button>
```

Driven by JS (`morphText(el, next)`):
  1. Find the letters both texts share at the start and at the end.
  2. Rebuild the label as: shared start, a `.t-morph-swap` holding the
     old middle (`.t-morph-old`) and the new middle (`.t-morph-new`)
     in one grid cell, shared end.
  3. Pin the swap to the old middle's width, force a reflow, then add
     `.is-morphing` and set the new middle's width: the old part
     blurs out, the new part blurs in, the width eases.
  4. When it settles, put the plain text back.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--text-morph-dur` | `180ms` | cross-blur of the changing letters |
| `--text-morph-resize-dur` | `240ms` | width of the changing part |
| `--text-morph-blur` | `2px` | blur of the outgoing and incoming letters |
| `--text-morph-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | |

The `:root` defaults below match the copy tooltip on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once; every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --text-morph-dur: 180ms;
  --text-morph-resize-dur: 240ms;
  --text-morph-blur: 2px;
  --text-morph-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-morph {
  white-space: nowrap;
}
/* The changing part: both versions share one grid cell, so they
   cross-blur in place; the cell's width eases between them. */
.t-morph-swap {
  display: inline-grid;
  vertical-align: bottom;
  justify-items: start;
  transition: width var(--text-morph-resize-dur) var(--text-morph-ease);
}
.t-morph-swap > span {
  grid-area: 1 / 1;
  white-space: pre;
  transition:
    opacity var(--text-morph-dur) var(--text-morph-ease),
    filter  var(--text-morph-dur) var(--text-morph-ease);
}
.t-morph-new {
  opacity: 0;
  filter: blur(var(--text-morph-blur));
}
.t-morph-swap.is-morphing .t-morph-old {
  opacity: 0;
  filter: blur(var(--text-morph-blur));
}
.t-morph-swap.is-morphing .t-morph-new {
  opacity: 1;
  filter: blur(0);
}

@media (prefers-reduced-motion: reduce) {
  .t-morph-swap,
  .t-morph-swap > span { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required; keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Text morph: the letters both texts share stay put; only the part that
// differs cross-blurs, while its width eases to the new text.
const root = document.documentElement;
const ms = (name) => parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;

function morphText(el, next) {
  const prev = el.dataset.text ?? el.textContent;
  if (prev === next) return;
  el.dataset.text = next;
  clearTimeout(el._morphTimer);

  // Shared start (a) and shared end (b).
  let a = 0;
  while (a < prev.length && a < next.length && prev[a] === next[a]) a++;
  let b = 0;
  while (b < prev.length - a && b < next.length - a &&
         prev[prev.length - 1 - b] === next[next.length - 1 - b]) b++;

  const swap = document.createElement("span");
  swap.className = "t-morph-swap";
  const out = document.createElement("span");
  out.className = "t-morph-old";
  out.setAttribute("aria-hidden", "true");
  out.textContent = prev.slice(a, prev.length - b);
  const inn = document.createElement("span");
  inn.className = "t-morph-new";
  inn.textContent = next.slice(a, next.length - b);
  swap.append(out, inn);

  el.textContent = "";
  el.append(next.slice(0, a), swap, next.slice(next.length - b));

  swap.style.width = out.getBoundingClientRect().width + "px";
  void swap.offsetWidth; // force reflow so the width transitions
  swap.classList.add("is-morphing");
  swap.style.width = inn.getBoundingClientRect().width + "px";

  el._morphTimer = setTimeout(() => {
    el.textContent = next;
  }, Math.max(ms("--text-morph-dur"), ms("--text-morph-resize-dur")) + 40);
}
```

Call it with the element and the new text: `morphText(label, copied ? "Copied" : "Copy code")`. Keep `el.dataset.text` as the source of truth while a morph runs, so a quick second click starts from the right text.
