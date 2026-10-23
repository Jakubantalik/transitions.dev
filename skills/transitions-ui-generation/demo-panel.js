// The demos' settings panel: the generate() options worth tweaking by eye. Each demo can pass its own defaults and
// storage key; changes are remembered per browser (when storage is available) and handed to onChange, which replays.
const FIELDS = [
  { key: "variant", label: "Variant", type: "segment", options: [["auto", "Auto"], ["text", "Text"], ["small-text", "Small text"], ["image", "Image"]], value: "text" },
  { key: "duration", label: "Build duration", type: "range", min: 1500, max: 6000, step: 100, unit: "ms", value: 3000 },
  { key: "fadeDelay", label: "Delay before fade", type: "range", min: 0, max: 1500, step: 10, unit: "ms", value: 140 },
  { key: "fade", label: "Fade in", type: "range", min: 50, max: 1000, step: 10, unit: "ms", value: 90 },
  // its first stop means "follow the tracing" (sent to generate() as null)
  { key: "fadeStagger", label: "Delay between characters", type: "range", min: -10, max: 300, step: 10, unit: "ms", value: 90, auto: "Follow trace" },
  // a preset fills the curve below; dragging the curve's handles makes it custom. generate() gets the curve.
  { key: "sequenceEase", label: "Sequence easing", type: "segment", options: [["linear", "Linear"], ["ease-in", "In"], ["ease-out", "Out"], ["ease-in-out", "In-out"], ["smooth-out", "Smooth out"]], value: "custom", curve: "sequenceCurve" },
  { key: "sequenceCurve", type: "curve", value: [0.37, -0.02, 0.73, 0.88] },
  { key: "fadeBy", label: "Fade by", type: "segment", options: [["character", "Character"], ["word", "Word"], ["gradient", "Gradient"]], value: "character" },
  { key: "focus", label: "Focus bracket", type: "switch", value: false },
  { key: "readout", label: "Coordinates", type: "switch", value: false },
  { key: "guides", label: "Type guides", type: "switch", value: false },
  { key: "particles", label: "Flying dots", type: "switch", value: true },
];

const PRESETS = { linear: [0, 0, 1, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1], "smooth-out": [0.22, 1, 0.36, 1] };
const NS = "http://www.w3.org/2000/svg";

const CSS = `
.tig-panel { position: fixed; top: 64px; right: 16px; z-index: 2147483647; width: 248px; max-height: calc(100vh - 80px); overflow-y: auto; overscroll-behavior: contain; padding: 14px 14px 12px; border-radius: 14px;
  background: var(--panel-bg, #fff); color: var(--fg, #0f0f0f); box-shadow: 0 0 0 1px rgba(0,0,0,.07), 0 8px 32px -4px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.07);
  font: 500 13px/18px Inter, system-ui, sans-serif; }
html[data-theme="dark"] .tig-panel { --panel-bg: #181818; box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 32px -4px rgba(0,0,0,.5); }
.tig-panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.tig-panel-head b { font-weight: 600; }
.tig-panel-head button { border: 0; background: none; padding: 0; color: var(--muted, #6c6c6c); font: inherit; cursor: pointer; }
.tig-row { padding: 9px 0; border-top: 1px solid var(--soft, rgba(0,0,0,.06)); }
.tig-row-top { display: flex; justify-content: space-between; gap: 8px; color: var(--muted, #6c6c6c); }
.tig-row-top output { color: var(--fg, #0f0f0f); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tig-row input[type="range"] { width: 100%; margin: 8px 0 0; accent-color: var(--fg, #0f0f0f); }
.tig-seg { display: grid; grid-template-columns: repeat(var(--cols, 3), 1fr); gap: 2px; margin-top: 8px; padding: 2px; border-radius: 9px; background: var(--soft, rgba(0,0,0,.06)); }
.tig-seg button { height: 28px; padding: 0 6px; border: 0; white-space: nowrap; border-radius: 7px; background: none; color: var(--muted, #6c6c6c); font: inherit; cursor: pointer;
  transition: background-color 150ms cubic-bezier(.22, 1, .36, 1), color 150ms cubic-bezier(.22, 1, .36, 1); }
.tig-seg button[aria-pressed="true"] { background: var(--panel-bg, #fff); color: var(--fg, #0f0f0f); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.tig-switch { display: flex; align-items: center; justify-content: space-between; color: var(--muted, #6c6c6c); cursor: pointer; }
.tig-switch input { appearance: none; -webkit-appearance: none; position: relative; width: 30px; height: 18px; margin: 0; border-radius: 99px; background: var(--soft, rgba(0,0,0,.12)); cursor: pointer;
  transition: background-color 150ms cubic-bezier(.22, 1, .36, 1); }
.tig-switch input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2);
  transition: transform 150ms cubic-bezier(.22, 1, .36, 1); }
.tig-switch input:checked { background: var(--fg, #0f0f0f); }
.tig-switch input:checked::after { transform: translateX(12px); }
.tig-switch input:focus-visible, .tig-seg button:focus-visible, .tig-panel-head button:focus-visible { outline: 2px solid var(--fg, #0f0f0f); outline-offset: 2px; }
.tig-row--curve { padding-top: 0; border-top: 0; }
.tig-curve { display: block; width: 100%; height: auto; margin-top: 4px; touch-action: none; }
.tig-curve .frame { fill: none; stroke: var(--soft, rgba(0,0,0,.1)); }
.tig-curve .diag { stroke: var(--soft, rgba(0,0,0,.1)); stroke-dasharray: 2 3; }
.tig-curve .arm { stroke: var(--muted, #6c6c6c); stroke-width: 1; }
.tig-curve .line { fill: none; stroke: var(--fg, #0f0f0f); stroke-width: 2; stroke-linecap: round; }
.tig-curve .knob { fill: var(--panel-bg, #fff); stroke: var(--fg, #0f0f0f); stroke-width: 1.5; cursor: grab; outline: none; }
.tig-curve .knob:focus-visible { stroke-width: 3; }
.tig-curve-code { margin-top: 6px; color: var(--muted, #6c6c6c); font: 500 10.5px/16px "Roboto Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; letter-spacing: -0.02em; }
@media (max-width: 900px) { .tig-panel { position: static; width: auto; max-height: none; margin: 0 16px 24px; } }
`;

// a cubic-bezier editor: drag either handle (or focus it and use the arrow keys); x stays within 0 to 1
function curveEditor(row, start, onMove, onDone) {
  const W = 220, H = 150, P = 12, Y0 = -0.25, Y1 = 1.25, pts = start.slice();
  const X = (x) => P + x * (W - 2 * P), Y = (y) => P + ((Y1 - y) / (Y1 - Y0)) * (H - 2 * P);
  const svg = document.createElementNS(NS, "svg"); svg.setAttribute("class", "tig-curve"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<rect class="frame" x="${X(0)}" y="${Y(1)}" width="${X(1) - X(0)}" height="${Y(0) - Y(1)}" rx="4"/><line class="diag" x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}"/>
    <line class="arm" data-a="0"/><line class="arm" data-a="1"/><path class="line"/>
    <circle class="knob" r="6" tabindex="0" role="slider" aria-label="First handle" data-k="0"/><circle class="knob" r="6" tabindex="0" role="slider" aria-label="Second handle" data-k="1"/>`;
  const code = document.createElement("div"); code.className = "tig-curve-code";
  row.append(svg, code);
  const r2 = (v) => Math.round(v * 100) / 100, fmt = (v) => String(r2(v)).replace(/^0\./, ".").replace(/^-0\./, "-.");
  const draw = () => {
    const [a, b, c, d] = pts;
    svg.querySelector(".line").setAttribute("d", `M${X(0)} ${Y(0)}C${X(a)} ${Y(b)} ${X(c)} ${Y(d)} ${X(1)} ${Y(1)}`);
    const [k0, k1] = svg.querySelectorAll(".knob"), [m0, m1] = svg.querySelectorAll(".arm");
    k0.setAttribute("cx", X(a)); k0.setAttribute("cy", Y(b)); k1.setAttribute("cx", X(c)); k1.setAttribute("cy", Y(d));
    m0.setAttribute("x1", X(0)); m0.setAttribute("y1", Y(0)); m0.setAttribute("x2", X(a)); m0.setAttribute("y2", Y(b));
    m1.setAttribute("x1", X(1)); m1.setAttribute("y1", Y(1)); m1.setAttribute("x2", X(c)); m1.setAttribute("y2", Y(d));
    k0.setAttribute("aria-valuetext", `${fmt(a)}, ${fmt(b)}`); k1.setAttribute("aria-valuetext", `${fmt(c)}, ${fmt(d)}`);
    code.textContent = `cubic-bezier(${pts.map(fmt).join(", ")})`;
  };
  const set = (k, x, y) => { pts[k * 2] = r2(Math.max(0, Math.min(1, x))); pts[k * 2 + 1] = r2(Math.max(Y0, Math.min(Y1, y))); draw(); onMove(pts.slice()); };
  svg.querySelectorAll(".knob").forEach((knob) => {
    const k = +knob.dataset.k;
    knob.addEventListener("pointerdown", (e) => {
      knob.setPointerCapture(e.pointerId); knob.style.cursor = "grabbing";
      const move = (ev) => { const r = svg.getBoundingClientRect(), sx = W / r.width, sy = H / r.height; set(k, ((ev.clientX - r.left) * sx - P) / (W - 2 * P), Y1 - (((ev.clientY - r.top) * sy - P) / (H - 2 * P)) * (Y1 - Y0)); };
      const up = () => { knob.removeEventListener("pointermove", move); knob.removeEventListener("pointerup", up); knob.style.cursor = ""; onDone(); };
      knob.addEventListener("pointermove", move); knob.addEventListener("pointerup", up);
    });
    knob.addEventListener("keydown", (e) => {
      const d = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, 0.01], ArrowDown: [0, -0.01] }[e.key]; if (!d) return;
      e.preventDefault(); const m = e.shiftKey ? 10 : 1; set(k, pts[k * 2] + d[0] * m, pts[k * 2 + 1] + d[1] * m);
    });
    knob.addEventListener("keyup", (e) => { if (/^Arrow/.test(e.key)) onDone(); });
  });
  draw();
  return () => { pts.splice(0, 4, ...row.__values()); draw(); };
}

// only: { key: [values] } limits a segment to some of its options (the text demo has no images)
export function settingsPanel(onChange, { defaults = {}, store = "tig-demo-settings", only = {} } = {}) {
  const base = (f) => (f.key in defaults ? defaults[f.key] : f.value), STORE = store;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { saved = {}; }
  const values = Object.fromEntries(FIELDS.map((f) => [f.key, f.key in saved ? saved[f.key] : base(f)]));
  // a preset easing without its own saved or default curve takes the preset's curve
  const sync = (from) => FIELDS.forEach((f) => { if (f.curve && !(f.curve in from) && PRESETS[values[f.key]]) values[f.curve] = PRESETS[values[f.key]].slice(); });
  sync(saved.sequenceCurve ? saved : { ...defaults, ...saved });
  const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  const panel = document.createElement("aside"); panel.className = "tig-panel"; panel.setAttribute("aria-label", "Effect settings");
  const changed = () => { try { localStorage.setItem(STORE, JSON.stringify(values)); } catch (e) {} onChange(values); };

  const curves = {}; // curve key → redraw()
  const opts = (f) => (only[f.key] ? f.options.filter(([v]) => only[f.key].includes(v)) : f.options);
  const render = () => {
    panel.innerHTML = `<div class="tig-panel-head"><b>Settings</b><button type="button" data-reset>Reset</button></div>`;
    for (const f of FIELDS) {
      const row = document.createElement("div"); row.className = "tig-row";
      if (f.type === "range") {
        const show = (v) => (f.auto && +v === f.min ? f.auto : v + f.unit);
        row.innerHTML = `<label class="tig-row-top"><span>${f.label}</span><output>${show(values[f.key])}</output></label>
          <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${values[f.key]}" aria-label="${f.label}" />`;
        const input = row.querySelector("input"), out = row.querySelector("output");
        input.addEventListener("input", () => { values[f.key] = +input.value; out.textContent = show(input.value); });
        input.addEventListener("change", changed); // replay once the slider is let go
      } else if (f.type === "segment") {
        row.innerHTML = `<div class="tig-row-top"><span>${f.label}</span></div><div class="tig-seg" role="group" aria-label="${f.label}" style="--cols: ${opts(f).length === 4 ? 4 : Math.min(3, opts(f).length)}">${opts(f).map(([v, l], i, all) => {
          // up to three a row; the last one stretches across what its row has left
          const span = all.length > 4 && i === all.length - 1 ? 3 - ((all.length - 1) % 3) : 1;
          return `<button type="button" data-v="${v}" aria-pressed="${values[f.key] === v}"${span > 1 ? ` style="grid-column: span ${span}"` : ""}>${l}</button>`;
        }).join("")}</div>`;
        row.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
          values[f.key] = b.dataset.v; row.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
          if (f.curve) { values[f.curve] = PRESETS[b.dataset.v].slice(); curves[f.curve] && curves[f.curve](); }
          changed();
        }));
        if (f.curve) row.dataset.seg = f.key;
      } else if (f.type === "curve") {
        row.classList.add("tig-row--curve");
        row.__values = () => values[f.key];
        curves[f.key] = curveEditor(row, values[f.key], (moved) => {
          values[f.key] = moved;
          const seg = FIELDS.find((x) => x.curve === f.key);
          if (seg) { values[seg.key] = "custom"; panel.querySelectorAll(`[data-seg="${seg.key}"] .tig-seg button`).forEach((x) => x.setAttribute("aria-pressed", "false")); }
        }, changed);
      } else {
        row.innerHTML = `<label class="tig-switch"><span>${f.label}</span><input type="checkbox" role="switch" ${values[f.key] ? "checked" : ""} /></label>`;
        const input = row.querySelector("input");
        input.addEventListener("change", () => { values[f.key] = input.checked; changed(); });
      }
      panel.appendChild(row);
    }
    panel.querySelector("[data-reset]").addEventListener("click", () => { FIELDS.forEach((f) => (values[f.key] = base(f))); sync(defaults); render(); changed(); });
  };
  render();
  document.body.appendChild(panel);
  // what generate() takes: an "auto" slider at its first stop sends null, and an eased segment sends its curve
  const options = () => Object.fromEntries(FIELDS.filter((f) => f.type !== "curve").map((f) => [f.key, f.curve ? values[f.curve] : f.auto && values[f.key] === f.min ? null : values[f.key]]));
  return { values, options };
}
