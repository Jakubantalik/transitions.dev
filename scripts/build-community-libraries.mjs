#!/usr/bin/env node
// Builds the Studio's preinstalled libraries and its built-in agent skill:
//
//   assets/community/libraries.json        the seven libraries.dev packages,
//                                          pinned, with a usage snippet and an
//                                          agent doc for each
//   assets/community/skills/transitions-dev.md
//                                          the transitions.dev skill, condensed
//                                          for the Studio agent
//
// Library docs come from the libraries.dev repo's skill references
// (LIBRARIES_DEV, default ../Libraries.dev). Without that checkout the
// script keeps the docs already in libraries.json.
//
//   node scripts/build-community-libraries.mjs

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB_REPO = resolve(process.env.LIBRARIES_DEV || join(root, "..", "Libraries.dev"));
const refs = join(LIB_REPO, "skills/libraries-dev/references");

// Versions are pinned so a published component keeps working when a package
// ships a breaking release. `peers` are extra packages the build imports.

const LIBRARIES = [
  {
    id: "beam", ref: "01-border-beam.md", name: "Border beam", pkg: "border-beam", version: "1.4.1",
    icon: "figma-beam.png", desc: "A soft glow that rides the border",
    usage: `import { BorderBeam } from "border-beam";

<BorderBeam size="md" colorVariant="colorful" theme="auto">
  <div className="card">Content</div>
</BorderBeam>`,
  },
  {
    id: "orbs", ref: "02-thinking-orbs.md", name: "Thinking orbs", pkg: "thinking-orbs", version: "0.3.2",
    icon: "figma-orbs.svg", desc: "Orbs that think while you wait",
    usage: `import { ThinkingOrb } from "thinking-orbs";

<ThinkingOrb state="searching" size={64} theme="auto" />`,
  },
  {
    id: "gooey", ref: "03-liquid-gooey.md", name: "Gooey", pkg: "liquid-gooey", version: "0.2.2",
    icon: "figma-gooey.svg", desc: "Pieces that merge like goo",
    usage: `import { Liquid } from "liquid-gooey";

<Liquid blur={6} contrast={18} fill="#fff">
  <Liquid.Item x={open ? -54 : 0} y={open ? -34 : 0} transition="bouncy">
    <button className="round-btn">+</button>
  </Liquid.Item>
</Liquid>`,
  },
  {
    id: "voice", ref: "04-voice-glow.md", name: "Voice glow", pkg: "voice-glow", version: "0.2.1",
    icon: "figma-voice.png", desc: "A glow that rises with your voice",
    usage: `import { VoiceBeam } from "voice-glow";

// The preview has no microphone: drive the glow with a level getter.
<VoiceBeam level={() => 0.4 + Math.sin(Date.now() / 300) * 0.3}>
  <div className="input">Ask anything</div>
</VoiceBeam>`,
  },
  {
    id: "bots", ref: "05-bot-avatars.md", name: "Bot avatars", pkg: "bot-avatars", version: "0.2.1",
    icon: "figma-avatars.svg", desc: "Animated faces for your AI agents",
    usage: `import { BotAvatar } from "bot-avatars";

<BotAvatar type="clover" state={busy ? "working" : "default"} size={64} />`,
  },
  {
    id: "metal", ref: "06-metal-fx.md", name: "Liquid metal", pkg: "metal-fx", version: "2.0.11",
    icon: "figma-metal.png", desc: "Liquid metal for your buttons",
    usage: `import { MetalFx, useMetalBend } from "metal-fx";

const ref = useRef(null);
useMetalBend(ref);

<MetalFx ref={ref} variant="circle" innerShadow strength={0.9}>
  <button aria-label="Send">↑</button>
</MetalFx>`,
  },
  {
    id: "image", ref: "07-img-fx.md", name: "Image generation", pkg: "img-fx", version: "0.5.1",
    icon: "figma-image.png", desc: "A loader that becomes the image", peers: { three: "0.170.0" },
    usage: `import { ImageGeneration } from "img-fx";

<ImageGeneration preset="pixels-organic" autoReveal>
  <div style={{ width: 240, height: 240, borderRadius: 20 }} />
</ImageGeneration>`,
  },
];

// ── Free tier ──────────────────────────────────────────────────────────────────
// What a free libraries.dev user gets, export by export, as the free detail
// pages' playgrounds allow it (sites/home/src/<library>.tsx): their locked
// tabs and the Studio-only controls are Pro. The skill references are looser
// (they count values from the pages' Copy prompt), so these lists win. The
// packages are MIT and enforce nothing, so the Studio does: the agent gets
// the Free API and the Pro list, and the preview drops anything else
// (written into community.js as FREE_API).
// Rules: an array lists the allowed values, { min, max } a number range,
// { any: [...] } a union, { keys: {...} } an object with only those keys,
// or a type name ("boolean", "number", "string", "function", "object", "any").
// $statics: subcomponents (Liquid.Item). $require: props that must be
// given with an allowed value, or the component renders only its children.
const FREE = {
  "border-beam": {
    default: "BorderBeam",
    components: {
      BorderBeam: {
        size: ["md", "line", "pulse-inner", "pulse-outside"],
        colorVariant: ["colorful", "mono"],
        active: "boolean",
        theme: ["dark", "light", "auto"],
      },
    },
  },
  "thinking-orbs": {
    components: {
      ThinkingOrb: {
        state: ["working", "searching", "solving", "listening", "connecting", "composing", "breathing"],
        size: [64, 20],
        gravity: { any: [false, null, { keys: { sprite: "object" } }] },
        paused: "boolean",
        theme: ["auto", "dark", "light"],
      },
    },
  },
  "liquid-gooey": {
    components: {
      Liquid: {
        blur: { min: 0, max: 16 },
        contrast: { min: 4, max: 40 },
        fill: ["#fff", "#ffffff", "#202020", "#525252"],
        shadow: "string",
        $statics: {
          Item: {
            effect: ["morph", "move", "bend", "melt"],
            x: "number",
            y: "number",
            transition: { any: [["snappy", "smooth", "bouncy"], { keys: { duration: "number", ease: "any" } }] },
            delay: "number",
          },
        },
      },
    },
  },
  "voice-glow": {
    default: "VoiceBeam",
    components: {
      VoiceBeam: {
        type: ["default", "mobile"],
        stream: "any",
        level: "function",
        processing: "boolean",
        paused: "boolean",
        theme: ["dark"],
      },
    },
    allow: ["useMicrophone", "isAudioSupported"],
  },
  "bot-avatars": {
    default: "BotAvatar",
    components: {
      BotAvatar: {
        type: ["clover", "flower", "star", "ghost", "mech", "circle", "hexagon", "square"],
        state: ["default", "working"],
        size: [96, 64, 32],
        shading: ["fabric", "plastic"],
        paused: "boolean",
      },
    },
  },
  "metal-fx": {
    components: {
      MetalFx: {
        variant: ["circle"],
        preset: ["chromatic"],
        theme: ["auto", "dark", "light"],
        strength: [0.9],
        innerShadow: "boolean",
        reflectionTargets: "any",
        disableGlow: "boolean",
        paused: "boolean",
        $require: { variant: ["circle"] },
      },
      MetalText: {
        font: "string",
        color: "string",
        strength: [0.9],
        reflectionTargets: "any",
      },
    },
    allow: ["useMetalBend", "useMetalTextReflection", "isMetalFxSupported"],
    fns: { setCursorLightConfig: { keys: { cursor: [false, true] } } },
  },
  "img-fx": {
    components: {
      ImageGeneration: {
        preset: ["pixels-organic", "pixels-mechanic", "sweep-gradient"],
        strength: { min: 0, max: 1 },
        images: { any: ["string", "object"] },
        autoReveal: "boolean",
        paused: "boolean",
      },
    },
  },
};

// What is Pro, in words the agent can quote back (the libraries.dev pages'
// locked tabs, Studio-only controls and the references' "Go further (Pro)").
const PRO_ONLY = {
  "border-beam": [
    '`size="sm"`; `colorVariant` "ocean", "sunset", "forest", "candy", "ice", "gold"',
    "`strength`, `duration`, `glowSize`, `brightness`, `saturation`, `hueRange`, `borderRadius`, `staticColors`, `css`, and the `--beam-*` / `--pulse-glow-*` variables",
  ],
  "thinking-orbs": [
    '`state` "weaving" and "shaping"; `size={32}`',
    "`speed`, ink `color`, `dots`, `dotSize`, per-state `opts`, `frame`, and gravity tuning beyond `{ sprite }` (and its setters)",
  ],
  "liquid-gooey": [
    "any `fill` other than the page colours (#fff, #202020, #525252); `waviness`",
    "the `move` object and every move, bend and melt physics knob; morph choreography (durations, staggers, spread, anticipation); the `filter` rewrite",
  ],
  "voice-glow": [
    '`type="pill"`; a numeric `level` (manual drive); `theme` "light" or "auto"',
    "`colorVariant`, `colors`, `bandColors`, `look`, `sensitivity`, `threshold`, `attack`, `release`, `reach`, `spread`, `flow`, `bend`, `idle`, `strength`, `brightness`, `saturation`, `css`",
  ],
  "bot-avatars": [
    '`state="sleeping"`; the other ten types (triangle, blob, drop, droid, alien, cat, cloud, pill, pebble, puddle); `shading` "crisp", "smooth", "flat"',
    "`hat`, `glasses`, `headphones`, `bowTie`, `accessoryColor`, `face`, `color`, `ink`, `brightness`, `saturation`, lighting and fur props, `speed`, `seed`, `turn`, `interactive`, whirl and jump props, `path`, `pose`",
  ],
  "metal-fx": [
    '`<MetalFx>` without `variant="circle"` (the pill button is Pro); `<MetalBadge>`; `preset` "silver" or "gold"; a `strength` other than 0.9',
    "`glowGain`, shader scale, ring width, metal opacity, `setGlowConfig`, `setBendConfig`, and cursor light tuning beyond `setCursorLightConfig({ cursor: false })`",
  ],
  "img-fx": [
    "`speed`, `pixelScale`, `cardBg`, `colors` (palette re-tints), `strength` above 1, `fragmentShader`",
  ],
};

// The Free API in words, from FREE.
function ruleText(r) {
  if (Array.isArray(r)) return r.map((v) => JSON.stringify(v)).join(" | ");
  if (r && r.any) return r.any.map(ruleText).join(" | ");
  if (r && r.keys) return "{ " + Object.entries(r.keys).map(([k, v]) => k + ": " + ruleText(v)).join(", ") + " }";
  if (r && typeof r === "object") return r.min + " to " + r.max;
  return r;
}
function freeText(pkg) {
  const f = FREE[pkg];
  const comp = (name, spec) => {
    const props = Object.entries(spec).filter(([k]) => k[0] !== "$")
      .map(([k, r]) => "`" + k + "`: " + ruleText(r)).join("; ");
    const req = spec.$require ? " Requires " + Object.entries(spec.$require).map(([k, r]) => "`" + k + "=" + JSON.stringify(r[0]) + "`").join(", ") + "." : "";
    let out = "- `<" + name + ">` " + props + "." + req;
    for (const [sub, s] of Object.entries(spec.$statics || {})) out += "\n" + comp(name + "." + sub, s).replace(/^/, "  ");
    return out;
  };
  const lines = Object.entries(f.components).map(([n, s]) => comp(n, s));
  if (f.allow) lines.push("- Also free: " + f.allow.map((x) => "`" + x + "`").join(", ") + ".");
  if (f.fns) for (const [n, r] of Object.entries(f.fns)) lines.push("- `" + n + "(" + ruleText(r) + ")`.");
  return "## Free API (use only this)\n\nAlso standard props: `className`, `style`, `id`, `aria-*`, `data-*`, event handlers, `ref`, `children`.\n\n" + lines.join("\n") +
    "\n\n## Pro only (never use; the preview drops it)\n\n" + PRO_ONLY[pkg].map((x) => "- " + x).join("\n");
}

// The agent reads the intro, the Free API, the Pro list and the common
// mistakes: enough to use a package correctly, and only its free tier,
// without spending the whole reference on every draft.
function agentDoc(md, pkg) {
  const lines = md.split("\n");
  const intro = [];
  for (const l of lines.slice(1)) { if (/^## /.test(l)) break; if (l.trim()) intro.push(l.trim()); }
  const section = (re) => {
    const at = lines.findIndex((l) => re.test(l));
    if (at < 0) return "";
    const end = lines.findIndex((l, i) => i > at && /^## /.test(l));
    return lines.slice(at, end < 0 ? undefined : end).join("\n").trim();
  };
  const mistakes = section(/^## Common mistakes/);
  return [intro.join(" "), freeText(pkg), mistakes.length > 2500 ? mistakes.slice(0, 2500).replace(/\n[^\n]*$/, "") + "\n…" : mistakes]
    .filter(Boolean).join("\n\n");
}

const outFile = join(root, "assets/community/libraries.json");
const previous = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : [];
// Icons: libraries.dev's own, a dark and a light-baked one per library
// (sites/home/public/assets/icons), copied next to the list.
const iconSrc = join(LIB_REPO, "sites/home/public/assets/icons");
const iconOut = join(root, "assets/community/libs");
mkdirSync(iconOut, { recursive: true });
const lightName = (icon) => icon.replace(/(\.\w+)$/, "-light$1");
const out = LIBRARIES.map(({ ref, ...lib }) => {
  for (const name of [lib.icon, lightName(lib.icon)]) {
    if (existsSync(join(iconSrc, name))) copyFileSync(join(iconSrc, name), join(iconOut, name));
  }
  const file = join(refs, ref);
  const doc = existsSync(file)
    ? agentDoc(readFileSync(file, "utf8"), lib.pkg)
    : (previous.find((p) => p.id === lib.id) || {}).doc || "";
  return { ...lib, iconLight: lightName(lib.icon), peers: lib.peers || {}, doc };
});
writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
// The preview's copy of the free tier (community.js, between the markers).
const runtimeFile = join(root, "assets/community/community.js");
const runtime = readFileSync(runtimeFile, "utf8");
const block = "  // <free-api>\n  var FREE_API = " + JSON.stringify(FREE) + ";\n  // </free-api>";
const next = runtime.replace(/  \/\/ <free-api>[\s\S]*?\/\/ <\/free-api>/, block);
if (next === runtime && runtime.indexOf(block) < 0) throw new Error("free-api markers not found in community.js");
writeFileSync(runtimeFile, next);
console.log("wrote FREE_API for", Object.keys(FREE).length, "libraries into assets/community/community.js");
console.log("wrote", out.length, "libraries to assets/community/libraries.json",
  existsSync(refs) ? "" : "(docs kept: no libraries.dev checkout)");

// ── Built-in skill: the transitions.dev skill, condensed ──────────────────────
const skillDir = join(root, "skills/transitions-dev");
const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8").replace(/^---[\s\S]*?---\n/, "");
const part = (heading) => {
  const at = skill.indexOf("\n## " + heading);
  if (at < 0) return "";
  const end = skill.indexOf("\n## ", at + 4);
  return skill.slice(at + 1, end < 0 ? undefined : end).trim();
};
const tokens = readFileSync(join(skillDir, "_root.css"), "utf8").split("/* Card resize */")[0].trim() + "\n}";
const condensed = [
  "# Transitions.dev",
  "Motion tokens and the 32 library transitions from transitions.dev. Reuse these tokens and patterns so components move like the library.",
  part("Quick reference").replace(/\s*\|\s*\[[^\]]+\]\([^)]+\)\s*\|/g, " |").replace(/\| Reference \|/, "|").replace(/\| --- \| --- \| --- \|/, "| --- | --- |"),
  part("Decision rules"),
  part("Motion tokens"),
  "## Token values\n\n```css\n" + tokens + "\n```",
  part("Common mistakes to avoid"),
].filter(Boolean).join("\n\n");
mkdirSync(join(root, "assets/community/skills"), { recursive: true });
// House style: no em dashes in anything the site ships.
const shipped = condensed.replace(/\s+\u2014\s+/g, ", ").replace(/\u2014/g, ", ");
writeFileSync(join(root, "assets/community/skills/transitions-dev.md"), shipped + "\n");
console.log("wrote assets/community/skills/transitions-dev.md", shipped.length, "chars");

// ── Recipes: the 32 transitions, for the Studio agent ─────────────────────────
// The condensed skill above names the transitions; these carry how to build
// them (markup, :root tokens, CSS, JS orchestration). The Studio sends the
// few that match a request (assets/community/skills/recipes.json, picked by
// these keywords against the request and the current component), so the
// agent applies the real pattern instead of improvising one.
const TRIGGERS = {
  "card-resize": ["resize", "expand", "collapse", "grow", "shrink", "width", "height", "size change"],
  "number-pop-in": ["number", "price", "pricing", "amount", "total", "count", "counter", "balance", "score", "stat", "value", "percent", "$", "€", "monthly", "yearly", "annual", "billing"],
  "notification-badge": ["badge", "notification", "unread", "bell", "dot"],
  "text-states-swap": ["text", "label", "status", "change", "swap", "switch", "state", "price", "pricing", "monthly", "yearly", "billing", "loading", "done", "tab"],
  "menu-dropdown": ["dropdown", "menu", "popover", "select", "options", "more", "3 dot", "3-dot", "three dot", "three-dot", "dots", "kebab", "overflow", "actions"],
  "modal": ["modal", "dialog", "popup", "overlay", "lightbox", "sheet"],
  "panel-reveal": ["panel", "drawer", "sidebar", "slide in", "slide-in", "bottom sheet", "reveal"],
  // Tab panels are pages too: switching tabs slides the content side by side.
  "page-side-by-side": ["page", "pages", "step", "steps", "wizard", "onboarding", "list detail", "navigate", "back", "tab", "tabs", "tab panel", "tabpanel", "panels", "screen", "screens", "view", "views", "segmented", "switch between"],
  "icon-swap": ["icon", "hamburger", "close", "play", "pause", "copy", "check", "toggle icon"],
  "success-check": ["success", "check", "done", "complete", "confirm", "paid", "uploaded"],
  // People shown as faces: any stack of avatars is this recipe.
  "avatar-group-hover": ["avatar", "avatars", "stack", "chips", "group", "team", "people", "person", "likes", "liked", "liked by", "attendees", "attending", "members", "guests", "participants", "contributors", "collaborators", "followers", "friends", "faces", "facepile"],
  "error-state-shake": ["error", "invalid", "wrong", "shake", "validation", "required", "email", "password", "sign in", "log in", "login", "invite", "verification code", "form"],
  "input-clear-dissolve": ["clear", "search", "input", "field", "reset"],
  "skeleton-reveal": ["skeleton", "loading", "placeholder", "load"],
  "shimmer-text": ["shimmer", "thinking", "loading text", "generating"],
  "tabs-sliding": ["tab", "tabs", "segmented", "segmented control", "segment", "switcher", "toggle group", "radio group", "radiogroup", "sliding", "sliding pill", "slide between", "monthly", "yearly", "billing", "filter", "rsvp"],
  "tooltip": ["tooltip", "hint", "info", "hover label"],
  "texts-reveal": ["headline", "hero", "heading", "intro", "empty state", "reveal text", "stagger"],
  "card-tilt": ["tilt", "3d", "card hover", "parallax", "glare"],
  "plus-menu-morph": ["plus", "fab", "compose", "morph"],
  // Any toggle that shows or hides content is an accordion, also on edits
  // where only the current code says so (a Details button, aria-expanded).
  "accordion": ["accordion", "faq", "disclosure", "show more", "show less", "read more", "see more", "see all", "more info", "details", "expand", "collapse", "expanded", "collapsed", "aria-expanded", "collapsible", "expandable"],
  "toast": ["toast", "snackbar", "alert", "message"],
  "like-button": ["like", "heart", "favorite", "favourite", "upvote"],
  "learn-more-hover": ["learn more", "link", "arrow", "chevron", "cta"],
  "checkbox-check": ["checkbox", "check box", "agree", "todo", "task"],
  "spinning-counter": ["spin", "odometer", "slot", "reel", "counter", "jackpot"],
  "toggle": ["toggle", "switch", "on off", "dark mode"],
  "thinking-states": ["thinking", "ai", "agent", "steps", "status line"],
  "reasoning-stream": ["reasoning", "transcript", "log", "stream"],
  "streaming-text": ["stream", "typing", "typewriter", "chat", "response"],
  "matrix-loader": ["loader", "spinner", "loading", "dots"],
  "banner-stacking": ["banner", "stack", "notifications", "toasts", "queue"],
  "text-morph": ["copy", "copied", "follow", "following", "save", "saved", "label change", "morph text", "text morph", "check in", "checked"],
  "text-swap-soft": ["period", "week", "month", "year", "range", "currency", "unit", "chart", "total", "values", "data", "stats", "update"],
  "donut-chart": ["donut", "ring chart", "pie", "chart", "breakdown", "spending", "budget", "allocation", "segments", "portfolio"],
};
function recipeOf(md) {
  const part = (h) => {
    const at = md.indexOf("\n## " + h);
    if (at < 0) return "";
    const end = md.indexOf("\n## ", at + 4);
    return md.slice(at + 4 + h.length, end < 0 ? undefined : end).trim();
  };
  const code = (s, lang) => [...s.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map((m) => m[1].trim());
  const rootCss = code(part("Tunable variables"), "css")[0] || "";
  const htmlPart = part("HTML usage").replace(/```html\n[\s\S]*?```/g, "").trim();
  return [
    "When to use: " + part("When to use").split("\n\n")[0].trim(),
    "HTML:\n```html\n" + (code(part("HTML usage"), "html")[0] || "") + "\n```" + (htmlPart ? "\n" + htmlPart : ""),
    rootCss ? "Tokens:\n```css\n" + rootCss + "\n```" : "",
    "CSS:\n```css\n" + code(part("CSS"), "css").join("\n\n") + "\n```",
    code(part("JavaScript orchestration"), "js").length ? "JS:\n```js\n" + code(part("JavaScript orchestration"), "js").join("\n\n") + "\n```" : "",
  ].filter(Boolean).join("\n\n").replace(/\s*\u2014\s*/g, ": ");
}
const recipes = readdirSync(skillDir).filter((f) => /^\d\d-.+\.md$/.test(f)).sort().map((f) => {
  const md = readFileSync(join(skillDir, f), "utf8");
  const id = f.replace(/^\d\d-|\.md$/g, "");
  if (!TRIGGERS[id]) throw new Error("no triggers for " + id);
  return { id, title: md.split("\n")[0].replace(/^#\s*/, "").trim(), triggers: TRIGGERS[id], recipe: recipeOf(md) };
});
writeFileSync(join(root, "assets/community/skills/recipes.json"), JSON.stringify(recipes) + "\n");
// The API sends every recipe with each draft from its own copy
// (api/src/ui-agent/recipes.json); API_DIR points at that api folder.
if (process.env.API_DIR) writeFileSync(join(process.env.API_DIR, "src/ui-agent/recipes.json"), JSON.stringify(recipes) + "\n");
console.log("wrote", recipes.length, "recipes to assets/community/skills/recipes.json",
  Math.round(recipes.reduce((n, r) => n + r.recipe.length, 0) / 1024) + " KB, largest " +
  Math.max(...recipes.map((r) => r.recipe.length)) + " chars");
