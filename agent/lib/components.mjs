// Component recognition, the way the transitions.dev skill reviews a project:
// find each UI component (modal, dropdown, tooltip, toast, accordion, tabs,
// toggle...), read what its motion actually does, and compare it with the
// matching library recipe by usage, never by nearest number.
//
// Three kinds of findings come out of this:
//   off-scale        a value whose usage calls for a different token
//                    (modal close 300ms -> 150ms). Polish fixes these.
//   recipe-mismatch  the motion is built wrong for its component (animates
//                    height, no exit, pops in). Revamp installs the recipe.
//   recipe-available a hand-rolled component the library has a recipe for.
//                    Informational; revamp installs the recipe.
import {
  cssSources, parseCss, collectProps, resolveVars, parseTransitionList, parseAnimationList,
  parseMotionValues, compounds, parseCompound, splitList, lineIndex,
} from "./css.mjs";
import {
  RECIPE_VARS, recipeForName, words, PART_WORDS, BACKDROP_WORDS, WRAPPER_WORDS, SURFACE_WORDS, SMOOTH_OUT, durationToken, scaleToken, recipeUrl,
} from "./catalog.mjs";

const JSXISH = new Set([".jsx", ".tsx", ".js", ".mjs", ".ts", ".vue", ".svelte", ".html"]);
const LAYOUT_PROPS = new Set([
  "height", "width", "max-height", "max-width", "min-height", "min-width", "top", "left", "right", "bottom", "inset",
  "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "padding", "padding-top", "padding-bottom",
  "padding-left", "padding-right", "grid-template-rows", "grid-template-columns", "border-radius", "font-size", "letter-spacing",
]);
const VISUAL_PROPS = new Set([
  "background", "background-color", "color", "border-color", "border", "box-shadow", "transform", "opacity", "filter",
  "outline-color", "text-decoration-color", "fill", "stroke", "scale", "translate", "rotate", "backdrop-filter",
]);
const NON_MOTION_PROPS = new Set(["transition", "animation", "pointer-events", "z-index", "cursor", "will-change", "content", "display", "visibility", "user-select"]);

const OPEN_CLASSES = new Set(["open", "opened", "is-open", "active", "is-active", "visible", "is-visible", "show", "shown", "showing", "is-shown", "expanded", "is-expanded", "in", "entered", "entering", "enter", "enter-active", "enter-done", "enter-to", "on", "is-on", "checked", "is-checked", "selected", "is-selected", "liked", "is-liked"]);
const CLOSING_CLASSES = new Set(["closing", "is-closing", "leaving", "leave", "leave-active", "leave-to", "exit", "exiting", "exit-active", "hiding", "is-hiding", "out", "is-leaving", "is-exiting"]);

// ── Entry point ───────────────────────────────────────────────────────────
export function analyzeComponents(files) {
  const parsed = [];
  for (const f of files) {
    const lineOf = lineIndex(f.content);
    for (const src of cssSources(f)) {
      const { rules, keyframes } = parseCss(src.text);
      parsed.push({ path: f.path, lineOf: (i) => lineOf(i + src.offset), rules, keyframes, ext: f.ext });
    }
  }
  const props = collectProps(parsed);
  const keyframes = new Map();
  for (const pf of parsed) for (const k of pf.keyframes) if (!keyframes.has(k.name)) keyframes.set(k.name, { ...k, path: pf.path, lineOf: pf.lineOf });
  const markup = scanMarkup(files);

  const instances = new Map();
  const hoverFindings = [];
  for (const pf of parsed) {
    for (const rule of pf.rules) {
      if (rule.media.some((m) => /prefers-reduced-motion/i.test(m))) continue;
      for (const sel of splitList(rule.selector)) {
        const hit = identify(sel, rule, markup);
        if (!hit) continue;
        const key = hit.recipe.slug + "|" + hit.token + "|" + hit.part;
        let inst = instances.get(key);
        if (!inst) {
          inst = { key, recipe: hit.recipe, token: hit.token, part: hit.part, names: hit.names, rules: [], path: pf.path, line: pf.lineOf(rule.index) };
          instances.set(key, inst);
        }
        inst.rules.push({ state: hit.state, rule, pf });
      }
    }
  }
  const transitionIndex = indexTransitions(parsed, props);
  for (const pf of parsed) hoverFindings.push(...hoverChecks(pf, props, transitionIndex, markup));

  const components = [];
  const findings = [...hoverFindings];
  // Surfaces before their backdrops, so a token they share is reported as the surface's.
  const ordered = [...instances.values()].sort((a, b) => (a.part === "backdrop") - (b.part === "backdrop"));
  const read = ordered.map((inst) => ({ inst, motion: readMotion(inst, props, keyframes, markup) }));
  const moving = new Set(read.filter((x) => x.motion.hasEnter).map((x) => x.inst.recipe.slug));
  const hooked = new Set();
  for (const { inst, motion } of read) {
    if (!motion.relevant) continue;
    const token = inst.token.split(" ").pop();
    if (isWrapperName(token.replace(/^\./, "")) && moving.has(inst.recipe.slug)) continue;
    if (hookOf(inst.token, inst.recipe)) {
      // Library code: the recipe CSS is correct by construction; only its
      // tunable variables can drift. One entry per recipe.
      if (hooked.has(inst.recipe.slug)) continue;
      hooked.add(inst.recipe.slug);
      const result = compareTunables(inst, props);
      components.push(result.component);
      findings.push(...result.findings);
      continue;
    }
    const result = compare(inst, motion, markup);
    components.push(result.component);
    findings.push(...result.findings);
  }
  for (const { inst, motion } of jsxMotion(files, markup)) {
    const result = compare(inst, motion, markup);
    components.push(result.component);
    findings.push(...result.findings);
  }
  // A backdrop is part of its modal: list it on its own only when the modal is not listed.
  const surfaces = new Set(components.filter((x) => !x.name.endsWith(" backdrop")).map((x) => x.recipe + "|" + x.path));
  const listed = components.filter((x) => !(x.name.endsWith(" backdrop") && surfaces.has(x.recipe + "|" + x.path)));
  listed.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { components: listed, findings };
}

// ── Recognition ───────────────────────────────────────────────────────────
function stateOf(parts, media) {
  let state = "base";
  if (media.some((m) => /@starting-style/i.test(m))) return "starting";
  for (const p of parts) {
    for (const c of p.classes) {
      if (CLOSING_CLASSES.has(c)) return "closing";
      if (OPEN_CLASSES.has(c)) state = "open";
    }
    for (const a of p.attrs) {
      if (/^data-state=["']?(closed|hidden)/.test(a) || /^data-(closing|leaving|exiting|ending-style)/.test(a)) return "closing";
      if (/^data-state=["']?(open|visible|active|checked|on|delayed-open|instant-open)/.test(a) || /^open$/.test(a) || /^aria-expanded=["']?true/.test(a) ||
          /^aria-selected=["']?true/.test(a) || /^aria-checked=["']?true/.test(a) || /^aria-pressed=["']?true/.test(a) || /^aria-hidden=["']?false/.test(a) ||
          /^data-(open|show|visible|expanded|checked|active|selected|enter)/.test(a)) state = "open";
      if (/^data-starting-style/.test(a)) return "starting";
    }
    for (const ps of p.pseudos) {
      if (/^(popover-open|checked|open|target)/.test(ps)) state = "open";
      else if (/^(hover|focus|focus-visible|focus-within|active)$/.test(ps) && state === "base") state = "hover";
    }
  }
  return state;
}

function tokenOf(p) {
  const cls = p.classes.find((c) => !OPEN_CLASSES.has(c) && !CLOSING_CLASSES.has(c));
  if (cls) return "." + cls;
  if (p.element) return p.element;
  const role = p.attrs.find((a) => a.startsWith("role="));
  if (role) return "[" + role + "]";
  return null;
}

function recipeFromCompound(p) {
  for (const c of p.classes) {
    if (OPEN_CLASSES.has(c) || CLOSING_CLASSES.has(c)) continue;
    const r = recipeForName(c, "class");
    if (r) return { recipe: r, name: c };
  }
  if (p.element) {
    const r = recipeForName(p.element, "element");
    if (r) return { recipe: r, name: p.element };
  }
  for (const a of p.attrs) {
    const role = a.match(/^role=["']?([a-z]+)/);
    if (role) {
      const r = recipeForName(role[1], "role");
      if (r) return { recipe: r, name: "role=" + role[1] };
    }
    const slot = a.match(/^data-slot=["']?([a-z-]+)/);
    if (slot) {
      const r = recipeForName(slot[1], "class");
      if (r) return { recipe: r, name: slot[1] };
    }
  }
  return null;
}

function isPartName(name, recipe) {
  const ws = words(name);
  const last = ws[ws.length - 1];
  if (!PART_WORDS.has(last)) return false;
  return !(recipe && recipe.nameSeqs.some((seq) => seq[seq.length - 1] === last));
}

function isWrapperName(name) {
  const ws = words(name);
  return WRAPPER_WORDS.has(ws[ws.length - 1]);
}

// Library hook classes: `t-modal`, `t-like-heart`, `t-tt`.
function hookOf(token, recipe) {
  if (!recipe.hook) return false;
  const prefix = recipe.hook.split("-").slice(0, 2).join("-");
  return token.split(" ").some((t) => {
    const c = t.replace(/^\./, "");
    return c === recipe.hook || c === prefix || c.startsWith(prefix + "-");
  });
}

// Template literals mix CSS with JS; a "selector" holding code is not CSS.
function looksLikeSelector(sel) {
  const bare = sel.replace(/\[[^\]]*\]/g, "").replace(/\([^()]*\)/g, "");
  return !/[;=!?'"`{}]|=>|\b(return|const|let|var|function|if|else|await|new)\b/.test(bare) && bare.length < 300;
}

function identify(selector, rule, markup) {
  if (!looksLikeSelector(selector)) return null;
  const cs = compounds(selector);
  if (!cs.length) return null;
  const parts = cs.map(parseCompound);
  const subject = parts[parts.length - 1];
  const state = stateOf(parts, rule.media);
  const backdropPseudo = subject.pseudoElement === "backdrop";
  if (subject.pseudoElement && !backdropPseudo) return null; // ::before/::after decorations

  const own = recipeFromCompound(subject);
  const subjectName = tokenOf(subject);
  if (own) {
    const ws = words(own.name);
    const isBackdrop = backdropPseudo || ws.some((w) => BACKDROP_WORDS.has(w));
    if (!isBackdrop && isPartName(own.name, own.recipe) && !own.name.startsWith("t-")) return null;
    // A class like `.field-input.is-error`: the recognized word came from a state
    // class, so the element is the first class.
    return { recipe: own.recipe, token: subjectName || own.name, part: isBackdrop ? "backdrop" : "surface", state, names: [own.name] };
  }
  // A plain backdrop (`.overlay`, `.backdrop`) belongs to a modal.
  if (subject.classes.some((c) => words(c).some((w) => BACKDROP_WORDS.has(w)) && !isPartName(c))) {
    return { recipe: recipeForName("modal"), token: subjectName, part: "backdrop", state, names: subject.classes };
  }
  // `.modal.is-open .content`: the subject is a surface inside a component.
  for (let k = parts.length - 2; k >= 0; k--) {
    const anc = recipeFromCompound(parts[k]);
    if (!anc) continue;
    if (!subjectName || !subject.classes.length) return null;
    const surfaceLike = subject.classes.some((c) => { const ws = words(c); return SURFACE_WORDS.has(ws[ws.length - 1]); });
    if (!surfaceLike) return null;
    return { recipe: anc.recipe, token: tokenOf(parts[k]) + " " + subjectName, part: backdropPseudo ? "backdrop" : "surface", state, names: [anc.name, ...subject.classes] };
  }
  return null;
}

// ── Motion ────────────────────────────────────────────────────────────────
function declsOf(entries, prop) {
  const out = [];
  for (const e of entries) for (const d of e.rule.decls) if (d.prop === prop) out.push({ d, pf: e.pf });
  return out;
}

function transitionsOf(entries, props) {
  const out = [];
  for (const e of entries) {
    const decls = e.rule.decls;
    const short = decls.filter((d) => d.prop === "transition");
    for (const d of short) {
      const r = resolveVars(d.value, props);
      if (/^\s*none\s*$/.test(r.value)) continue;
      for (const t of parseTransitionList(r.value)) {
        if (t.prop === "none") continue;
        out.push({ ...t, raw: d.value, via: r.via, line: e.pf.lineOf(d.index), path: e.pf.path, discrete: /allow-discrete/.test(r.value) });
      }
    }
    const longProp = decls.find((d) => d.prop === "transition-property");
    const longDur = decls.find((d) => d.prop === "transition-duration");
    if (longDur) {
      const dur = resolveVars(longDur.value, props);
      const propsList = longProp ? splitList(resolveVars(longProp.value, props).value) : ["all"];
      const durs = splitList(dur.value).map((v) => { const m = v.match(/(-?\d*\.?\d+)(ms|s)\b/); return m ? (m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1])) : 0; });
      const easeD = decls.find((d) => d.prop === "transition-timing-function");
      const eases = easeD ? splitList(resolveVars(easeD.value, props).value) : ["ease"];
      const delayD = decls.find((d) => d.prop === "transition-delay");
      const delays = delayD ? splitList(resolveVars(delayD.value, props).value).map((v) => { const m = v.match(/(-?\d*\.?\d+)(ms|s)\b/); return m ? (m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1])) : 0; }) : [0];
      propsList.forEach((p, i) => out.push({
        prop: p.trim().toLowerCase(), ms: durs[i % durs.length], delay: delays[i % delays.length], ease: eases[i % eases.length],
        raw: longDur.value, via: dur.via, line: e.pf.lineOf(longDur.index), path: e.pf.path,
        discrete: decls.some((d) => d.prop === "transition-behavior" && /allow-discrete/.test(d.value)),
      }));
    }
    const timingOnly = decls.find((d) => d.prop === "transition-timing-function");
    if (timingOnly && !longDur && !short.length) out.push({ prop: "*", ms: null, delay: 0, ease: resolveVars(timingOnly.value, props).value, raw: timingOnly.value, via: null, line: e.pf.lineOf(timingOnly.index), path: e.pf.path });
  }
  return out;
}

function animationsOf(entries, props) {
  const out = [];
  for (const e of entries) {
    for (const d of e.rule.decls) {
      if (d.prop === "animation") {
        const r = resolveVars(d.value, props);
        if (/^\s*none\s*$/.test(r.value)) continue;
        for (const a of parseAnimationList(r.value)) out.push({ ...a, via: r.via, line: e.pf.lineOf(d.index), path: e.pf.path });
      }
    }
    const name = e.rule.decls.find((d) => d.prop === "animation-name");
    if (name && !/^\s*none\s*$/.test(name.value)) {
      const dur = e.rule.decls.find((d) => d.prop === "animation-duration");
      const ease = e.rule.decls.find((d) => d.prop === "animation-timing-function");
      const iter = e.rule.decls.find((d) => d.prop === "animation-iteration-count");
      const r = dur ? resolveVars(dur.value, props) : { value: "", via: null };
      const m = r.value.match(/(-?\d*\.?\d+)(ms|s)\b/);
      out.push({
        name: name.value.trim(), ms: m ? (m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1])) : 0, delay: 0,
        ease: ease ? resolveVars(ease.value, props).value : "ease", infinite: iter ? /infinite/.test(iter.value) : false,
        via: r.via, line: e.pf.lineOf((dur || name).index), path: e.pf.path,
      });
    }
  }
  return out;
}

function motionValues(entries, props) {
  const decls = [];
  for (const e of entries) for (const d of e.rule.decls) decls.push({ ...d, value: resolveVars(d.value, props).value, line: e.pf.lineOf(d.index), path: e.pf.path, rawValue: d.value, via: resolveVars(d.value, props).via });
  const v = parseMotionValues(decls);
  const scaleDecl = decls.find((d) => (d.prop === "transform" && /scale/.test(d.value)) || d.prop === "scale");
  return { ...v, scaleSource: scaleDecl ? { line: scaleDecl.line, path: scaleDecl.path, via: scaleDecl.via, raw: scaleDecl.rawValue } : null };
}

function frameValues(kf, pick) {
  if (!kf) return {};
  const frame = kf.frames.find((f) => f.keys.includes(pick));
  if (!frame) return {};
  return parseMotionValues(frame.decls);
}

function frameProps(kf) {
  if (!kf) return [];
  const out = new Set();
  for (const f of kf.frames) for (const d of f.decls) out.add(d.prop);
  return [...out];
}

function readMotion(inst, props, keyframes, markup) {
  const by = (s) => inst.rules.filter((r) => r.state === s);
  const base = by("base");
  const open = by("open");
  const closing = by("closing");
  const hover = by("hover");
  const starting = by("starting");
  const family = inst.recipe.family;
  // For surfaces, a hover/focus state (tooltips, hover cards) is the open state.
  const openLike = family === "surface" && !open.length ? hover : open;

  const tBase = transitionsOf(base, props);
  const tOpen = transitionsOf(openLike, props);
  const tClosing = transitionsOf(closing, props);
  const aBase = animationsOf(base, props);
  const aOpen = animationsOf(openLike, props);
  const aClosing = animationsOf(closing, props);
  const loops = [...aBase, ...aOpen].filter((a) => a.infinite);

  const enterT = tOpen.filter((t) => t.ms != null).length ? tOpen : tBase;
  const exitT = tClosing.filter((t) => t.ms != null).length ? tClosing : (openLike.length || starting.length ? tBase : []);
  const enterA = [...aOpen, ...aBase].filter((a) => !a.infinite && a.ms > 0);
  const exitA = aClosing.filter((a) => !a.infinite && a.ms > 0);

  const displayOf = (entries) => declsOf(entries, "display").map((x) => x.d.value.trim());
  const baseHidden = displayOf(base).includes("none");
  const openShown = displayOf(openLike).some((v) => v !== "none");
  const discrete = [...tBase, ...tOpen].some((t) => t.discrete);
  const displayToggle = baseHidden && openShown && !discrete && !starting.length;

  const tokens = inst.token.split(" ").map((t) => t.replace(/^\./, ""));
  const mountedConditionally = tokens.some((t) => markup.conditional.has(t));
  const orchestrated = closing.length > 0 || tokens.some((t) => markup.presence.has(t));

  const hasStates = openLike.length > 0 || closing.length > 0 || starting.length > 0;
  const tMs = (list) => list.filter((t) => t.ms != null && t.ms > 20);
  const enterByTransition = tMs(enterT).length > 0 && (hasStates || family === "hover" || family === "symmetric" || family === "control") && !displayToggle && !(mountedConditionally && !starting.length);
  const enterByAnimation = enterA.length > 0;
  const hasEnter = enterByTransition || enterByAnimation;
  let hasExit = tMs(exitT).length > 0 || exitA.length > 0;
  if (displayToggle && !exitA.length) hasExit = false;
  if (mountedConditionally && !orchestrated) hasExit = false;

  const pickMs = (list) => {
    const l = tMs(list);
    if (!l.length) return null;
    const main = l.filter((t) => /^(transform|opacity|all|scale|translate|filter|clip-path|grid-template-rows|height|max-height|width|top|left|\*)$/.test(t.prop));
    const pool = main.length ? main : l;
    return pool.reduce((a, b) => (b.ms > a.ms ? b : a));
  };
  const enterSrc = enterByAnimation && (!enterByTransition || enterA[0].ms >= (pickMs(enterT)?.ms || 0)) ? { kind: "animation", v: enterA[0] } : enterByTransition ? { kind: "transition", v: pickMs(enterT) } : null;
  const exitSrc = exitA.length ? { kind: "animation", v: exitA[0] } : hasExit && pickMs(exitT) ? { kind: "transition", v: pickMs(exitT) } : null;

  // Scale the surface travels from (enter) and to (exit).
  let preScale = null, closeScale = null, scaleSrc = null, closeScaleSrc = null, distance = null, blur = null;
  const vBase = motionValues(base, props);
  const vStart = motionValues(starting, props);
  const vOpen = motionValues(openLike, props);
  const vClose = motionValues(closing, props);
  if (enterSrc && enterSrc.kind === "animation") {
    const kf = keyframes.get(enterSrc.v.name);
    const from = frameValues(kf, 0);
    if (from.scale != null) { preScale = from.scale; scaleSrc = kf ? { path: kf.path, line: kf.lineOf(kf.index), via: null } : null; }
    distance = Math.max(Math.abs(from.tx || 0), Math.abs(from.ty || 0)) || null;
    blur = from.blur ?? null;
  } else {
    const pre = starting.length ? vStart : vBase;
    if (pre.scale != null && (vOpen.scale == null || vOpen.scale === 1)) { preScale = pre.scale; scaleSrc = pre.scaleSource; }
    distance = Math.max(Math.abs(pre.tx || 0), Math.abs(pre.ty || 0)) || null;
    blur = pre.blur ?? null;
  }
  if (vClose.scale != null) { closeScale = vClose.scale; closeScaleSrc = vClose.scaleSource; }
  else if (exitSrc && exitSrc.kind === "animation") {
    const kf = keyframes.get(exitSrc.v.name);
    const to = frameValues(kf, 100);
    if (to.scale != null) { closeScale = to.scale; closeScaleSrc = kf ? { path: kf.path, line: kf.lineOf(kf.index), via: null } : null; }
  } else if (hasExit && preScale != null && !starting.length) { closeScale = preScale; closeScaleSrc = scaleSrc; }
  if (preScale === 1) preScale = null;
  if (closeScale === 1) closeScale = null;

  // What actually animates.
  const animated = new Set();
  for (const t of [...enterT, ...exitT]) {
    if (t.prop === "all") {
      const diff = changedProps(base, [...openLike, ...closing]);
      diff.forEach((p) => animated.add(p));
    } else if (t.prop !== "*") animated.add(t.prop);
  }
  for (const a of [...enterA, ...exitA]) frameProps(keyframes.get(a.name)).forEach((p) => animated.add(p));
  const layout = [...animated].filter((p) => LAYOUT_PROPS.has(p) && !(inst.recipe.layoutOk || []).includes(p));

  const origin = inst.rules.some((e) => e.rule.decls.some((d) => d.prop === "transform-origin")) || tokens.some((t) => markup.origin.has(t));
  const hasMotion = hasEnter || hasExit || loops.length > 0 || tBase.length > 0 || aBase.length > 0;

  // Only components that move (or visibly should) are worth reporting.
  const relevant = inst.part === "backdrop"
    ? hasEnter || hasExit
    : family === "loop" ? loops.length > 0 || enterA.length > 0
    : family === "surface" ? hasStates || hasEnter || mountedConditionally
    : family === "hover" ? hover.length > 0 && (tBase.length > 0 || tOpen.length > 0 || hasEnter)
    : inst.recipe.tier === "pro" ? hasMotion
    : family === "symmetric" || family === "control" ? hasMotion
    : hasMotion && (hasStates || hover.length > 0 || enterA.length > 0);

  return {
    relevant, family, hasEnter, hasExit, hasStates, displayToggle, mountedConditionally, orchestrated,
    enter: enterSrc, exit: exitSrc, preScale, closeScale, scaleSrc, closeScaleSrc, distance, blur,
    layout, animated: [...animated], origin, loops, hover: hover.length > 0,
  };
}

function changedProps(baseEntries, stateEntries) {
  const baseDecls = new Map();
  for (const e of baseEntries) for (const d of e.rule.decls) baseDecls.set(d.prop, d.value);
  const out = new Set();
  for (const e of stateEntries) {
    for (const d of e.rule.decls) {
      if (d.prop.startsWith("--") || NON_MOTION_PROPS.has(d.prop)) continue;
      if (baseDecls.get(d.prop) !== d.value) out.add(d.prop);
    }
  }
  return [...out];
}

// ── Comparison with the recipe ────────────────────────────────────────────
function easeClass(ease) {
  if (!ease) return null;
  const e = ease.trim().toLowerCase();
  if (e === "linear") return "linear";
  if (e === "ease-in") return "ease-in";
  if (e === "ease-in-out") return "ease-in-out";
  if (e === "ease") return "ease";
  if (e === "ease-out") return "ease-out";
  const m = e.match(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
  if (m) {
    const [x1, y1, , y2] = m.slice(1).map(Number);
    if (y1 > 1.05 || y2 > 1.05) return "bounce";
    if (x1 <= 0.4 && y1 >= 0.75) return "smooth-out";
    if (x1 >= 0.35 && y1 <= 0.15) return "ease-in";
    return "custom";
  }
  if (/^linear\(/.test(e)) return "custom";
  if (/^steps/.test(e)) return "steps";
  return "custom";
}

// Usage-based duration check: off when the value sits clearly on another step.
// Surfaces are held to the scale; controls and one-off moments get more room.
function durationOff(actual, expected, family = "surface") {
  if (actual == null || expected == null || actual <= 20) return false;
  const [lo, hi] = family === "surface" || family === "symmetric" ? [0.6, 1.4] : [0.4, 2];
  return (actual > expected * hi || actual < expected * lo) && Math.abs(actual - expected) > 40;
}

function fmtMs(ms) {
  return Math.round(ms) + "ms";
}

function usageLabel(inst, what) {
  const base = inst.part === "backdrop" ? shortName(inst.recipe) + " backdrop" : shortName(inst.recipe);
  return base + " " + what;
}

function shortName(r) {
  return r.label.toLowerCase();
}

// Where to report a value: at the token definition when the token belongs to
// this component (`--modal-open-dur`), otherwise where it is used.
function site(src, inst) {
  if (!src) return { path: inst.path, line: inst.line };
  const via = src.via;
  if (via && via.name) {
    const vw = words(via.name);
    const own = inst.names.some((n) => words(n).some((w) => vw.includes(w) && w.length > 2)) || vw.includes(shortName(inst.recipe));
    if (own) return { path: via.path, line: via.line, token: via.name };
  }
  return { path: src.path, line: src.line };
}

function compare(inst, m, markup) {
  const r = inst.recipe;
  const spec = r.spec;
  const findings = [];
  const issues = [];
  const offs = [];
  const label = inst.part === "backdrop" ? r.label + " backdrop" : r.label;
  const tokens = inst.token.split(" ").map((t) => t.replace(/^\./, ""));
  const usesRecipe = r.hook && tokens.some((t) => t === r.hook || (t.startsWith("t-") && r.hook.startsWith(t)) || t.startsWith(r.hook.split("-").slice(0, 2).join("-")));
  const related = [...new Set(tokens.flatMap((t) => markup.usedIn.get(t) || []))].filter((p) => p !== inst.path);

  const off = (what, from, to, src, extra, severity = "warn") => {
    const where = site(src, inst);
    offs.push(what + " " + from);
    findings.push({
      rule: "off-scale", severity, path: where.path, line: where.line, recipe: r.slug,
      message: `${usageLabel(inst, what)}: ${from} -> ${to}${extra ? ". " + extra : ""}`,
      usage: usageLabel(inst, what), from, to, related,
    });
  };

  const openMs = m.enter ? m.enter.v.ms : null;
  const closeMs = m.exit ? m.exit.v.ms : null;
  const surfaceLike = m.family === "surface" || m.family === "symmetric";

  if (spec) {
    // Durations, by usage.
    if (durationOff(openMs, spec.open, m.family)) {
      const tok = durationToken(spec.open);
      off("open", fmtMs(openMs), fmtMs(spec.open) + (tok ? ` (var(${tok}))` : ""), m.enter.v, openMs > spec.open ? "Opening this slow makes the UI feel laggy" : "", openMs > spec.open * 1.9 ? "warn" : "minor");
    }
    if (m.family === "surface" && spec.close != null && durationOff(closeMs, spec.close, m.family)) {
      const tok = durationToken(spec.close);
      off("close", fmtMs(closeMs), fmtMs(spec.close) + (tok ? ` (var(${tok}))` : ""), m.exit.v, closeMs > spec.close ? "Closes should get out of the way, quicker than opens" : "", closeMs > spec.close * 1.9 ? "warn" : "minor");
    } else if (m.family === "surface" && inst.part !== "backdrop" && spec.open && spec.close && spec.close < spec.open && openMs && closeMs && closeMs >= openMs && closeMs > spec.close + 20 && !durationOff(openMs, spec.open)) {
      const tok = durationToken(spec.close);
      off("close", fmtMs(closeMs), fmtMs(spec.close) + (tok ? ` (var(${tok}))` : ""), m.exit.v, `Closes as slowly as it opens; the recipe closes in ${fmtMs(spec.close)} after a ${fmtMs(spec.open)} open`, "minor");
    }

    // Easing, by usage.
    const easeSrc = m.enter && inst.part !== "backdrop" ? m.enter.v : null;
    const ec = easeClass(easeSrc ? easeSrc.ease : null);
    const specEc = easeClass(spec.ease);
    if (ec && easeSrc) {
      const wantSmooth = specEc === "smooth-out";
      const bad = ec === "linear" && specEc !== "linear" && m.family !== "feedback"
        || ec === "ease-in" && specEc !== "ease-in"
        || (wantSmooth && surfaceLike && (ec === "ease" || ec === "ease-in-out" || ec === "custom"));
      if (bad) {
        const to = spec.ease === SMOOTH_OUT ? `var(--ease-smooth-out) (${SMOOTH_OUT})` : spec.ease;
        const why = ec === "linear" ? "Linear timing feels mechanical on UI surfaces" : ec === "ease-in" ? "Ease-in starts slow, so the surface feels late" : "";
        off("easing", easeSrc.ease, to, easeSrc, why, ec === "linear" || ec === "ease-in" ? "warn" : "minor");
      }
    }
    const exitEase = m.exit ? m.exit.v.ease : null;
    if (m.family === "surface" && easeClass(exitEase) === "bounce" && easeClass(spec.closeEase) !== "bounce") {
      off("close easing", exitEase, spec.closeEase || `var(--ease-smooth-out)`, m.exit.v, "Never bounce a close");
    }

    // Scale, by usage.
    if (spec.preScale != null && m.preScale != null && Math.abs(m.preScale - spec.preScale) > 0.025 && inst.part !== "backdrop") {
      const tok = scaleToken(spec.preScale);
      off("scale", String(m.preScale), String(spec.preScale) + (tok ? ` (var(${tok}))` : ""), m.scaleSrc, m.preScale < 0.9 ? "Below 0.9 reads as a zoom, not UI chrome" : "", m.preScale < 0.9 ? "warn" : "minor");
    }
    if (m.family === "surface" && spec.closeScale != null && m.closeScale != null && Math.abs(m.closeScale - spec.closeScale) > 0.025 && inst.part !== "backdrop" &&
        !(m.closeScaleSrc && m.scaleSrc && m.closeScaleSrc.line === m.scaleSrc.line && m.closeScaleSrc.path === m.scaleSrc.path)) {
      const tok = scaleToken(spec.closeScale);
      off("close scale", String(m.closeScale), String(spec.closeScale) + (tok ? ` (var(${tok}))` : ""), m.closeScaleSrc, "", m.closeScale < 0.9 ? "warn" : "minor");
    }

    // Travel distance.
    if (m.distance != null && m.distance > 40 && !r.bigTravel && inst.part !== "backdrop") {
      const to = spec.distance != null ? spec.distance + "px" : "8px (var(--distance-base))";
      off("travel", m.distance + "px", to, m.enter ? m.enter.v : null, "Long travel reads as sluggish", "minor");
    }

    // Tooltip intent delay; never delay a close.
    if (spec.delay && m.enter && m.enter.kind === "transition" && !(m.enter.v.delay > 0) && inst.part !== "backdrop") {
      off("delay", "0ms", fmtMs(spec.delay) + " (var(--duration-micro))", m.enter.v, "A short intent delay stops a passing cursor from triggering it", "minor");
    }
    if (m.family === "surface" && m.exit && m.exit.v.delay > 20 && m.exit.v !== (m.enter && m.enter.v)) {
      off("close delay", fmtMs(m.exit.v.delay), "0ms", m.exit.v, "Dismissal must feel instant");
    }
  }

  // Structure: what polish cannot fix.
  if (m.family === "surface" && inst.part !== "backdrop") {
    if (!m.hasEnter && (m.hasStates || m.mountedConditionally)) issues.push(m.displayToggle ? "toggles display, so it pops in and out" : m.mountedConditionally ? "mounts with no enter motion (CSS transitions do not run on mount)" : "appears and disappears with no transition");
    else if (m.hasEnter && !m.hasExit) issues.push(m.mountedConditionally ? "unmounts instantly, no exit animation" : m.displayToggle ? "hides with display: none, no exit animation" : "has no exit animation");
    if (r.origin && m.preScale != null && !m.origin) issues.push("grows from its center, not from its trigger");
  }
  if (m.layout.length && !isWrapperName(inst.token.split(" ").pop().replace(/^\./, ""))) {
    issues.push(`animates ${m.layout.join(", ")} (layout)` + (r.layoutHint ? `; ${r.layoutHint}` : ""));
  }

  let status;
  if (issues.length) {
    status = "mismatch";
    const sev = issues.some((i) => /pops|no enter|no exit|instantly|no transition|layout/.test(i)) ? "major" : "warn";
    findings.push({
      rule: "recipe-mismatch", severity: sev, path: inst.path, line: inst.line, recipe: r.slug, related,
      message: `${label} ${issues.join("; ")}. ${recipeSummary(r)}`,
    });
  } else if (offs.length) {
    status = "off";
  } else if (usesRecipe || inst.part === "backdrop") {
    status = "matches";
  } else {
    status = "available";
    findings.push({
      rule: "recipe-available", severity: "info", path: inst.path, line: inst.line, recipe: r.slug, related,
      message: `Hand-rolled ${label.toLowerCase()}. ${recipeSummary(r)}`,
    });
  }

  return {
    findings,
    component: {
      recipe: r.slug, name: label, tier: r.tier, url: recipeUrl(r), path: inst.path, line: inst.line, selector: inst.token,
      status, usesRecipe: !!usesRecipe, issues, offScale: offs,
      motion: {
        open: openMs != null ? Math.round(openMs) : null, close: closeMs != null ? Math.round(closeMs) : null,
        ease: m.enter ? m.enter.v.ease : null, scale: m.preScale, exit: m.hasExit, layout: m.layout,
      },
      recipeSpec: r.spec ? { open: r.spec.open, close: r.spec.close, scale: r.spec.preScale, ease: r.spec.ease } : null,
    },
  };
}

// A component built from the library recipe: compare the project's values for
// the recipe's tunable variables with the recipe defaults, by usage.
function compareTunables(inst, props) {
  const r = inst.recipe;
  const findings = [];
  const offs = [];
  const label = r.label;
  const defaults = RECIPE_VARS.get(r.slug) || {};
  for (const [name, def] of Object.entries(defaults)) {
    const cur = props.get(name);
    if (!cur) continue;
    const value = resolveVars(cur.value, props).value.trim();
    if (value === def) continue;
    const line = cur.lineOf(cur.index);
    const usage = usageOfVar(r, name);
    const ms = value.match(/^(-?\d*\.?\d+)(ms|s)$/);
    const defMs = def.match(/^(-?\d*\.?\d+)(ms|s)$/);
    let bad = false;
    let extra = "";
    if (ms && defMs) {
      const a = ms[2] === "s" ? parseFloat(ms[1]) * 1000 : parseFloat(ms[1]);
      const e = defMs[2] === "s" ? parseFloat(defMs[1]) * 1000 : parseFloat(defMs[1]);
      bad = durationOff(a, e, r.family);
      if (bad && /close|out|collapse/.test(name) && a > e) extra = "Closes should get out of the way, quicker than opens";
      else if (bad && a > e) extra = "Opening this slow makes the UI feel laggy";
    } else if (/^-?\d*\.?\d+$/.test(value) && /^-?\d*\.?\d+$/.test(def) && /scale/.test(name)) {
      bad = Math.abs(parseFloat(value) - parseFloat(def)) > 0.025;
      if (bad && parseFloat(value) < 0.9) extra = "Below 0.9 reads as a zoom, not UI chrome";
    } else if (/ease/.test(name)) {
      bad = easeClass(value) !== easeClass(def) && (easeClass(value) === "linear" || easeClass(value) === "ease-in");
    }
    if (!bad) continue;
    offs.push(usage + " " + value);
    findings.push({
      rule: "off-scale", severity: extra ? "warn" : "minor", path: cur.path, line, recipe: r.slug,
      message: `${usage} (${name}): ${value} -> ${def}, the ${r.label} recipe default${extra ? ". " + extra : ""}`,
      usage, from: value, to: def,
    });
  }
  return {
    findings,
    component: {
      recipe: r.slug, name: label, tier: r.tier, url: recipeUrl(r), path: inst.path, line: inst.line, selector: inst.token,
      status: offs.length ? "off" : "matches", usesRecipe: true, issues: [], offScale: offs,
      motion: tunedMotion(r, props),
      recipeSpec: r.spec ? { open: r.spec.open, close: r.spec.close, scale: r.spec.preScale, ease: r.spec.ease } : null,
    },
  };
}

// The recipe's timing as this project sets it (tunables, falling back to defaults).
function tunedMotion(r, props) {
  const sv = r.specVars || {};
  const defaults = RECIPE_VARS.get(r.slug) || {};
  const val = (name) => {
    if (!name) return null;
    const cur = props.get(name);
    return cur ? resolveVars(cur.value, props).value.trim() : defaults[name] ?? null;
  };
  const ms = (v) => { const m = v && v.match(/^(-?\d*\.?\d+)(ms|s)$/); return m ? Math.round(m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1])) : null; };
  const num = (v) => (v != null && /^-?\d*\.?\d+$/.test(v) ? parseFloat(v) : null);
  return { open: ms(val(sv.open)), close: ms(val(sv.close)), ease: val(sv.ease), scale: num(val(sv.preScale)), exit: true, layout: [] };
}

function usageOfVar(r, name) {
  const base = r.label.toLowerCase();
  if (/scale/.test(name)) return base + (/clos/.test(name) ? " close scale" : " scale");
  if (/ease/.test(name)) return base + (/out|clos/.test(name) ? " close easing" : " easing");
  if (/delay/.test(name)) return base + " delay";
  if (/close|-out\b|collapse|return|uncheck/.test(name)) return base + " close";
  if (/dur|open|-in\b|expand|pop/.test(name)) return base + " open";
  return base + " " + name.replace(/^--[a-z]+-/, "").replace(/-/g, " ");
}

function recipeSummary(r) {
  const s = r.spec;
  const tier = r.tier === "pro" ? " (Pro)" : "";
  if (!s || s.open == null) return `The transitions.dev ${r.name} recipe${tier} fits: ${r.when || recipeUrl(r)}`.replace(/\s+$/, "");
  const parts = [];
  if (s.delay) parts.push(`${fmtMs(s.delay)} intent delay`);
  if (s.open) parts.push(`${fmtMs(s.open)} in`);
  if (s.close && s.close !== s.open) parts.push(`${fmtMs(s.close)} out`);
  if (s.preScale) parts.push(`scale from ${s.preScale}`);
  if (s.ease === SMOOTH_OUT) parts.push("smooth ease-out");
  if (r.origin) parts.push("grows from its trigger");
  if (r.layoutHint) parts.push("grid-rows height");
  return `The transitions.dev ${r.name} recipe${tier}: ${parts.join(", ")}.`;
}

// ── Hover in/out ──────────────────────────────────────────────────────────
// A hover that changes properties its transition does not cover snaps, and a
// hover that shifts layout (padding, margin, width) jumps.

// Transitions declared on each subject (`.tooltip`, `button`), project-wide,
// from rules without hover/focus/active states.
function indexTransitions(parsed, props) {
  const index = new Map();
  for (const pf of parsed) {
    for (const r of pf.rules) {
      if (r.media.some((m) => /prefers-reduced-motion/i.test(m))) continue;
      const trans = [];
      for (const d of r.decls) {
        const at = { path: pf.path, line: pf.lineOf(d.index), raw: d.value };
        if (d.prop === "transition") trans.push(...parseTransitionList(resolveVars(d.value, props).value).filter((t) => t.prop !== "none").map((t) => ({ ...t, ...at })));
        if (d.prop === "transition-property") splitList(d.value).forEach((p) => trans.push({ prop: p.trim(), ms: 1 }));
      }
      if (!trans.length) continue;
      for (const sel of splitList(r.selector)) {
        if (/:(hover|focus|active)/.test(sel)) continue;
        const key = subjectKey(sel);
        if (!key) continue;
        // Indexed by the whole subject and by each of its classes, so `.btn.primary`
        // covers a `.primary:hover` on the same element.
        for (const k of [key, ...parseCompound(key).classes.map((c) => "." + c)]) {
          if (!index.has(k)) index.set(k, []);
          index.get(k).push(...trans);
        }
      }
    }
  }
  return index;
}

// The last compound without state pseudo-classes: `.a:hover .b.c` -> `.b.c`.
function subjectKey(sel) {
  const cs = compounds(sel.trim());
  if (!cs.length) return null;
  return cs[cs.length - 1].replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "").replace(/:(hover|focus-visible|focus-within|focus|active)\b/g, "");
}

function hoverChecks(pf, props, index, markup) {
  const out = [];
  const seen = new Set();
  for (const r of pf.rules) {
    if (r.media.some((m) => /prefers-reduced-motion/i.test(m))) continue;
    for (const sel of splitList(r.selector)) {
      if (!/:hover\b/.test(sel)) continue;
      const changed = new Set();
      for (const d of r.decls) if (!d.prop.startsWith("--") && !NON_MOTION_PROPS.has(d.prop)) changed.add(d.prop);
      if (!changed.size) continue;
      const subject = subjectKey(sel);
      const baseSel = sel.replace(/:hover\b/g, "").replace(/\s+/g, " ").trim();
      // Everything that can transition this element: its exact base rule, any
      // rule on the same subject, and classes it shares an element with.
      const trans = [...(index.get(baseSel) || []), ...(index.get(subject) || [])];
      for (const r2 of [r]) for (const d of r2.decls) if (d.prop === "transition") trans.push(...parseTransitionList(resolveVars(d.value, props).value));
      const classes = parseCompound(subject || "").classes;
      for (const c of classes) {
        trans.push(...(index.get("." + c) || []));
        for (const co of markup.coClasses.get(c) || []) trans.push(...(index.get("." + co) || []));
      }
      const covered = new Set(trans.map((t) => t.prop));
      const all = covered.has("all");
      const visual = [...changed].filter((p) => (VISUAL_PROPS.has(p) || /^(background|border)-/.test(p)) && !/^(background-image|border-style|border-width|background-clip)$/.test(p));
      const layout = [...changed].filter((p) => LAYOUT_PROPS.has(p));
      const covers = (p) => all || covered.has(p) || (p.startsWith("background") && covered.has("background")) || (p.startsWith("border") && covered.has("border")) || (p === "background" && covered.has("background-color")) || (p === "border" && covered.has("border-color"));
      const uncovered = visual.filter((p) => !covers(p));
      const line = pf.lineOf(r.index);
      // Theme variants of the same hover (html[data-theme=dark] ...) are one issue.
      const key = pf.path + "|" + subject + "|" + [...changed].sort().join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      if (trans.length && uncovered.length) {
        const has = [...covered].filter((p) => p !== "all").join(", ");
        out.push({
          rule: "hover-without-transition", severity: "warn", path: pf.path, line, selector: sel, props: uncovered,
          message: `"${sel.slice(0, 60)}" changes ${uncovered.join(", ")}, but its transition only covers ${has || "other properties"}, so those changes snap. Add them to the transition.`,
        });
      } else if (!trans.length && visual.length) {
        out.push({
          rule: "hover-without-transition", severity: "warn", path: pf.path, line, selector: sel, props: visual,
          message: `"${sel.slice(0, 60)}" changes ${visual.join(", ")} with no transition. The change snaps instead of easing.`,
        });
      }
      // Hover in is quick and eases out; ease-in or linear makes it feel late.
      const driving = visual.length ? trans.filter((t) => t.line && t.ms > 20) : [];
      const lateEase = driving.find((t) => /^(ease-in|linear)$/.test(String(t.ease).trim()));
      if (lateEase && !seen.has("ease|" + lateEase.path + ":" + lateEase.line)) {
        seen.add("ease|" + lateEase.path + ":" + lateEase.line);
        out.push({
          rule: "off-scale", severity: "minor", path: lateEase.path, line: lateEase.line,
          message: `hover easing: ${lateEase.ease} -> var(--ease-smooth-out) (cubic-bezier(0.22, 1, 0.36, 1)). Hover in should be quick and direct; ${lateEase.ease} makes it feel late`,
          usage: "hover easing", from: lateEase.ease, to: "var(--ease-smooth-out)", selector: sel,
        });
      }
      if (layout.length) {
        out.push({
          rule: "layout-animation", severity: "warn", path: pf.path, line, selector: sel, props: layout,
          message: `"${sel.slice(0, 60)}" shifts ${layout.join(", ")} on hover (layout), which moves surrounding content. Use transform (translate or scale) for the shift.`,
        });
      }
    }
  }
  return out;
}

// ── Markup ────────────────────────────────────────────────────────────────
// Where classes are used, which elements mount conditionally (so they cannot
// animate out without help), and which set their own transform origin.
function scanMarkup(files) {
  const conditional = new Set();
  const presence = new Set();
  const origin = new Set();
  const usedIn = new Map();
  const coClasses = new Map();
  for (const f of files) {
    if (!JSXISH.has(f.ext)) continue;
    const src = f.content;
    const classRe = /\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g;
    let m;
    while ((m = classRe.exec(src))) {
      const list = (m[1] ?? m[2] ?? m[3] ?? "").split(/\s+/).filter(Boolean);
      for (const c of list) {
        if (!usedIn.has(c)) usedIn.set(c, new Set());
        usedIn.get(c).add(f.path);
        if (!coClasses.has(c)) coClasses.set(c, new Set());
        for (const other of list) if (other !== c) coClasses.get(c).add(other);
      }
    }
    const condRe = /(?:&&|\?)\s*\(?\s*<[A-Za-z][\w.]*\b[^>]*?\bclass(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/g;
    while ((m = condRe.exec(src))) {
      for (const c of (m[1] ?? m[2] ?? m[3] ?? "").split(/\s+/).filter(Boolean)) conditional.add(c);
    }
    if (/AnimatePresence|<Transition\b|CSSTransition|useTransition|TransitionGroup|data-state|onAnimationEnd|onTransitionEnd|transitionend|animationend|is-closing|isClosing|closing/.test(src)) {
      for (const c of usedIn.keys()) if (usedIn.get(c).has(f.path)) presence.add(c);
    }
    if (/data-origin|transformOrigin|transform-origin/.test(src)) {
      for (const c of usedIn.keys()) if (usedIn.get(c).has(f.path)) origin.add(c);
    }
  }
  const used = new Map([...usedIn].map(([k, v]) => [k, [...v]]));
  return { conditional, presence, origin, usedIn: used, coClasses };
}

// ── Motion defined in JSX: Framer Motion props and Tailwind utilities ─────
const TW_DEFAULT_MS = 150; // tailwindcss-animate and Tailwind's transition default

function jsxMotion(files, markup) {
  const out = [];
  for (const f of files) {
    if (!/\.(jsx|tsx|js|mjs|ts|vue|svelte)$/.test(f.path) || !/(motion\.|animate-in|animate-out|zoom-in|duration-\d|data-\[state)/.test(f.content)) continue;
    const lineOf = lineIndex(f.content);
    const fileRecipe = recipeForName(f.path.split("/").pop().replace(/\.\w+$/, ""), "file");
    for (const el of jsxElements(f.content)) {
      const cls = attr(el.attrs, "className") || attr(el.attrs, "class") || "";
      const slot = attr(el.attrs, "data-slot");
      const framer = /^(motion|m)\./.test(el.tag);
      const tw = /\b(animate-in|animate-out|zoom-in-\d+|zoom-out-\d+|duration-(\d+|\[)|slide-in-from-|fade-in)/.test(cls);
      if (!framer && !tw) continue;
      const names = cls.split(/\s+/).filter((c) => c && !/[:[\]]/.test(c) && !/^(animate|duration|ease|zoom|fade|slide|transition|scale|opacity|translate|origin)-/.test(c));
      let recipe = null;
      let via = null;
      for (const n of [...names, slot, enclosingComponent(f.content, el.index)]) {
        if (!n) continue;
        const r = recipeForName(n, "class");
        if (!r || (isPartName(n, r) && !n.startsWith("t-"))) continue;
        recipe = r;
        via = n;
        break;
      }
      if (!recipe && fileRecipe) { recipe = fileRecipe; via = f.path; }
      if (!recipe) continue;
      const motion = framer ? framerMotion(el, f, lineOf, recipe) : tailwindMotion(cls, f, lineOf(el.index), recipe);
      if (!motion) continue;
      const token = names[0] ? "." + names[0] : via;
      const part = [via, ...names].some((n) => n && words(n).some((w) => BACKDROP_WORDS.has(w))) ? "backdrop" : "surface";
      out.push({
        inst: { key: recipe.slug + "|" + f.path + ":" + lineOf(el.index), recipe, token, part, names: [via, ...names].filter(Boolean), path: f.path, line: lineOf(el.index) },
        motion,
      });
    }
  }
  return out;
}

// Opening tags with their attribute text; braces are balanced so arrow
// functions and object literals in props do not end the tag early.
function jsxElements(src) {
  const out = [];
  const re = /<([A-Za-z][\w.]*)(?=[\s>/])/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    let i = m.index + m[0].length;
    let quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === quote && src[i - 1] !== "\\") quote = null; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: m[1], attrs: src.slice(m.index + m[0].length, i), index: m.index });
  }
  return out;
}

function attr(attrs, name) {
  const re = new RegExp("\\b" + name.replace(/[-]/g, "\\-") + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|\\{\\s*[\"'`]([^\"'`]*)[\"'`]\\s*\\}|\\{([^}]*)\\})");
  const m = attrs.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? (m[4] || "").replace(/[`"']/g, " ");
}

// Object-literal prop value: initial={{ ... }} -> "{ ... }" text.
function objectProp(attrs, name) {
  const i = attrs.search(new RegExp("\\b" + name + "\\s*=\\s*\\{"));
  if (i < 0) return null;
  let start = attrs.indexOf("{", i);
  let depth = 0;
  for (let j = start; j < attrs.length; j++) {
    if (attrs[j] === "{") depth++;
    else if (attrs[j] === "}") { depth--; if (depth === 0) return attrs.slice(start + 1, j); }
  }
  return null;
}

function num(text, key) {
  if (!text) return null;
  const m = text.match(new RegExp("\\b" + key + "\\s*:\\s*(-?\\d*\\.?\\d+)"));
  return m ? parseFloat(m[1]) : null;
}

function framerEase(text) {
  if (!text) return null;
  const arr = text.match(/\bease\s*:\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]/);
  if (arr) return `cubic-bezier(${arr[1]}, ${arr[2]}, ${arr[3]}, ${arr[4]})`;
  const named = text.match(/\bease\s*:\s*["'](\w+)["']/);
  if (named) return { linear: "linear", easeIn: "ease-in", easeOut: "ease-out", easeInOut: "ease-in-out" }[named[1]] || named[1];
  if (/\btype\s*:\s*["']spring["']/.test(text)) return "spring";
  return null;
}

function enclosingComponent(src, index) {
  const before = src.slice(Math.max(0, index - 4000), index);
  const re = /(?:function\s+([A-Z]\w*)|(?:const|let)\s+([A-Z]\w*)\s*=\s*(?:\(|React\.forwardRef|forwardRef|memo|React\.memo|styled))/g;
  let m;
  let last = null;
  while ((m = re.exec(before))) last = m[1] || m[2];
  return last;
}

function framerMotion(el, f, lineOf, recipe) {
  const line = lineOf(el.index);
  const initial = objectProp(el.attrs, "initial");
  const animate = objectProp(el.attrs, "animate");
  const exit = objectProp(el.attrs, "exit");
  const trans = objectProp(el.attrs, "transition");
  if (!initial && !animate && !exit) return null;
  const exitTrans = exit && (exit.match(/transition\s*:\s*\{([^}]*)\}/) || [])[1];
  const dur = num(trans, "duration");
  const exitDur = exitTrans ? num(exitTrans, "duration") : dur;
  const ease = framerEase(trans) || (trans ? "ease-out" : "ease-out");
  const spring = ease === "spring";
  const enterMs = dur != null ? dur * 1000 : spring ? null : 300;
  const presence = /AnimatePresence/.test(f.content);
  const src = { ms: enterMs, ease: spring ? "cubic-bezier(0.22, 1, 0.36, 1)" : ease, delay: (num(trans, "delay") || 0) * 1000, path: f.path, line, via: null };
  const exitSrc = { ms: exitDur != null ? exitDur * 1000 : enterMs, ease: framerEase(exitTrans) || src.ease, delay: 0, path: f.path, line, via: null };
  const pre = num(initial, "scale");
  const post = num(exit, "scale");
  const dist = Math.max(Math.abs(num(initial, "y") || 0), Math.abs(num(initial, "x") || 0)) || null;
  const layout = ["height", "width", "top", "left"].filter((k) => num(initial, k) != null || (initial && new RegExp("\\b" + k + "\\s*:").test(initial)));
  return {
    relevant: true, family: recipe.family, hasEnter: !!initial || !!animate, hasExit: !!exit && presence, hasStates: true,
    displayToggle: false, mountedConditionally: !presence, orchestrated: presence,
    enter: enterMs != null ? { kind: "transition", v: src } : null,
    exit: exit && presence && exitSrc.ms != null ? { kind: "transition", v: exitSrc } : null,
    preScale: pre != null && pre !== 1 ? pre : null, closeScale: post != null && post !== 1 ? post : null,
    scaleSrc: { path: f.path, line, via: null }, closeScaleSrc: { path: f.path, line: line + 1, via: null },
    distance: dist, blur: null, layout, animated: [], origin: /originX|originY|transformOrigin|style=\{\{[^}]*origin/.test(el.attrs), loops: [], hover: /whileHover/.test(el.attrs),
  };
}

function tailwindMotion(cls, f, line, recipe) {
  const list = cls.split(/\s+/);
  const find = (re) => { for (const c of list) { const m = c.match(re); if (m) return m; } return null; };
  const msOf = (m) => (m ? (m[2] ? parseFloat(m[2]) : parseFloat(m[1])) : null);
  const base = msOf(find(/^duration-(?:(\d+)|\[(\d+)ms\])$/));
  const openMs = msOf(find(/^data-\[state=open\]:duration-(?:(\d+)|\[(\d+)ms\])$/)) ?? base ?? TW_DEFAULT_MS;
  const closeMs = msOf(find(/^data-\[state=closed\]:duration-(?:(\d+)|\[(\d+)ms\])$/)) ?? base ?? TW_DEFAULT_MS;
  const easeM = find(/^(?:data-\[state=open\]:)?ease-(linear|in|out|in-out|\[(.+)\])$/);
  const ease = easeM ? (easeM[2] ? easeM[2].replace(/_/g, " ") : { linear: "linear", in: "ease-in", out: "ease-out", "in-out": "ease-in-out" }[easeM[1]]) : "ease-out";
  const zoomIn = find(/zoom-in-(\d+)$/);
  const zoomOut = find(/zoom-out-(\d+)$/);
  const slide = find(/slide-in-from-(?:top|bottom|left|right)-(\d+)$/);
  const hasEnter = list.some((c) => /animate-in$|zoom-in|fade-in|slide-in/.test(c));
  const hasExit = list.some((c) => /animate-out$|zoom-out|fade-out|slide-out/.test(c));
  const src = { ms: openMs, ease, delay: 0, path: f.path, line, via: null };
  return {
    relevant: true, family: recipe.family, hasEnter, hasExit, hasStates: true, displayToggle: false, mountedConditionally: false, orchestrated: true,
    enter: hasEnter ? { kind: "transition", v: src } : null,
    exit: hasExit ? { kind: "transition", v: { ...src, ms: closeMs } } : null,
    preScale: zoomIn ? parseInt(zoomIn[1], 10) / 100 : null, closeScale: zoomOut ? parseInt(zoomOut[1], 10) / 100 : null,
    scaleSrc: { path: f.path, line, via: null }, closeScaleSrc: { path: f.path, line, via: null },
    distance: slide ? parseInt(slide[1], 10) * 4 : null, blur: null, layout: [], animated: [], origin: list.some((c) => /^origin-/.test(c)), loops: [], hover: false,
  };
}
