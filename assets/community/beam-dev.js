// Dev-only tuning panel for the community composer's border beam (the
// libraries.dev dev panel pattern). feed.js loads it on localhost or with
// ?dev in the URL; visitors never get it. The controls write the beam's CSS
// variables on #cm-beam live, per site theme, and stay after a reload. The
// code line is the rule to paste into community.css once a look is found.
(function () {
  "use strict";
  var beam = document.getElementById("cm-beam");
  if (!beam || document.getElementById("bdev")) return;

  var KEY = "tdev:beam-dev";
  // Sliders: [css variable, label, min, max, step, unit, hint]
  var GLOW = [
    ["--beam-strength", "Strength", 0, 2, 0.01, "", "opacity of every layer; 1 is the package default"],
    ["--beam-core-blur", "Core blur", 0, 30, 0.5, "px", "the glow hugging the edge"],
    ["--beam-bloom-blur", "Bloom blur", 0, 60, 0.5, "px", "the wide halo around it"],
  ];
  var TONE = [
    ["--beam-glow-saturate", "Saturation", 0, 2, 0.01, "", "1 shows the colors as picked"],
    ["--beam-glow-brightness", "Brightness", 0.5, 2.5, 0.01, "", "above 1 lifts toward pastel, clipping strong colors"],
    ["--beam-hue-base", "Hue shift", -180, 180, 1, "deg", "turns the whole palette around the color wheel"],
    ["--beam-drift", "Drift", 0, 180, 1, "", "degrees the hue wanders either way while it breathes"],
  ];
  var PULSE = [
    ["--beam-pulse", "Pulse", 0, 2, 0.01, "", "how deep the glow breathes: 0 holds it still, 1 is the package"],
    ["--beam-pulse-speed", "Pulse speed", 0.25, 3, 0.05, "", "1 is the package pace, 2 twice as fast"],
  ];
  var SLIDERS = GLOW.concat(TONE, PULSE);
  // Edge colors, clockwise from the top left: [slot, label]
  var COLORS = [
    [0, "Top left"], [6, "Top right"], [7, "Right top"], [8, "Right bottom"],
    [4, "Bottom right"], [1, "Bottom left"], [2, "Left bottom"], [3, "Left top"],
  ];

  function theme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; } }
  function save(all) { try { localStorage.setItem(KEY, JSON.stringify(all)); } catch (e) {} }
  var saved = load();

  function toHex(triplet) {
    return "#" + String(triplet).split(",").map(function (v) {
      var n = Math.max(0, Math.min(255, parseInt(v, 10) || 0));
      return (n < 16 ? "0" : "") + n.toString(16);
    }).join("");
  }
  function toTriplet(hex) {
    var h = hex.replace("#", "");
    return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }).join(", ");
  }
  function cvar(slot) { return "--beam-c" + slot; }

  // The stylesheet's values for the current theme (inline overrides cleared).
  function defaults() {
    SLIDERS.forEach(function (r) { beam.style.removeProperty(r[0]); });
    COLORS.forEach(function (c) { beam.style.removeProperty(cvar(c[0])); });
    var cs = getComputedStyle(beam);
    var d = {};
    SLIDERS.forEach(function (r) { d[r[0]] = parseFloat(cs.getPropertyValue(r[0])) || 0; });
    COLORS.forEach(function (c) { d[cvar(c[0])] = cs.getPropertyValue(cvar(c[0])).trim(); });
    return d;
  }
  var base = {};
  var values = {};
  function apply() {
    SLIDERS.forEach(function (r) { beam.style.setProperty(r[0], values[r[0]] + r[5]); });
    COLORS.forEach(function (c) { beam.style.setProperty(cvar(c[0]), values[cvar(c[0])]); });
    if (window.TdevBeam && window.TdevBeam.refresh) window.TdevBeam.refresh(beam);
  }
  function sync() {
    base = defaults();
    values = Object.assign({}, base, saved[theme()] || {});
    apply();
    paint();
  }

  var css =
    ".bdev{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:272px;max-height:calc(100vh - 32px);overflow-y:auto;" +
    "display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:14px;background:var(--card-bg,#fff);" +
    "box-shadow:var(--menu-shadow,0 4px 42px rgba(0,0,0,.16));color:var(--text);font:400 12px/16px var(--font-sans);scrollbar-width:thin}" +
    ".bdev[hidden],.bdev-fab[hidden]{display:none}" +
    ".bdev-head{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
    ".bdev-title{font-size:13px;font-weight:500}" +
    ".bdev-actions{display:flex;gap:4px}" +
    ".bdev-btn,.bdev-fab{height:26px;padding:0 10px;border:0;border-radius:60px;background:var(--chip-bg);color:var(--text);" +
    "font:500 12px/16px var(--font-sans);cursor:pointer}" +
    ".bdev-btn:hover,.bdev-fab:hover{background:var(--chip-bg-hover)}" +
    ".bdev-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;box-shadow:var(--menu-shadow)}" +
    ".bdev-section{margin:4px 0 -4px;font-size:11px;font-weight:500;letter-spacing:.02em;text-transform:uppercase;color:var(--text-faint)}" +
    ".bdev-hint{color:var(--text-faint);font-size:11px;line-height:15px}" +
    ".bdev-row{display:flex;flex-direction:column;gap:4px}" +
    ".bdev-row-head{display:flex;justify-content:space-between;color:var(--text-muted)}" +
    ".bdev-changed{color:var(--text)}" +
    ".bdev-val{font-variant-numeric:tabular-nums}" +
    ".bdev-row input{width:100%;margin:0;accent-color:var(--accent)}" +
    ".bdev-colors{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 6px}" +
    ".bdev-swatch{display:flex;flex-direction:column;gap:3px;color:var(--text-muted);font-size:10px;line-height:12px;text-align:center}" +
    ".bdev-swatch input{width:100%;height:26px;margin:0;padding:0;border:0;border-radius:7px;background:none;cursor:pointer}" +
    ".bdev-swatch input::-webkit-color-swatch-wrapper{padding:0}" +
    ".bdev-swatch input::-webkit-color-swatch{border:0;border-radius:7px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1)}" +
    ".bdev-swatch input::-moz-color-swatch{border:0;border-radius:7px}" +
    ".bdev-swatch.bdev-changed{color:var(--text)}" +
    ".bdev-code-row{display:flex;gap:6px;align-items:flex-start}" +
    ".bdev-code{flex:1 1 auto;min-width:0;display:block;max-height:120px;overflow-y:auto;padding:8px 10px;border-radius:8px;" +
    "background:rgba(127,127,127,.12);font:11px/16px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-all}";
  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  function sliderRow(r) {
    return '<label class="bdev-row"><span class="bdev-row-head"><span data-name="' + r[0] + '">' + r[1] + "</span>" +
      '<span class="bdev-val" data-val="' + r[0] + '"></span></span>' +
      '<input type="range" min="' + r[2] + '" max="' + r[3] + '" step="' + r[4] + '" data-var="' + r[0] + '" />' +
      '<span class="bdev-hint">' + r[6] + "</span></label>";
  }
  var panel = document.createElement("aside");
  panel.className = "bdev";
  panel.id = "bdev";
  panel.setAttribute("aria-label", "Border beam tuning (dev only)");
  panel.innerHTML =
    '<header class="bdev-head"><span class="bdev-title">Border beam · dev</span>' +
      '<span class="bdev-actions"><button type="button" class="bdev-btn" data-reset>Reset</button>' +
      '<button type="button" class="bdev-btn" data-close aria-label="Close">×</button></span></header>' +
    '<p class="bdev-hint" data-theme-note></p>' +
    '<p class="bdev-section">Glow</p>' + GLOW.map(sliderRow).join("") +
    '<p class="bdev-section">Color</p>' +
    '<div class="bdev-colors">' + COLORS.map(function (c) {
      return '<label class="bdev-swatch" data-swatch="' + cvar(c[0]) + '"><input type="color" data-color="' + cvar(c[0]) + '" aria-label="' + c[1] + ' color" />' + c[1] + "</label>";
    }).join("") + "</div>" +
    TONE.map(sliderRow).join("") +
    '<p class="bdev-section">Pulse</p>' + PULSE.map(sliderRow).join("") +
    '<div class="bdev-code-row"><code class="bdev-code" data-code></code><button type="button" class="bdev-btn" data-copy>Copy</button></div>';
  var fab = document.createElement("button");
  fab.type = "button";
  fab.className = "bdev-fab";
  fab.textContent = "Beam dev";
  fab.hidden = true;
  document.body.appendChild(panel);
  document.body.appendChild(fab);

  function fmt(r, v) { return (r[4] >= 1 ? v.toFixed(0) : r[4] >= 0.1 ? v.toFixed(1) : v.toFixed(2)).replace(/\.0+$/, ""); }
  function code() {
    var sel = theme() === "dark" ? 'html[data-theme="dark"] .cm-beam' : ".cm-beam";
    var parts = SLIDERS.map(function (r) { return r[0] + ": " + fmt(r, values[r[0]]) + r[5] + ";"; })
      .concat(COLORS.slice().sort(function (a, b) { return a[0] - b[0]; }).map(function (c) { return cvar(c[0]) + ": " + values[cvar(c[0])] + ";"; }));
    return sel + " {\n  " + parts.join("\n  ") + "\n}";
  }
  function paint() {
    panel.querySelector("[data-theme-note]").textContent = "Tuning the " + theme() + " theme. Values apply live and stay after a reload.";
    SLIDERS.forEach(function (r) {
      var v = values[r[0]];
      panel.querySelector('[data-var="' + r[0] + '"]').value = v;
      panel.querySelector('[data-val="' + r[0] + '"]').textContent = fmt(r, v) + (r[5] === "deg" || r[0] === "--beam-drift" ? "°" : r[0] === "--beam-pulse-speed" ? "×" : r[5]);
      panel.querySelector('[data-name="' + r[0] + '"]').classList.toggle("bdev-changed", v !== base[r[0]]);
    });
    COLORS.forEach(function (c) {
      var k = cvar(c[0]);
      panel.querySelector('[data-color="' + k + '"]').value = toHex(values[k]);
      panel.querySelector('[data-swatch="' + k + '"]').classList.toggle("bdev-changed", values[k].replace(/\s/g, "") !== String(base[k]).replace(/\s/g, ""));
    });
    panel.querySelector("[data-code]").textContent = code();
  }
  function remember(k) {
    var mine = saved[theme()] || (saved[theme()] = {});
    mine[k] = values[k];
    save(saved);
  }

  panel.addEventListener("input", function (e) {
    var k = e.target.getAttribute("data-var");
    var c = e.target.getAttribute("data-color");
    if (k) values[k] = parseFloat(e.target.value);
    else if (c) values[c] = toTriplet(e.target.value);
    else return;
    remember(k || c);
    apply();
    paint();
  });
  panel.querySelector("[data-reset]").addEventListener("click", function () {
    delete saved[theme()];
    save(saved);
    sync();
  });
  var copyTimer = null;
  panel.querySelector("[data-copy]").addEventListener("click", function () {
    var b = this;
    if (navigator.clipboard) navigator.clipboard.writeText(code()).catch(function () {});
    b.textContent = "Copied";
    clearTimeout(copyTimer);
    copyTimer = setTimeout(function () { b.textContent = "Copy"; }, 1400);
  });
  panel.querySelector("[data-close]").addEventListener("click", function () { panel.hidden = true; fab.hidden = false; });
  fab.addEventListener("click", function () { panel.hidden = false; fab.hidden = true; });

  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  sync();
})();
