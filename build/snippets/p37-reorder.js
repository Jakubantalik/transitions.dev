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
