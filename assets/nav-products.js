// The top bar's Products menu: opens on hover with a mouse, on click or tap
// otherwise; arrow keys move between items, Escape closes. Uses the
// .t-dropdown open and close classes the 3-dot menu uses.
(function () {
  "use strict";
  var root = document.querySelector("[data-nav-products]");
  if (!root) return;
  var btn = root.querySelector(".nav-products-btn");
  var menu = root.querySelector(".nav-products-menu");
  var fine = window.matchMedia ? window.matchMedia("(hover: hover) and (pointer: fine)") : { matches: false };
  var open = false, closing = null, leave = null;

  // The chevron does not rotate or flip: it is one line whose tip travels
  // through it, a little ahead of the ends, at the same width throughout.
  // Down to up and back in 168ms; an interrupted morph turns around from
  // where it is.
  var svg = btn.querySelector("svg");
  var arrow = null, morph = 0, raf = 0;
  if (svg) {
    svg.innerHTML = '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
    arrow = svg.firstChild;
  }
  function ease(x) { x = Math.max(0, Math.min(1, x)); return 1 - Math.pow(1 - x, 3); }
  function drawArrow(t) {
    // t = 0: down (tip at 8,10). t = 1: up (tip at 8,6.5).
    var tip = 10 - 3.5 * ease(t / 0.9);
    var end = 6.5 + 3.5 * ease((t - 0.1) / 0.9);
    arrow.setAttribute("d", "M4.5 " + end.toFixed(2) + "L8 " + tip.toFixed(2) + "L11.5 " + end.toFixed(2));
  }
  function morphArrow(to) {
    if (!arrow) return;
    cancelAnimationFrame(raf);
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { morph = to; drawArrow(to); return; }
    var from = morph, start = performance.now(), dur = 168 * Math.abs(to - from);
    (function step(now) {
      var k = dur ? Math.min(1, (now - start) / dur) : 1;
      morph = from + (to - from) * k;
      drawArrow(morph);
      if (k < 1) raf = requestAnimationFrame(step);
    })(start);
  }
  if (arrow) drawArrow(0);

  function set(on) {
    if (on === open) return;
    open = on;
    btn.setAttribute("aria-expanded", String(on));
    morphArrow(on ? 1 : 0);
    clearTimeout(closing);
    if (on) {
      menu.classList.remove("is-closing");
      void menu.offsetWidth;
      menu.classList.add("is-open");
    } else {
      menu.classList.remove("is-open");
      menu.classList.add("is-closing");
      closing = setTimeout(function () { menu.classList.remove("is-closing"); }, 160);
    }
  }
  function items() { return Array.prototype.slice.call(menu.querySelectorAll("a")); }

  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    set(fine.matches ? true : !open);
  });
  root.addEventListener("mouseenter", function () { if (fine.matches) { clearTimeout(leave); set(true); } });
  root.addEventListener("mouseleave", function () { if (fine.matches) leave = setTimeout(function () { set(false); }, 150); });
  document.addEventListener("click", function (e) { if (open && !root.contains(e.target)) set(false); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) { set(false); btn.focus(); }
  });
  btn.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); set(true); items()[0].focus(); }
  });
  menu.addEventListener("keydown", function (e) {
    var list = items(), i = list.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    if (e.key === "Tab" && !e.shiftKey && i === list.length - 1) set(false);
  });
})();
