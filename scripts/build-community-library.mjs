#!/usr/bin/env node
// Builds assets/community/library.json: every free library transition as an
// exact copy of its card on library.html, so a remix starts from what the
// card shows and does:
//   - html: the card stage markup, as written in the page
//   - css:  every rule that applies to the card (its states, dark theme,
//           reduced motion, responsive tweaks), the keyframes and @property
//           rules those use, the design tokens they read, and the site's
//           base reset, taken from the page's CSS source text
//   - js:   the card's own handlers, cut from the page's prototype script
// Images the card uses are inlined as data URIs (previews are sandboxed).
// Pro transitions are never included: their code is paid content.
//
//   node scripts/build-community-library.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "library.html"), "utf8");

// ── Text helpers ─────────────────────────────────────────────────────────────

// Index just past the brace that closes the one at `open`, skipping strings,
// template literals, comments and regex literals.
function closeBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2) + 1; continue; }
    if (c === "/") {
      const prev = src.slice(0, i).replace(/\s+$/, "").slice(-1);
      if (!prev || "(,=:[!&|?{};+-*%<>~^".includes(prev)) {
        for (i++; i < src.length && src[i] !== "/"; i++) {
          if (src[i] === "\\") i++;
          else if (src[i] === "[") { for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++; }
        }
        continue;
      }
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

// The element starting at `start` (an opening <tag ...>) through its closing tag.
function element(src, start, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(src))) {
    if (m[0] === `</${tag}>`) { if (--depth === 0) return src.slice(start, m.index + m[0].length); }
    else depth++;
  }
  return null;
}

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ── Cards ────────────────────────────────────────────────────────────────────

const cards = [];
for (const m of page.matchAll(/<article class="card" data-proto-card[^>]*>/g)) {
  const art = element(page, m.index, "article");
  if (!art) continue; // a card template inside a script
  const key = (art.match(/data-copy-key="(p\d+)"/) || [])[1];
  if (!key) continue; // Pro cards copy through the API (data-pro-copy)
  const stageAt = art.indexOf('<div class="card-stage"');
  cards.push({
    key,
    n: key.slice(1),
    open: m[0],
    stage: element(art, stageAt, "div"),
    title: decode((art.match(/<div class="card-title">([^<]+)<\/div>/) || [])[1] || key).trim(),
    desc: decode((art.match(/<div class="card-subtitle">([^<]+)<\/div>/) || [])[1] || "").trim(),
    cat: (art.match(/data-cat="([^"]+)"/) || [])[1] || "essential",
  });
}

// ── Scripts ──────────────────────────────────────────────────────────────────

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const main = scripts.find((s) => s.includes("Prototype handlers"));
if (!main) throw new Error("prototype script not found in library.html");
const all = scripts.join("\n");

// Source text cut at `at` loses its first line's indentation; put it back
// (the column of `at`), then strip the common indent.
function dedent(src, at, text) {
  const lines = text.split("\n");
  lines[0] = " ".repeat(at - src.lastIndexOf("\n", at) - 1) + lines[0].trimStart();
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(Math.min(pad, l.match(/^ */)[0].length))).join("\n");
}
const indent = (text, n) => text.split("\n").map((l) => (l.trim() ? " ".repeat(n) + l : "")).join("\n");

function fn(src, name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) throw new Error("helper not found: " + name);
  return dedent(src, at, src.slice(at, closeBrace(src, src.indexOf("{", at))));
}

// "/* ── Prototype N: ..." sections: a prototype's helpers and its init.
function section(n) {
  const re = /\/\* ── Prototype (\d+)\b/g;
  let m;
  while ((m = re.exec(main))) {
    if (m[1] !== n) continue;
    const rest = main.slice(m.index + 1);
    const ends = [
      rest.search(/\/\* ── Prototype \d+/),
      rest.search(/\n {6}var PROTO_TEMPLATES/),
      rest.search(/\n {6}\/\* Per-prototype portable/),
    ];
    // Another prototype's init (with its leading comment) ends it too.
    for (const o of rest.matchAll(/(?:\n {6}\/\/[^\n]*)*\n {6}\(function initP(\d+)/g)) {
      if (o[1] !== n) { ends.push(o.index); break; }
    }
    return dedent(main, m.index, main.slice(m.index, m.index + 1 + Math.min(...ends.filter((i) => i >= 0))).trimEnd());
  }
  return "";
}

// "(function initP<N>...() { ... })();" blocks, anywhere in the page.
function inits(n) {
  const out = [];
  const re = new RegExp(`\\(function initP${n}(?!\\d)\\w*\\(\\) \\{`, "g");
  let m;
  while ((m = re.exec(all))) {
    const end = closeBrace(all, all.indexOf("{", m.index));
    out.push({ raw: all.slice(m.index, end), text: dedent(all, m.index, all.slice(m.index, end) + ")();") });
  }
  return out;
}

// The page's click delegation, split into its commented segments.
const clickAt = main.indexOf('document.addEventListener("click", function (e) {', main.indexOf("Prototype 8: token / back"));
const clickBody = main.slice(main.indexOf("{", clickAt) + 1, closeBrace(main, main.indexOf("{", clickAt)) - 1);
function segment(from, to) {
  const a = clickBody.indexOf(from);
  const b = to ? clickBody.indexOf(to) : clickBody.length;
  if (a < 0 || b < 0) throw new Error("click segment not found: " + from);
  return dedent(clickBody, a, clickBody.slice(a, b).trimEnd());
}
const p8At = clickBody.search(/\S/);
const SEG = {
  p8: dedent(clickBody, p8At, clickBody.slice(p8At, clickBody.indexOf("/* --- Animate buttons --- */")).trimEnd()),
  like: segment("/* --- Prototype 23", "/* --- Prototype 25"),
  checkbox: segment("/* --- Prototype 25", "/* --- Prototype 27"),
  toggle: segment("/* --- Prototype 27", "/* --- Copy buttons"),
};
const animate = segment("/* --- Animate buttons --- */", "/* --- Prototype 23");
function caseBlock(n) {
  const at = animate.indexOf(`case "${n}": {`);
  if (at < 0) return null;
  return dedent(animate, at, animate.slice(at, closeBrace(animate, animate.indexOf("{", at))));
}

function scriptFor(c) {
  const parts = [];
  const sec = section(c.n);
  if (sec) parts.push(sec);
  if (c.n === "6") {
    const at = main.indexOf("// ── Prototype 6 message cycle");
    parts.push(dedent(main, at, main.slice(at, main.indexOf("\n\n", at)).trim()));
  }
  const handlers = [];
  if (c.n === "8") handlers.push(SEG.p8);
  const cb = caseBlock(c.n);
  if (cb) {
    handlers.push(
      "var animateBtn = e.target.closest(\"button[data-proto]\");\n" +
      "if (animateBtn) {\n" +
      "  var proto = animateBtn.getAttribute(\"data-proto\");\n" +
      "  var card = findCard(animateBtn);\n" +
      "  if (!card) return;\n" +
      "  switch (proto) {\n" + indent(cb, 4) + "\n  }\n" +
      "  return;\n" +
      "}"
    );
  }
  if (c.n === "23") handlers.push(SEG.like);
  if (c.n === "25") handlers.push(SEG.checkbox);
  if (c.n === "27") handlers.push(SEG.toggle);
  if (handlers.length) parts.push('document.addEventListener("click", function (e) {\n' + indent(handlers.join("\n\n"), 2) + "\n});");
  // Inits that live inside the prototype's section are in already.
  for (const it of inits(c.n)) {
    const name = it.raw.match(/\(function (initP\w+)\(/)[1];
    if (!sec.includes("(function " + name + "(")) parts.push(it.text);
  }
  if (!parts.length) return "";
  const body = [fn(main, "findCard"), fn(main, "readMs"), ...parts].join("\n\n");
  const js = "// " + c.title + ": the library card's own script, from library.html.\n(function () {\n" + indent(body, 2) + "\n})();\n";
  new Function(js); // syntax check
  return js;
}

// Class and attribute names the script sets, so state rules come along.
function scriptTokens(js) {
  const out = new Set();
  for (const m of js.matchAll(/["']([a-z][\w-]*)["']/gi)) out.add(m[1]);
  return [...out];
}

// ── Images ───────────────────────────────────────────────────────────────────

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif" };
// Large rasters are scaled down first (macOS sips) so a card stays well
// under the 100 KB per-field limit; card images show at icon sizes.
function dataUri(path) {
  const clean = path.replace(/[?#].*$/, "");
  const ext = extname(clean).toLowerCase();
  let buf = readFileSync(join(root, clean));
  if (buf.length > 16000 && (ext === ".png" || ext === ".jpg" || ext === ".jpeg")) {
    const tmp = join(tmpdir(), "tdev-card-img" + ext);
    try {
      execFileSync("sips", ["-Z", "96", join(root, clean), "--out", tmp], { stdio: "ignore" });
      const small = readFileSync(tmp);
      if (small.length < buf.length) buf = small;
    } catch (e) { /* no sips: keep the original */ }
  }
  return "data:" + MIME[ext] + ";base64," + buf.toString("base64");
}
const inlineImages = (s) => s
  .replace(/(src=")(assets\/[^"]+)(")/g, (m, a, p, b) => a + dataUri(p) + b)
  .replace(/url\((['"]?)(assets\/[^'")]+)\1\)/g, (m, q, p) => "url(" + q + dataUri(p) + q + ")");

// ── CSS (from the page's style source) ─────────────────────────────────────
// Read as written, not through CSSOM: CSSOM cannot serialize a shorthand
// that uses var() (animation: x var(--d) ...) and drops its value.

function stripComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const at = i;
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      out += src.slice(at, i + 1);
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1;
      if (i <= 0) break;
    } else out += c;
  }
  return out;
}

// Rules as a tree: { type: "rule", selector, body } | { type: "group", prelude,
// children } (@media / @supports) | { type: "at", prelude, body } (@keyframes,
// @property, @font-face ...).
function parseCss(src) {
  let i = 0;
  function skipString(q) { for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++; }
  function blockEnd() { // i is just past "{"; returns the body, i past "}"
    const from = i;
    let depth = 1;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'") skipString(c);
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) { i++; return src.slice(from, i - 1); }
    }
    return src.slice(from);
  }
  function block() {
    const items = [];
    while (i < src.length) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;
      if (src[i] === "}") { i++; break; }
      const from = i;
      let paren = 0;
      while (i < src.length && !(paren === 0 && (src[i] === "{" || src[i] === ";" || src[i] === "}"))) {
        const c = src[i];
        if (c === '"' || c === "'") skipString(c);
        else if (c === "(") paren++;
        else if (c === ")") paren--;
        i++;
      }
      const prelude = src.slice(from, i).trim();
      if (src[i] !== "{") { if (src[i] === ";") i++; continue; } // @import / @charset
      i++;
      if (/^@(media|supports|container|layer)\b/.test(prelude)) items.push({ type: "group", prelude, children: block() });
      else if (prelude.startsWith("@")) items.push({ type: "at", prelude, body: blockEnd() });
      else items.push({ type: "rule", selector: prelude, body: blockEnd() });
    }
    return items;
  }
  return block();
}

function declarations(body) {
  const out = [];
  let depth = 0, cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"' || c === "'") {
      const at = i;
      for (i++; i < body.length && body[i] !== c; i++) if (body[i] === "\\") i++;
      cur += body.slice(at, i + 1);
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === ";" && !depth) { if (cur.trim()) out.push(cur.trim()); cur = ""; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map((d) => {
    const at = d.indexOf(":");
    return [d.slice(0, at).trim(), d.slice(at + 1).trim()];
  });
}

const sheet = parseCss(stripComments([...page.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n")));

function splitSelectors(sel) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of sel) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (ch === "," && !depth) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// The last compound selector (the subject), outside any brackets.
function subject(sel) {
  let depth = 0, cut = 0;
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (!depth && (ch === " " || ch === ">" || ch === "+" || ch === "~")) cut = i + 1;
  }
  return sel.slice(cut);
}

const CHROME = new Set(["card", "card-meta", "card-title", "card-subtitle", "card-copy", "cards"]);
const ROOT = /^(:root|html)(\[data-theme=["']?(dark|light)["']?\])?$/;
const PASS_ATTRS = /^(aria-[\w-]+|role|type|disabled|hidden|tabindex|open|checked)$/;

// Every rule that can apply to the card, plus the keyframes, @property rules
// and tokens they use (transitively).
function collectCss(card, jsTokens) {
  const markup = card.open + card.stage;
  const own = new Set(), ids = new Set();
  for (const m of markup.matchAll(/\sclass="([^"]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach((c) => own.add(c));
  for (const m of markup.matchAll(/<[a-zA-Z][\w-]*((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*\/?>/g)) {
    for (const a of m[1].matchAll(/\s([\w:-]+)(?:=|\s|$)/g)) own.add(a[1]);
  }
  for (const m of markup.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  own.delete("class");
  ["card-meta", "card-title", "card-subtitle", "card-copy"].forEach((c) => own.delete(c));
  // Elements the card's script builds (reels, dots, banners) carry its own
  // class prefix; their rules belong to the card too.
  jsTokens.forEach((t) => { if (t.startsWith("p" + card.n + "-")) own.add(t); });
  const allowed = new Set([...own, ...jsTokens]);

  function keep(sel) {
    const bare = sel.replace(/::?[\w-]+(\([^)]*\))?/g, "");
    const classes = [...sel.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    const attrs = [...sel.matchAll(/\[\s*([\w-]+)/g)].map((m) => m[1]);
    const idList = [...sel.matchAll(/#([\w-]+)/g)].map((m) => m[1]);
    if (idList.some((x) => !ids.has(x))) return false;
    if (classes.some((c) => !allowed.has(c))) return false;
    for (const a of attrs) {
      if (a === "data-theme") { if (!/^(html|:root)\b/.test(sel)) return false; continue; }
      if (PASS_ATTRS.test(a)) continue;
      if (!allowed.has(a)) return false;
    }
    const specific = classes.some((c) => own.has(c) && !CHROME.has(c)) ||
      attrs.some((a) => own.has(a) && a !== "data-theme" && !PASS_ATTRS.test(a)) || idList.length;
    if (!specific) return false;
    if ([...subject(bare.trim()).matchAll(/\.([\w-]+)/g)].some((m) => CHROME.has(m[1]))) return false;
    return true;
  }

  const rules = [];      // { wrap: [preludes], text }
  const tokens = [];     // { wrap, selector, decls }
  const keyframes = {};
  const properties = {};
  (function walk(items, wrap) {
    for (const it of items) {
      if (it.type === "group") walk(it.children, wrap.concat(it.prelude));
      else if (it.type === "at") {
        const kf = it.prelude.match(/^@(?:-webkit-)?keyframes\s+([\w-]+)/);
        if (kf) keyframes[kf[1]] = it.prelude + " {" + it.body + "}";
        const pr = it.prelude.match(/^@property\s+(--[\w-]+)/);
        if (pr) properties[pr[1]] = it.prelude + " {" + it.body + "}";
      } else {
        const sels = splitSelectors(it.selector);
        if (sels.every((x) => ROOT.test(x))) {
          const decls = declarations(it.body).filter(([n]) => n.startsWith("--"));
          if (decls.length) tokens.push({ wrap, selector: it.selector, decls });
          continue;
        }
        const kept = sels.filter(keep);
        if (!kept.length) continue;
        const body = declarations(it.body).map(([n, v]) => "  " + n + ": " + v + ";").join("\n");
        rules.push({ wrap, text: kept.join(",\n") + " {\n" + body + "\n}" });
      }
    }
  })(sheet, []);

  const text = rules.map((r) => r.text).join("\n");
  const usedFrames = new Set();
  for (const m of text.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
    for (const w of m[1].split(/[\s,]+/)) if (keyframes[w]) usedFrames.add(w);
  }
  const frames = [...usedFrames].map((n) => keyframes[n]);
  const vars = new Set(["--font-sans", "--text"]);
  const scan = (str) => { for (const m of str.matchAll(/var\(\s*(--[\w-]+)/g)) vars.add(m[1]); };
  scan(text); frames.forEach(scan);
  for (let grew = true; grew;) {
    grew = false;
    for (const t of tokens) for (const [name, value] of t.decls) {
      if (!vars.has(name)) continue;
      const before = vars.size;
      scan(value);
      if (vars.size > before) grew = true;
    }
  }
  const nest = (css, wrap) => wrap.slice().reverse().reduce((acc, w) => w + " {\n" + acc + "\n}", css);
  // --stage-* comes from the preview stage (same colors as the site's card
  // stage), so the card never overrides it.
  const tokenCss = tokens.map((t) => {
    const decls = t.decls.filter(([n]) => vars.has(n) && !n.startsWith("--stage-"));
    if (!decls.length) return "";
    return nest(t.selector + " {\n" + decls.map(([n, v]) => "  " + n + ": " + v + ";").join("\n") + "\n}", t.wrap);
  }).filter(Boolean);
  const props = Object.keys(properties).filter((n) => vars.has(n)).map((n) => properties[n]);

  // Kept rules in source order; consecutive ones sharing a wrapper grouped.
  const blocks = [];
  for (const r of rules) {
    const w = r.wrap.join(" | ");
    const last = blocks[blocks.length - 1];
    if (last && last.w === w) last.items.push(r.text); else blocks.push({ w, wrap: r.wrap, items: [r.text] });
  }
  const ruleCss = blocks.map((b) => nest(b.items.join("\n"), b.wrap));
  return { tokens: tokenCss, props, rules: ruleCss, frames };
}

// No html or body rules and no font import: the preview stage sets the page
// (background, Inter, smoothing), as it does for every component.
const BASE = `/* The library card, at its size: the stage of the card on library.html. */
:where(.card), :where(.card) *, :where(.card) *::before, :where(.card) *::after { box-sizing: border-box; margin: 0; padding: 0; }
.card { position: relative; width: 296px; height: 260px; color: var(--text); font-family: var(--font-sans); }
.card > .card-stage { inset: 0; width: auto; height: auto; max-width: none; border-radius: 0; }
.card > .card-stage::after { content: none; }`;


// ── Build ────────────────────────────────────────────────────────────────────

const out = [];
for (const c of cards) {
  const js = scriptFor(c);
  const css = collectCss(c, scriptTokens(js));
  const html =
    `<div class="card" data-proto-card data-cat="${c.cat}">\n` +
    c.stage.split("\n").map((l) => l.replace(/^ {6}/, "")).join("\n") + "\n</div>\n";
  out.push({
    key: c.key,
    slug: slug(c.title),
    title: c.title,
    desc: c.desc,
    cat: c.cat,
    html: inlineImages(html),
    css: inlineImages([...css.tokens, BASE, ...css.props, ...css.rules, ...css.frames].join("\n\n") + "\n"),
    js,
  });
}

writeFileSync(join(root, "assets/community/library.json"), JSON.stringify(out, null, 0) + "\n");
console.log("wrote", out.length, "transitions to assets/community/library.json");
for (const t of out) console.log("  " + t.key.padEnd(4) + t.slug.padEnd(30) + " html " + t.html.length + "  css " + t.css.length + "  js " + t.js.length);
