// The demos' settings panel: the generate() options worth tweaking by eye. Remembered per browser (when storage is
// available) and handed to onChange, which replays the demo.
const FIELDS = [
  { key: "duration", label: "Build duration", type: "range", min: 1500, max: 6000, step: 100, unit: "ms", value: 3000 },
  { key: "fade", label: "Fade in", type: "range", min: 50, max: 1000, step: 10, unit: "ms", value: 200 },
  { key: "fadeBy", label: "Fade by", type: "segment", options: [["character", "Character"], ["word", "Word"]], value: "character" },
  { key: "focus", label: "Focus bracket", type: "switch", value: true },
  { key: "readout", label: "Coordinates", type: "switch", value: true },
  { key: "guides", label: "Type guides", type: "switch", value: true },
  { key: "particles", label: "Flying dots", type: "switch", value: true },
];
const STORE = "tig-demo-settings";

const CSS = `
.tig-panel { position: fixed; top: 64px; right: 16px; z-index: 2147483647; width: 248px; padding: 14px 14px 12px; border-radius: 14px;
  background: var(--panel-bg, #fff); color: var(--fg, #0f0f0f); box-shadow: 0 0 0 1px rgba(0,0,0,.07), 0 8px 32px -4px rgba(0,0,0,.08), 0 1px 3px rgba(0,0,0,.07);
  font: 500 13px/18px Inter, system-ui, sans-serif; }
html[data-theme="dark"] .tig-panel { --panel-bg: #181818; box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 32px -4px rgba(0,0,0,.5); }
.tig-panel-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.tig-panel-head b { font-weight: 600; }
.tig-panel-head button { border: 0; background: none; padding: 0; color: var(--muted, #6c6c6c); font: inherit; cursor: pointer; }
.tig-row { padding: 9px 0; border-top: 1px solid var(--soft, rgba(0,0,0,.06)); }
.tig-row-top { display: flex; justify-content: space-between; color: var(--muted, #6c6c6c); }
.tig-row-top output { color: var(--fg, #0f0f0f); font-variant-numeric: tabular-nums; }
.tig-row input[type="range"] { width: 100%; margin: 8px 0 0; accent-color: var(--fg, #0f0f0f); }
.tig-seg { display: grid; grid-auto-flow: column; gap: 2px; margin-top: 8px; padding: 2px; border-radius: 9px; background: var(--soft, rgba(0,0,0,.06)); }
.tig-seg button { height: 28px; border: 0; border-radius: 7px; background: none; color: var(--muted, #6c6c6c); font: inherit; cursor: pointer;
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
@media (max-width: 900px) { .tig-panel { position: static; width: auto; margin: 0 16px 24px; } }
`;

export function settingsPanel(onChange) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { saved = {}; }
  const values = Object.fromEntries(FIELDS.map((f) => [f.key, f.key in saved ? saved[f.key] : f.value]));
  const style = document.createElement("style"); style.textContent = CSS; document.head.appendChild(style);
  const panel = document.createElement("aside"); panel.className = "tig-panel"; panel.setAttribute("aria-label", "Effect settings");
  const changed = () => { try { localStorage.setItem(STORE, JSON.stringify(values)); } catch (e) {} onChange(values); };

  const render = () => {
    panel.innerHTML = `<div class="tig-panel-head"><b>Settings</b><button type="button" data-reset>Reset</button></div>`;
    for (const f of FIELDS) {
      const row = document.createElement("div"); row.className = "tig-row";
      if (f.type === "range") {
        row.innerHTML = `<label class="tig-row-top"><span>${f.label}</span><output>${values[f.key]}${f.unit}</output></label>
          <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${values[f.key]}" aria-label="${f.label}" />`;
        const input = row.querySelector("input"), out = row.querySelector("output");
        input.addEventListener("input", () => { values[f.key] = +input.value; out.textContent = input.value + f.unit; });
        input.addEventListener("change", changed); // replay once the slider is let go
      } else if (f.type === "segment") {
        row.innerHTML = `<div class="tig-row-top"><span>${f.label}</span></div><div class="tig-seg" role="group" aria-label="${f.label}">${f.options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${values[f.key] === v}">${l}</button>`).join("")}</div>`;
        row.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
          values[f.key] = b.dataset.v; row.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); changed();
        }));
      } else {
        row.innerHTML = `<label class="tig-switch"><span>${f.label}</span><input type="checkbox" role="switch" ${values[f.key] ? "checked" : ""} /></label>`;
        const input = row.querySelector("input");
        input.addEventListener("change", () => { values[f.key] = input.checked; changed(); });
      }
      panel.appendChild(row);
    }
    panel.querySelector("[data-reset]").addEventListener("click", () => { FIELDS.forEach((f) => (values[f.key] = f.value)); render(); changed(); });
  };
  render();
  document.body.appendChild(panel);
  return { values };
}
