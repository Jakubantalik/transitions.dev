// Magnetic slider. While held, position is the pointer: no transition,
// so the thumb cannot lag the finger. On release the nearest stop wins
// and one spring carries thumb and fill there together.
const slider = document.querySelector(".t-mslider");
const STOPS = ["Off", "Low", "Medium", "High", "Max"];
const last = STOPS.length - 1;
let index = 2;
let dragging = false;

const px = (name) =>
  parseFloat(getComputedStyle(slider).getPropertyValue(name)) || 0;
const travel = () =>
  slider.getBoundingClientRect().width - px("--mslider-thumb") - px("--mslider-inset") * 2;

// One writer for both layers: the fill is cut to the thumb's centre, so
// the colour always ends under it however the two are sized.
function paint(ratio) {
  const w = slider.getBoundingClientRect().width;
  const x = travel() * ratio;
  const centre = px("--mslider-inset") + x + px("--mslider-thumb") / 2;
  slider.style.setProperty("--x", x.toFixed(2) + "px");
  slider.style.setProperty("--cut", (100 - (centre / w) * 100).toFixed(2) + "%");
  // At the first stop the fill would still show its rounded cap beside
  // the thumb, so collapse it entirely.
  slider.classList.toggle("is-min", ratio <= 0.0005);
}

function commit(i) {
  index = Math.max(0, Math.min(last, i));
  paint(index / last);
  slider.setAttribute("aria-valuenow", String(index + 1));
  slider.setAttribute("aria-valuetext", STOPS[index]);
}

function ratioFrom(e) {
  const r = slider.getBoundingClientRect();
  const x = e.clientX - r.left - px("--mslider-inset") - px("--mslider-thumb") / 2;
  return Math.max(0, Math.min(1, x / travel()));
}

slider.addEventListener("pointerdown", (e) => {
  dragging = true;
  try { slider.setPointerCapture(e.pointerId); } catch {}
  slider.classList.remove("is-snapping");
  slider.classList.add("is-grabbed");
  paint(ratioFrom(e));
});
slider.addEventListener("pointermove", (e) => {
  if (dragging) paint(ratioFrom(e));
});

function release(e) {
  if (!dragging) return;
  dragging = false;
  slider.classList.remove("is-grabbed");
  slider.classList.add("is-snapping");
  commit(Math.round(ratioFrom(e) * last));
  const dur = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--mslider-snap")
  ) || 380;
  setTimeout(() => slider.classList.remove("is-snapping"), dur + 40);
}
slider.addEventListener("pointerup", release);
slider.addEventListener("pointercancel", release);

// Keyboard: one stop per press, same spring as a release.
slider.addEventListener("keydown", (e) => {
  const step =
    e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 :
    e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  slider.classList.add("is-snapping");
  commit(index + step);
  setTimeout(() => slider.classList.remove("is-snapping"), 420);
});

commit(index);
addEventListener("resize", () => paint(index / last));
