#!/usr/bin/env node
// Builds assets/community/beam.js: the libraries.dev border-beam effect
// ("pulse-outside", the outward halo) around the Community composer, without
// React.
//
// The stylesheet and the breathing driver come from the border-beam package
// source (LIBRARIES_DEV, default ../Libraries.dev), bundled with that repo's
// esbuild, so the halo matches the published package. The page gets the two
// generated stylesheets (light and dark site theme), the driver tables, and a
// small runtime that does what <BorderBeam> does in React: theme switching,
// glow scaling to the wrapped element, offscreen pause, reduced motion.
// Colors, strength, blur, saturation, brightness, hue shift and drift are all
// CSS variables on the wrapper (the 8 edge colors are --beam-c0 to --beam-c8,
// "r, g, b"), set in community.css and tunable live with
// assets/community/beam-dev.js.
//
//   node scripts/build-community-beam.mjs

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB_REPO = resolve(process.env.LIBRARIES_DEV || join(root, "..", "Libraries.dev"));
const PKG = join(LIB_REPO, "packages/border-beam");
const OUT = join(root, "assets/community/beam.js");

const version = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
const esbuildModule = await import(pathToFileURL(join(LIB_REPO, "node_modules/esbuild/lib/main.js")).href);
const esbuild = esbuildModule.build ? esbuildModule : esbuildModule.default;

// The composer: 20px corners, the package defaults for everything else.
const SIZE = "pulse-outside";
const RADIUS = 20;
const DURATION = 2.3;
const HUE_RANGE = 30;
const ID = (theme) => "cmb-" + theme;

// Each palette slot is painted from a CSS variable, so the colors live in
// community.css. The package only takes literal rgb() colors, so the build
// feeds it a sentinel per slot, rgb(1, 2, slot), and swaps those for
// var(--beam-c<slot>) in the generated CSS. Slot 5 is unused by this size.
const SLOTS = 9;
const SENTINEL = (i) => `rgb(1, 2, ${i})`;
// The package rotates pulse colors a full 360 degrees; here the hue drifts by
// --beam-drift degrees either way (read at mount), so the palette's balance
// holds.
const HUE_DRIFT = 12;
const HUE_PERIOD = 14;

const tmp = mkdtempSync(join(tmpdir(), "beam-"));
try {
  const stylesOut = join(tmp, "styles.mjs");
  await esbuild.build({
    entryPoints: [join(PKG, "src/styles.ts")],
    bundle: true, format: "esm", platform: "node", outfile: stylesOut, logLevel: "warning",
  });
  const S = await import(pathToFileURL(stylesOut).href);
  S.colorPalettes.tdev = {
    ...S.colorPalettes.colorful,
    border: S.colorPalettes.colorful.border.map((c, i) => ({ ...c, color: SENTINEL(i) })),
  };

  // Same resolution as BorderBeam.tsx for these props.
  const css = {};
  const driver = {};
  for (const theme of ["light", "dark"]) {
    const t = S.sizeThemePresets[SIZE][theme];
    css[theme] = S.generateBeamCSS({
      id: ID(theme),
      borderRadius: RADIUS,
      borderWidth: S.sizePresets[SIZE].borderWidth,
      duration: DURATION,
      strokeOpacity: t.strokeOpacity,
      innerOpacity: t.innerOpacity,
      bloomOpacity: t.bloomOpacity,
      innerShadow: t.innerShadow,
      size: SIZE,
      colorVariant: "tdev",
      staticColors: false,
      brightness: t.brightness ?? 1.3,
      saturation: t.saturation,
      hueRange: HUE_RANGE,
      theme,
      hairlineOpacity: t.hairlineOpacity,
      glowSize: 1,
      glowScale: 1,
    })
      .replace(/\s+/g, " ")
      .replace(/\s*([{};,])\s*/g, "$1")
      .trim()
      .replace(/rgba\(1,2,(\d),/g, "rgba(var(--beam-c$1),");
    if (/rgba?\(1,2,\d/.test(css[theme])) throw new Error("a palette sentinel was not replaced");
    for (let i = 0; i < SLOTS; i++) if (i !== 5 && css[theme].indexOf("--beam-c" + i) < 0) throw new Error("slot " + i + " is not painted");
    driver[theme] = S.getPulseDriverConfig(SIZE, theme, DURATION, HUE_RANGE, false, ID(theme));
    driver[theme].hue = { prop: "--beam-hue-" + ID(theme), range: HUE_DRIFT, period: HUE_PERIOD, continuous: false };
  }

  const runtime = `
import { registerPulseInstance } from "./pulseDriver";

const CSS = ${JSON.stringify(css)};
const DRIVER = ${JSON.stringify(driver)};
// The glow geometry is authored for a 350 by 140 element.
const REF_WIDTH = 350;
const REF_HEIGHT = 140;

// The package's breathing as authored: every oscillator's range and period.
// --beam-pulse scales the ranges around their middle (0 holds the glow
// still, 1 is the package, 2 twice as deep) and --beam-pulse-speed the pace
// (1 is the package, 2 twice as fast). refresh() applies both.
const BASE = JSON.parse(JSON.stringify(DRIVER));
function readNum(el, name, fallback, min, max) {
  const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
  return isNaN(v) ? fallback : Math.max(min, Math.min(max, v));
}

// Hue drift in degrees either way, from --beam-drift on the wrapper.
function readDrift(el) {
  const v = parseFloat(getComputedStyle(el).getPropertyValue("--beam-drift"));
  return isNaN(v) ? ${HUE_DRIFT} : Math.max(0, Math.min(180, v));
}

function siteTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function mount(el) {
  if (!el || el.hasAttribute("data-beam")) return;
  if (!document.getElementById("tdev-beam-css")) {
    const style = document.createElement("style");
    style.id = "tdev-beam-css";
    style.textContent = CSS.light + "\\n" + CSS.dark;
    document.head.appendChild(style);
  }
  const bloom = document.createElement("div");
  bloom.setAttribute("data-beam-bloom", "");
  el.appendChild(bloom);

  const reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let theme = null;
  let visible = true;
  let stop = null;

  // One shared, fps-capped loop breathes every instance while it is onscreen.
  function drive() {
    if (stop) { stop(); stop = null; }
    if (!visible || (reduce && reduce.matches)) return;
    stop = registerPulseInstance(el, DRIVER[theme]);
  }
  function setTheme() {
    const next = siteTheme();
    if (next === theme) return;
    if (theme) {
      DRIVER[theme].oscillators.forEach((o) => el.style.removeProperty(o.prop));
      if (DRIVER[theme].hue) el.style.removeProperty(DRIVER[theme].hue.prop);
    }
    theme = next;
    el.setAttribute("data-beam", "cmb-" + theme);
    drive();
  }
  function measure() {
    const child = el.firstElementChild;
    if (!child) return;
    const rect = child.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const clamp = (v) => Math.max(0.35, Math.min(4, v));
    el.style.setProperty("--pulse-glow-sx", String(+clamp(rect.width / REF_WIDTH).toFixed(3)));
    el.style.setProperty("--pulse-glow-sy", String(+clamp(rect.height / REF_HEIGHT).toFixed(3)));
  }

  refresh(el);
  setTheme();
  el.setAttribute("data-active", "");
  measure();
  if (window.ResizeObserver && el.firstElementChild) new ResizeObserver(measure).observe(el.firstElementChild);
  new MutationObserver(setTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (window.IntersectionObserver) {
    new IntersectionObserver((entries) => {
      entries.forEach((e) => { visible = e.isIntersecting; });
      if (visible) el.removeAttribute("data-paused"); else el.setAttribute("data-paused", "");
      drive();
    }, { rootMargin: "256px" }).observe(el);
  }
  if (reduce && reduce.addEventListener) reduce.addEventListener("change", drive);
}

// Re-reads the CSS-driven settings (the dev panel calls it after a change).
function refresh(el) {
  const drift = readDrift(el);
  const depth = readNum(el, "--beam-pulse", 1, 0, 2);
  const speed = readNum(el, "--beam-pulse-speed", 1, 0.25, 3);
  for (const theme of ["light", "dark"]) {
    DRIVER[theme].hue.range = drift;
    DRIVER[theme].oscillators.forEach((o, i) => {
      const b = BASE[theme].oscillators[i];
      const mid = (b.a + b.b) / 2;
      o.a = mid + (b.a - mid) * depth;
      o.b = mid + (b.b - mid) * depth;
      o.period = b.period / speed;
      o.delay = b.delay / speed;
    });
  }
}

window.TdevBeam = { mount, refresh };
`;

  const out = await esbuild.build({
    stdin: { contents: runtime, resolveDir: join(PKG, "src"), loader: "ts", sourcefile: "beam-runtime.ts" },
    bundle: true, format: "iife", target: "es2018", write: false, logLevel: "warning",
  });
  const header = `// Generated by scripts/build-community-beam.mjs from border-beam@${version}\n` +
    `// (libraries.dev), size "${SIZE}", colors from CSS variables. Do not edit; rebuild instead.\n`;
  writeFileSync(OUT, header + out.outputFiles[0].text);
  console.log("wrote", OUT.replace(root + "/", ""), Math.round(out.outputFiles[0].text.length / 1024) + " KB", "border-beam@" + version);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
