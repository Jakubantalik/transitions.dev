# Text swap soft

## When to use

Updating a value or label in place without any movement: the amounts, totals and legend values of a chart when its period changes (Week, Month, Year), a price when the currency changes, a reading when the unit changes. The old text blurs out and the new text blurs in at the same time, in the same spot (a cross-blur, no gap between them), so a whole panel of values can change at once without anything sliding. The value's width eases from the old text to the new one, so whatever sits next to it (a badge after a total, a unit, an icon) glides to its new place instead of jumping. Use Text states swap when the change is a status that should read as a step (Processing to Done); use Text morph when the two texts share letters.

## HTML usage

```html
<span class="t-text-soft">$2,140</span>
```

Driven by JS (`softSwap(el, next)`):
  1. Put the old text and the new text in the element as two spans
     sharing one grid cell (`.t-text-soft-old`, `.t-text-soft-new`).
  2. Pin the element to the old text's width, force a reflow, then
     add `.is-swapping` and set the new text's width: the old text
     blurs out while the new text blurs in, together, and the width
     eases so the elements beside it move smoothly.
  3. When both settle, put the plain new text back and release the
     width.

For values aligned to the right (amounts in a list), set
`--text-soft-align: end` on the element so both texts share the
right edge.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--text-soft-dur` | `200ms` | the whole cross-blur, out and in together |
| `--text-soft-blur` | `2px` | |
| `--text-soft-ease` | `ease-in-out` | |
| `--text-soft-resize-dur` | `240ms` | the width, so neighbors glide to their new place |
| `--text-soft-resize-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | |

Drop the `:root` defaults into your global stylesheet once; every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --text-soft-dur: 200ms;
  --text-soft-blur: 2px;
  --text-soft-ease: ease-in-out;
  --text-soft-resize-dur: 240ms;
  --text-soft-resize-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
/* Both texts share one grid cell, so they cross-blur in place; the
   cell's width eases between them. */
.t-text-soft {
  display: inline-grid;
  justify-items: var(--text-soft-align, start);
  transition: width var(--text-soft-resize-dur) var(--text-soft-resize-ease);
}
.t-text-soft > span {
  grid-area: 1 / 1;
  white-space: pre;
  transition:
    filter  var(--text-soft-dur) var(--text-soft-ease),
    opacity var(--text-soft-dur) var(--text-soft-ease);
}
.t-text-soft-new {
  opacity: 0;
  filter: blur(var(--text-soft-blur));
}
.t-text-soft.is-swapping .t-text-soft-old {
  opacity: 0;
  filter: blur(var(--text-soft-blur));
}
.t-text-soft.is-swapping .t-text-soft-new {
  opacity: 1;
  filter: blur(0);
}

@media (prefers-reduced-motion: reduce) {
  .t-text-soft,
  .t-text-soft > span { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required; keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Soft swap: the old text blurs out while the new text blurs in, at the
// same time and in the same spot, and the width eases so the elements
// beside it glide to their new place.
const ms = (name) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;

function softSwap(el, next) {
  const prev = el.dataset.text ?? el.textContent;
  if (prev === next) return;
  el.dataset.text = next;
  clearTimeout(el._softTimer);

  const out = document.createElement("span");
  out.className = "t-text-soft-old";
  out.setAttribute("aria-hidden", "true");
  out.textContent = prev;
  const inn = document.createElement("span");
  inn.className = "t-text-soft-new";
  inn.textContent = next;

  const w0 = el.getBoundingClientRect().width;
  el.classList.remove("is-swapping");
  el.replaceChildren(out, inn);
  const w1 = inn.getBoundingClientRect().width;
  el.style.width = w0 + "px";
  void el.offsetWidth; // force reflow so every transition runs
  el.classList.add("is-swapping");
  el.style.width = w1 + "px";

  el._softTimer = setTimeout(() => {
    el.classList.remove("is-swapping");
    el.style.removeProperty("width");
    el.textContent = next;
  }, Math.max(ms("--text-soft-dur"), ms("--text-soft-resize-dur")) + 40);
}
```

Call it for every value that changes: `softSwap(totalEl, "$2,140")`. Values that stay the same are left alone, so only what changed blurs. Keep `el.dataset.text` as the source of truth while a swap runs, so a quick second change starts from the right text.
