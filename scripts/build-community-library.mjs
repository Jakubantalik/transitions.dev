#!/usr/bin/env node
// Builds assets/community/library.json: every free library transition as a
// React component the Studio can remix. Sources:
//   - the React snippet shown on each card (index.html, data-react-key)
//   - the canonical CSS from skills/transitions-dev/NN-*.md (":root" tokens + "## CSS")
//   - a small Demo wrapper below, so the remix renders something on first load
// Pro transitions are never included: their code is paid content served by the API.
//
// Run after changing a transition: node scripts/build-community-library.mjs

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const skillDir = join(root, "skills/transitions-dev");

// React snippets by template key (p1, p2 ...).
const react = {};
for (const m of html.matchAll(/<script type="text\/plain" data-react-key="(p\d+)">([\s\S]*?)<\/script>/g)) {
  react[m[1]] = m[2].trim() + "\n";
}

// Template names, to pair snippets with their skill files.
const names = {};
for (const m of html.matchAll(/^\s{8}(p\d+): \{\s*\n\s*name: "([^"]+)"/gm)) names[m[1]] = m[2];

const skillByTitle = {};
for (const f of readdirSync(skillDir).filter((f) => /^\d\d-.+\.md$/.test(f))) {
  const md = readFileSync(join(skillDir, f), "utf8");
  skillByTitle[md.split("\n")[0].replace(/^#\s*/, "").trim().toLowerCase()] = md;
}

function skillCss(md) {
  const blocks = [...md.matchAll(/```css\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  const rootBlock = blocks.find((b) => /^:root\s*\{/.test(b)) || "";
  const cssSection = md.split(/^## CSS\s*$/m)[1] || "";
  const main = (cssSection.match(/```css\n([\s\S]*?)```/) || [])[1] || "";
  return [rootBlock, main.trim()].filter(Boolean).join("\n\n") + "\n";
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// The card a template belongs to on the home page: its visible title is what
// detail.html slugs into ?t=, so remix credits link to the right page.
function cardTitle(key) {
  const at = html.indexOf(`data-copy-key="${key}"`);
  if (at < 0) return null;
  const start = html.lastIndexOf("<article", at);
  const m = html.slice(start, at).match(/<div class="card-title">([^<]+)<\/div>/);
  return m ? m[1].replace(/&amp;/g, "&").trim() : null;
}

// Scaffolding around each transition: neutral controls and surfaces in the
// stage colors, kept separate from the transition's own CSS.
const DEMO_CSS = `
/* Demo scaffolding (not part of the transition) */
.demo { display: flex; flex-direction: column; align-items: center; gap: 16px; }
.demo button:not([class]), .demo-btn {
  padding: 8px 14px;
  border: 0;
  border-radius: 999px;
  background: var(--stage-surface);
  color: var(--stage-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--stage-border);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.demo-surface {
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--stage-surface);
  color: var(--stage-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), inset 0 0 0 1px var(--stage-border);
}
.demo-muted { color: var(--stage-muted); font-size: 13px; }
/* Zero-specificity defaults: any rule in the transition's CSS wins. */
:where(.demo) :where(button) {
  padding: 7px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--stage-surface);
  color: var(--stage-fg);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--stage-border);
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
:where(.demo) :where(input[type="text"], input:not([type])) {
  width: 200px;
  padding: 9px 12px;
  border: 0;
  border-radius: 10px;
  background: var(--stage-surface);
  color: var(--stage-fg);
  box-shadow: inset 0 0 0 1px var(--stage-border);
  font: inherit;
  outline: none;
}
`;

const ICON = {
  bell: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 6.5a4 4 0 1 1 8 0c0 3.5 1.5 4.5 1.5 4.5h-11S4 10 4 6.5ZM6.5 13a1.6 1.6 0 0 0 3 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>`,
  menu: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M3 5.5h10M3 10.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>`,
  close: `<svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>`,
  check: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 12.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>`,
};

// Demo JSX per template key. `C` is replaced with the exported component name.
const DEMOS = {
  p1: { jsx: `<C>${ICON.bell}</C>`, css: `.demo > button { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 12px; }\n.t-badge-dot { min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: #ff3b30; color: #fff; font-size: 10px; font-weight: 600; line-height: 16px; text-align: center; }` },
  p2: { jsx: `<C />` },
  p3: { jsx: `<C><div className="demo-surface" style={{ width: 200 }}><strong>Panel</strong><div className="demo-muted">Slides in from below.</div></div></C>` },
  p4: { jsx: `<C />` },
  p5: { jsx: `<C iconA={${ICON.menu}} iconB={${ICON.close}} />` },
  p6: { jsx: `<C />` },
  p7: { jsx: `<C><strong>Modal title</strong><p className="demo-muted" style={{ margin: "6px 0 12px" }}>Opens and closes with the modal transition.</p></C>`, css: `.t-modal { position: fixed; left: 50%; top: 50%; translate: -50% -50%; width: 220px; padding: 16px; border-radius: 16px; background: var(--stage-surface); box-shadow: 0 12px 40px -12px rgba(0, 0, 0, 0.35), inset 0 0 0 1px var(--stage-border); }` },
  p8: { jsx: `<C />` },
  p9: { jsx: `<C value="128" />` },
  p10: { jsx: `<C>${ICON.check}</C>`, css: `.t-success-check { display: grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: #22c55e; color: #fff; }` },
  p11: { jsx: `<C items={["#ff8a65", "#7aa7ff", "#5ad1a0", "#f5c451"].map((c, i) => <span key={c} className="demo-avatar" style={{ background: c }}>{"ABCD"[i]}</span>)} />`, css: `.t-avatar-group { display: flex; }\n.t-avatar + .t-avatar { margin-left: -8px; }\n.demo-avatar { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; color: #fff; font-size: 13px; font-weight: 600; box-shadow: 0 0 0 2px var(--stage-bg); }` },
  p12: { jsx: `<C message="Please enter a valid email."><input type="text" defaultValue="name@" aria-label="Email" /></C>`, css: `.t-input input { width: 200px; padding: 9px 12px; border: 0; border-radius: 10px; background: var(--stage-surface); color: var(--stage-fg); box-shadow: inset 0 0 0 1px var(--stage-border); font: inherit; outline: none; }\n.t-input.is-error input { box-shadow: inset 0 0 0 1.5px #e23014; }\n.t-error-msg { margin: 6px 0 0; color: #e23014; font-size: 12px; }` },
  p13: { jsx: `<C defaultValue="Clear me with the x" placeholder="Type something" />` },
  p14: { jsx: `<C skeleton={<div className="demo-skel"><span /><span /><span /></div>}><div className="demo-surface" style={{ width: 200 }}><strong>Loaded content</strong><div className="demo-muted">Revealed after the skeleton.</div></div></C>`, css: `.demo-skel { display: grid; gap: 8px; width: 200px; padding: 14px 16px; box-sizing: border-box; }\n.demo-skel span { height: 10px; border-radius: 6px; background: var(--stage-border); }\n.demo-skel span:nth-child(2) { width: 70%; }\n.demo-skel span:nth-child(3) { width: 40%; }` },
  p15: { jsx: `<C>Thinking about motion…</C>` },
  p16: { jsx: `<C tabs={["Overview", "Activity", "Settings"]} />` },
  p17: { jsx: `<C id="demo" items={[{ label: "Copy", tooltip: "Copy link" }, { label: "Share", tooltip: "Share with team" }, { label: "Pin", tooltip: "Pin to top" }]} />` },
  p18: { jsx: `<C primary="Motion that feels right" secondary="Staggered, soft and quick." />` },
  p19: { jsx: `<C><div className="demo-tilt">Hover me</div></C>`, css: `.demo-tilt { display: grid; place-items: center; width: 180px; height: 120px; border-radius: 16px; background: linear-gradient(135deg, #7aa7ff, #b28dff); color: #fff; font-weight: 600; }` },
  p20: { jsx: `<C><button type="button" role="menuitem">New file</button><button type="button" role="menuitem">Upload</button><button type="button" role="menuitem">Import</button></C>` },
  p21: { jsx: `<div style={{ width: 240 }}><C title="What is a transition?">A change between two states, eased so the eye can follow it.</C></div>` },
  p22: { jsx: `<C><div className="demo-surface">Saved to your library</div></C>` },
  p23: { jsx: `<C />` },
  p24: { jsx: `<C />` },
  p25: { jsx: `<C label="Remember me" />` },
  p26: { jsx: `<C target={128} />` },
  p27: { jsx: `<C />`, css: `.t-toggle { display: block; width: 46px; height: 28px; padding: 3px; box-sizing: border-box; border-radius: 999px; background: var(--stage-border); box-shadow: none; }\n.t-toggle[data-on="true"] { background: #34c759; }\n.t-toggle-thumb { display: block; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25); }` },
  p28: { jsx: `<C />` },
  p29: { jsx: `<div style={{ width: 240 }}><C>Reading the component tree. Checking which states change. Comparing durations against the easing tokens. Drafting a smoother exit for the dropdown.</C></div>` },
  p30: { jsx: `<div style={{ width: 240 }}><C text="Motion should explain what changed, never make you wait for it." /></div>` },
  p33: { jsx: `<C />` },
  p34: {
    jsx: `<StackDemo />`,
    extra: `
function StackDemo() {
  const [banners, setBanners] = useState([]);
  const add = () => {
    const n = banners.length + 1;
    setBanners((b) => [...b, { id: String(n), node: <div className="demo-surface">Notification {n}</div> }]);
  };
  return (
    <>
      <C banners={banners} />
      <button type="button" onClick={add}>Add banner</button>
    </>
  );
}
`,
  },
};

function withDemo(key, src) {
  const name = (src.match(/export\s+(?:default\s+)?function\s+(\w+)/) || [])[1];
  if (!name) return null;
  const demo = DEMOS[key] || { jsx: `<${name} />` };
  let code = src;
  if (demo.extra && !/import\s*\{[^}]*\buseState\b/.test(code)) {
    code = code.replace(/import\s*\{([^}]*)\}\s*from\s*"react";/, (m, g) => `import {${g.trimEnd()}, useState } from "react";`);
    if (!/useState/.test(code.split("\n")[0])) code = `import { useState } from "react";\n` + code;
  }
  const jsx = demo.jsx.replace(/<C\b/g, "<" + name).replace(/<\/C>/g, "</" + name + ">");
  const extra = (demo.extra || "").replace(/<C\b/g, "<" + name).replace(/<\/C>/g, "</" + name + ">");
  return {
    jsx: code.trimEnd() + "\n\n// Demo: what the preview renders. Edit freely.\n" + extra.trim() + (extra.trim() ? "\n\n" : "") +
      "export default function Demo() {\n  return (\n    <div className=\"demo\">\n      " + jsx + "\n    </div>\n  );\n}\n",
    css: demo.css || "",
  };
}

const out = [];
for (const [key, title] of Object.entries(names)) {
  const src = react[key];
  const md = skillByTitle[title.toLowerCase()];
  if (!src || !md) { console.warn("skip", key, title, !src ? "(no React)" : "(no skill file)"); continue; }
  const d = withDemo(key, src);
  if (!d) { console.warn("skip", key, title, "(no export)"); continue; }
  const shown = cardTitle(key) || title;
  out.push({
    key,
    slug: slug(shown),
    title: shown,
    jsx: d.jsx,
    css: skillCss(md) + DEMO_CSS + (d.css ? d.css.trim() + "\n" : ""),
  });
}

writeFileSync(join(root, "assets/community/library.json"), JSON.stringify(out, null, 0) + "\n");
console.log("wrote", out.length, "transitions to assets/community/library.json");
