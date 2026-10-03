// Studio Motion tab: the motion in a component's CSS, as Refine controls.
//
// The CSS is scanned for two things:
//   - motion tokens: custom properties whose value is a duration, an easing,
//     or (by name) a distance, blur or scale, e.g. --badge-pop-dur: 260ms;
//   - transitions: transition / animation declarations with literal values,
//     e.g. transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1);
// Every editable value keeps its offsets in the CSS text, so an edit splices
// just that value and leaves the rest of the stylesheet byte for byte.
//
// Presets are the transitions.dev motion tokens (skills/transitions-dev/
// _root.css). The easing editor, springs and value fields port the Refine
// tool's inspector (refine/demo.html).
(function () {
  "use strict";

  // ── Presets ─────────────────────────────────────────────────────────────────
  var DURATIONS = [
    { label: "Stagger", value: 40 }, { label: "Micro", value: 80 }, { label: "Quick", value: 150 },
    { label: "Fast", value: 250 }, { label: "Medium", value: 350 }, { label: "Slow", value: 400 },
    { label: "Very slow", value: 500 },
  ];
  var DISTANCES = [
    { label: "Micro", value: 4 }, { label: "Small", value: 6 }, { label: "Base", value: 8 },
    { label: "Medium", value: 12 }, { label: "Large", value: 30 },
  ];
  var BLURS = [{ label: "Small", value: 2 }, { label: "Medium", value: 3 }, { label: "Large", value: 8 }];
  var SCALES = [
    { label: "Large", value: 0.96 }, { label: "Medium", value: 0.97 },
    { label: "Small", value: 0.98 }, { label: "Tiny", value: 0.99 },
  ];
  var KINDS = {
    duration: { label: "Duration", unit: "ms", min: 0, max: 2000, step: 10, presets: DURATIONS },
    delay: { label: "Delay", unit: "ms", min: 0, max: 2000, step: 10, presets: [{ label: "None", value: 0 }].concat(DURATIONS.slice(0, 4)) },
    distance: { label: "Distance", unit: "px", min: -64, max: 64, step: 1, presets: DISTANCES },
    blur: { label: "Blur", unit: "px", min: 0, max: 24, step: 0.5, presets: BLURS },
    scale: { label: "Scale", unit: "", min: 0.5, max: 1.5, step: 0.01, presets: SCALES },
  };

  var EASINGS = [
    { group: "Motion tokens" },
    { label: "Smooth ease out", value: "cubic-bezier(0.22, 1, 0.36, 1)", hint: "Open and close, page slide, resize" },
    { label: "Ease in out", value: "ease-in-out", hint: "Icon swap, text swap, reveals" },
    { label: "Ease out", value: "ease-out", hint: "Tooltip open and close" },
    { label: "Linear", value: "linear", hint: "Shimmer, pulse, spinner" },
    { label: "Bouncy overshoot", value: "cubic-bezier(0.34, 1.36, 0.64, 1)", hint: "Badge pop, a small overshoot" },
    { label: "Strong bouncy overshoot", value: "cubic-bezier(0.34, 3.85, 0.64, 1)", hint: "Bouncy return, spring-like" },
    { group: "Standard" },
    { label: "ease", value: "ease" }, { label: "ease-in", value: "ease-in" },
    { label: "ease-out", value: "ease-out" }, { label: "ease-in-out", value: "ease-in-out" },
  ];
  // Four of Refine's spring presets (react-spring naming: tension =
  // stiffness), from quick to playful.
  var SPRINGS = [
    { label: "Snappy", stiffness: 300, damping: 24, mass: 1 },
    { label: "Default", stiffness: 170, damping: 26, mass: 1 },
    { label: "Gentle", stiffness: 120, damping: 14, mass: 1 },
    { label: "Bouncy", stiffness: 200, damping: 10, mass: 1 },
  ];
  var KEYWORD_CUBIC = {
    linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1],
    "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1],
  };

  // Integrates a damped oscillator 0 -> 1 and samples it into CSS linear();
  // the duration emerges from the physics (Refine's simulateSpring).
  var springCache = {};
  function simulateSpring(k, c, m) {
    var key = k + "|" + c + "|" + m;
    if (springCache[key]) return springCache[key];
    var dt = 1 / 360, maxT = 6, rest = 0.0015;
    var x = 0, v = 0, last = 0, pos = [];
    for (var t = 0; t <= maxT + dt; t += dt) {
      pos.push(x);
      var a = (-k * (x - 1) - c * v) / m;
      v += a * dt; x += v * dt;
      if (Math.abs(x - 1) > rest || Math.abs(v) > rest) last = t;
    }
    var settle = Math.min(maxT, Math.max(0.08, last + dt * 2));
    var N = 60, values = [];
    for (var i = 0; i <= N; i++) {
      var fi = (i / N) * settle / dt, i0 = Math.floor(fi), i1 = Math.min(pos.length - 1, i0 + 1), f = fi - i0;
      values.push(pos[i0] * (1 - f) + pos[i1] * f);
    }
    values[0] = 0; values[N] = 1;
    var out = {
      ms: Math.round(settle * 1000),
      values: values,
      css: "linear(" + values.map(function (q) { return Math.round(q * 10000) / 10000; }).join(", ") + ")",
    };
    springCache[key] = out;
    return out;
  }
  SPRINGS.forEach(function (s) {
    var sim = simulateSpring(s.stiffness, s.damping, s.mass);
    EASINGS.push(s === SPRINGS[0] ? { group: "Springs" } : null);
    EASINGS.push({ label: "Spring " + s.label, value: sim.css, hint: "Settles in about " + sim.ms + "ms", spring: sim });
  });
  EASINGS = EASINGS.filter(Boolean);

  function norm(v) { return String(v || "").replace(/\s+/g, "").toLowerCase(); }
  var EASE_LABEL = {};
  EASINGS.forEach(function (e) { if (e.value && !EASE_LABEL[norm(e.value)]) EASE_LABEL[norm(e.value)] = e.label; });
  function easeLabel(v) { return EASE_LABEL[norm(v)] || (/^linear\(/i.test(v) ? "Custom spring" : /^steps/i.test(v) ? "Steps" : "Custom curve"); }
  function toCubic(v) {
    var k = KEYWORD_CUBIC[String(v).trim().toLowerCase()];
    if (k) return k.slice();
    var m = String(v).match(/cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/i);
    return m ? [+m[1], +m[2], +m[3], +m[4]] : null;
  }
  function linearValues(v) {
    var m = String(v).match(/^linear\((.*)\)$/i);
    if (!m) return null;
    var vals = m[1].split(",").map(function (p) { return parseFloat(p); }).filter(function (n) { return !isNaN(n); });
    return vals.length > 2 ? vals : null;
  }

  // ── CSS scan ────────────────────────────────────────────────────────────────
  var DUR_RE = /^(-?\d*\.?\d+)(ms|s)$/i;
  var EASE_RE = /^(cubic-bezier\([^)]*\)|linear\([^)]*\)|steps\([^)]*\)|ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i;
  var NUM_RE = /^-?\d*\.?\d+$/;
  var PX_RE = /^(-?\d*\.?\d+)px$/i;
  var MOTION_PROPS = {
    transition: "transition", "transition-duration": "duration", "transition-timing-function": "easing", "transition-delay": "delay",
    animation: "animation", "animation-duration": "duration", "animation-timing-function": "easing", "animation-delay": "delay",
  };

  // Declarations with their selector chain and value offsets. Comments are
  // blanked (same length) so offsets stay true to the original text.
  function declarations(css) {
    var src = css.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, " "); });
    var out = [], stack = [], seg = 0, paren = 0, quote = null;
    function flush(a, b) {
      if (!stack.length) return;
      var text = src.slice(a, b);
      var c = text.indexOf(":");
      if (c < 0) return;
      var prop = text.slice(0, c).trim();
      if (!/^-{0,2}[a-zA-Z_][\w-]*$/.test(prop)) return;
      var raw = text.slice(c + 1);
      var value = raw.trim();
      if (!value) return;
      var start = a + c + 1 + (raw.length - raw.replace(/^\s+/, "").length);
      out.push({ prop: prop, value: value, start: start, end: start + value.length, ctx: stack.slice() });
    }
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (quote) {
        if (ch === quote) {
          var bs = 0;
          for (var k = i - 1; k >= 0 && src[k] === "\\"; k--) bs++;
          if (bs % 2 === 0) quote = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === "(") { paren++; continue; }
      if (ch === ")") { paren = Math.max(0, paren - 1); continue; }
      if (paren) continue;
      if (ch === "{") { stack.push(src.slice(seg, i).trim()); seg = i + 1; }
      else if (ch === "}") { flush(seg, i); stack.pop(); seg = i + 1; }
      else if (ch === ";") { flush(seg, i); seg = i + 1; }
    }
    return out;
  }

  // Splits on top-level separators, keeping offsets relative to `base`.
  function split(text, base, sep) {
    var parts = [], depth = 0, from = 0;
    for (var i = 0; i <= text.length; i++) {
      var ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (i === text.length || (!depth && (sep === "," ? ch === "," : /\s/.test(ch)))) {
        var piece = text.slice(from, i);
        var lead = piece.length - piece.replace(/^\s+/, "").length;
        var t = piece.trim();
        if (t) parts.push({ text: t, start: base + from + lead, end: base + from + lead + t.length });
        from = i + 1;
      }
    }
    return parts;
  }

  function ms(v) {
    var m = String(v).match(DUR_RE);
    if (!m) return null;
    return m[2].toLowerCase() === "s" ? Math.round(parseFloat(m[1]) * 1000) : parseFloat(m[1]);
  }

  function tokenKind(prop, value) {
    if (DUR_RE.test(value)) return /delay/i.test(prop) ? "delay" : "duration";
    if (EASE_RE.test(value)) return "easing";
    if (PX_RE.test(value)) {
      if (/blur/i.test(prop)) return "blur";
      if (/(dist|offset|travel|shift|lift|slide|rise|drop|move|nudge|translate|(^|-)[xy]($|-))/i.test(prop)) return "distance";
      return null;
    }
    if (NUM_RE.test(value) && /scale/i.test(prop)) return "scale";
    return null;
  }

  function skipCtx(ctx) {
    return ctx.some(function (s) { return /^@(-webkit-)?keyframes/i.test(s) || /prefers-reduced-motion/i.test(s); });
  }

  function scan(css) {
    var tokens = [], groups = [], seen = {};
    declarations(css).forEach(function (d) {
      if (skipCtx(d.ctx)) return;
      var selector = d.ctx.filter(function (s) { return s.charAt(0) !== "@"; }).pop() || d.ctx[d.ctx.length - 1];
      if (d.prop.indexOf("--") === 0) {
        var kind = tokenKind(d.prop, d.value);
        if (!kind || seen[d.prop]) return;
        seen[d.prop] = true;
        tokens.push({ name: d.prop, selector: selector, field: { kind: kind, value: d.value, start: d.start, end: d.end } });
        return;
      }
      var mp = MOTION_PROPS[d.prop.toLowerCase()];
      if (!mp) return;
      var items = [];
      split(d.value, d.start, ",").forEach(function (part) {
        var fields = [], refs = [], names = [], times = 0;
        split(part.text, part.start, " ").forEach(function (w) {
          var t = w.text;
          if (/^var\(/i.test(t)) {
            var ref = t.replace(/^var\(\s*|\s*(,.*)?\)$/g, "");
            refs.push(ref);
            // A var() in the time slot still takes that slot (duration, then delay).
            if ((mp === "transition" || mp === "animation") && /dur|delay|time|speed/i.test(ref)) times++;
            return;
          }
          if (DUR_RE.test(t)) {
            var kind = mp === "delay" ? "delay" : mp === "duration" ? "duration" : times === 0 ? "duration" : "delay";
            times++;
            fields.push({ kind: kind, value: t, start: w.start, end: w.end });
            return;
          }
          if (EASE_RE.test(t)) { fields.push({ kind: "easing", value: t, start: w.start, end: w.end }); return; }
          names.push(t);
        });
        if (!fields.length) return;
        var label = mp === "animation" ? (names.filter(function (n) { return !/^(infinite|alternate|reverse|normal|both|forwards|backwards|none|running|paused|alternate-reverse|\d+)$/i.test(n); })[0] || "animation")
          : mp === "transition" ? (names[0] || "all") : d.prop;
        items.push({ label: label, fields: fields, refs: refs });
      });
      if (items.length) groups.push({ selector: selector, prop: d.prop, items: items });
    });
    return { tokens: tokens, groups: groups };
  }

  // ── Floating menu: the nav's 3-dot menu (.tl-menu.t-dropdown), fixed to the
  // viewport so the scrolling panel can't clip it. Same 250ms in, 150ms out.
  var TL_CHECK = '<span class="tl-menu-check" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M4 8.4268L6.46155 11.19223L12 4.97001" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  var openMenu = null;
  function closeMenu() {
    if (!openMenu) return;
    var m = openMenu;
    openMenu = null;
    m.el.classList.remove("is-open");
    m.el.classList.add("is-closing");
    if (m.anchor) m.anchor.setAttribute("aria-expanded", "false");
    setTimeout(function () { m.el.remove(); }, 150);
  }
  document.addEventListener("mousedown", function (e) {
    if (openMenu && !openMenu.el.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", closeMenu);

  // rows: [{ group }] | [{ label, value, dim, title, active }]
  function menu(anchor, rows, onPick) {
    if (openMenu && openMenu.anchor === anchor) { closeMenu(); return; }
    closeMenu();
    var el = document.createElement("div");
    el.className = "tl-menu t-dropdown tl-menu--float ctl-menu";
    el.setAttribute("role", "menu");
    rows.forEach(function (r) {
      if (r.group) {
        var g = document.createElement("p");
        g.className = "tl-menu-group";
        g.textContent = r.group;
        el.appendChild(g);
        return;
      }
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tl-menu-item";
      b.setAttribute("role", "menuitemradio");
      b.setAttribute("aria-checked", String(!!r.active));
      if (r.title) b.title = r.title;
      b.innerHTML = '<span class="tl-menu-item-label"></span><span class="tl-menu-trail">' +
        (r.dim ? '<span class="tl-menu-dim"></span>' : "") + TL_CHECK + "</span>";
      b.querySelector(".tl-menu-item-label").textContent = r.label;
      if (r.dim) b.querySelector(".tl-menu-dim").textContent = r.dim;
      b.addEventListener("click", function () { closeMenu(); onPick(r); });
      el.appendChild(b);
    });
    document.body.appendChild(el);
    var rect = anchor.getBoundingClientRect();
    var w = Math.max(rect.width, 240);
    el.style.width = w + "px";
    var h = el.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, rect.right - w));
    var below = window.innerHeight - rect.bottom;
    var down = below > h + 12 || below > rect.top;
    el.style.left = left + "px";
    el.style.top = Math.max(8, down ? rect.bottom + 6 : rect.top - h - 6) + "px";
    el.style.maxHeight = Math.max(160, (down ? below : rect.top) - 20) + "px";
    el.style.transformOrigin = down ? "top right" : "bottom right";
    anchor.setAttribute("aria-expanded", "true");
    openMenu = { el: el, anchor: anchor };
    void el.offsetWidth; // commit the closed frame, then enter
    el.classList.add("is-open");
    var active = el.querySelector('[aria-checked="true"]');
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  // ── Value field: Refine's slider + input (drag anywhere, click value to type)
  function fmt(kind, n) {
    var k = KINDS[kind];
    var d = k.step < 0.1 ? 2 : k.step < 1 ? 1 : 0;
    var s = (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toString();
    return s + k.unit;
  }
  function numeric(kind, value) {
    if (kind === "duration" || kind === "delay") return ms(value);
    var m = String(value).match(/-?\d*\.?\d+/);
    return m ? parseFloat(m[0]) : 0;
  }

  var CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M4.47 6.47a.75.75 0 0 1 1.06 0L8 8.94l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z"/></svg>';
  var CURVE_ICON = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 13.5C6 13.5 6.5 2.5 13.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="2.5" cy="13.5" r="1.4" fill="currentColor"/><circle cx="13.5" cy="2.5" r="1.4" fill="currentColor"/></svg>';

  function valueField(label, field, onChange) {
    var k = KINDS[field.kind];
    var value = numeric(field.kind, field.value);
    var wrap = document.createElement("div");
    wrap.className = "ctl-field-wrap";
    wrap.innerHTML =
      '<div class="ctl-field">' +
        '<div class="ctl-field-fill"><span class="ctl-field-thumb"></span></div>' +
        '<div class="ctl-field-track"></div>' +
        '<span class="ctl-field-label"></span>' +
        '<span class="ctl-field-value" tabindex="0" role="spinbutton"></span>' +
      "</div>" +
      '<button type="button" class="ctl-chev" aria-haspopup="menu" aria-expanded="false" aria-label="Presets">' + CHEVRON + "</button>";
    var box = wrap.querySelector(".ctl-field");
    var fill = wrap.querySelector(".ctl-field-fill");
    var valEl = wrap.querySelector(".ctl-field-value");
    wrap.querySelector(".ctl-field-label").textContent = label;
    valEl.setAttribute("aria-label", label);

    function paint() {
      var pct = Math.max(0, Math.min(1, (value - k.min) / (k.max - k.min)));
      fill.style.width = "calc(32px + (100% - 32px) * " + pct + ")";
      valEl.textContent = fmt(field.kind, value);
      valEl.setAttribute("aria-valuenow", String(value));
    }
    // The slider spans min..max; a typed value may go past max (up to 10s).
    function set(n, final) {
      value = Math.max(k.min, Math.min(10000, n));
      paint();
      onChange(fmt(field.kind, value), final);
    }
    paint();

    // Drag: 1/5 of a step while moving, the full step on release.
    var track = wrap.querySelector(".ctl-field-track");
    track.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      box.classList.add("is-dragging");
      var rect = box.getBoundingClientRect();
      var fine = k.step / 5;
      function at(x) {
        var p = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
        return Math.round((k.min + p * (k.max - k.min)) / fine) * fine;
      }
      set(at(e.clientX), false);
      function move(ev) { set(at(ev.clientX), false); }
      function up(ev) {
        track.removeEventListener("pointermove", move);
        track.removeEventListener("pointerup", up);
        track.removeEventListener("pointercancel", up);
        box.classList.remove("is-dragging");
        set(Math.round(at(ev.clientX) / k.step) * k.step, true);
      }
      track.addEventListener("pointermove", move);
      track.addEventListener("pointerup", up);
      track.addEventListener("pointercancel", up);
    });

    // Click the value to type one; Enter commits, Escape cancels.
    function edit() {
      box.classList.add("is-editing");
      var input = document.createElement("input");
      input.className = "ctl-field-input";
      input.value = String(Math.round(value * 100) / 100);
      input.inputMode = "decimal";
      box.appendChild(input);
      input.focus();
      input.select();
      var done = false;
      function end(commit) {
        if (done) return;
        done = true;
        var n = parseFloat(input.value);
        if (input.value.trim().toLowerCase().endsWith("s") && !input.value.trim().toLowerCase().endsWith("ms") && (field.kind === "duration" || field.kind === "delay")) n = n * 1000;
        input.remove();
        box.classList.remove("is-editing");
        if (commit && !isNaN(n)) set(Math.max(k.min, Math.min(10000, n)), true);
      }
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); end(true); }
        if (e.key === "Escape") { e.preventDefault(); end(false); }
      });
      input.addEventListener("blur", function () { end(true); });
    }
    valEl.addEventListener("click", edit);
    valEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); edit(); }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        set(value + (e.key === "ArrowUp" ? 1 : -1) * k.step * (e.shiftKey ? 10 : 1), true);
      }
    });

    var chev = wrap.querySelector(".ctl-chev");
    chev.addEventListener("click", function () {
      menu(chev, [{ group: "Motion tokens" }].concat(k.presets.map(function (p) {
        return { label: p.label, dim: fmt(field.kind, p.value), value: p.value, active: Math.abs(p.value - value) < 1e-6 };
      })), function (r) { set(r.value, true); });
    });
    return wrap;
  }

  // ── Easing field: select + curve editor ─────────────────────────────────────
  // 0..1 progress spans UNIT px; the box grows to fit overshoot (springs,
  // bouncy curves) instead of letting handles spill over the fields above.
  var CURVE = { W: 240, UNIT: 128, PX: 20, PY: 18 };

  function easingField(label, field, onChange, durationOf) {
    var value = field.value;
    var wrap = document.createElement("div");
    wrap.className = "ctl-ease";
    wrap.innerHTML =
      '<div class="ctl-field-wrap">' +
        '<button type="button" class="ctl-select" aria-haspopup="menu" aria-expanded="false">' +
          '<span class="ctl-field-label"></span><span class="ctl-select-value"></span>' + CHEVRON +
        "</button>" +
        '<button type="button" class="ctl-chev ctl-curve-btn" aria-expanded="false" aria-label="Edit curve" title="Edit curve">' + CURVE_ICON + "</button>" +
      "</div>" +
      '<div class="ctl-curve-panel" hidden></div>';
    var sel = wrap.querySelector(".ctl-select");
    var curveBtn = wrap.querySelector(".ctl-curve-btn");
    var panel = wrap.querySelector(".ctl-curve-panel");
    wrap.querySelector(".ctl-field-label").textContent = label;
    var editor = null;

    function paint() {
      wrap.querySelector(".ctl-select-value").textContent = easeLabel(value);
      sel.title = value;
    }
    function set(v, final) {
      value = v;
      paint();
      if (editor) editor.update(value);
      onChange(value, final);
    }
    paint();

    sel.addEventListener("click", function () {
      menu(sel, EASINGS.map(function (e) {
        return e.group ? e : { label: e.label, dim: e.spring ? e.spring.ms + "ms" : "", title: e.hint || "", value: e.value, active: norm(e.value) === norm(value) };
      }).concat([{ group: "Custom" }, { label: "Custom curve", title: "Drag the handles", value: "__curve", active: false }]), function (r) {
        if (r.value === "__curve") {
          if (!toCubic(value)) set("cubic-bezier(0.22, 1, 0.36, 1)", true);
          open(true);
          return;
        }
        set(r.value, true);
      });
    });

    function open(on) {
      panel.hidden = !on;
      curveBtn.setAttribute("aria-expanded", String(on));
      if (on && !editor) { editor = curveEditor(value, function (v, final) { set(v, final); }, durationOf); panel.appendChild(editor.el); }
      if (editor) editor.play(on);
    }
    curveBtn.addEventListener("click", function () { open(panel.hidden); });
    return wrap;
  }

  function curveEditor(initial, onChange, durationOf) {
    var el = document.createElement("div");
    el.className = "ctl-curve";
    var W = CURVE.W, PX = CURVE.PX, PY = CURVE.PY, UNIT = CURVE.UNIT, pw = W - PX * 2;
    var yMax = 1, H = UNIT + PY * 2, frozen = false;
    var fx = function (x) { return PX + x * pw; };
    var fy = function (y) { return PY + (yMax - y) * UNIT; };
    el.innerHTML =
      '<div class="ctl-curve-box"><svg viewBox="0 0 ' + W + " " + H + '" aria-label="Easing curve">' +
        '<line class="ctl-curve-base" data-base="0"/>' +
        '<line class="ctl-curve-base" data-base="1"/>' +
        '<path class="ctl-curve-path" d=""/>' +
        '<line class="ctl-curve-arm" data-arm="0"/><line class="ctl-curve-arm" data-arm="1"/>' +
        '<circle class="ctl-curve-dot" r="5.5" data-dot="0"/><circle class="ctl-curve-dot" r="5.5" data-dot="1"/>' +
        '<circle class="ctl-curve-hit" r="12" data-hit="0"/><circle class="ctl-curve-hit" r="12" data-hit="1"/>' +
      "</svg></div>" +
      '<div class="ctl-cubic"></div>' +
      '<p class="ctl-curve-note" hidden></p>' +
      '<div class="ctl-track"><div class="ctl-rail"></div><span class="ctl-dot"></span></div>';
    var svg = el.querySelector("svg");
    var path = el.querySelector(".ctl-curve-path");
    var cubicRow = el.querySelector(".ctl-cubic");
    var note = el.querySelector(".ctl-curve-note");
    var cubic = toCubic(initial) || [0.22, 1, 0.36, 1];
    var current = initial;
    var inputs = ["x1", "y1", "x2", "y2"].map(function (n, i) {
      var cell = document.createElement("label");
      cell.className = "ctl-cubic-cell";
      cell.innerHTML = '<span></span><input type="number" step="0.01">';
      cell.querySelector("span").textContent = n;
      var input = cell.querySelector("input");
      if (i % 2 === 0) { input.min = "0"; input.max = "1"; }
      input.addEventListener("change", function () {
        var n2 = parseFloat(input.value);
        if (isNaN(n2)) return;
        if (i % 2 === 0) n2 = Math.max(0, Math.min(1, n2));
        cubic[i] = Math.round(n2 * 100) / 100;
        emit(true);
      });
      cubicRow.appendChild(cell);
      return input;
    });

    function str() { return "cubic-bezier(" + cubic.join(", ") + ")"; }
    function emit(final) { current = str(); draw(); onChange(current, final); restart(); }

    // Fit the box to the curve's range; held still while a handle is dragged
    // so the mapping under the pointer does not shift mid-drag.
    function layout(lin) {
      if (frozen) return;
      var ys = lin ? lin : [cubic[1], cubic[3]];
      var lo = Math.min.apply(null, [0].concat(ys)), hi = Math.max.apply(null, [1].concat(ys));
      yMax = hi;
      H = Math.round((hi - lo) * UNIT + PY * 2);
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      [0, 1].forEach(function (v) {
        var b = el.querySelector('[data-base="' + v + '"]');
        b.setAttribute("x1", PX); b.setAttribute("x2", W - PX);
        b.setAttribute("y1", fy(v)); b.setAttribute("y2", fy(v));
      });
    }

    function draw() {
      var lin = linearValues(current);
      var isCubic = !!toCubic(current);
      if (isCubic) cubic = toCubic(current);
      layout(isCubic ? null : lin);
      el.classList.toggle("is-linear", !isCubic);
      note.hidden = isCubic;
      if (!isCubic) {
        note.textContent = lin ? "Spring curve. Drag a handle or edit a value to switch to a cubic-bezier." : "Steps easing. Drag a handle to switch to a cubic-bezier.";
        path.setAttribute("d", lin ? lin.map(function (v, i) {
          return (i ? "L " : "M ") + fx(i / (lin.length - 1)).toFixed(1) + " " + fy(v).toFixed(1);
        }).join(" ") : "");
      } else {
        var c = cubic;
        path.setAttribute("d", "M " + fx(0) + " " + fy(0) + " C " + fx(c[0]) + " " + fy(c[1]) + ", " + fx(c[2]) + " " + fy(c[3]) + ", " + fx(1) + " " + fy(1));
      }
      [0, 1].forEach(function (p) {
        var hx = fx(cubic[p * 2]), hy = fy(cubic[p * 2 + 1]);
        var ax = p === 0 ? fx(0) : fx(1), ay = p === 0 ? fy(0) : fy(1);
        var arm = el.querySelector('[data-arm="' + p + '"]');
        arm.setAttribute("x1", ax); arm.setAttribute("y1", ay); arm.setAttribute("x2", hx); arm.setAttribute("y2", hy);
        el.querySelector('[data-dot="' + p + '"]').setAttribute("cx", hx);
        el.querySelector('[data-dot="' + p + '"]').setAttribute("cy", hy);
        el.querySelector('[data-hit="' + p + '"]').setAttribute("cx", hx);
        el.querySelector('[data-hit="' + p + '"]').setAttribute("cy", hy);
      });
      inputs.forEach(function (input, i) { if (document.activeElement !== input) input.value = String(cubic[i]); });
    }

    // Drag a handle: x clamps to 0..1, y to -0.5..1.5, two decimals.
    el.querySelectorAll(".ctl-curve-hit").forEach(function (hit) {
      hit.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        var p = +hit.getAttribute("data-hit");
        hit.setPointerCapture(e.pointerId);
        el.classList.add("is-dragging");
        frozen = true;
        function move(ev) {
          var r = svg.getBoundingClientRect();
          var vx = (ev.clientX - r.left) * (W / r.width), vy = (ev.clientY - r.top) * (H / r.height);
          cubic[p * 2] = Math.round(Math.max(0, Math.min(1, (vx - PX) / pw)) * 100) / 100;
          cubic[p * 2 + 1] = Math.round(Math.max(-0.5, Math.min(1.5, yMax - (vy - PY) / UNIT)) * 100) / 100;
          current = str();
          draw();
          onChange(current, false);
        }
        function up() {
          hit.removeEventListener("pointermove", move);
          hit.removeEventListener("pointerup", up);
          hit.removeEventListener("pointercancel", up);
          el.classList.remove("is-dragging");
          frozen = false;
          emit(true);
        }
        hit.addEventListener("pointermove", move);
        hit.addEventListener("pointerup", up);
        hit.addEventListener("pointercancel", up);
      });
    });

    // Position preview: a dot crossing the track with the current easing.
    var dot = el.querySelector(".ctl-dot");
    var anim = null, timer = null, playing = false, right = false;
    function step() {
      if (!playing) return;
      var track = el.querySelector(".ctl-track");
      var travel = track.clientWidth - 42 - 20;
      var dur = Math.max(160, (durationOf && durationOf()) || 600);
      var from = right ? travel : 0, to = right ? 0 : travel;
      var easing = current;
      try { anim = dot.animate([{ transform: "translateX(" + from + "px)" }, { transform: "translateX(" + to + "px)" }], { duration: dur, easing: easing, fill: "forwards" }); }
      catch (e) { anim = dot.animate([{ transform: "translateX(" + from + "px)" }, { transform: "translateX(" + to + "px)" }], { duration: dur, easing: "linear", fill: "forwards" }); }
      anim.onfinish = function () { right = !right; timer = setTimeout(step, 480); };
    }
    function restart() { if (!playing) return; clearTimeout(timer); if (anim) anim.cancel(); right = false; step(); }

    draw();
    return {
      el: el,
      update: function (v) { current = v; draw(); restart(); },
      play: function (on) {
        if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) on = false;
        playing = on;
        clearTimeout(timer);
        if (anim) anim.cancel();
        if (on) { right = false; step(); }
      },
    };
  }

  // ── Mount ───────────────────────────────────────────────────────────────────
  // api: { getCss(), setCss(css, final), reset() }
  function mount(root, api) {
    var model = [];   // every editable field, for offset bookkeeping
    var lastCss = null;

    function apply(field, next, final) {
      var css = api.getCss();
      if (css.slice(field.start, field.end) !== field.value) { refresh(true); return; }
      var delta = next.length - (field.end - field.start);
      css = css.slice(0, field.start) + next + css.slice(field.end);
      model.forEach(function (f) {
        if (f !== field && f.start >= field.end) { f.start += delta; f.end += delta; }
      });
      field.end = field.start + next.length;
      field.value = next;
      lastCss = css;
      api.setCss(css, final);
    }

    function prettyName(name) { return name.replace(/^--/, ""); }

    function render(found) {
      root.innerHTML = "";
      model = [];
      if (!found.tokens.length && !found.groups.length) {
        root.innerHTML = '<p class="ctl-empty">No motion in the CSS yet. Durations, easings and transitions you write (or the agent writes) show up here as controls.</p>';
        return;
      }
      var head = document.createElement("div");
      head.className = "ctl-head";
      head.innerHTML = '<p class="ctl-head-text">Edit the motion. Presets are the transitions.dev motion tokens.</p>' +
        '<button type="button" class="st-ghost st-ghost--icon ctl-reset" aria-label="Reset motion" title="Reset to the loaded values">' +
        '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.33301 6.66667C1.33301 6.66667 2.66966 4.84548 3.75556 3.75883C4.84147 2.67218 6.34207 2 7.99967 2C11.3134 2 13.9997 4.68629 13.9997 8C13.9997 11.3137 11.3134 14 7.99967 14C5.26428 14 2.95642 12.1695 2.23419 9.66667M5.33301 6.66667H1.33301V2.66667" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
      head.querySelector(".ctl-reset").addEventListener("click", function () { api.reset(); });
      root.appendChild(head);

      // A duration paired with an easing drives that easing's dot preview.
      function durFor(list) {
        return function () {
          var d = list.filter(function (f) { return f.kind === "duration"; })[0];
          return d ? ms(d.value) : 600;
        };
      }

      if (found.tokens.length) {
        var sec = section("Motion tokens");
        var tokenDur = function () {
          var d = found.tokens.filter(function (t) { return t.field.kind === "duration"; })[0];
          return d ? ms(d.field.value) : 600;
        };
        found.tokens.forEach(function (t) {
          model.push(t.field);
          var label = prettyName(t.name);
          var row = t.field.kind === "easing"
            ? easingField(label, t.field, function (v, final) { apply(t.field, v, final); }, tokenDur)
            : valueField(label, t.field, function (v, final) { apply(t.field, v, final); });
          row.title = t.name + (t.selector && t.selector !== ":root" ? " in " + t.selector : "");
          sec.appendChild(row);
        });
      }

      if (found.groups.length) {
        var tsec = section("Transitions");
        found.groups.forEach(function (g) {
          var box = document.createElement("div");
          box.className = "ctl-group";
          var sel = document.createElement("p");
          sel.className = "ctl-selector";
          sel.textContent = g.selector + (g.prop.indexOf("animation") === 0 ? "  · animation" : "");
          box.appendChild(sel);
          g.items.forEach(function (item) {
            var it = document.createElement("div");
            it.className = "ctl-item";
            var name = document.createElement("p");
            name.className = "ctl-item-name";
            name.textContent = item.label + (item.refs.length ? "  · uses " + item.refs.join(", ") : "");
            it.appendChild(name);
            var dur = durFor(item.fields);
            item.fields.forEach(function (f) {
              model.push(f);
              it.appendChild(f.kind === "easing"
                ? easingField("Easing", f, function (v, final) { apply(f, v, final); }, dur)
                : valueField(KINDS[f.kind].label, f, function (v, final) { apply(f, v, final); }));
            });
            box.appendChild(it);
          });
          tsec.appendChild(box);
        });
      }

      function section(title) {
        var s = document.createElement("section");
        s.className = "ctl-sec";
        var h = document.createElement("h3");
        h.className = "ctl-title";
        h.textContent = title;
        s.appendChild(h);
        root.appendChild(s);
        return s;
      }
    }

    // Rebuilt only when the CSS changed outside the controls (the editor, the
    // agent, a load), so a field being dragged is never torn down mid-drag.
    function refresh(force) {
      var css = api.getCss() || "";
      if (!force && css === lastCss) return;
      lastCss = css;
      closeMenu();
      render(scan(css));
    }

    return { refresh: refresh };
  }

  window.StudioControls = { mount: mount, scan: scan, simulateSpring: simulateSpring };
})();
