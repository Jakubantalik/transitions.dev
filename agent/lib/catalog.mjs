// The transitions.dev library as the scanner sees it: every recipe, the names
// that give a component away in a codebase (the skill's decision rules), and
// the recipe's canonical motion. Free recipe values come from
// recipe-specs.json, generated from skills/transitions-dev by
// scripts/build-recipe-specs.mjs. Pro recipes carry recognition only; their
// source stays with the fix service.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "recipe-specs.json"), "utf8"));

export const TOKENS = DATA.tokens.map((t) => ({ ...t, ms: /ms$/.test(t.value) ? parseFloat(t.value) : null }));
export const DURATION_TOKENS = TOKENS.filter((t) => t.name.startsWith("--duration-"));
export const SMOOTH_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

// family:
//   surface   opens and closes (asymmetric: closes quicker than it opens)
//   symmetric one reversible motion, same timing both ways
//   hover     pointer-driven in/out
//   control   a boolean flips (toggle, checkbox, like)
//   feedback  a one-off moment (success, error, number change, reveal)
//   loop      continuous (shimmer, pulse, loader) - linear is fine here
//
// names: words or hyphenated phrases matched against class, element, role,
// data-slot, component, and file names. `with` lists words that must also
// appear somewhere in the same name. Earlier entries win, so specific
// recipes come before generic ones.
const R = [
  // Pro, specific names first so they are not swallowed by free look-alikes.
  { slug: "gooey-plus-menu", desc: "A plus button that liquid-splits into satellite actions and merges back.", page: "gooey-plus-menu", tier: "pro", family: "surface", names: ["gooey", "goo-menu", "liquid-menu", "blob-menu"] },
  { slug: "image-open-tilt", desc: "An image opens iPadOS-style with a 3D tilt and organic bend.", page: "image-open-tilt", tier: "pro", family: "surface", names: ["image-viewer", "photo-viewer", "media-viewer", "image-zoom", "zoom-image", "image-lightbox", "photo-lightbox", "gallery-lightbox", "gallery-viewer"] },
  { slug: "image-gen-placeholder", desc: "A dot field wakes into generation noise, then cross-fades into the finished image.", page: "image-generation-placeholder", tier: "pro", family: "loop", names: ["image-gen", "image-generation", "generating-image", "gen-placeholder", "image-placeholder-gen"] },
  { slug: "smoky-dissolve", desc: "Deleting a card or image shreds it into smoke that sinks under gravity.", page: "delete-with-smoky-dissolve", tier: "pro", family: "feedback", names: ["smoky", "smoke", "dissolve-delete", "delete-dissolve"] },
  { slug: "drag-drop-physics", desc: "A drag that lifts and tilts with velocity, then settles into a drop zone.", page: "drag-drop-with-physics", tier: "pro", family: "feedback", names: ["draggable", "drop-zone", "dropzone", "drag-item", "drag-card", "dnd", "sortable"] },
  { slug: "confetti-burst", desc: "Physics confetti that bursts from and lands on the trigger button.", page: "confetti-burst", tier: "pro", family: "feedback", names: ["confetti", "celebration", "celebrate"] },
  { slug: "card-stack-hover", desc: "A stacked trio of cards fans out with a spring on hover.", page: "card-stack-hover", tier: "pro", family: "hover", names: ["card-stack", "stacked-cards", "cards-stack", "card-fan", "fanned-cards", "deck"] },
  { slug: "pro-gradient-text", desc: "A living gradient clipped to the glyphs, with drifting colour washes.", page: "pro-gradient-text", tier: "pro", family: "loop", names: ["gradient-text", "text-gradient", "rainbow-text", "animated-gradient-text"] },
  { slug: "organic-shimmer", desc: "A wavy skeleton shimmer with a phase-locked edge glow.", page: "organic-shimmer", tier: "pro", family: "loop", names: ["organic-shimmer", "wavy-shimmer", "wave-shimmer"] },
  { slug: "spinner-check-morph", desc: "A spinner resolves into a success disc that hops and draws its own check.", page: "spinner-to-check-morph", tier: "pro", family: "feedback", names: ["spinner-check", "spinner-to-check", "loading-check", "spinner-success"] },
  { slug: "get-pro-button", desc: "A pill whose rim glows with drifting gradient washes.", page: "get-pro-button", tier: "pro", family: "loop", names: ["get-pro", "go-pro", "upgrade-button", "pro-button", "premium-button"] },

  // Free.
  { slug: "banner-stacking", page: "banner-stacking", family: "surface", names: ["toast-stack", "toasts-stack", "stacked-toasts", "banner-stack", "stacked-banners", "notification-stack", "toaster", "sonner"],
    spec: { open: "--stack-open", close: "--stack-close", ease: "--stack-ease", preScale: "--stack-scale", blur: "--stack-blur" } },
  { slug: "plus-menu-morph", page: "dropdown-menu-morph", family: "surface", names: ["fab", "plus-menu", "speed-dial", "speeddial", "morph-menu", "menu-morph", "compose-button"],
    spec: { open: "--morph-open-dur", close: "--morph-close-dur", ease: "--morph-ease", closeEase: "--morph-close-ease", preScale: "--morph-scale" }, layoutOk: ["width", "height", "border-radius"] },
  { slug: "tooltip", page: "tooltip-open-close", family: "surface", names: ["tooltip", "tooltips", "tippy", "hovercard", "hover-card", "tt"], roles: ["tooltip"],
    spec: { open: "--tt-in-dur", close: "--tt-out-dur", ease: "--tt-in-ease", preScale: "--tt-scale", delay: "--tt-delay" } },
  { slug: "toast", page: "toast-open-close", family: "surface", names: ["toast", "snackbar", "snack-bar", "flash-message"],
    spec: { open: "--toast-open", close: "--toast-close", ease: "--toast-ease", preScale: "--toast-scale", distance: "--toast-distance", blur: "--toast-blur" } },
  { slug: "modal", page: "modal-open-close", family: "surface", names: ["modal", "dialog", "lightbox", "alertdialog", "alert-dialog"], elements: ["dialog"], roles: ["dialog", "alertdialog"],
    backdrop: true, spec: { open: "--modal-open-dur", close: "--modal-close-dur", ease: "--modal-ease", preScale: "--modal-scale", closeScale: "--modal-scale-close" } },
  { slug: "menu-dropdown", page: "menu-dropdown", family: "surface", names: ["dropdown", "drop-down", "menu", "popover", "popup", "pop-up", "listbox", "combobox", "flyout", "context-menu", "contextmenu", "submenu", "autocomplete", "suggestions", "select-content", "select-menu"], roles: ["menu", "listbox"],
    notWith: ["menubar", "navbar", "nav", "hamburger", "burger", "icon"],
    spec: { open: "--dropdown-open-dur", close: "--dropdown-close-dur", ease: "--dropdown-ease", preScale: "--dropdown-pre-scale", closeScale: "--dropdown-closing-scale" }, origin: true },
  { slug: "notification-badge", page: "notification-badge", family: "surface", names: ["notification-badge", "notification-dot", "unread-dot", "unread-badge", "unread-count", "indicator-dot", "count-badge", "bell-dot", "bell-badge", "badge-dot", "inbox-badge"],
    spec: { open: "--badge-pop-dur", close: "--badge-pop-close-dur", ease: "--badge-pop-ease" } },
  { slug: "accordion", page: "accordion", family: "symmetric", names: ["accordion", "collapse", "collapsible", "disclosure", "expander", "expandable", "faq-item", "faq-answer", "show-more"], elements: ["details"],
    spec: { open: "--acc-expand", close: "--acc-collapse", ease: "--acc-ease" }, layoutOk: ["grid-template-rows"], layoutHint: "animate grid-template-rows (0fr to 1fr) instead of height" },
  { slug: "tabs-sliding", page: "tabs-sliding", family: "symmetric", names: ["tabs", "tab-list", "tablist", "tab-bar", "tabbar", "segmented", "segmented-control", "segment", "tab-indicator", "tab-pill", "tabs-pill", "view-switcher", "toggle-group"], roles: ["tablist"],
    spec: { open: "--tabs-dur", ease: "--tabs-ease" }, layoutOk: ["width"] },
  { slug: "panel-reveal", page: "panel-reveal", family: "surface", names: ["drawer", "sheet", "offcanvas", "off-canvas", "slide-over", "slideover", "side-panel", "sidepanel", "detail-panel", "panel-slide", "slide-panel", "reveal-panel"],
    spec: { open: "--panel-open-dur", close: "--panel-close-dur", ease: "--panel-ease", distance: "--panel-translate-y", blur: "--panel-blur" }, bigTravel: true },
  { slug: "page-side-by-side", page: "page-side-by-side", family: "symmetric", names: ["page-slide", "slide-page", "wizard", "stepper", "screen-slide", "pages-track", "step-panel", "onboarding-step"],
    spec: { open: "--page-slide-dur", ease: "--page-slide-ease", distance: "--page-slide-distance", blur: "--page-blur" } },
  { slug: "card-resize", page: "card-resize", family: "symmetric", names: ["resize", "resizable", "expanding-card", "expandable-card", "card-expand"],
    spec: { open: "--resize-dur", ease: "--resize-ease" }, layoutOk: ["width", "height"] },
  { slug: "icon-swap", page: "icon-swap", family: "symmetric", names: ["icon-swap", "swap-icon", "icon-toggle", "hamburger", "burger", "sun-icon", "moon-icon", "play-pause", "copy-icon"],
    spec: { open: "--icon-swap-dur", ease: "--icon-swap-ease", blur: "--icon-swap-blur" } },
  { slug: "text-states-swap", page: "text-states-swap", family: "symmetric", names: ["text-swap", "swap-text", "status-text", "status-label", "state-label", "label-swap"],
    spec: { open: "--text-swap-dur", ease: "--text-swap-ease", distance: "--text-swap-translate-y", blur: "--text-swap-blur" } },
  { slug: "toggle", page: "toggle", family: "control", names: ["switch", "toggle-switch", "toggle-thumb", "toggle-track", "switch-thumb", "switch-track"], roles: ["switch"],
    spec: { open: "--toggle-dur", ease: "--toggle-ease" } },
  { slug: "checkbox-check", page: "checkbox-check", family: "control", names: ["checkbox", "check-box", "checkmark"], roles: ["checkbox"],
    spec: { open: "--check-box", close: "--check-uncheck", ease: "--check-ease" } },
  { slug: "like-button", page: "like-button", family: "control", names: ["like", "like-button", "heart", "favorite", "favourite", "fav-button"],
    spec: { open: "--like-pop", ease: "--like-pop-ease" } },
  { slug: "learn-more-hover", page: "learn-more-hover", family: "hover", names: ["learn-more", "read-more", "see-all", "see-more", "arrow-link", "link-arrow", "more-link", "cta-arrow"],
    spec: { open: "--learn-in", close: "--learn-out", ease: "--learn-ease" } },
  { slug: "avatar-group-hover", page: "avatar-group-hover", family: "hover", names: ["avatar-group", "avatar-stack", "avatars", "facepile", "face-pile", "chip-group"],
    spec: { open: "--avatar-dur", ease: "--avatar-ease-in", closeEase: "--avatar-ease-out" } },
  { slug: "card-tilt", page: "3d-tilt", family: "hover", names: ["tilt", "tilt-card", "card-tilt", "parallax-card", "card-3d"],
    spec: { open: "--tilt-follow", close: "--tilt-return", ease: "--tilt-follow-ease" } },
  { slug: "error-state-shake", page: "error-state-shake", family: "feedback", names: ["shake", "shaking", "wiggle", "jiggle", "is-error", "has-error", "error-shake"],
    spec: { ease: "--shake-ease" } },
  { slug: "input-clear-dissolve", page: "input-clear-with-dissolve", family: "feedback", names: ["input-clear", "clear-input", "search-clear", "clear-search", "clear-button", "clear-btn"],
    spec: { ease: "--clear-out-ease" } },
  { slug: "success-check", page: "success-check", family: "feedback", names: ["success-check", "check-success", "success-icon", "success-badge", "check-circle", "done-check"],
    spec: { open: "--check-opacity-dur", ease: "--check-ease-out" } },
  { slug: "spinning-counter", page: "spinning-counter", family: "feedback", names: ["odometer", "reel", "slot-machine", "spinning-counter", "rolling-number", "digit-reel"],
    spec: { ease: "--reel-ease" } },
  { slug: "number-pop-in", page: "number-pop-in", family: "feedback", names: ["number-pop", "digit", "digits", "counter", "count-up", "countup", "ticker", "kpi-value", "stat-value"],
    spec: { open: "--digit-dur", ease: "--digit-ease", distance: "--digit-distance", stagger: "--digit-stagger" } },
  { slug: "skeleton-reveal", page: "skeleton-loader-and-reveal", family: "loop", names: ["skeleton", "skel", "ghost-card", "loading-placeholder", "placeholder-shimmer", "bone"],
    spec: { reveal: "--reveal-dur" } },
  { slug: "shimmer-text", page: "shimmer-text", family: "loop", names: ["shimmer", "shimmer-text", "text-shimmer", "shine", "sheen", "glimmer", "loading-text", "generating"] },
  { slug: "thinking-states", page: "thinking-states", family: "loop", names: ["thinking", "agent-status", "status-line", "thinking-state", "working-status"] },
  { slug: "reasoning-stream", page: "reasoning-stream", family: "loop", names: ["reasoning", "chain-of-thought", "thoughts", "thought-stream"] },
  { slug: "streaming-text", page: "streaming-text", family: "feedback", names: ["streaming", "stream-text", "typewriter", "typing-text", "word-reveal", "token-stream"],
    spec: { open: "--stream-fade", ease: "--stream-ease" } },
  { slug: "matrix-loader", page: "matrix-dot-loader", family: "loop", names: ["matrix", "dot-loader", "dots-loader", "loading-dots", "loader-dots", "dot-matrix"] },
  { slug: "texts-reveal", page: "texts-reveal", family: "feedback", names: ["texts-reveal", "text-reveal", "reveal-text", "stagger", "staggered", "fade-up", "fade-in-up", "rise-in", "hero-reveal"],
    spec: { open: "--stagger-dur", ease: "--stagger-ease", distance: "--stagger-distance", stagger: "--stagger-stagger", blur: "--stagger-blur" } },
];

// Words that mark a sub-part of a component rather than the moving surface:
// `.dropdown-item`, `.modal-close`, `.menu-trigger`.
// The last word of a class names the thing: `.dropdown-item` is an item,
// `.proto-modal-tab` a tab, `.dropdown-menu` the menu itself.
export const PART_WORDS = new Set([
  "item", "items", "option", "options", "trigger", "button", "btn", "icon", "label", "link",
  "divider", "separator", "sep", "chevron", "arrow", "caret", "title", "heading", "header",
  "footer", "close", "closer", "action", "actions", "description", "desc", "kbd", "shortcut",
  "input", "field", "img", "avatar", "anchor", "target", "toggle", "cta", "tab", "row", "cell",
  "check", "text", "name", "count", "value", "hint", "caption", "tag", "logo",
]);
// Containers that only show and hide while an inner element does the moving.
export const WRAPPER_WORDS = new Set(["root", "wrapper", "wrap", "layer", "shell", "container", "host", "portal", "stage", "outer", "frame", "viewport", "positioner", "holder"]);
// Words that make a descendant the moving surface of its component: `.modal .content`.
export const SURFACE_WORDS = new Set(["content", "panel", "body", "inner", "surface", "box", "card", "window", "popup", "list", "pane", "sheet", "dialog", "modal", "menu", "bubble", "paper"]);
export const BACKDROP_WORDS = new Set(["backdrop", "overlay", "scrim", "dim", "shade", "curtain"]);

const MS_VAR = (v) => (v && /ms$/.test(v) ? parseFloat(v) : v && /s$/.test(v) ? parseFloat(v) * 1000 : null);
const NUM = (v) => (v != null && !Number.isNaN(parseFloat(v)) ? parseFloat(v) : null);

export const RECIPES = R.map((r) => {
  const data = DATA.recipes[r.slug];
  const vars = data ? data.vars : {};
  const v = (k) => (r.spec && r.spec[k] ? vars[r.spec[k]] : undefined);
  const spec = r.spec ? {
    open: MS_VAR(v("open")),
    close: MS_VAR(v("close")) ?? (r.family === "symmetric" ? MS_VAR(v("open")) : null),
    ease: v("ease") || null,
    closeEase: v("closeEase") || v("ease") || null,
    preScale: NUM(v("preScale")),
    closeScale: NUM(v("closeScale")) ?? NUM(v("preScale")),
    distance: NUM(v("distance")),
    blur: NUM(v("blur")),
    delay: MS_VAR(v("delay")),
    stagger: MS_VAR(v("stagger")),
  } : null;
  const name = data ? data.name : prettify(r.slug);
  return {
    ...r,
    tier: r.tier || "free",
    name,
    label: r.label || name.replace(/\s+open\s*\/\s*close$/i, "").replace(/\s+with dissolve$/i, "").replace(/^Menu dropdown$/, "Dropdown menu"),
    when: (data ? data.when : r.desc || "").replace(/\s*\u2014\s*/g, ": ").replace(/\*\*/g, ""),
    hook: data ? data.hook : null,
    spec,
    specVars: r.spec || null,
    nameSeqs: r.names.map((n) => n.split("-")),
  };
});

export const RECIPE_BY_SLUG = new Map(RECIPES.map((r) => [r.slug, r]));
// Tunable defaults per free recipe, straight from the library.
export const RECIPE_VARS = new Map(Object.entries(DATA.recipes).map(([slug, d]) => [slug, d.vars]));

function prettify(slug) {
  return slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// "dropdownMenu__list--open" -> ["dropdown", "menu", "list", "open"]
export function words(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasSeq(ws, seq) {
  outer: for (let i = 0; i + seq.length <= ws.length; i++) {
    for (let j = 0; j < seq.length; j++) if (ws[i + j] !== seq[j]) continue outer;
    return true;
  }
  return false;
}

// The recipe a name points at, or null. `kind` is "class" | "element" |
// "role" | "component" | "file".
export function recipeForName(name, kind = "class") {
  if (!name) return null;
  if (kind === "element") return RECIPES.find((r) => r.elements && r.elements.includes(name.toLowerCase())) || null;
  if (kind === "role") return RECIPES.find((r) => r.roles && r.roles.includes(name.toLowerCase())) || null;
  // Library hooks (`t-modal`, `t-tt`, `t-panel-slide`) name their recipe outright.
  if (/^t-[a-z]/.test(name)) {
    const hooked = RECIPES.find((r) => r.hook && (name === r.hook || name.startsWith(r.hook.split("-").slice(0, 2).join("-") + "-") || name === r.hook.split("-").slice(0, 2).join("-")));
    if (hooked) return hooked;
  }
  const ws = words(name);
  if (!ws.length) return null;
  for (const r of RECIPES) {
    if (!r.nameSeqs.some((seq) => hasSeq(ws, seq))) continue;
    if (r.notWith && r.notWith.some((w) => ws.includes(w))) continue;
    return r;
  }
  return null;
}

// The token whose documented usage matches, for messages: 150 -> --duration-quick.
export function durationToken(ms) {
  const t = DURATION_TOKENS.find((d) => d.ms === ms);
  return t ? t.name : null;
}

export function scaleToken(scale) {
  const t = TOKENS.find((d) => d.name.startsWith("--scale-") && parseFloat(d.value) === scale);
  return t ? t.name : null;
}

export function recipeUrl(r) {
  return "transitions.dev/transitions/" + r.page;
}
