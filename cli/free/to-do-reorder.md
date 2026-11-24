# To-do reorder

## When to use

Sortable lists: to-do items, playlist tracks, board columns, settings rows. The dragged row lifts and follows the pointer exactly while the rows it passes slide one slot aside, so the gap it will land in is always visible.

The DOM order changes only when the drop finishes, and the inline transforms are cleared in the same frame, so the reorder itself is never seen. Rows must be positioned or the dragged row passes behind its later siblings.

## HTML usage

```html
<ul class="t-reorder">
  <li class="t-reorder-item">…</li>
  <li class="t-reorder-item">…</li>
</ul>
```

Driven by pointer events (script below). While a row is held it
carries `.is-dragging` and a --dy of the pointer's travel; the rows
it passes take a transform of exactly one slot. On release the row
gets `.is-settling` and a --rest of the distance to its new slot.

The DOM order only changes when the settle ends, and the inline
transforms are cleared in the same frame, so the reorder itself is
never visible.

Rows must be positioned (`position: relative`), or the z-index on
the dragged row is ignored and a row dragged downwards passes
behind its later siblings.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--reorder-shift` | `220ms` | sourced from `--p37-shift-dur` |
| `--reorder-lift-dur` | `180ms` | sourced from `--p37-lift-dur` |
| `--reorder-drop` | `260ms` | sourced from `--p37-drop-dur` |
| `--reorder-lift` | `1.02` | sourced from `--p37-lift` |
| `--reorder-tilt` | `0.6deg` | sourced from `--p37-tilt` |
| `--reorder-gap` | `6px` | sourced from `--p37-gap` |
| `--reorder-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p37-ease` |
| `--reorder-drop-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p37-drop-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --reorder-shift: 220ms;
  --reorder-lift-dur: 180ms;
  --reorder-drop: 260ms;
  --reorder-lift: 1.02;
  --reorder-tilt: 0.6deg;
  --reorder-gap: 6px;
  --reorder-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --reorder-drop-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-reorder {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--reorder-gap);
  margin: 0;
  padding: 0;
  list-style: none;
}
/* Positioned, or the z-index below is ignored and a row dragged
   downwards passes behind its later siblings. */
.t-reorder-item {
  position: relative;
  z-index: 0;
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transform: translateY(0) scale(1) rotate(0deg);
  transition:
    transform var(--reorder-shift) var(--reorder-ease),
    box-shadow var(--reorder-lift-dur) var(--reorder-ease);
  will-change: transform;
}
/* The row under the pointer is off the flow's clock entirely, so it
   tracks the finger 1:1 instead of easing behind it. */
.t-reorder-item.is-dragging {
  z-index: 2;
  cursor: grabbing;
  transform:
    translateY(var(--dy, 0px))
    scale(var(--reorder-lift))
    rotate(var(--reorder-tilt));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  transition: box-shadow var(--reorder-lift-dur) var(--reorder-ease);
}
.t-reorder-item.is-settling {
  z-index: 2;
  animation: t-reorder-land var(--reorder-drop) var(--reorder-drop-ease) forwards;
}
@keyframes t-reorder-land {
  from {
    transform:
      translateY(var(--dy, 0px))
      scale(var(--reorder-lift))
      rotate(var(--reorder-tilt));
  }
  to { transform: translateY(var(--rest, 0px)) scale(1) rotate(0deg); }
}

@media (prefers-reduced-motion: reduce) {
  .t-reorder-item { transition: none !important; animation: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Pointer-driven reorder. The dragged row rides a transform and the
// rows it passes take exactly one slot of offset; the DOM order only
// changes when the drop finishes, so the reorder itself is never seen.
const list = document.querySelector(".t-reorder");
let drag = null;
let pending = null; // a drop still playing out its settle

const slot = () => {
  const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
  return list.children[0].getBoundingClientRect().height + gap;
};
const ms = (name, fb) => {
  const v = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name)
  );
  return Number.isFinite(v) ? v : fb;
};

list.addEventListener("pointerdown", (e) => {
  const item = e.target.closest(".t-reorder-item");
  if (!item || e.button !== 0) return;
  // Grabbing again mid-settle would let the old drop's cleanup wipe the
  // new drag's transforms, so commit it first.
  if (pending) { clearTimeout(pending.timer); pending.run(); }
  const rows = Array.from(list.children);
  drag = {
    item,
    rows,
    from: rows.indexOf(item),
    to: rows.indexOf(item),
    startY: e.clientY,
    step: slot(),
  };
  // Capture keeps the drag alive when the pointer leaves the row, but it
  // throws for a pointer the element never saw. The drag works without
  // it, so a failure here must not cost the lift.
  try { item.setPointerCapture(e.pointerId); } catch {}
  item.classList.add("is-dragging");
  item.style.setProperty("--dy", "0px");
});

list.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.startY;
  drag.item.style.setProperty("--dy", dy + "px");

  // Half a slot of travel commits to the next index.
  const to = Math.max(
    0,
    Math.min(drag.rows.length - 1, drag.from + Math.round(dy / drag.step))
  );
  if (to === drag.to) return;
  drag.to = to;

  drag.rows.forEach((row, i) => {
    if (row === drag.item) return;
    let shift = 0;
    if (drag.from < to && i > drag.from && i <= to) shift = -drag.step;
    if (drag.from > to && i >= to && i < drag.from) shift = drag.step;
    row.style.transform = `translateY(${shift}px)`;
  });
});

function end() {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.item.classList.remove("is-dragging");
  d.item.style.setProperty("--rest", (d.to - d.from) * d.step + "px");
  d.item.classList.add("is-settling");

  const run = () => {
    if (!pending) return;
    pending = null;
    const ref = d.rows[d.to > d.from ? d.to + 1 : d.to];
    list.insertBefore(d.item, ref || null);
    d.rows.forEach((row) => {
      row.style.transition = "none";
      row.style.transform = "";
      row.style.removeProperty("--dy");
      row.style.removeProperty("--rest");
    });
    d.item.classList.remove("is-settling");
    void list.offsetHeight; // flush before transitions come back
    d.rows.forEach((row) => { row.style.transition = ""; });
  };
  pending = { run, timer: setTimeout(run, ms("--reorder-drop", 260)) };
}
list.addEventListener("pointerup", end);
list.addEventListener("pointercancel", end);
```

