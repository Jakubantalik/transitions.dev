/* Number: three ways to change a number.
 *
 *   import { createNumber } from "./number.js";
 *   const n = createNumber(el, { type: "spin", value: 100 });
 *   n.set(178);
 *
 * Types:
 *   spin    Digits roll through the numbers on a 3D drum, then land with a bounce.
 *   pop     Changed digits leave upward as the new ones rise in and land with a bounce.
 *   subtle  Changed digits cross-fade in place. For numbers that update often.
 *
 * No dependencies. Blur and distances adjust to the element's font size on
 * every change, from values locked per size (see `sizes`).
 * With prefers-reduced-motion the value just swaps.
 */

// `sizes` holds the values locked per font size, in px. Sizes in between
// interpolate; outside the table they scale from the nearest end. Blur and
// short distances don't read the same at every size, so these aren't a fixed
// ratio of the font.

const SPIN = {
  stepDur: 130,            // ms per number rolled
  ease: [0.35, -0.02, 0.43, 1],
  stagger: 90,             // ms between columns starting
  sideScale: 0.7,          // numbers above and below the middle
  sideOffset: 0.52,        // em from the middle
  sideOpacity: 0.17,
  centerScale: 0.9,        // middle number while rolling
  anticDur: 100,           // ms
  anticScale: 0.94,
  landDur: 740,            // ms of spring
  landPeak: 1.03,
  sizes: {
    12: { sideBlur: 0.8, centerBlur: 0.4, anticLift: 1.5 },
    16: { sideBlur: 1.2, centerBlur: 0.6, anticLift: 2 },
    24: { sideBlur: 2, centerBlur: 1, anticLift: 3 },
    44: { sideBlur: 6.2, centerBlur: 1.9, anticLift: 6.2 },
    72: { sideBlur: 10.2, centerBlur: 3.1, anticLift: 10.1 },
  },
};

const POP = {
  exitDur: 155,            // ms, old digit leaving
  exitEase: [0.65, 0, 0.35, 1],
  exitHold: 0.4,           // share of the exit before the old digit starts fading
  enterDelay: 50,          // ms after the old digit starts leaving that the new one appears
  moveDur: 175,            // ms, new digit travelling to the middle
  moveEase: [0.42, 0, 0.58, 1],
  dur: 500,                // ms of spring
  stagger: 40,             // ms, last two characters
  anticDur: 100,           // ms
  startScale: 0.7,         // new digit, at the bottom of the drum
  startOpacity: 0,
  landPeak: 1.03,
  sizes: {
    12: { distance: 6.2, exitDistance: 6.2, blur: 0.8, anticLift: 1.5 },
    16: { distance: 8.3, exitDistance: 8.3, blur: 1.2, anticLift: 2 },
    24: { distance: 12.5, exitDistance: 12.5, blur: 2, anticLift: 3 },
    44: { distance: 10.9, exitDistance: 22.9, blur: 6.2, anticLift: 6.2 },
    72: { distance: 37.4, exitDistance: 37.4, blur: 10.2, anticLift: 10.1 },
  },
};

const SUBTLE = {
  dur: 455,                // ms
  ease: [0.22, 1, 0.36, 1],
  sizes: {
    12: { distance: 1.5, blur: 0.4 },
    16: { distance: 2.2, blur: 0.6 },
    24: { distance: 3.4, blur: 1 },
    44: { distance: 6.2, blur: 3.9 },
    72: { distance: 10, blur: 3.1 },
  },
};

// Every type's values, live: change one and the next animation uses it.
export const settings = { spin: SPIN, pop: POP, subtle: SUBTLE };

const STEP_ANGLE = (50 * Math.PI) / 180; // drum angle between two digits
const ENTER_MS = 120;                    // rest to rolling
const FADE_END = 1.8;                    // steps from the middle where a digit is gone
const LAND_AT = 0.6;                     // steps from the middle where the target starts landing
const ARRIVE_AT = 0.29;                  // share of the spring where it reaches the middle
const CLEAR_MS = 200;                    // blur + neighbours clearing at the start of the spring
const SPRING_DAMP = 3;
const SPRING_FREQ = 3;

function injectStyles() {
  if (document.getElementById("number-styles")) return;
  const style = document.createElement("style");
  style.id = "number-styles";
  style.textContent = `
    .nfx { display: inline-flex; align-items: center; font-variant-numeric: tabular-nums; }
    .nfx-col { position: relative; display: inline-block; height: 1.3em; line-height: 1.3em; }
    .nfx-sizer { visibility: hidden; }
    .nfx-digit {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      will-change: transform, filter, opacity;
    }
    .nfx-sep { display: inline-block; height: 1.3em; line-height: 1.3em; }
    .nfx-char { position: relative; display: inline-block; line-height: 1.3em; }
    .nfx-old { position: absolute; inset: 0; text-align: center; }
  `;
  document.head.appendChild(style);
}

function reducedMotion() {
  return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function format(value) {
  return Math.round(value).toLocaleString("en-US");
}

function isDigit(ch) {
  return ch >= "0" && ch <= "9";
}

// The locked values for a font size.
function sizedValues(table, fontSize) {
  const stops = Object.keys(table).map(Number).sort((a, b) => a - b);
  const first = stops[0];
  const last = stops[stops.length - 1];
  const out = {};
  for (const key of Object.keys(table[first])) {
    if (fontSize <= first) {
      out[key] = table[first][key] * (fontSize / first);
    } else if (fontSize >= last) {
      out[key] = table[last][key] * (fontSize / last);
    } else {
      const hi = stops.findIndex((stop) => stop >= fontSize);
      const a = stops[hi - 1];
      const b = stops[hi];
      out[key] = table[a][key] + ((table[b][key] - table[a][key]) * (fontSize - a)) / (b - a);
    }
  }
  return out;
}

function easingCss(values) {
  return `cubic-bezier(${values.join(", ")})`;
}

function smooth(x) {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
}

// cubic-bezier values to a progress function.
function bezier([x1, y1, x2, y2]) {
  const at = (a, b, t) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 20; i++) {
      if (at(x1, x2, t) < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return at(y1, y2, t);
  };
}

// Damped wave over s = 0-1: starts at 1, crosses 0, swings negative (the
// bounce), rebounds once, ends at 0.
function wave(s) {
  if (s >= 1) return 0;
  return Math.exp(-SPRING_DAMP * s) * Math.cos(SPRING_FREQ * Math.PI * s) * (1 - s);
}
const WAVE_TROUGH = (() => {
  let low = 0;
  for (let i = 1; i < 400; i++) low = Math.min(low, wave(i / 400));
  return -low;
})();

/* ── spin ─────────────────────────────────────────────────────────── */

function buildColumns(el, str) {
  el.replaceChildren();
  const cols = [];
  for (const ch of str) {
    if (!isDigit(ch)) {
      const sep = document.createElement("span");
      sep.className = "nfx-sep";
      sep.textContent = ch;
      el.appendChild(sep);
      continue;
    }
    const col = document.createElement("span");
    col.className = "nfx-col";
    const sizer = document.createElement("span");
    sizer.className = "nfx-sizer";
    sizer.textContent = "0";
    col.appendChild(sizer);
    const cells = [];
    for (let d = 0; d < 10; d++) {
      const cell = document.createElement("span");
      cell.className = "nfx-digit";
      cell.textContent = String(d);
      col.appendChild(cell);
      cells.push(cell);
    }
    el.appendChild(col);
    cols.push({ cells, digit: +ch });
  }
  return cols;
}

function restColumn(col, digit) {
  col.cells.forEach((cell, d) => {
    cell.style.transform = "none";
    cell.style.filter = "none";
    cell.style.zIndex = "";
    cell.style.opacity = d === digit ? "1" : "0";
  });
}

// How a digit looks purely from its distance to the middle of the drum.
function lookAt(dist, middle) {
  const angle = Math.min(dist * STEP_ANGLE, Math.PI / 2);
  // 1 in the middle, 0 at one step away, below 0 further back.
  const face = (Math.cos(angle) - Math.cos(STEP_ANGLE)) / (1 - Math.cos(STEP_ANGLE));
  return {
    angle,
    scale: SPIN.sideScale + (middle - SPIN.sideScale) * face,
    back: dist <= 1
      ? 1 + (SPIN.sideOpacity - 1) * dist
      : SPIN.sideOpacity * (1 - (dist - 1) / (FADE_END - 1)),
  };
}

function placeColumn(col, pos, spread, middle, em, sized, land) {
  const radius = (SPIN.sideOffset * em) / Math.sin(STEP_ANGLE);
  col.cells.forEach((cell, d) => {
    let p = (((d - pos) % 10) + 10) % 10;
    if (p > 5) p -= 10;
    const dist = Math.abs(p);
    if (dist >= FADE_END) {
      cell.style.opacity = "0";
      return;
    }
    const look = lookAt(dist, middle);
    // Upcoming digits sit above the middle, so the drum turns downward.
    let y = (p < 0 ? 1 : -1) * radius * Math.sin(look.angle);
    const blur = (sized.centerBlur + (sized.sideBlur - sized.centerBlur) * Math.min(dist, 1)) * spread;
    // Only digits away from the middle follow `spread`.
    const away = Math.max(0, Math.min(1, (dist - 0.3) / 0.5));
    let opacity = look.back * (1 - (1 - spread) * away);
    let scale = look.scale;
    let z = 100 - Math.round(dist * 10);
    if (land && d === col.digit) {
      y = y * land.arrive + land.lift;
      scale = land.scale;
      opacity = land.opacity;
      z = 200;
    }
    cell.style.transform = `translateY(${y.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    cell.style.filter = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "none";
    cell.style.opacity = opacity.toFixed(3);
    cell.style.zIndex = String(z);
  });
}

function renderSpin(state, str) {
  const cols = buildColumns(state.el, str);
  cols.forEach((c) => restColumn(c, c.digit));
  state.cols = cols;
}

function animateSpin(state, str) {
  const { el } = state;
  const ease = bezier(SPIN.ease);
  const em = parseFloat(getComputedStyle(el).fontSize) || 16;
  const sized = sizedValues(SPIN.sizes, em);
  // Interrupted mid-roll: carry on from what is on screen, not the old target.
  const prev = state.cols || [];
  const prevDigits = prev.map((c) => {
    if (c.done || c.from === undefined) return c.digit;
    if (c.pos === undefined) return c.from;
    return ((Math.round(c.pos) % 10) + 10) % 10;
  });
  const cols = buildColumns(el, str);
  state.cols = cols;
  cols.forEach((c, i) => {
    // Aligned from the right, so 99 to 100 rolls the right columns.
    const fromIndex = prevDigits.length - cols.length + i;
    c.from = fromIndex >= 0 ? prevDigits[fromIndex] : 0;
    restColumn(c, c.from);
    if (c.from === c.digit) c.done = true;
  });

  const t0 = performance.now();
  const tick = () => {
    const t = performance.now() - t0;
    let running = false;
    cols.forEach((c, i) => {
      if (c.done) return;
      const local = t - i * SPIN.stagger;
      if (local <= 0) {
        running = true;
        return;
      }
      const total = (c.digit - c.from + 10) % 10;
      // Time per number is fixed, so a longer roll takes longer.
      const pos = c.from + total * ease(local / (total * SPIN.stepDur));
      c.pos = pos;
      const enter = Math.min(1, local / ENTER_MS);
      if (c.landAt === undefined && c.from + total - pos < LAND_AT) c.landAt = t;
      const since = c.landAt === undefined ? -1 : t - c.landAt;
      if (since >= SPIN.anticDur + SPIN.landDur) {
        restColumn(c, c.digit);
        c.done = true;
        return;
      }
      running = true;
      const middle = 1 + (SPIN.centerScale - 1) * enter;
      let spread = enter;
      let land = null;
      if (since >= 0) {
        // Start from how the target looks right now, so nothing jumps.
        if (!c.landFrom) c.landFrom = lookAt(c.from + total - pos, middle);
        const arrive = 1 - smooth(since / (SPIN.anticDur + SPIN.landDur * ARRIVE_AT));
        if (since < SPIN.anticDur) {
          const a = smooth(since / SPIN.anticDur);
          land = {
            scale: c.landFrom.scale + (SPIN.anticScale - c.landFrom.scale) * a,
            lift: -sized.anticLift * a,
            opacity: c.landFrom.back + (1 - c.landFrom.back) * a,
            arrive,
          };
        } else {
          const sp = since - SPIN.anticDur;
          const sn = sp / SPIN.landDur;
          const w = wave(sn);
          // Before the first crossing it rises out of the dip; after that the
          // wave swings around 100%, peaking at landPeak.
          land = {
            scale: sn < 1 / (2 * SPRING_FREQ)
              ? 1 + (SPIN.anticScale - 1) * w
              : 1 - ((SPIN.landPeak - 1) * w) / WAVE_TROUGH,
            lift: -sized.anticLift * w,
            opacity: 1,
            arrive,
          };
          spread = 1 - Math.min(1, sp / CLEAR_MS);
        }
      }
      placeColumn(c, pos, spread, middle, em, sized, land);
    });
    state.raf = running ? requestAnimationFrame(tick) : null;
  };
  tick();
}

/* ── pop ──────────────────────────────────────────────────────────── */

function renderChars(state, str) {
  state.el.replaceChildren(
    ...[...str].map((ch) => {
      const span = document.createElement("span");
      span.className = "nfx-char";
      span.textContent = ch;
      return span;
    })
  );
}

// The new digit's path as sampled keyframes: from the bottom of the drum it
// pulls back down, travels up into the middle on moveEase, and the spring takes
// its scale past 100% before it settles.
function popInFrames(sized) {
  const move = bezier(POP.moveEase);
  const total = Math.max(POP.anticDur + POP.dur, POP.moveDur);
  const frames = [];
  const count = 48;
  for (let i = 0; i <= count; i++) {
    const since = (i / count) * total;
    const travelled = move(since / POP.moveDur);
    let scale = POP.startScale;
    let lift = 0;
    let clear = 0;
    if (since < POP.anticDur) {
      lift = sized.anticLift * smooth(since / POP.anticDur);
    } else {
      const sp = since - POP.anticDur;
      const sn = sp / POP.dur;
      const w = wave(sn);
      scale = sn < 1 / (2 * SPRING_FREQ)
        ? 1 + (POP.startScale - 1) * w
        : 1 - ((POP.landPeak - 1) * w) / WAVE_TROUGH;
      lift = sized.anticLift * w;
      clear = Math.min(1, sp / CLEAR_MS);
    }
    const shown = Math.max(0, Math.min(1, travelled));
    frames.push({
      offset: i / count,
      transform: `translateY(${(sized.distance * (1 - travelled) + lift).toFixed(2)}px) scale(${scale.toFixed(4)})`,
      opacity: (POP.startOpacity + (1 - POP.startOpacity) * shown).toFixed(3),
      filter: `blur(${(sized.blur * (1 - clear)).toFixed(2)}px)`,
    });
  }
  return { frames, total };
}

function animatePop(state, prev, str) {
  const sized = sizedValues(POP.sizes, parseFloat(getComputedStyle(state.el).fontSize) || 16);
  // Only digits that changed pop: the leading characters both numbers share stay.
  let same = 0;
  while (same < prev.length && same < str.length && prev[same] === str[same]) same++;
  renderChars(state, str);
  const entrance = popInFrames(sized);
  [...state.el.children].forEach((span, i) => {
    if (i < same || !isDigit(str[i])) return;
    const fromEnd = str.length - 1 - i;
    const delay = fromEnd === 1 ? POP.stagger : fromEnd === 0 ? POP.stagger * 2 : 0;
    // A drum column: the sizer keeps the width, both digits sit on top of it.
    span.className = "nfx-col";
    span.replaceChildren();
    const sizer = document.createElement("span");
    sizer.className = "nfx-sizer";
    sizer.textContent = str[i];
    span.appendChild(sizer);
    let appearAt = delay;
    const oldChar = prev[prev.length - (str.length - i)];
    if (oldChar !== undefined && isDigit(oldChar)) {
      const old = document.createElement("span");
      old.className = "nfx-digit";
      old.textContent = oldChar;
      span.appendChild(old);
      // Leaves through the top of the drum. It stays solid for the start of
      // the exit, so the upward move reads before it fades.
      old.animate(
        [
          { offset: 0, transform: "translateY(0) scale(1)", opacity: 1, filter: "blur(0)" },
          { offset: POP.exitHold, opacity: 1 },
          { offset: 1, transform: `translateY(${-sized.exitDistance}px) scale(${POP.startScale})`, opacity: 0, filter: `blur(${sized.blur}px)` },
        ],
        { duration: POP.exitDur, delay, easing: easingCss(POP.exitEase), fill: "both" }
      ).finished.then(() => old.remove(), () => {});
      appearAt = delay + POP.enterDelay;
    }
    // The new digit appears just after the old one starts leaving.
    const fresh = document.createElement("span");
    fresh.className = "nfx-digit";
    fresh.textContent = str[i];
    span.appendChild(fresh);
    if (appearAt > 0) {
      fresh.animate([{ visibility: "hidden" }, { visibility: "hidden" }], { duration: appearAt });
    }
    fresh.animate(entrance.frames, { duration: entrance.total, delay: appearAt, fill: "backwards" });
  });
}

/* ── subtle ───────────────────────────────────────────────────────── */

function animateSubtle(state, prev, str, direction) {
  const sized = sizedValues(SUBTLE.sizes, parseFloat(getComputedStyle(state.el).fontSize) || 16);
  const distance = sized.distance;
  const blur = `blur(${sized.blur}px)`;
  // Compared position by position. A length change swaps every character.
  const sameLength = prev.length === str.length;
  renderChars(state, str);
  [...state.el.children].forEach((span, i) => {
    if (sameLength && prev[i] === str[i]) return;
    const timing = { duration: SUBTLE.dur, easing: easingCss(SUBTLE.ease) };
    if (sameLength) {
      const old = document.createElement("span");
      old.className = "nfx-old";
      old.textContent = prev[i];
      span.appendChild(old);
      old.animate(
        [
          { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
          { transform: `translateY(${-direction * distance}px)`, opacity: 0, filter: blur },
        ],
        { ...timing, fill: "forwards" }
      ).finished.then(() => old.remove(), () => {});
    }
    // Wrapped so the new digit moves independently of the old one beside it.
    const fresh = document.createElement("span");
    fresh.textContent = str[i];
    fresh.style.display = "inline-block";
    span.replaceChild(fresh, span.firstChild);
    fresh.animate(
      [
        { transform: `translateY(${direction * distance}px)`, opacity: 0, filter: blur },
        { transform: "translateY(0)", opacity: 1, filter: "blur(0)" },
      ],
      timing
    );
  });
}

/* ── public ───────────────────────────────────────────────────────── */

export function createNumber(el, { type = "spin", value = 0 } = {}) {
  injectStyles();
  el.classList.add("nfx");
  const state = { el, type, value, raf: null, cols: null };
  const initial = format(value);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", initial);
  if (type === "spin") renderSpin(state, initial);
  else renderChars(state, initial);

  return {
    get value() {
      return state.value;
    },
    // Shows a value with no animation.
    jump(next) {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      state.value = next;
      const str = format(next);
      el.setAttribute("aria-label", str);
      if (type === "spin") renderSpin(state, str);
      else renderChars(state, str);
    },
    set(next) {
      const prev = format(state.value);
      const str = format(next);
      const direction = next >= state.value ? 1 : -1;
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = null;
      state.value = next;
      el.setAttribute("aria-label", str);
      if (str === prev) return;
      const still = reducedMotion();
      if (type === "spin") {
        if (still) renderSpin(state, str);
        else animateSpin(state, str);
      } else if (still) {
        renderChars(state, str);
      } else if (type === "pop") {
        animatePop(state, prev, str);
      } else {
        animateSubtle(state, prev, str, direction);
      }
    },
  };
}
