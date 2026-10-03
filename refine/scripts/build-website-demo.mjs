// Builds a standalone, browser-testable website-demo.html for the Refine tool.
//
// Like server/inject.mjs, this transforms the already-tested code inside
// demo.html instead of maintaining a second copy of the timeline UI. It:
//   1. Extracts the panel <style> and the module <script> (up to the demo-boxes
//      CUT_MARKER — i.e. panel + runtime + the guarded mock, NOT the demo App).
//   2. Rewrites the bare-specifier imports to absolute esm.sh URLs (so the page
//      needs no import map).
//   3. Composes a single self-contained HTML document with a transitions.dev
//      site header, a namespaced .wd-dd Menu-dropdown prototype, and a website
//      App that scans it — with window.__TX_REFINE_MOCK = true so the panel's
//      Refine / Accept / grouped-scan are served by demo.html's built-in mock
//      (no relay, no LLM, no CLI).
//
// Run: node scripts/build-website-demo.mjs   (or: npm run build:website-demo)

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEMO_PATH = fileURLToPath(new URL("../demo.html", import.meta.url));
// Repo root, so the generated page's `assets/...` (header icons) resolve.
const OUT_PATH = fileURLToPath(new URL("../../website-demo.html", import.meta.url));

// Absolute module URLs so the page works without an import map (same as inject.mjs).
const REACT_URL = "https://esm.sh/react@19";
const REACT_DOM_URL = "https://esm.sh/react-dom@19";
const REACT_DOM_CLIENT_URL = "https://esm.sh/react-dom@19/client";
const BORDER_BEAM_URL = "https://esm.sh/border-beam@1.2.0?deps=react@19,react-dom@19";

const CUT_MARKER = "// ── demo boxes ──";

function extractBetween(src, openRe, closeTag) {
  const open = src.match(openRe);
  if (!open) return null;
  const start = open.index + open[0].length;
  const end = src.indexOf(closeTag, start);
  if (end === -1) return null;
  return src.slice(start, end);
}

function buildJs(scriptSrc) {
  let js = scriptSrc;
  // Drop everything from the demo-only boxes onward (App + createRoot render);
  // we supply our own website App below. Keep the panel + runtime + mock.
  const cut = js.indexOf(CUT_MARKER);
  if (cut !== -1) js = js.slice(0, cut);

  // Rewrite the demo's bare-specifier imports to absolute URLs (mirrors inject.mjs).
  js = js
    .replace(/import\s+React\s+from\s+["']react["'];?/, `import React from "${REACT_URL}";`)
    .replace(/import\s+\{\s*createRoot\s*\}\s+from\s+["']react-dom\/client["'];?/, `import { createRoot } from "${REACT_DOM_CLIENT_URL}";`)
    .replace(/import\s+\{\s*createPortal\s*\}\s+from\s+["']react-dom["'];?/, `import { createPortal } from "${REACT_DOM_URL}";`)
    .replace(/import\s+\{\s*BorderBeam\s*\}\s+from\s+["']border-beam["'];?/, `import { BorderBeam } from "${BORDER_BEAM_URL}";`);

  return js.trim();
}

// Site-header CSS from refine.html hero (eyebrow + title + subtitle).
const HEADER_CSS = `
    /* ── transitions.dev hero header (verbatim from refine.html) ── */
    /* Saans — hero eyebrow + title (Medium / 500). */
    @font-face {
      font-family: "Saans";
      src: url("assets/fonts/Saans-Medium.woff2") format("woff2"),
           url("assets/fonts/Saans-Medium.woff") format("woff");
      font-weight: 500; font-style: normal; font-display: swap;
    }
    .app {
      position: relative; max-width: 1008px; margin: 0 auto; width: 100%;
      padding: 0 24px 64px;
      display: flex; flex-direction: column; align-items: center;
    }
    .header {
      position: relative; width: 100%; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: center;
      padding-top: 28px; padding-bottom: 47px;
    }
    .header #root { width: 100%; display: flex; flex-direction: column; align-items: center; }
    .hero-eyebrow, .title, .subtitle { text-align: center; }
    .hero-eyebrow {
      margin: 0; font-family: "Saans", var(--font-sans);
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 18px; font-weight: 500; line-height: 24px;
      letter-spacing: -0.005em; color: var(--text-muted);
    }
    .beta-badge {
      display: inline-flex; align-items: center; justify-content: center;
      height: 22px; padding: 0 8px; border-radius: 50px; overflow: hidden;
      font-family: "Inter", var(--font-sans);
      font-size: 13px; font-weight: 500; line-height: 16px;
      letter-spacing: 0; white-space: nowrap;
      color: rgba(94, 94, 94, 0.8);
      background: rgba(0, 0, 0, 0.03);
    }
    html[data-theme="dark"] .beta-badge {
      color: rgba(237, 237, 237, 0.7);
      background: rgba(255, 255, 255, 0.08);
    }
    .title {
      margin-top: 9px; font-family: "Saans", var(--font-sans);
      font-size: 36px; font-weight: 500; line-height: 34px;
      color: var(--text); letter-spacing: -0.01em;
    }
    .subtitle {
      margin-top: 16px; max-width: 417px; font-size: 16px; font-weight: 400;
      line-height: 24.2px; color: var(--text-muted);
    }
    @media (max-width: 639px) {
      .app { padding: 0 20px 48px; }
      .header { height: auto; padding-top: 24px; padding-bottom: 32px; }
    }
    @media (max-width: 640px) {
      .title { font-size: 26px; line-height: 32px; }
      .subtitle { font-size: 15px; line-height: 22px; }
    }`;

// transitions.dev site top-nav, ported verbatim from refine.html's
// <header class="site-nav">. This is Refine-tool UI chrome (NOT the prototype
// being inspected): the markup carries data-tl-ui AND sits outside the scanned
// #root/.demo-root, so DomScanner never lists the nav's transitions.
// Page shell tokens (--bg, --text, --text-muted, --chip-bg*, --icon-color*) and
// body background match refine.html so the bar reads identically. No nav pill is
// marked active on this page (Refine tool links to /refine.html only).
const NAV_CSS = `
    /* ── transitions.dev site nav (from refine.html, UI chrome — data-tl-ui) ── */
    html {
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    html, body { margin: 0; }
    :root {
      color-scheme: light;
      --bg: #fdfdfd;
      --text: #0d0d0d;
      --text-muted: #6c6c6c;
      --chip-bg: #f4f4f4;
      --chip-bg-hover: #f1f1f1;
      --chip-bg-pressed: #eae9e9;
      --icon-color: #0d0d0d;
      --icon-color-muted: rgba(13, 13, 13, 0.6);
      --material-bg: #ffffff;
      --material-shadow:
        0 4px 42px 0 rgba(0, 0, 0, 0.06),
        0 2px 6px 0 rgba(0, 0, 0, 0.05),
        0 0 0 1px rgba(0, 0, 0, 0.06);
      --menu-title: #8b8b8b;
      --menu-item: #1b1b1b;
      --menu-item-hover: #f4f4f5;
      --menu-item-active: #ededee;
      --menu-icon: #696969;
      --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --p5-dur: 200ms;
      --p5-blur: 2px;
      --p5-start-scale: 0.25;
      --p5-ease: ease-in-out;
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --bg: #121212;
      --text: #ffffff;
      --text-muted: rgba(202, 202, 202, 0.7);
      --chip-bg: rgba(255, 255, 255, 0.07);
      --chip-bg-hover: rgba(255, 255, 255, 0.1);
      --chip-bg-pressed: rgba(255, 255, 255, 0.08);
      --icon-color: #ededed;
      --icon-color-muted: rgba(237, 237, 237, 0.6);
      --material-bg: #181818;
      --material-shadow:
        0 1px 3px 0 rgba(0, 0, 0, 0.04),
        inset 0 1px 0 0 rgba(255, 255, 255, 0.04),
        inset 0 0 0 1px rgba(0, 0, 0, 0.06),
        inset 0 -1px 0 0 rgba(0, 0, 0, 0.06),
        inset 0 0 0 1px rgba(196, 196, 196, 0.08);
      --menu-title: #767676;
      --menu-item: #ededed;
      --menu-item-hover: rgba(255, 255, 255, 0.08);
      --menu-item-active: rgba(255, 255, 255, 0.12);
      --menu-icon: rgba(237, 237, 237, 0.6);
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      min-height: 100vh;
      transition: background-color 0.2s ease, color 0.2s ease;
    }
    .site-nav { width: 100%; }
    .site-nav-inner {
      max-width: 1280px; margin: 0 auto; padding: 16px 24px;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
    }
    .site-nav-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .site-nav-right { display: flex; align-items: center; gap: 8px; }

    .brand {
      display: inline-flex; align-items: center; gap: 4px;
      height: 35px; padding: 5px 0; text-decoration: none;
      color: var(--text); flex-shrink: 0;
    }
    .brand-mark {
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; color: var(--icon-color);
    }
    .brand-mark svg { width: 18px; height: 20.295px; display: block; }
    .brand-word {
      font-size: 15px; font-weight: 500; line-height: 1;
      letter-spacing: -0.01em; white-space: nowrap;
    }
    .brand-word-dim { color: var(--text-muted); }

    .site-nav-menu { display: flex; align-items: center; gap: 8px; }
    .nav-pill {
      display: inline-flex; align-items: center; justify-content: center;
      height: 36px; padding: 0 13px; border-radius: 50px;
      font-family: var(--font-sans); font-size: 13px; font-weight: 500;
      line-height: 16px; color: var(--text-muted); text-decoration: none;
      white-space: nowrap;
      transition: background-color 0.15s ease, color 0.15s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .nav-pill:hover { color: var(--text); background: rgba(0, 0, 0, 0.03); }
    html[data-theme="dark"] .nav-pill:hover { background: rgba(255, 255, 255, 0.06); }
    .nav-pill--active { color: var(--text); background: rgba(0, 0, 0, 0.03); }
    html[data-theme="dark"] .nav-pill--active { background: rgba(255, 255, 255, 0.06); }
    .nav-pill:focus-visible { outline: 2px solid var(--icon-color); outline-offset: 2px; }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border: 0; border-radius: 50px;
      background: var(--chip-bg); color: var(--icon-color); cursor: pointer;
      text-decoration: none; padding: 0;
      transition: background-color 0.15s ease, color 0.15s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .icon-btn:hover { background: var(--chip-bg-hover); }
    .icon-btn:active { background: var(--chip-bg-pressed); }
    .icon-btn:focus-visible { outline: 2px solid var(--icon-color); outline-offset: 2px; }
    .icon-btn svg {
      width: 16px; height: 16px; display: block; fill: currentColor;
      color: var(--icon-color-muted); transition: color 0.15s ease;
    }
    .icon-btn svg.icon-x { width: 16px; height: 17px; }
    .icon-btn:hover svg { color: var(--icon-color); }

    .icon-btn-pill {
      display: inline-flex; align-items: center; justify-content: center;
      gap: 6px; height: 36px; width: auto; min-width: 36px; padding: 0 13px;
      border: 0; border-radius: 50px; background: var(--chip-bg);
      color: var(--icon-color-muted); font-family: var(--font-sans);
      font-size: 13px; font-weight: 500; line-height: 16px; cursor: pointer;
      text-decoration: none;
      transition: background-color 0.15s ease, color 0.15s ease;
      -webkit-tap-highlight-color: transparent;
    }
    .icon-btn-pill:hover { background: var(--chip-bg-hover); color: var(--icon-color); }
    .icon-btn-pill:active { background: var(--chip-bg-pressed); }
    .icon-btn-pill:focus-visible { outline: 2px solid var(--icon-color); outline-offset: 2px; }
    .icon-btn-pill svg {
      width: auto; height: 16px; max-width: 16px; display: block;
      color: inherit; transition: color 0.15s ease;
    }
    .icon-btn-pill .pill-label { display: inline-block; color: inherit; }
    .icon-btn-pill[data-loading="true"] .pill-label { opacity: 0.5; }

    .theme-icon-stack { position: relative; display: inline-flex; width: 16px; height: 16px; }
    .theme-icon {
      position: absolute; inset: 0; width: 16px; height: 16px; display: block;
      transform-origin: center; pointer-events: none; user-select: none;
      transition:
        opacity   var(--p5-dur) var(--p5-ease),
        filter    var(--p5-dur) var(--p5-ease),
        transform var(--p5-dur) var(--p5-ease);
      opacity: 0; transform: scale(var(--p5-start-scale));
    }
    .theme-icon-moon { filter: blur(var(--p5-blur)); }
    .theme-icon-sun  { filter: brightness(0) invert(1) blur(var(--p5-blur)); }
    .theme-icon-stack[data-active="moon"] .theme-icon-moon,
    .theme-icon-stack[data-active="sun"]  .theme-icon-sun { opacity: 0.6; transform: scale(1); }
    .theme-icon-stack[data-active="moon"] .theme-icon-moon { filter: blur(0); }
    .theme-icon-stack[data-active="sun"]  .theme-icon-sun  { filter: brightness(0) invert(1); }
    .theme-toggle:hover .theme-icon-stack[data-active="moon"] .theme-icon-moon,
    .theme-toggle:hover .theme-icon-stack[data-active="sun"]  .theme-icon-sun { opacity: 1; }
    .theme-icon-stack.no-anim .theme-icon { transition: none; }

    @media (max-width: 639px) {
      .icon-btn-pill .pill-label { display: none; }
      .icon-btn-pill { width: 36px; padding: 0; min-width: 36px; }
      #gh-stars-btn .pill-label { display: inline-block; }
      #gh-stars-btn { width: auto; padding: 0 12px; }
    }
    @media (max-width: 640px) {
      .site-nav-menu { gap: 2px; }
      .nav-pill { padding: 0 10px; }
      .brand-word { display: none; }
    }
    @media (max-width: 460px) {
      .site-nav-inner { padding: 12px 16px; gap: 8px; }
      .nav-pill { padding: 0 8px; font-size: 12px; }
    }`;

// Namespaced Menu-dropdown CSS (transitions.dev #05). `.wd-dd-*` so it never
// collides with the panel's own `.t-dropdown`. Authored slightly OFF the motion
// tokens (400ms open / close, ease-out).
// Secondary pill button — verbatim from skill.html (.skill-btn + --secondary).
const SKILL_BTN_CSS = `
    /* ── skill.html CTA buttons (used by .wd-dd-trigger) ── */
    .skill-btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      height: 40px; padding: 0 16px;
      border: 0; border-radius: 26px;
      font-family: var(--font-sans);
      font-size: 13px; font-weight: 500; line-height: 13px;
      cursor: pointer; text-decoration: none; white-space: nowrap;
      -webkit-tap-highlight-color: transparent;
      transition: background-color 200ms cubic-bezier(0.22, 1, 0.36, 1),
                  color 200ms cubic-bezier(0.22, 1, 0.36, 1),
                  scale 0.12s ease;
    }
    button.skill-btn { -webkit-appearance: none; appearance: none; }
    .skill-btn--secondary { background: #f5f5f5; color: #17181c; }
    .skill-btn--secondary:hover { background: #ececec; }
    .skill-btn--secondary:active { scale: 0.96; }
    html[data-theme="dark"] .skill-btn--secondary {
      background: rgba(255, 255, 255, 0.08); color: #ededed;
    }
    html[data-theme="dark"] .skill-btn--secondary:hover {
      background: rgba(255, 255, 255, 0.12);
    }
    .skill-btn svg {
      width: 16px; height: 16px; display: block; fill: currentColor;
    }
    .skill-btn .wd-dd-caret { fill: none; flex-shrink: 0; opacity: 0.5; }
    .skill-btn:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }`;

const DROPDOWN_CSS = `
    /* ── website demo: Menu dropdown (transitions.dev #05), namespaced .wd-dd-* ── */
    /* demo.html's .demo-root ships 48px/120px padding (it carries a demo-header
       there); the website demo dropdown sits inside .header like refine's
       .skill-cta-row, so drop all of it and let .header own the rhythm. */
    .demo-root { padding: 0; width: 100%; }
    .wd-dd-wrap {
      display: flex; justify-content: center; width: 100%;
      margin-top: 17px; padding: 0;
    }
    .wd-dd { position: relative; display: inline-block; }

    .wd-dd-menu {
      position: absolute; top: calc(100% + 8px); left: 0;
      min-width: 208px; padding: 6px;
      background: var(--material-bg);
      border-radius: 12px;
      box-shadow: var(--material-shadow);
      text-align: left;
      transform-origin: top left;
      /* Intentionally off-token motion so Refine has obvious things to fix:
         scale 0.8 (vs the 0.97 dropdown token — over-pops), 300ms (off-grid,
         snaps to the 250ms Medium token) and the generic ease curve (vs the
         transitions.dev Smooth ease out). One fix per kind: scale, duration, easing.
         The scale is var-backed (--wd-dd-scale) so Refine's Apply can write it
         live — readElValueHint only drives the DOM through a CSS variable. */
      --wd-dd-scale: 0.8;
      transform: scale(var(--wd-dd-scale)) translateZ(0);
      opacity: 0;
      pointer-events: none;
      transition:
        transform 300ms ease,
        opacity   300ms ease;
      will-change: transform, opacity;
      z-index: 5;
    }
    .wd-dd.is-open .wd-dd-menu {
      transform: scale(1) translateZ(0);
      opacity: 1;
      pointer-events: auto;
    }
    .wd-dd.is-closing .wd-dd-menu {
      transform: scale(var(--wd-dd-scale)) translateZ(0);
      opacity: 0;
      pointer-events: none;
      transition:
        transform 300ms ease,
        opacity   300ms ease;
    }
    /* Section header — mirrors the Refine dropdown's .tl-menu-section
       (Inter Regular 11/14 #8b8b8b, pt-12 pb-8 pl-8; no uppercase). */
    /* First (only) section header — match the Refine app's .tl-menu-group:first-child
       4px top pad so it doesn't float far below the menu's 6px padding. */
    .wd-dd-menu-title {
      padding: 4px 8px 8px; font-size: 11px; font-weight: 400;
      line-height: 14px; color: var(--menu-title);
    }
    /* Rows — mirror demo.html .dd-item: instant hover/active, no transition
       (hover-only feedback is not part of the dropdown open/close group). */
    .wd-dd-item {
      display: flex; align-items: center; gap: 8px; width: 100%;
      min-height: 32px; padding: 0 8px;
      font-family: inherit;
      font-size: 13px; font-weight: 400; line-height: 16px; color: var(--menu-item);
      background: transparent; border: 0; border-radius: 8px; cursor: pointer;
      text-align: left;
    }
    .wd-dd-item:hover { background: var(--menu-item-hover); }
    .wd-dd-item:active { background: var(--menu-item-active); }
    .wd-dd-item-icon { display: flex; flex: none; color: var(--menu-icon); }

    @media (prefers-reduced-motion: reduce) {
      .wd-dd-menu { transition: none !important; }
    }

    /* Panel dropdowns portal into #root inside .header — keep menus left-aligned. */
    .tl-menu { text-align: left; }`;

// The website App + the Menu-dropdown component, appended after the extracted
// panel/runtime/mock code (so `h`, hooks, TransitionRegistry, DomScanner,
// TimelineCtx, TimelinePanel, Ic, cx, BorderBeam are all in scope).
const APPENDED_JS = `
    // ── website demo: Menu dropdown (transitions.dev #05 — open/close phases) ──
    // Namespaced .wd-dd-* so it can never collide with the panel's own .t-dropdown.
    // JS owns .is-open / .is-closing with a setTimeout cleanup (per the skill), so
    // the closing scale animates before the menu resets to its pre-open rest state.
    function BoxDropdown(){
      const [open,setOpen]=useState(false);
      const [closing,setClosing]=useState(false);
      const ref=useRef(null);
      const toRef=useRef(null);
      const close=useCallback(()=>{
        setOpen(false); setClosing(true);
        if(toRef.current) clearTimeout(toRef.current);
        toRef.current=setTimeout(()=>setClosing(false),400); // --close-dur
      },[]);
      const toggle=useCallback(()=>{ if(open){ close(); } else { setClosing(false); setOpen(true); } },[open,close]);
      useEffect(()=>{
        const onDoc=e=>{ if(ref.current && !ref.current.contains(e.target)) close(); };
        const onKey=e=>{ if(e.key==="Escape") close(); };
        document.addEventListener("click",onDoc);
        document.addEventListener("keydown",onKey);
        return()=>{ document.removeEventListener("click",onDoc); document.removeEventListener("keydown",onKey); };
      },[close]);
      const item=(label)=>h("button",{className:"wd-dd-item",type:"button",onClick:close},label);
      return h("div",{className:cx("wd-dd",open&&"is-open",closing&&"is-closing"),ref},
        h("button",{className:"skill-btn skill-btn--secondary wd-dd-trigger",type:"button","aria-haspopup":"menu",
          "data-tl-ui":"",
          "aria-expanded":open?"true":"false",
          onClick:e=>{ e.stopPropagation(); toggle(); }},
          "Dropdown menu",
          h("svg",{className:"wd-dd-caret",width:16,height:16,viewBox:"0 0 16 16",fill:"none","aria-hidden":"true"},
            h("path",{d:"M4 6l4 4 4-4",stroke:"currentColor",strokeWidth:1.6,strokeLinecap:"round",strokeLinejoin:"round"}))),
        h("div",{className:"wd-dd-menu",role:"menu","data-origin":"top-left","aria-hidden":open?"false":"true"},
          h("div",{className:"wd-dd-menu-title"},"Actions"),
          item("Item 1"),
          item("Item 2"),
          item("Item 3")));
    }

    // Website App — models the demo App: a scanned demo-root + the TimelinePanel.
    function WebsiteApp(){
      const rootRef=useRef(null);
      const registry=useMemo(()=>new TransitionRegistry(),[]);
      const [activeId,setActiveId]=useState(null);
      useEffect(()=>{
        const root=rootRef.current||document.body;
        const scanner=new DomScanner(root,registry);
        scanner.start();
        return()=>scanner.stop();
      },[registry]);
      const ctx=useMemo(()=>({registry,activeId,setActiveId}),[registry,activeId]);
      return h(TimelineCtx.Provider,{value:ctx},
        h("div",{ref:rootRef,className:"demo-root"},
          h("div",{className:"wd-dd-wrap"}, h(BoxDropdown))),
        h(TimelinePanel));
    }

    createRoot(document.getElementById("root")).render(h(WebsiteApp));`;

// Pre-scanned grouping for the Menu dropdown — captured from a real agent/scan
// run against this exact prototype, then saved here with human-friendly member
// names. Shipping it as window.__TX_SEED_GROUPS means the public demo shows the
// already-named, already-grouped result INSTANTLY: no relay, no LLM, no scan
// (online users never see a "scanning" state). Selectors/timings mirror the live
// DOM so editing a lane drives the real transition and Apply/Accept still work.
const SEED_GROUPS = [
  {
    id: "menu-dropdown", label: "Menu dropdown", component: null,
    phases: [
      {
        id: "menu-dropdown:open", phase: "open", label: "Open",
        stateTarget: ".wd-dd", fromState: null, toState: ".is-open",
        members: [
          { id: "m1", label: "Menu surface", selector: "div.wd-dd-wrap > div.wd-dd > div.wd-dd-menu",
            propertyTimings: [
              { property: "transform", durationMs: 300, delayMs: 0, easing: "ease" },
              { property: "opacity", durationMs: 300, delayMs: 0, easing: "ease" } ] },
        ],
      },
      {
        id: "menu-dropdown:close", phase: "close", label: "Close",
        stateTarget: ".wd-dd", fromState: ".is-open", toState: null,
        members: [
          { id: "m1", label: "Menu surface", selector: "div.wd-dd-wrap > div.wd-dd > div.wd-dd-menu",
            propertyTimings: [
              { property: "transform", durationMs: 300, delayMs: 0, easing: "ease" },
              { property: "opacity", durationMs: 300, delayMs: 0, easing: "ease" } ] },
        ],
      },
    ],
  },
];

// Nav chrome scripts — theme toggle + live GitHub stars (from refine.html).
const HEAD_THEME_SCRIPT = `  <script>
    (function () {
      try {
        if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
          // Page chrome AND the embedded Refine panel follow the same switch on
          // this showcase page (data-tl-theme drives the panel + its portals).
          document.documentElement.setAttribute("data-theme", "dark");
          document.documentElement.setAttribute("data-tl-theme", "dark");
        }
      } catch (e) {}
    })();
  </script>`;

const NAV_SCRIPTS = `  <script>
    (function () {
      var html = document.documentElement;
      var iconStack = document.getElementById("theme-icon-stack");
      var userOverride = false;
      function currentSystemTheme() {
        return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
          ? "dark" : "light";
      }
      function applyTheme(next) {
        if (next === "dark") html.setAttribute("data-theme", "dark");
        else html.removeAttribute("data-theme");
        // Keep the embedded Refine panel (and its body-portaled menus/toasts) in
        // lockstep with the page toggle on this showcase page.
        html.setAttribute("data-tl-theme", next === "dark" ? "dark" : "light");
        if (iconStack) {
          iconStack.classList.remove("no-anim");
          iconStack.setAttribute("data-active", next === "dark" ? "sun" : "moon");
        }
      }
      applyTheme(currentSystemTheme());
      if (iconStack) iconStack.classList.add("no-anim");
      var themeBtn = document.getElementById("theme-toggle");
      if (themeBtn) {
        themeBtn.addEventListener("click", function () {
          userOverride = true;
          var current = html.getAttribute("data-theme") === "dark" ? "dark" : "light";
          applyTheme(current === "dark" ? "light" : "dark");
        });
      }
      if (window.matchMedia) {
        var mq = window.matchMedia("(prefers-color-scheme: dark)");
        var listener = function () {
          if (userOverride) return;
          applyTheme(mq.matches ? "dark" : "light");
        };
        if (mq.addEventListener) mq.addEventListener("change", listener);
        else if (mq.addListener) mq.addListener(listener);
      }

      var STAR_CACHE_KEY = "tdev:gh-stars";
      var STAR_CACHE_TTL = 5 * 60 * 1000;
      var STAR_REPO = "Jakubantalik/transitions.dev";
      var pill = document.getElementById("gh-stars-btn");
      var countEl = document.getElementById("gh-stars-count");
      function formatStars(n) {
        if (n == null || !Number.isFinite(n)) return "";
        if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\\.0$/, "") + "k";
        return String(n);
      }
      function paintStars(n) {
        if (!pill || !countEl) return;
        countEl.textContent = formatStars(n);
        pill.removeAttribute("data-loading");
        pill.setAttribute("aria-label", "GitHub repository \\u2014 " + (n === 1 ? "1 star" : n + " stars"));
      }
      function readStarCache(allowStale) {
        try {
          var cached = sessionStorage.getItem(STAR_CACHE_KEY);
          if (!cached) return null;
          var parsed = JSON.parse(cached);
          if (!parsed || !Number.isFinite(parsed.n)) return null;
          if (allowStale || Date.now() - parsed.t < STAR_CACHE_TTL) return parsed.n;
        } catch (e) {}
        return null;
      }
      function saveStarCache(n) {
        try { sessionStorage.setItem(STAR_CACHE_KEY, JSON.stringify({ n: n, t: Date.now() })); } catch (e) {}
      }
      function releaseStarLoading(fallbackLabel) {
        if (!pill || !pill.hasAttribute("data-loading")) return;
        if (countEl && fallbackLabel) countEl.textContent = fallbackLabel;
        pill.removeAttribute("data-loading");
      }
      function parseShieldsStars(data) {
        if (!data) return null;
        var raw = data.message != null ? data.message : data.value;
        if (raw == null) return null;
        raw = String(raw).replace(/,/g, "");
        if (/^\\d+(?:\\.\\d+)?k$/i.test(raw)) return Math.round(parseFloat(raw) * 1000);
        var n = parseInt(raw, 10);
        return Number.isFinite(n) ? n : null;
      }
      var freshCache = readStarCache(false);
      if (freshCache != null) paintStars(freshCache);
      function fetchGitHubStars() {
        if (!window.fetch) {
          var stale = readStarCache(true);
          if (stale != null) paintStars(stale);
          else releaseStarLoading("Star");
          return;
        }
        fetch("https://api.github.com/repos/" + STAR_REPO, { headers: { Accept: "application/vnd.github+json" } })
          .then(function (r) { if (!r.ok) throw new Error("github " + r.status); return r.json(); })
          .then(function (data) {
            if (!data || !Number.isFinite(data.stargazers_count)) throw new Error("github parse");
            paintStars(data.stargazers_count);
            saveStarCache(data.stargazers_count);
          })
          .catch(function () {
            return fetch("https://img.shields.io/github/stars/" + STAR_REPO + ".json")
              .then(function (r) { if (!r.ok) throw new Error("shields " + r.status); return r.json(); })
              .then(function (data) {
                var n = parseShieldsStars(data);
                if (n == null) throw new Error("shields parse");
                paintStars(n);
                saveStarCache(n);
              });
          })
          .catch(function () {
            var stale = readStarCache(true);
            if (stale != null) paintStars(stale);
            else releaseStarLoading("Star");
          });
      }
      fetchGitHubStars();
    })();
  </script>`;

function buildHtml({ css, js }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <title>Transitions \u2014 Refine demo</title>
  <link rel="stylesheet" href="assets/fonts/fonts.css" />
  <link rel="stylesheet" href="assets/fonts/inter-700.css" />
${HEAD_THEME_SCRIPT}
  <style>
${css}
${NAV_CSS}
${HEADER_CSS}
${SKILL_BTN_CSS}
${DROPDOWN_CSS}
  </style>
</head>
<body>
  <!-- Site top-nav (UI chrome): data-tl-ui + outside #root so the Refine scanner skips it. -->
  <header class="site-nav" data-tl-ui>
    <div class="site-nav-inner">
      <div class="site-nav-left">
        <a class="brand" href="/" aria-label="Transitions.dev home">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 18 20.2947" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path fill-rule="evenodd" clip-rule="evenodd" d="M9 0L12.5409 1.99176L11.5604 3.73491L10 2.8572V5.14735H8V2.8572L6.43962 3.73491L5.45909 1.99176L9 0ZM14.3613 3.01571L18 5.0625V9.14735H16V7.3794L14.0359 8.51337L13.0359 6.78132L14.9804 5.65867L13.3807 4.75886L14.3613 3.01571ZM4.61925 4.75887L3.01961 5.65867L4.9641 6.78132L3.9641 8.51337L2 7.3794L2 9.14735H0L1.54972e-06 5.0625L3.63873 3.01572L4.61925 4.75887ZM2 11.1473V12.9153L3.9641 11.7813L4.9641 13.5134L3.01961 14.636L4.61925 15.5358L3.63873 17.279L3.57628e-07 15.2322V11.1473H2ZM18 11.1473V15.2322L14.3613 17.279L13.3807 15.5358L14.9804 14.636L13.0359 13.5134L14.0359 11.7813L16 12.9153V11.1473H18ZM10 15.1473V17.4375L11.5604 16.5598L12.5409 18.3029L9 20.2947L5.45908 18.3029L6.43961 16.5598L8 17.4375V15.1473H10Z" fill="currentColor"/>
              <path fill-rule="evenodd" clip-rule="evenodd" d="M12.0981 9.51337L10 10.7247V13.1474H8V10.7247L5.90192 9.51337L6.90192 7.78132L9 8.99265L11.0981 7.78132L12.0981 9.51337Z" fill="currentColor"/>
            </svg>
          </span>
          <span class="brand-word"><span class="brand-word-strong">Transitions</span><span class="brand-word-dim">.dev</span></span>
        </a>
        <nav class="site-nav-menu" aria-label="Primary">
          <a class="nav-pill" href="/">Transitions</a>
          <a class="nav-pill" href="/skill.html">Skill</a>
          <a class="nav-pill" href="/refine.html">Refine tool</a>
        </nav>
      </div>
      <div class="site-nav-right">
        <a
          class="icon-btn-pill"
          id="gh-stars-btn"
          href="https://github.com/Jakubantalik/transitions.dev"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository — star count"
          data-loading="true"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          <span class="pill-label" id="gh-stars-count">—</span>
        </a>
        <a
          class="icon-btn"
          href="https://x.com/jakubantalik"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="X (Twitter)"
        >
          <svg class="icon-x" aria-hidden="true" viewBox="0 0 16 17" xmlns="http://www.w3.org/2000/svg">
            <path
              fill="currentColor"
              d="M12.4041 1.39726H14.6953L9.69087 7.2591L15.5781 15.2368H10.9696L7.35741 10.3996L3.22921 15.2368H0.934687L6.28641 8.96575L0.642598 1.39726H5.36795L8.62962 5.81859L12.4041 1.39726ZM11.5992 13.8329H12.8682L4.67667 2.72798H3.31359L11.5992 13.8329Z"
            />
          </svg>
        </a>
        <button
          type="button"
          class="icon-btn theme-toggle"
          id="theme-toggle"
          aria-label="Toggle color theme"
        >
          <span class="theme-icon-stack no-anim" id="theme-icon-stack" data-active="moon" aria-hidden="true">
            <img src="assets/theme-moon-01.svg" alt="" class="theme-icon theme-icon-moon" width="16" height="16" decoding="async" />
            <img src="assets/theme-sun.svg" alt="" class="theme-icon theme-icon-sun" width="16" height="16" decoding="async" />
          </span>
        </button>
      </div>
    </div>
  </header>

  <main id="main" class="app">
    <header class="header">
      <p class="hero-eyebrow">Refine<span class="beta-badge">Beta</span></p>
      <h1 class="title">Live demo</h1>
      <p class="subtitle">Demo mode: No LLM is used on this website. Agent responses are simulated to showcase the functionality of the Refine tool.</p>
      <div id="root"></div>
    </header>
  </main>
${NAV_SCRIPTS}
  <script type="module">
    // Standalone demo: route the panel's relay client through demo.html's
    // built-in mock instead of a live relay/LLM/CLI.
    window.__TX_REFINE_MOCK = true;
    // Pre-baked agent grouping → the panel shows named, grouped transitions
    // instantly. No scan ever runs online (see runGroupScan's seed fast-path).
    window.__TX_SEED_GROUPS = ${JSON.stringify(SEED_GROUPS)};
${js}
${APPENDED_JS}
  </script>
</body>
</html>
`;
}

async function main() {
  const html = await readFile(DEMO_PATH, "utf8");

  const styleSrc = extractBetween(html, /<style>/, "</style>");
  const scriptSrc = extractBetween(html, /<script\s+type="module">/, "</script>");
  if (!styleSrc || !scriptSrc) {
    throw new Error("build-website-demo: could not locate <style> or module <script> in demo.html");
  }

  const css = styleSrc.replace(/\s+$/g, "");
  const js = buildJs(scriptSrc);
  const out = buildHtml({ css, js });
  await writeFile(OUT_PATH, out, "utf8");
  console.log(`website-demo.html written (${out.length} bytes) → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
