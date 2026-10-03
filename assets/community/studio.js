// studio.html: build, remix and publish a component.
//
//   studio.html                 new component (restores the last unsaved one)
//   studio.html?mode=react      new component in React mode
//   studio.html?id=<id>         open a component: edit when it is yours, view otherwise
//   studio.html?remix=<id>      new component from a community component
//   studio.html?lib=<slug>      new component from a library transition
//   studio.html?pick=library    new component, library picker open
//   studio.html?ai=1            new component, run the prompt handed over by community.html
(function () {
  "use strict";
  var C = window.Community;
  if (!C) return;

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var SCRATCH_KEY = "tdev:studio:scratch";

  var STARTER = {
    html: {
      html: '<button class="pill" type="button">Hover me</button>\n',
      css:
        ".pill {\n" +
        "  padding: 10px 18px;\n" +
        "  border: 0;\n" +
        "  border-radius: 999px;\n" +
        "  background: var(--stage-surface);\n" +
        "  color: var(--stage-fg);\n" +
        "  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--stage-border);\n" +
        "  font: inherit;\n" +
        "  font-weight: 500;\n" +
        "  cursor: pointer;\n" +
        "  transition:\n" +
        "    transform 300ms cubic-bezier(0.22, 1, 0.36, 1),\n" +
        "    box-shadow 300ms cubic-bezier(0.22, 1, 0.36, 1);\n" +
        "}\n" +
        ".pill:hover {\n" +
        "  transform: translateY(-2px);\n" +
        "  box-shadow: 0 10px 24px -10px rgba(0, 0, 0, 0.3), inset 0 0 0 1px var(--stage-border);\n" +
        "}\n" +
        ".pill:active { transform: scale(0.97); }\n\n" +
        "@media (prefers-reduced-motion: reduce) {\n" +
        "  .pill { transition: none; }\n" +
        "}\n",
      js: "// Runs once after the markup exists. Optional.\n",
    },
    react: {
      html: "",
      css:
        ".save {\n" +
        "  padding: 10px 18px;\n" +
        "  border: 0;\n" +
        "  border-radius: 999px;\n" +
        "  background: var(--stage-surface);\n" +
        "  color: var(--stage-fg);\n" +
        "  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--stage-border);\n" +
        "  font: inherit;\n" +
        "  font-weight: 500;\n" +
        "  cursor: pointer;\n" +
        "  transition: background-color 250ms ease, color 250ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1);\n" +
        "}\n" +
        ".save:active { transform: scale(0.97); }\n" +
        '.save[data-on="true"] { background: var(--stage-accent); color: var(--stage-on-accent); }\n\n' +
        "@media (prefers-reduced-motion: reduce) {\n" +
        "  .save { transition: none; }\n" +
        "}\n",
      js:
        'import { useState } from "react";\n\n' +
        "export default function SaveButton() {\n" +
        "  const [on, setOn] = useState(false);\n" +
        "  return (\n" +
        '    <button className="save" type="button" data-on={on} onClick={() => setOn((v) => !v)}>\n' +
        '      {on ? "Saved" : "Save"}\n' +
        "    </button>\n" +
        "  );\n" +
        "}\n",
    },
  };

  // ── State ───────────────────────────────────────────────────────────────────
  var S = {
    id: null,
    owner: true,          // editable + savable; false while viewing someone else's work
    published: false,
    mode: "html",
    files: { html: "", css: "", js: "" },
    stash: {},            // the other mode's files, so a mode flip is undoable
    title: "Untitled",
    description: "",
    remix: null,          // { kind: "library" | "community", id, title?, handle? }
    author: null,
    likes: 0,
    liked: false,
    dirty: false,
    file: "html",
  };

  function snapshot() {
    return { title: S.title, description: S.description, mode: S.mode, html: S.files.html, css: S.files.css, js: S.files.js };
  }
  function isStarter() {
    var st = STARTER[S.mode];
    return S.files.html === st.html && S.files.css === st.css && S.files.js === st.js;
  }

  // ── Editor (CodeMirror when it loads, a textarea until then or if it fails) ─
  var codeHost = $("st-code");
  var editor = textareaEditor();
  var changeTimer = null;

  function onEdit(file, text) {
    S.files[file] = text;
    markDirty();
    clearTimeout(changeTimer);
    // A stylesheet edit restyles the live preview in place; markup and
    // script edits remount it.
    if (file === "css" && C.pushCss(preview, text)) { refreshControlsSoon(); return; }
    changeTimer = setTimeout(render, 350);
  }

  function textareaEditor() {
    var ta = document.createElement("textarea");
    ta.className = "st-fallback";
    ta.spellcheck = false;
    ta.setAttribute("aria-label", "Code");
    codeHost.appendChild(ta);
    var current = "html";
    ta.addEventListener("input", function () { onEdit(current, ta.value); });
    ta.addEventListener("keydown", function (e) {
      if (e.key !== "Tab") return;
      e.preventDefault();
      var s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + "  " + ta.value.slice(en);
      ta.selectionStart = ta.selectionEnd = s + 2;
      onEdit(current, ta.value);
    });
    return {
      show: function (file) { current = file; ta.value = S.files[file] || ""; },
      reload: function () { ta.value = S.files[current] || ""; },
      refresh: function () {},
      setReadOnly: function (ro) { ta.readOnly = ro; },
      destroy: function () { ta.remove(); },
    };
  }

  function loadCodeMirror() {
    var V = "https://esm.sh/";
    return Promise.all([
      import(V + "codemirror@6.0.1"),
      import(V + "@codemirror/state@6"),
      import(V + "@codemirror/view@6"),
      import(V + "@codemirror/lang-html@6"),
      import(V + "@codemirror/lang-css@6"),
      import(V + "@codemirror/lang-javascript@6"),
      import(V + "@codemirror/language@6"),
      import(V + "@codemirror/theme-one-dark@6"),
      import(V + "@codemirror/commands@6"),
    ]).then(function (m) {
      var cm = m[0], st = m[1], vw = m[2], langHtml = m[3].html, langCss = m[4].css, langJs = m[5].javascript;
      var lang = m[6], oneDark = m[7], commands = m[8];
      var current = "html";
      var readOnly = false;
      var states = {};
      var themeComp = new st.Compartment();
      var roComp = new st.Compartment();
      var base = vw.EditorView.theme({
        "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)" },
        ".cm-content": { padding: "12px 0", caretColor: "var(--text)" },
        ".cm-line": { padding: "0 16px 0 6px" },
        ".cm-gutters": { backgroundColor: "transparent", border: "0", color: "var(--text-faint)" },
        ".cm-lineNumbers .cm-gutterElement": { padding: "0 6px 0 14px", minWidth: "26px" },
        "&.cm-focused .cm-cursor": { borderLeftColor: "var(--text)" },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft-hover) !important" },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
        ".cm-foldGutter": { display: "none" },
      });
      function themeExt() {
        return C.siteTheme() === "dark"
          ? [lang.syntaxHighlighting(oneDark.oneDarkHighlightStyle)]
          : [lang.syntaxHighlighting(lang.defaultHighlightStyle, { fallback: true })];
      }
      function langFor(file) {
        if (file === "html") return langHtml();
        if (file === "css") return langCss();
        return S.mode === "react" ? langJs({ jsx: true, typescript: true }) : langJs();
      }
      function makeState(file) {
        return st.EditorState.create({
          doc: S.files[file] || "",
          extensions: [
            cm.basicSetup,
            vw.keymap.of([commands.indentWithTab]),
            base,
            themeComp.of(themeExt()),
            roComp.of(st.EditorState.readOnly.of(readOnly)),
            st.EditorState.tabSize.of(2),
            vw.EditorView.lineWrapping,
            langFor(file),
            vw.EditorView.updateListener.of(function (u) {
              if (u.docChanged) onEdit(file, u.state.doc.toString());
            }),
          ],
        });
      }
      var view = new vw.EditorView({ state: makeState("html"), parent: codeHost });
      function rebuild() { states = {}; view.setState(states[current] = makeState(current)); }
      new MutationObserver(function () {
        view.dispatch({ effects: themeComp.reconfigure(themeExt()) });
        states = {}; states[current] = view.state;
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return {
        show: function (file) {
          if (current && view.state) states[current] = view.state;
          current = file;
          var s = states[file];
          if (!s || s.doc.toString() !== (S.files[file] || "")) s = makeState(file);
          states[file] = s;
          view.setState(s);
        },
        reload: function () { rebuild(); },
        refresh: function () { view.requestMeasure(); },
        setReadOnly: function (ro) {
          readOnly = ro;
          view.dispatch({ effects: roComp.reconfigure(st.EditorState.readOnly.of(ro)) });
          states = {}; states[current] = view.state;
        },
        destroy: function () { view.destroy(); },
      };
    });
  }

  // ── Tabs + mode ─────────────────────────────────────────────────────────────
  var tabsEl = $("st-tabs");
  var modeBtn = $("st-mode-btn");
  var modeMenu = $("st-mode-menu");

  // Sliding pill tabs (libraries.dev Studio): the indicator takes the
  // selected button's width and offset.
  function pillTabs(root, attr, onPick) {
    var ind = root.querySelector(".st-tabs-indicator");
    var btns = Array.prototype.slice.call(root.querySelectorAll(".st-tab"));
    function place() {
      var sel = btns.filter(function (b) { return b.getAttribute("aria-selected") === "true"; })[0];
      if (!sel || !ind) return;
      ind.style.width = sel.offsetWidth + "px";
      ind.style.transform = "translateX(" + sel.offsetLeft + "px)";
    }
    function pick(value, silent) {
      btns.forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute(attr) === value)); });
      place();
      if (!silent) onPick(value);
    }
    btns.forEach(function (b) { b.addEventListener("click", function () { pick(b.getAttribute(attr)); }); });
    window.addEventListener("resize", place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place();
    return pick;
  }

  // Every menu here is the nav's 3-dot menu component (Community.dropdown).
  var dropdown = C.dropdown;
  var hint = $("st-hint");
  var HINTS = {
    html: { html: "Body markup", css: "Use var(--stage-fg) and friends for theme colors", js: "Runs once after the markup" },
    react: { js: "export default a component. npm imports load from esm.sh", css: "Plain CSS, use className" },
  };

  function paintTabs() {
    var files = S.mode === "react" ? ["js", "css"] : ["html", "css", "js"];
    if (files.indexOf(S.file) < 0) S.file = files[0];
    var btns = tabsEl.querySelectorAll("button");
    btns.forEach(function (b) {
      var f = b.getAttribute("data-file");
      var i = files.indexOf(f);
      b.hidden = i < 0;
      b.style.order = String(i);
      b.textContent = f === "js" ? (S.mode === "react" ? "Component" : "JS") : f.toUpperCase();
      b.setAttribute("aria-selected", String(f === S.file));
    });
    $("st-mode-label").textContent = S.mode === "react" ? "React" : "HTML/CSS";
    modeMenu.querySelectorAll("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-checked", String(b.getAttribute("data-mode") === S.mode));
    });
    hint.textContent = (HINTS[S.mode] || {})[S.file] || "";
    editor.show(S.file);
  }

  tabsEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-file]");
    if (!b) return;
    S.file = b.getAttribute("data-file");
    paintTabs();
  });

  var setModeMenu = dropdown(modeBtn, modeMenu);
  modeMenu.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-mode]");
    if (!b || !S.owner) return;
    setModeMenu(false);
    var m = b.getAttribute("data-mode");
    if (m === S.mode) return;
    var starter = isStarter();
    // A real component is converted by the agent (same look and motion), not
    // swapped for the other format's starter. A version already made in
    // that format comes back as it was.
    if (!starter && !S.stash[m]) {
      var label = m === "react" ? "React" : "HTML/CSS";
      C.confirm({
        title: "Convert to " + label + "?",
        body: "The agent rewrites this component as " + (m === "react" ? "a React component (TSX)" : "HTML, CSS and JS") +
          ", keeping its look and motion. It uses one AI draft; switching back restores this version.",
        ok: "Convert",
      }).then(function (ok) { if (ok) convertTo(m); });
      return;
    }
    S.stash[S.mode] = { html: S.files.html, css: S.files.css, js: S.files.js };
    S.mode = m;
    S.files = S.stash[m] ? S.stash[m] : (starter ? clone(STARTER[m]) : { html: m === "react" ? "" : S.files.html, css: S.files.css, js: m === "react" ? STARTER.react.js : "" });
    S.file = m === "react" ? "js" : "html";
    markDirty();
    editor.reload && editor.reload();
    paintTabs();
    render();
    paintLibs();
    if (controls) controls.refresh();
  });

  function clone(o) { return { html: o.html, css: o.css, js: o.js }; }

  // ── Preview / Code ──────────────────────────────────────────────────────────
  var stageBar = $("st-stage-bar");
  var codePanel = $("st-code-panel");
  var showView = pillTabs($("st-view-tabs"), "data-show", function (v) {
    if (v !== "preview" && tool) setTool(null);
    stageBar.setAttribute("data-show", v);
    codePanel.hidden = v !== "code";
    if (v === "code" && editor.refresh) editor.refresh();
  });

  // ── Panel: Agent / Motion / Design system ──────────────────────────────────
  pillTabs($("st-panel-tabs"), "data-panel", function (v) {
    document.querySelectorAll("[data-panel-body]").forEach(function (el) {
      el.hidden = el.getAttribute("data-panel-body") !== v;
    });
    if (v === "controls" && controls) controls.refresh();
  });

  // ── Controls: the CSS motion as Refine fields (controls.js) ────────────────
  var loadedCss = "";
  var editorSync = null;
  var controlsSync = null;
  var controls = window.StudioControls ? StudioControls.mount($("st-controls"), {
    getCss: function () { return S.files.css; },
    setCss: function (css, final) {
      S.files.css = css;
      markDirty();
      if (!C.pushCss(preview, css)) { clearTimeout(changeTimer); changeTimer = setTimeout(render, 150); }
      // The editor catches up once the drag settles, not on every frame.
      clearTimeout(editorSync);
      editorSync = setTimeout(function () { if (S.file === "css" && editor.reload) editor.reload(); }, final ? 0 : 250);
    },
    reset: function () {
      S.files.css = loadedCss;
      markDirty();
      if (!C.pushCss(preview, loadedCss)) render();
      if (S.file === "css" && editor.reload) editor.reload();
      controls.refresh(true);
    },
  }) : null;
  function refreshControlsSoon() {
    clearTimeout(controlsSync);
    controlsSync = setTimeout(function () { if (controls) controls.refresh(); }, 400);
  }

  // ── Preview ─────────────────────────────────────────────────────────────────
  var preview = $("st-preview");
  var consoleEl = $("st-console");
  var logs = [];

  function showConsole(kind, text) {
    if (kind === "error") {
      consoleEl.setAttribute("data-kind", "error");
      consoleEl.textContent = text;
      consoleEl.hidden = false;
      return;
    }
    if (consoleEl.getAttribute("data-kind") === "error" && !consoleEl.hidden) return;
    logs.push(text);
    logs = logs.slice(-6);
    consoleEl.setAttribute("data-kind", "log");
    consoleEl.textContent = logs.join("\n");
    consoleEl.hidden = false;
  }

  function render() {
    logs = [];
    consoleEl.hidden = true;
    consoleEl.textContent = "";
    C.mountPreview(preview, { mode: S.mode, html: S.files.html, css: S.files.css, js: S.files.js, title: S.title }, {
      onMessage: function (m) {
        if (m.type === "error") showConsole("error", m.message + (m.line ? " (line " + m.line + ")" : ""));
        if (m.type === "console") showConsole(m.level === "error" ? "error" : "log", m.text);
        // A fresh preview frame starts outside select mode.
        if (m.type === "ready" && tool === "select") C.tellPreview(preview, { type: "select", on: true });
        if (m.type === "selected") onSelected(m);
        if (m.type === "snapshot" && snapWait) snapWait(m);
      },
    });
  }
  $("st-replay").addEventListener("click", render);

  // ── Tools on the preview: Select an element, Draw on it (as in Lovable) ─────
  // Select runs inside the sandboxed frame (its bridge outlines what the
  // pointer is on and reports the clicked element); the pick becomes a chip
  // in the agent input and travels with the next request. Draw puts a canvas
  // over the preview; Attach asks the frame for a snapshot, paints the
  // strokes on it and attaches the image to the next request.
  var tool = null;    // "select" | "draw" | null
  var target = null;  // the picked element: { selector, tag, text, html }
  var hint = $("st-tool-hint");
  function setTool(next) {
    if (next === tool) next = null;
    if (tool === "select") C.tellPreview(preview, { type: "select", on: false });
    if (tool === "draw") drawOff();
    tool = next;
    $("st-select").setAttribute("aria-pressed", String(tool === "select"));
    $("st-draw").setAttribute("aria-pressed", String(tool === "draw"));
    preview.classList.toggle("is-tool", !!tool);
    hint.hidden = tool !== "select";
    if (tool === "select") {
      hint.textContent = "Click an element to select it. Esc to stop.";
      C.tellPreview(preview, { type: "select", on: true });
    }
    if (tool === "draw") drawOn();
  }
  function useTool(name) {
    if (stageBar.getAttribute("data-show") !== "preview") showView("preview");
    setTool(name);
  }
  $("st-select").addEventListener("click", function () { useTool("select"); });
  $("st-draw").addEventListener("click", function () { useTool("draw"); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && tool && !document.querySelector(".cm-ask, .cm-lib[data-open='true']")) setTool(null);
  });

  var X_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  function targetLabel(t) { return t.selector.split(" > ").pop(); }
  function paintTarget() {
    var el = $("st-target");
    el.hidden = !target;
    if (!target) { el.innerHTML = ""; return; }
    el.innerHTML = '<span class="st-target-key">Selected</span><code>' + C.esc(targetLabel(target)) + "</code>" +
      (target.text ? '<span class="st-target-text">' + C.esc(target.text) + "</span>" : "") +
      '<button type="button" class="st-target-x" aria-label="Clear the selected element">' + X_SVG + "</button>";
    el.querySelector("button").addEventListener("click", clearTarget);
  }
  function clearTarget() {
    target = null;
    C.tellPreview(preview, { type: "select", on: false, clear: true });
    paintTarget();
  }
  function onSelected(m) {
    target = {
      selector: String(m.selector || "").slice(0, 300),
      tag: String(m.tag || ""),
      text: String(m.text || "").slice(0, 80),
      html: String(m.html || "").slice(0, 1500),
    };
    tool = "select"; // the frame already left select mode; just reset the button
    setTool(null);
    paintTarget();
    aiInput.focus();
  }

  var drawLayer = $("st-draw-layer");
  var drawCanvas = $("st-draw-canvas");
  var strokes = [];
  var stroke = null;
  var drawColor = "#ff3b30";
  var snapWait = null;
  function paintStrokes(g, scale, list) {
    list.forEach(function (st) {
      g.strokeStyle = st.color;
      g.lineWidth = 4 * scale;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      st.points.forEach(function (p, i) { if (i) g.lineTo(p[0] * scale, p[1] * scale); else g.moveTo(p[0] * scale, p[1] * scale); });
      if (st.points.length === 1) g.lineTo(st.points[0][0] * scale + 0.1, st.points[0][1] * scale);
      g.stroke();
    });
  }
  function redraw() {
    var dpr = window.devicePixelRatio || 1;
    var g = drawCanvas.getContext("2d");
    g.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    paintStrokes(g, dpr, strokes);
  }
  function sizeCanvas() {
    var r = preview.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    drawCanvas.width = Math.round(r.width * dpr);
    drawCanvas.height = Math.round(r.height * dpr);
    drawCanvas.style.width = r.width + "px";
    drawCanvas.style.height = r.height + "px";
    redraw();
  }
  function drawOn() {
    strokes = [];
    drawLayer.hidden = false;
    sizeCanvas();
    window.addEventListener("resize", sizeCanvas);
  }
  function drawOff() {
    drawLayer.hidden = true;
    strokes = [];
    stroke = null;
    snapWait = null;
    window.removeEventListener("resize", sizeCanvas);
    var btn = $("st-draw-attach");
    btn.disabled = false;
    btn.textContent = "Attach";
  }
  drawCanvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    drawCanvas.setPointerCapture(e.pointerId);
    stroke = { color: drawColor, points: [[e.offsetX, e.offsetY]] };
    strokes.push(stroke);
    redraw();
  });
  drawCanvas.addEventListener("pointermove", function (e) {
    if (!stroke) return;
    stroke.points.push([e.offsetX, e.offsetY]);
    redraw();
  });
  ["pointerup", "pointercancel"].forEach(function (n) { drawCanvas.addEventListener(n, function () { stroke = null; }); });
  drawLayer.querySelectorAll(".st-draw-color").forEach(function (b) {
    b.addEventListener("click", function () {
      drawColor = b.getAttribute("data-color");
      drawLayer.querySelectorAll(".st-draw-color").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    });
  });
  $("st-draw-undo").addEventListener("click", function () { strokes.pop(); redraw(); });
  $("st-draw-clear").addEventListener("click", function () { strokes = []; redraw(); });
  $("st-draw-cancel").addEventListener("click", function () { setTool(null); });
  $("st-draw-attach").addEventListener("click", function () {
    if (!strokes.length) { C.toast("Draw on the preview first."); return; }
    var btn = this;
    btn.disabled = true;
    btn.textContent = "Capturing…";
    var r = preview.getBoundingClientRect();
    var w = Math.round(r.width), h = Math.round(r.height);
    var list = strokes.slice();
    var bg = getComputedStyle(preview).backgroundColor;
    var done = false;
    function compose(url) {
      if (done) return;
      done = true;
      snapWait = null;
      var cv = document.createElement("canvas");
      cv.width = w * 2;
      cv.height = h * 2;
      var g = cv.getContext("2d");
      g.fillStyle = bg;
      g.fillRect(0, 0, cv.width, cv.height);
      function finish() {
        paintStrokes(g, 2, list);
        cv.toBlob(function (blob) {
          if (blob) attach.add([new File([blob], "annotation.jpg", { type: "image/jpeg" })]);
          setTool(null);
          aiInput.focus();
        }, "image/jpeg", 0.9);
      }
      if (!url) { C.toast("The preview could not be captured, so only the drawing is attached.", "err"); finish(); return; }
      var im = new Image();
      im.onload = function () { g.drawImage(im, 0, 0, cv.width, cv.height); finish(); };
      im.onerror = function () { finish(); };
      im.src = url;
    }
    snapWait = function (m) { compose(m.url || null); };
    setTimeout(function () { compose(null); }, 9000);
    if (!C.tellPreview(preview, { type: "snapshot" })) compose(null);
  });

  // ── Header: title, credit, actions ──────────────────────────────────────────
  var titleEl = $("st-title");
  titleEl.addEventListener("input", function () { S.title = titleEl.value; markDirty(); });
  titleEl.addEventListener("keydown", function (e) { if (e.key === "Enter") titleEl.blur(); });

  function link(href, text) { return '<a href="' + C.esc(href) + '">' + C.esc(text) + "</a>"; }

  // "just now", "5 min ago", "3 h ago", "2 days ago", then the date.
  function ago(ms) {
    if (!ms) return "";
    var s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 172800) return "yesterday";
    if (s < 604800) return Math.floor(s / 86400) + " days ago";
    var d = new Date(ms);
    return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear() ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
  }

  // The maker: the author, or for your own work your community profile
  // (its name follows the account page's first and last name).
  var meProfile = null;
  function maker() {
    var p = S.owner ? meProfile : S.author;
    if (!p) return "";
    var name = p.display_name || "@" + p.handle;
    return p.handle ? link(C.profileUrl(p.handle), name) : C.esc(name);
  }

  function paintCredit() {
    var parts = [];
    var by = maker();
    if (by) parts.push("by " + by);
    if (S.createdAt) parts.push("created " + ago(S.createdAt));
    if (S.remix) {
      if (S.remix.kind === "library") {
        parts.push("Remix of the " + link("detail.html?t=" + S.remix.id, S.remix.title || S.remix.id) + " transition");
      } else if (S.remix.title) {
        parts.push("Remix of " + link(C.studioUrl({ id: S.remix.id }), S.remix.title) + (S.remix.handle ? " by " + link(C.profileUrl(S.remix.handle), "@" + S.remix.handle) : ""));
      }
    }
    $("st-credit").innerHTML = parts.join(" · ");
  }

  function paintHeader() {
    titleEl.value = S.title;
    titleEl.readOnly = !S.owner;
    paintCredit();

    document.querySelectorAll("[data-edit]").forEach(function (el) { el.hidden = !S.owner; });
    document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = S.owner; });
    document.querySelectorAll("[data-owner]").forEach(function (el) {
      el.hidden = !(S.owner && S.id) || (el.getAttribute("data-act") === "unpublish" && !S.published);
    });
    document.querySelectorAll("[data-viewer]").forEach(function (el) { el.hidden = S.owner; });
    document.querySelectorAll("[data-needs-id]").forEach(function (el) { el.hidden = !S.id || !S.published; });
    var dangerRule = document.querySelector("[data-danger-rule]");
    if (dangerRule) dangerRule.hidden = !menu.querySelector(".is-danger:not([hidden])");
    $("st-save").textContent = S.published ? "Save changes" : "Save draft";
    $("st-save").className = "cm-btn" + (S.published ? " cm-btn--primary" : "");
    $("st-publish").hidden = !S.owner || S.published;
    var like = $("st-like");
    like.setAttribute("aria-pressed", String(!!S.liked));
    like.querySelector(".cm-like-count").textContent = String(S.likes || 0);
    modeBtn.hidden = !S.owner;
    editor.setReadOnly(false);
    // Viewers read the description from the menu; owners edit it there.
    var about = menu.querySelector('[data-act="about"]');
    if (about) about.hidden = S.owner || !S.description;
    document.title = (S.title || "Untitled") + " | Transitions.dev Studio";
  }

  // ── Dirty tracking + local scratch ──────────────────────────────────────────
  var savedEl = $("st-saved");
  function markDirty() {
    S.dirty = true;
    if (S.owner) { savedEl.textContent = S.id ? "Unsaved changes" : ""; savedEl.hidden = !S.id; }
    if (!S.id && S.owner) {
      try { localStorage.setItem(SCRATCH_KEY, JSON.stringify({ s: snapshot(), remix: S.remix, t: Date.now() })); } catch (e) {}
    }
  }
  function markSaved(text) {
    S.dirty = false;
    savedEl.textContent = text || "Saved";
    savedEl.hidden = false;
  }
  window.addEventListener("beforeunload", function (e) {
    if (S.dirty && S.owner && S.id) { e.preventDefault(); e.returnValue = ""; }
  });

  // ── Load ────────────────────────────────────────────────────────────────────
  function apply(c, opts) {
    opts = opts || {};
    S.id = opts.asNew ? null : c.id || null;
    S.owner = opts.asNew ? true : !!c.owner;
    S.published = opts.asNew ? false : !!c.published;
    S.mode = c.mode === "react" ? "react" : "html";
    S.files = { html: c.html || "", css: c.css || "", js: c.js || "" };
    S.stash = {};
    S.title = c.title || "Untitled";
    S.description = c.description || "";
    S.author = c.author || null;
    S.createdAt = opts.asNew ? Date.now() : c.created_at || c.updated_at || null;
    S.likes = c.likes || 0;
    S.liked = !!c.liked;
    S.remix = opts.remix || (c.remix ? { kind: c.remix.kind, id: c.remix.id, title: c.remix.source && c.remix.source.title, handle: c.remix.source && c.remix.source.handle } : null);
    S.file = S.mode === "react" ? "js" : "html";
    S.dirty = false;
    loadedCss = S.files.css;
    savedEl.hidden = true;
    paintHeader();
    paintTabs();
    render();
    if (controls) controls.refresh(true);
    if (typeof paintLibs === "function") paintLibs();
  }

  function startNew(mode, keepScratch) {
    var restored = null;
    if (keepScratch) {
      try { restored = JSON.parse(localStorage.getItem(SCRATCH_KEY) || "null"); } catch (e) {}
    }
    if (restored && restored.s && (!mode || restored.s.mode === mode)) {
      apply(restored.s, { asNew: true, remix: restored.remix || null });
      S.dirty = true;
      return;
    }
    var m = mode === "react" ? "react" : "html";
    apply({ mode: m, title: "Untitled", html: STARTER[m].html, css: STARTER[m].css, js: STARTER[m].js }, { asNew: true });
  }

  function remixOf(c) {
    apply({
      mode: c.mode, html: c.html, css: c.css, js: c.js,
      title: (c.title || "Untitled") + " remix", description: c.description,
    }, { asNew: true, remix: { kind: "community", id: c.id, title: c.title, handle: c.author && c.author.handle } });
    S.dirty = true;
    history.replaceState(null, "", "studio.html?remix=" + encodeURIComponent(c.id));
    markDirty();
  }

  // ── Library (remix a transition) ────────────────────────────────────────────
  function startFromLibrary(slug) {
    return C.library().then(function (items) {
      var t = items.filter(function (x) { return x.slug === slug; })[0];
      if (!t) { C.toast("That transition is not available to remix.", "err"); return false; }
      // The card itself, as library.html renders it: markup, CSS and script.
      apply({ mode: "html", title: t.title + " remix", html: t.html, css: t.css, js: t.js }, { asNew: true, remix: { kind: "library", id: t.slug, title: t.title } });
      history.replaceState(null, "", "studio.html?lib=" + encodeURIComponent(slug));
      markDirty();
      return true;
    });
  }

  // Dialogs: shown and hidden with the same fade (skill and design system editors).
  function showDialog(d) { d.hidden = false; requestAnimationFrame(function () { d.classList.add("is-open"); }); }
  function hideDialog(d) { d.classList.remove("is-open"); setTimeout(function () { d.hidden = true; }, 200); }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    var d = $("st-skill-dlg");
    if (!d.hidden) hideDialog(d);
    if (!$("st-ds-dlg").hidden) closeDesign();
  });

  // The shared picker (static thumbnails, search, categories). Asked
  // in-page: native confirm() is blocked in embedded browsers.
  function openLibrary() {
    C.pickLibrary().then(function (t) {
      if (!t) return;
      (S.dirty && !isStarter()
        ? C.confirm({ title: "Replace the current component?", body: "Unsaved changes to it will be lost.", ok: "Replace" })
        : Promise.resolve(true)
      ).then(function (ok) { if (ok) startFromLibrary(t.slug); });
    });
  }

  // ── Save / publish ──────────────────────────────────────────────────────────
  function payload(publish) {
    var p = snapshot();
    if (publish !== undefined) p.publish = publish;
    if (!S.id && S.remix) p.remix = { kind: S.remix.kind, id: S.remix.id };
    return p;
  }

  function save(publish, btn) {
    C.withAccount(function () {
      if (btn) btn.disabled = true;
      var req = S.id ? C.api.update(S.id, payload(publish)) : C.api.create(payload(!!publish));
      req.then(function (r) {
        if (btn) btn.disabled = false;
        if (r.error) {
          if (r.error === "not_found" && S.id) {
            // Signed in as someone else since opening: keep the work as a new copy.
            S.id = null;
            return save(publish, btn);
          }
          C.toast(C.errorText(r.error), "err");
          return;
        }
        var wasNew = !S.id;
        S.id = r.id;
        S.owner = true;
        S.published = !!r.published;
        if (wasNew) {
          try { localStorage.removeItem(SCRATCH_KEY); } catch (e) {}
          history.replaceState(null, "", "studio.html?id=" + encodeURIComponent(r.id));
        }
        markSaved("Saved");
        paintHeader();
        if (publish === true) C.toast("Published to the Community");
        else if (publish === false) C.toast("Unpublished. Only you can see it now.");
      });
    });
  }
  $("st-save").addEventListener("click", function () { save(undefined, this); });
  $("st-publish").addEventListener("click", function () { save(true, this); });
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (S.owner) save(undefined, $("st-save"));
    }
  });

  // ── View mode actions ───────────────────────────────────────────────────────
  var likeBtn = $("st-like");
  likeBtn.addEventListener("click", function () {
    if (!S.id) return;
    C.withAccount(function () {
      var next = likeBtn.getAttribute("aria-pressed") !== "true";
      S.liked = next;
      S.likes = Math.max(0, S.likes + (next ? 1 : -1));
      paintHeader();
      if (next) { likeBtn.classList.remove("is-popping"); void likeBtn.offsetWidth; likeBtn.classList.add("is-popping"); }
      C.api.like(S.id, next).then(function (r) {
        if (r.error) { S.liked = !next; S.likes = Math.max(0, S.likes + (next ? -1 : 1)); paintHeader(); C.toast(C.errorText(r.error), "err"); return; }
        S.likes = r.likes;
        paintHeader();
      });
    });
  });

  $("st-remix").addEventListener("click", function () {
    var source = { id: S.id, title: S.title, description: S.description, mode: S.mode, html: S.files.html, css: S.files.css, js: S.files.js, author: S.author };
    remixOf(source);
    C.toast("Remixing. Your copy saves to your account.");
  });

  // ── More menu ───────────────────────────────────────────────────────────────
  var menu = $("st-menu");
  var setMoreMenu = dropdown($("st-more"), menu);
  function closeMenu() { setMoreMenu(false); }

  // Copy prompt: one paste hands this component to a coding agent, the same
  // job as Copy prompt on the transition pages and libraries.dev.
  function promptText() {
    var react = S.mode === "react";
    var pkgs = [];
    var re = /\bfrom\s*["']([^"'./][^"']*)["']/g, m;
    while ((m = re.exec(S.files.js))) {
      var spec = m[1].match(/^(@[^/]+\/[^/]+|[^/]+)/)[1];
      if (spec === "react" || spec === "react-dom" || pkgs.indexOf(spec) >= 0) continue;
      pkgs.push(spec);
    }
    var pins = (C.preinstalled || {});
    var install = pkgs.map(function (p) { return pins[p] ? p + "@" + pins[p] : p; });
    if (pkgs.indexOf("img-fx") >= 0 && install.indexOf("three@" + pins.three) < 0) install.push("three@" + pins.three);
    var url = S.id && S.published ? location.origin + "/studio.html?id=" + encodeURIComponent(S.id) : "";
    var lines = [
      'Add the "' + (S.title || "Untitled") + '" component to my project.' + (url ? " It comes from the transitions.dev Community: " + url : ""),
    ];
    if (S.description) lines.push("", S.description);
    lines.push(
      "",
      "Adapt it to my stack and design system, but keep the motion: the durations, the easings,",
      "and the prefers-reduced-motion fallback. Theme colors come from --stage-* CSS variables",
      "(--stage-bg, --stage-fg, --stage-muted, --stage-border, --stage-surface, --stage-accent,",
      "--stage-on-accent); map them to my own tokens."
    );
    if (install.length) lines.push("", "Install first:", "npm install " + install.join(" "));
    if (react) {
      lines.push("", "Component (React, TSX):", "```tsx", S.files.js.trim(), "```", "", "Styles:", "```css", S.files.css.trim(), "```");
    } else {
      lines.push("", "Markup:", "```html", S.files.html.trim(), "```", "", "Styles:", "```css", S.files.css.trim(), "```");
      if (S.files.js.trim()) lines.push("", "Script (runs once after the markup):", "```js", S.files.js.trim(), "```");
    }
    return lines.join("\n") + "\n";
  }

  var copyBtn = $("st-copy");
  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(promptText()).then(function () {
      copyBtn.setAttribute("data-copied", "true");
      setTimeout(function () { copyBtn.removeAttribute("data-copied"); }, 1600);
    }, function () { C.toast("Could not copy", "err"); });
  });

  menu.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    closeMenu();
    var act = b.getAttribute("data-act");
    if (act === "new") {
      (S.dirty && S.owner && !isStarter()
        ? C.confirm({ title: "Start a new component?", body: "Unsaved changes will be lost.", ok: "Start new" })
        : Promise.resolve(true)
      ).then(function (ok) {
        if (!ok) return;
        try { localStorage.removeItem(SCRATCH_KEY); } catch (err) {}
        history.replaceState(null, "", "studio.html");
        startNew(S.mode, false);
      });
    } else if (act === "library") {
      openLibrary();
    } else if (act === "desc") {
      C.ask({
        title: "Description",
        body: "One sentence on what the interaction does. It shows with the component in the Community.",
        placeholder: "What does the interaction do?",
        value: S.description || "",
        max: 280,
        ok: "Save",
      }).then(function (v) {
        if (v == null || v === (S.description || "")) return;
        S.description = v;
        markDirty();
        paintHeader();
      });
    } else if (act === "about") {
      C.confirm({ title: S.title || "Untitled", body: S.description, ok: "Close", cancel: false });
    } else if (act === "link") {
      navigator.clipboard.writeText(location.origin + "/studio.html?id=" + encodeURIComponent(S.id)).then(function () { C.toast("Link copied"); });
    } else if (act === "unpublish") {
      save(false, null);
    } else if (act === "delete") {
      C.confirm({ title: "Delete “" + S.title + "”?", body: "This cannot be undone.", ok: "Delete", danger: true }).then(function (ok) {
        if (!ok) return;
        C.api.remove(S.id).then(function (r) {
          if (r.error) { C.toast(C.errorText(r.error), "err"); return; }
          S.dirty = false;
          location.href = "community.html";
        });
      });
    } else if (act === "report") {
      C.withAccount(function () {
        C.ask({ title: "Report this component", body: "What is wrong with it?", placeholder: "Spam, stolen work, harmful content…", ok: "Report" }).then(function (reason) {
          if (reason == null) return;
          C.api.report(S.id, reason || "unspecified").then(function (r) {
            C.toast(r.error ? C.errorText(r.error) : "Thanks. We will take a look.", r.error ? "err" : undefined);
          });
        });
      });
    }
  });

  // ── Agent context: skills and preinstalled libraries ───────────────────────
  // Skills are guidance the agent follows (the built-in transitions.dev skill
  // plus the account's own); libraries are the libraries.dev packages the
  // preview preloads. Toggles are a per-browser preference.
  var CTX_KEY = "tdev:studio:context";
  var ctx = { builtin: true, skills: {}, libs: {} };
  try { var saved = JSON.parse(localStorage.getItem(CTX_KEY) || "null"); if (saved) ctx = Object.assign(ctx, saved); } catch (e) {}
  function saveCtx() { try { localStorage.setItem(CTX_KEY, JSON.stringify(ctx)); } catch (e) {} }
  var customSkills = [];
  var libraries = [];
  // Built-in skills, on by default. Transitions Pro is assembled by the API
  // from the paid recipes, so it only switches on for Pro and Business.
  var BUILTINS = [
    { id: "builtin", name: "Transitions.dev", sub: "Built in: motion tokens and 32 transitions", file: "transitions-dev.md?v=1" },
    { id: "polish", name: "Make interfaces feel better", sub: "Built in: polish details, by Jakub Krehel", file: "make-interfaces-feel-better.md?v=1" },
  ];
  var hasPro = false;
  var builtinP = {};
  function builtinText(b) {
    if (!builtinP[b.id]) builtinP[b.id] = fetch("assets/community/skills/" + b.file).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { builtinP[b.id] = null; return ""; });
    return builtinP[b.id];
  }
  function proOn() { return hasPro && ctx.pro !== false; }

  var ICON_BOOK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3.5A1.5 1.5 0 0 1 4.5 2H13v10H4.5A1.5 1.5 0 0 0 3 13.5m0-10v10m0 0A1.5 1.5 0 0 0 4.5 15H13v-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_DOC = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6m-4-4 4 4m-4-4v4h4M5.5 9h5M5.5 11.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_EDIT = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 3.5l3 3M2.5 13.5l.6-2.9L10.8 2.9a1.4 1.4 0 0 1 2 0l.3.3a1.4 1.4 0 0 1 0 2l-7.7 7.7-2.9.6Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_COPY = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.8" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.3A1.2 1.2 0 0 0 9.3 2H3.2A1.2 1.2 0 0 0 2 3.2v6.1a1.2 1.2 0 0 0 1.2 1.2h.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var ICON_SPARK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3L8 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12.5 11v3M11 12.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var ICON_STAR = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M7.5 2.3c.2-.4.8-.4 1 0l1.4 2.9 3.2.5c.5.1.7.6.3 1l-2.3 2.2.5 3.2c.1.5-.4.8-.8.6L8 11.2l-2.9 1.5c-.4.2-.9-.1-.8-.6l.5-3.2L2.6 6.7c-.4-.4-.2-.9.3-1l3.2-.5 1.4-2.9Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  var ICON_PLUS = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="16" height="16" style="margin-right:8px;flex:none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function sw(on, label) {
    return '<button type="button" class="st-check" role="menuitemcheckbox" aria-checked="' + (on ? "true" : "false") + '" aria-label="' + C.esc(label) + '"></button>';
  }

  var skillsMenu = $("st-skills-menu");
  var libsMenu = $("st-libs-menu");
  var setSkillsMenu = dropdown($("st-skills-btn"), skillsMenu);
  var setLibsMenu = dropdown($("st-libs-btn"), libsMenu);

  function skillOn(id) { return id === "builtin" ? ctx.builtin !== false : ctx.skills[id] !== false; }
  function paintCounts() {
    var n = BUILTINS.filter(function (b) { return skillOn(b.id); }).length + (proOn() ? 1 : 0) +
      customSkills.filter(function (k) { return skillOn(k.id); }).length;
    $("st-skills-count").textContent = n ? String(n) : "";
    var l = libraries.filter(function (x) { return ctx.libs[x.id]; }).length;
    $("st-libs-count").textContent = l ? String(l) : "";
  }

  function paintSkills() {
    var signedIn = !!(window.TransitionsPro && TransitionsPro.state && TransitionsPro.state.authenticated);
    skillsMenu.innerHTML =
      '<p class="tl-menu-group">Skills the agent follows with every request</p>' +
      BUILTINS.map(function (b) {
        return '<div class="tl-menu-item st-pop-row" data-skill="' + b.id + '"><span class="st-pop-ico">' + (b.id === "builtin" ? ICON_BOOK : ICON_SPARK) + "</span>" +
          '<span class="st-pop-main"><b>' + b.name + "</b><span>" + b.sub + "</span></span>" +
          sw(skillOn(b.id), "Use the " + b.name + " skill") + "</div>";
      }).join("") +
      '<div class="tl-menu-item st-pop-row' + (hasPro ? "" : " is-locked") + '" data-skill="pro"><span class="st-pop-ico">' + ICON_STAR + "</span>" +
        '<span class="st-pop-main"><b>Transitions Pro</b><span>' + (hasPro ? "Built in: every Pro transition recipe" : "For Pro and Business plans") + "</span></span>" +
        (hasPro ? "" : '<a class="st-pop-badge" href="pro.html">Get Pro</a>') +
        '<button type="button" class="st-check" role="menuitemcheckbox" aria-checked="' + proOn() + '"' + (hasPro ? "" : " disabled") +
          ' aria-label="Use the Transitions Pro skill"></button></div>' +
      customSkills.map(function (k) {
        return '<div class="tl-menu-item st-pop-row" data-skill="' + C.esc(k.id) + '"><span class="st-pop-ico">' + ICON_DOC + "</span>" +
          '<span class="st-pop-main"><b>' + C.esc(k.name) + "</b><span>" + k.content.length.toLocaleString() + " characters</span></span>" +
          '<button type="button" class="st-pop-act" data-edit-skill="' + C.esc(k.id) + '" aria-label="Edit ' + C.esc(k.name) + '">' + ICON_EDIT + "</button>" +
          sw(skillOn(k.id), "Use " + k.name) + "</div>";
      }).join("") +
      '<div class="tl-menu-divider"></div>' +
      '<button type="button" class="tl-menu-item" role="menuitem" data-add-skill><span class="tl-menu-item-label">' + ICON_PLUS +
        (signedIn ? "Add a skill" : "Sign in to add your own skills") + "</span></button>";
    paintCounts();
  }

  function paintLibs() {
    var react = S.mode === "react";
    libsMenu.innerHTML =
      '<p class="tl-menu-group">Preinstalled from libraries.dev</p>' +
      libraries.map(function (l) {
        return '<div class="tl-menu-item st-pop-row" data-lib="' + C.esc(l.id) + '">' +
          '<span class="st-lib-ico" aria-hidden="true">' +
            '<img class="is-dark" src="assets/community/libs/' + C.esc(l.icon) + '" alt="" width="30" height="30" />' +
            '<img class="is-light" src="assets/community/libs/' + C.esc(l.iconLight || l.icon) + '" alt="" width="30" height="30" />' +
          "</span>" +
          '<span class="st-pop-main"><b>' + C.esc(l.name) + "</b><span><code>" + C.esc(l.pkg) + "</code> · " + C.esc(l.desc) + "</span></span>" +
          '<button type="button" class="st-pop-act" data-copy-lib="' + C.esc(l.id) + '" aria-label="Copy ' + C.esc(l.name) + ' usage" title="Copy usage">' + ICON_COPY + "</button>" +
          sw(!!ctx.libs[l.id], "Explain " + l.name + " to the agent") + "</div>";
      }).join("") +
      '<div class="tl-menu-divider"></div>' +
      '<p class="tl-menu-note">Import them in React components. Switched-on ones are explained to the agent.' +
      (react ? "" : ' <button type="button" data-react>Switch to React</button>') + "</p>";
    paintCounts();
  }

  skillsMenu.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("[data-add-skill]")) { setSkillsMenu(false); openSkill(null); return; }
    var ed = t.closest("[data-edit-skill]");
    if (ed) {
      var k = customSkills.filter(function (x) { return x.id === ed.getAttribute("data-edit-skill"); })[0];
      setSkillsMenu(false);
      if (k) openSkill(k);
      return;
    }
    var row = t.closest("[data-skill]");
    if (!row || t.closest("a")) return;
    var id = row.getAttribute("data-skill");
    if (id === "pro") {
      if (!hasPro) return;
      ctx.pro = !proOn();
      saveCtx();
      row.querySelector(".st-check").setAttribute("aria-checked", String(proOn()));
      paintCounts();
      return;
    }
    var on = !skillOn(id);
    if (id === "builtin") ctx.builtin = on; else ctx.skills[id] = on;
    saveCtx();
    row.querySelector(".st-check").setAttribute("aria-checked", String(on));
    paintCounts();
  });

  libsMenu.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("[data-react]")) {
      setLibsMenu(false);
      var reactBtn = modeMenu.querySelector('[data-mode="react"]');
      if (reactBtn && S.owner) reactBtn.click();
      return;
    }
    var cp = t.closest("[data-copy-lib]");
    if (cp) {
      var lib = libraries.filter(function (x) { return x.id === cp.getAttribute("data-copy-lib"); })[0];
      if (lib) navigator.clipboard.writeText(lib.usage).then(function () { C.toast(lib.name + " usage copied"); }, function () {});
      return;
    }
    var row = t.closest("[data-lib]");
    if (!row) return;
    var id = row.getAttribute("data-lib");
    ctx.libs[id] = !ctx.libs[id];
    saveCtx();
    row.querySelector(".st-check").setAttribute("aria-checked", String(!!ctx.libs[id]));
    paintCounts();
  });

  function loadSkills() {
    C.auth().then(function (st) {
      if (!st || !st.authenticated) { customSkills = []; paintSkills(); return; }
      C.api.skills().then(function (r) { customSkills = (r && r.items) || []; paintSkills(); });
    });
  }
  fetch("assets/community/libraries.json?v=2").then(function (r) { return r.json(); })
    .then(function (list) { libraries = list || []; paintLibs(); }).catch(function () {});
  paintSkills();
  loadSkills();
  document.addEventListener("pro:me", loadSkills);

  // The transitions.dev recipes that fit this request: scored by their
  // trigger words in the request (strongly) and in the current component
  // (lightly), up to four. They carry the real markup, tokens, CSS and JS,
  // so the agent applies the library's pattern instead of improvising.
  var recipesP = null;
  function recipes() {
    if (!recipesP) recipesP = fetch("assets/community/skills/recipes.json?v=2").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { recipesP = null; return []; });
    return recipesP;
  }
  function pickRecipes(list, request) {
    var ask = " " + String(request || "").toLowerCase() + " ";
    var code = (" " + S.files.html + " " + S.files.css + " " + S.files.js + " ").toLowerCase();
    function has(hay, w) {
      if (/^[\w ]+$/.test(w)) return new RegExp("[^a-z0-9]" + w.replace(/ /g, "[ -]") + "s?[^a-z0-9]").test(hay);
      return hay.indexOf(w) >= 0;
    }
    var scored = list.map(function (r) {
      var fromAsk = r.triggers.filter(function (w) { return has(ask, w); }).length;
      var fromCode = Math.min(2, r.triggers.filter(function (w) { return w.length >= 4 && has(code, w); }).length);
      return { r: r, score: fromAsk * 3 + fromCode };
    }).filter(function (x) { return x.score >= 2; });
    scored.sort(function (a, b) { return b.score - a.score; });
    var out = [], size = 0;
    scored.forEach(function (x) {
      if (out.length >= 4 || size + x.r.recipe.length > 20000) return;
      out.push(x.r);
      size += x.r.recipe.length;
    });
    return out;
  }

  // What the agent reads besides the request, in the order it should weigh it.
  function agentContext(request) {
    var on = BUILTINS.filter(function (b) { return skillOn(b.id); });
    var withRecipes = skillOn("builtin");
    var ds = dsCurrent();
    return Promise.all(on.map(builtinText).concat([ds.builtin ? modernText() : Promise.resolve(""), withRecipes ? recipes() : Promise.resolve([])])).then(function (texts) {
      var list = texts.pop();
      var dsContent = texts.pop();
      var items = [];
      // Modern goes with its text; the API reads an account's own by id.
      if (!ds.builtin) items.push({ kind: "design_system", id: ds.id, name: ds.name });
      else if (dsContent) items.push({ kind: "design_system", id: "modern", name: ds.name, content: dsContent });
      on.forEach(function (b, i) { if (texts[i]) items.push({ kind: "skill", name: b.name, content: texts[i] }); });
      pickRecipes(list, request).forEach(function (r) {
        items.push({ kind: "skill", name: "Transitions.dev recipe: " + r.title, content: r.recipe });
      });
      // The API builds this one from the paid recipes; the page only asks.
      if (proOn()) items.push({ kind: "pro", name: "Transitions Pro" });
      customSkills.forEach(function (k) { if (skillOn(k.id)) items.push({ kind: "skill", name: k.name, content: k.content }); });
      if (S.mode === "react" && libraries.length) {
        items.push({
          kind: "skill",
          name: "Preinstalled libraries",
          content: "These npm packages are preloaded in the preview at pinned versions. Import them by package name; they need no install and no CSS import.\n" +
            libraries.map(function (l) { return "- " + l.pkg + " (" + l.name + "): " + l.desc + ". " + l.usage.split("\n")[0]; }).join("\n"),
        });
        libraries.forEach(function (l) {
          if (ctx.libs[l.id]) items.push({ kind: "library", name: l.name, package: l.pkg, content: "```tsx\n" + l.usage + "\n```\n\n" + l.doc });
        });
      }
      var total = items.reduce(function (n, x) { return n + (x.content || "").length; }, 0);
      if (total > 58000) throw new Error("context_too_large");
      return items;
    });
  }

  // ── Skill editor ────────────────────────────────────────────────────────────
  var skillDlg = $("st-skill-dlg");
  var skillForm = skillDlg.querySelector("form");
  var skillName = $("st-skill-name");
  var skillText = $("st-skill-content");
  var skillErr = $("st-skill-err");
  var editingSkill = null;
  function skillCount() { $("st-skill-count").textContent = skillText.value.length.toLocaleString() + " / 20,000"; }
  skillText.addEventListener("input", skillCount);
  function openSkill(k) {
    C.withAccount(function () {
      editingSkill = k;
      $("st-skill-title").textContent = k ? "Edit skill" : "Add a skill";
      skillName.value = k ? k.name : "";
      skillText.value = k ? k.content : "";
      $("st-skill-del").hidden = !k;
      skillErr.hidden = true;
      skillCount();
      showDialog(skillDlg);
      setTimeout(function () { (k ? skillText : skillName).focus(); }, 50);
    });
  }
  skillDlg.addEventListener("click", function (e) {
    if (e.target === skillDlg || e.target.closest("[data-close]")) hideDialog(skillDlg);
  });
  $("st-skill-file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 200000) { skillErr.textContent = "That file is too large for a skill."; skillErr.hidden = false; return; }
    f.text().then(function (text) {
      // A SKILL.md names itself in its front matter.
      var fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
      var named = fm && fm[1].match(/^name:\s*(.+)$/m);
      if (!skillName.value.trim()) skillName.value = (named ? named[1] : f.name.replace(/\.(md|markdown|txt)$/i, "")).trim().slice(0, 60);
      skillText.value = text.slice(0, 20000);
      skillCount();
      if (text.length > 20000) { skillErr.textContent = "Trimmed to the first 20,000 characters."; skillErr.hidden = false; }
    });
  });
  skillForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = $("st-skill-save");
    btn.disabled = true;
    C.api.saveSkill({ id: editingSkill ? editingSkill.id : undefined, name: skillName.value.trim(), content: skillText.value }).then(function (r) {
      btn.disabled = false;
      if (r.error) { skillErr.textContent = C.errorText(r.error); skillErr.hidden = false; return; }
      var k = r.skill;
      var i = customSkills.map(function (x) { return x.id; }).indexOf(k.id);
      if (i >= 0) customSkills[i] = k; else customSkills.unshift(k);
      ctx.skills[k.id] = true;
      saveCtx();
      paintSkills();
      hideDialog(skillDlg);
      C.toast(editingSkill ? "Skill updated" : "Skill added. The agent follows it from now on.");
    });
  });
  $("st-skill-del").addEventListener("click", function () {
    if (!editingSkill) return;
    var k = editingSkill;
    C.confirm({ title: "Delete “" + k.name + "”?", body: "The agent stops using it.", ok: "Delete", danger: true }).then(function (ok) {
      if (!ok) return;
      C.api.deleteSkill(k.id).then(function (r) {
        if (r.error) { skillErr.textContent = C.errorText(r.error); skillErr.hidden = false; return; }
        customSkills = customSkills.filter(function (x) { return x.id !== k.id; });
        delete ctx.skills[k.id];
        saveCtx();
        paintSkills();
        hideDialog(skillDlg);
      });
    });
  });

  // ── Design system ───────────────────────────────────────────────────────────
  // The visual language the agent builds in. Modern (the transitions.dev and
  // Refine look) is built in, free and the default; with Pro or Business an
  // account adds its own from a screenshot (the agent writes the values) or
  // by pasting values. The pick is a per-browser preference, like the skills.
  var MODERN = {
    id: "modern", name: "Modern", builtin: true, file: "modern.md?v=1",
    sub: "Default · the transitions.dev and Refine look",
    spec: {
      light: { bg: "#f9f9f9", surface: "#ffffff", text: "#0d0d0d", muted: "#6c6c6c", accent: "#0073e5", onAccent: "#ffffff", radius: "40px" },
      dark: { bg: "#131313", surface: "#1d1d1d", text: "#f2f2f2", muted: "rgba(202, 202, 202, .7)", accent: "#55cfff", onAccent: "#04131a", radius: "40px" },
      font: "",
    },
  };
  var designSystems = [];
  var modernP = null;
  function modernText() {
    if (!modernP) modernP = fetch("assets/community/design-systems/" + MODERN.file).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { modernP = null; return ""; });
    return modernP;
  }
  function dsAll() { return [MODERN].concat(designSystems); }
  function dsCurrent() {
    var id = hasPro ? ctx.ds || "modern" : "modern";
    return dsAll().filter(function (x) { return x.id === id; })[0] || MODERN;
  }

  // The specimen on a custom system's card, read off its values: CSS custom
  // properties by role name (light from :root, dark from a dark-theme block),
  // else the lightest, darkest and most colorful colors it mentions. Values
  // only reach the page through these patterns.
  var ROLES = {
    bg: ["bg", "background", "page", "canvas", "base", "bg-base", "background-default"],
    surface: ["surface", "card", "card-bg", "surface-bg", "panel", "popover", "elevated", "bg-elevated"],
    text: ["text", "fg", "foreground", "text-primary", "ink", "text-default"],
    muted: ["text-muted", "muted-foreground", "text-secondary", "muted", "text-subtle", "fg-muted"],
    accent: ["accent", "primary", "brand", "action", "accent-bg", "primary-bg"],
    onAccent: ["on-accent", "on-primary", "accent-foreground", "primary-foreground", "on-brand"],
    radius: ["radius-pill", "radius-md", "radius", "radius-lg", "rounded", "radius-button"],
  };
  var SAFE_COLOR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab|lab|lch)\([\d\s.,%/a-z+-]{1,60}\)|white|black|transparent)$/i;
  var SAFE_SIZE = /^\d{1,4}(\.\d+)?(px|rem|em|%)$/;
  var SAFE_FONT = /^[\w\s"',.-]{1,120}$/;
  function readVars(text) {
    var out = {}, re = /--([\w-]+)\s*:\s*([^;}\n]+)/g, m;
    while ((m = re.exec(text))) { var k = m[1].toLowerCase(); if (!(k in out)) out[k] = m[2].trim(); }
    return out;
  }
  function resolveVar(vars, v) {
    for (var i = 0; i < 4 && v; i++) {
      var m = /^var\(\s*--([\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(v);
      if (!m) break;
      v = vars[m[1].toLowerCase()] || (m[2] || "").trim();
    }
    return v;
  }
  function pickRole(vars, role) {
    var names = ROLES[role];
    var ok = role === "radius" ? SAFE_SIZE : SAFE_COLOR;
    var keys = Object.keys(vars);
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < names.length; i++) {
        for (var j = 0; j < keys.length; j++) {
          var k = keys[j];
          var hit = pass === 0 ? (k === names[i] || k === "color-" + names[i]) : (k.slice(-names[i].length - 1) === "-" + names[i]);
          if (!hit) continue;
          var v = resolveVar(vars, vars[k]);
          if (v && ok.test(v)) return v;
        }
      }
    }
    return null;
  }
  function hexInfo(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    var r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    return { l: 0.2126 * r + 0.7152 * g + 0.0722 * b, s: max - min };
  }
  function dsSpec(ds) {
    if (ds.builtin) return ds.spec;
    if (ds._spec && ds._specOf === ds.content) return ds._spec;
    var text = ds.content || "";
    var dm = /(?:html|:root)?\s*\[data-theme=["']?dark["']?\][^{]*\{([^}]*)\}|\.dark\s*\{([^}]*)\}|@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^{]*\{([^}]*)\}/i.exec(text);
    var lightVars = readVars(dm ? text.replace(dm[0], "") : text);
    var darkVars = dm ? Object.assign({}, lightVars, readVars(dm[1] || dm[2] || dm[3] || "")) : null;
    function side(vars) {
      var o = {};
      Object.keys(ROLES).forEach(function (r) { o[r] = pickRole(vars, r); });
      return o;
    }
    var light = side(lightVars);
    if (!light.bg && !light.text && !light.accent) {
      var hexes = (text.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).filter(function (h, i, a) { return a.indexOf(h) === i; }).slice(0, 12);
      if (hexes.length) {
        var info = hexes.map(function (h) { return { h: h, i: hexInfo(h) }; });
        var byL = info.slice().sort(function (a, b) { return b.i.l - a.i.l; });
        light.bg = byL[0].h;
        light.text = byL[byL.length - 1].h;
        var vivid = info.slice().sort(function (a, b) { return b.i.s - a.i.s; })[0];
        if (vivid.i.s > 0.25) light.accent = vivid.h;
      }
    }
    var fm = /--font(?:-sans|-family|-body)?\s*:\s*([^;}\n]+)/i.exec(text) || /font-family\s*:\s*([^;}\n]+)/i.exec(text);
    var font = fm && SAFE_FONT.test(fm[1].trim()) ? fm[1].trim() : "";
    ds._specOf = ds.content;
    ds._spec = { light: light, dark: darkVars ? side(darkVars) : null, font: font };
    return ds._spec;
  }
  var SPEC_VARS = { bg: "b", surface: "s", text: "t", muted: "m", accent: "a", onAccent: "oa", radius: "r" };
  function specimen(ds) {
    var sp = dsSpec(ds);
    var style = [];
    [["l", sp.light], ["d", sp.dark]].forEach(function (pair) {
      if (!pair[1]) return;
      Object.keys(SPEC_VARS).forEach(function (k) {
        if (pair[1][k]) style.push("--" + pair[0] + SPEC_VARS[k] + ":" + pair[1][k]);
      });
    });
    if (sp.font) style.push("--f:" + sp.font);
    return '<span class="st-ds-spec" style="' + C.esc(style.join(";")) + '" aria-hidden="true">' +
      '<span class="st-ds-spec-card"><span class="st-ds-spec-aa">Aa</span><span class="st-ds-spec-lines"><i></i><i></i></span></span>' +
      '<span class="st-ds-spec-btn">Button</span>' +
      '<span class="st-ds-spec-check"><svg viewBox="0 0 16 16" fill="none"><path d="M4 8.4268L6.46155 11.19223L12 4.97001" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
    "</span>";
  }
  var ICON_EYE = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.75 8s2.3-4.25 6.25-4.25S14.25 8 14.25 8 11.95 12.25 8 12.25 1.75 8 1.75 8Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.9" stroke="currentColor" stroke-width="1.4"/></svg>';

  var dsListEl = $("st-ds-list");
  var addDsBtn = $("st-ds-add");
  var dsUpsell = $("st-ds-upsell");
  function paintDesign() {
    var cur = dsCurrent();
    dsListEl.innerHTML = dsAll().map(function (ds) {
      var on = ds === cur;
      var locked = !ds.builtin && !hasPro;
      var n = ds.builtin ? 0 : Object.keys(readVars(ds.content || "")).length;
      var sub = ds.builtin ? ds.sub : n ? "Yours · " + n + " token" + (n === 1 ? "" : "s") : "Yours · " + (ds.content || "").length.toLocaleString() + " characters";
      return '<div class="st-ds-item' + (on ? " is-on" : "") + (locked ? " is-locked" : "") + '" data-ds="' + C.esc(ds.id) + '">' +
        '<button type="button" class="st-ds-pick" role="radio" aria-checked="' + on + '" tabindex="' + (on ? 0 : -1) + '"' + (locked ? ' aria-disabled="true"' : "") + ">" +
          specimen(ds) +
          '<span class="st-ds-meta"><b>' + C.esc(ds.name) + "</b><span>" + C.esc(sub) + "</span></span>" +
        "</button>" +
        '<button type="button" class="st-pop-act st-ds-act" data-ds-open="' + C.esc(ds.id) + '" aria-label="' + (ds.builtin ? "View " : "Edit ") + C.esc(ds.name) + '" title="' + (ds.builtin ? "View values" : "Edit") + '">' +
          (ds.builtin ? ICON_EYE : ICON_EDIT) + "</button>" +
      "</div>";
    }).join("");
    addDsBtn.classList.toggle("is-locked", !hasPro);
    dsUpsell.hidden = hasPro;
  }
  // Without Pro or Business: Modern only, and the way to get more.
  function upsellDesign() {
    C.confirm({
      title: "Build in your own design system",
      body: "Custom design systems come with Pro and Business. Add one from a screenshot of your product or by pasting its values, and the agent builds every component in it.",
      ok: "Get Pro",
      cancel: "Not now",
    }).then(function (ok) { if (ok) location.href = "pro.html"; });
  }
  function pickDesign(id) {
    if (id !== "modern" && !hasPro) { upsellDesign(); return; }
    ctx.ds = id;
    saveCtx();
    paintDesign();
    var b = dsListEl.querySelector('[data-ds="' + id + '"] .st-ds-pick');
    if (b) b.focus();
  }
  dsListEl.addEventListener("click", function (e) {
    var open = e.target.closest("[data-ds-open]");
    if (open) {
      var ds = dsAll().filter(function (x) { return x.id === open.getAttribute("data-ds-open"); })[0];
      if (ds) openDesign(ds);
      return;
    }
    var item = e.target.closest("[data-ds]");
    if (item && e.target.closest(".st-ds-pick")) pickDesign(item.getAttribute("data-ds"));
  });
  // Radio group keys: arrows move the pick.
  dsListEl.addEventListener("keydown", function (e) {
    if (["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].indexOf(e.key) < 0 || !e.target.closest(".st-ds-pick")) return;
    e.preventDefault();
    var list = dsAll();
    if (!hasPro) return;
    var i = list.indexOf(dsCurrent()) + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1);
    pickDesign(list[(i + list.length) % list.length].id);
  });
  addDsBtn.addEventListener("click", function () {
    C.auth().then(function (st) {
      if (st && st.authenticated && !hasPro) upsellDesign(); else openDesign(null);
    });
  });

  function loadDesignSystems() {
    C.auth().then(function (st) {
      if (!st || !st.authenticated) { designSystems = []; paintDesign(); return; }
      C.api.designSystems().then(function (r) {
        if (r && r.items) designSystems = r.items;
        paintDesign();
      });
    });
  }
  paintDesign();
  loadDesignSystems();
  document.addEventListener("pro:me", loadDesignSystems);

  // ── Design system dialog: add (screenshot or pasted values), edit, view ────
  var dsDlg = $("st-ds-dlg");
  var dsForm = dsDlg.querySelector("form");
  var dsName = $("st-ds-name");
  var dsText = $("st-ds-content");
  var dsNotes = $("st-ds-notes");
  var dsErr = $("st-ds-err");
  var dsSave = $("st-ds-save");
  var dsNote = $("st-ds-note");
  var dsStatus = $("st-ds-status");
  var dsTabsEl = $("st-ds-tabs");
  var dsEditing = null;     // the custom system being edited, MODERN when viewing it, null when adding
  var dsSrc = "shot";
  var dsRun = 0;            // the extraction in flight; closing the dialog drops its result
  var dsBusy = false;
  var dsShots = C.attachments({ list: $("st-ds-imgs"), drop: dsDlg.querySelector(".st-ds-shot"), paste: dsForm, onChange: function () { if (dsShots) dsPaint(); } });
  var pickSrc = pillTabs(dsTabsEl, "data-src", function (v) { dsSrc = v; dsPaint(); });

  function dsCount() { $("st-ds-count").textContent = dsText.value.length.toLocaleString() + " / 20,000"; }
  function dsShowErr(t) { dsErr.textContent = t || ""; dsErr.hidden = !t; }
  function dsPaint() {
    var adding = !dsEditing;
    var viewing = dsEditing === MODERN;
    dsTabsEl.hidden = !adding;
    dsForm.querySelectorAll("[data-src-body]").forEach(function (el) {
      el.hidden = adding ? el.getAttribute("data-src-body") !== dsSrc : el.getAttribute("data-src-body") !== "paste";
    });
    dsName.readOnly = dsText.readOnly = viewing;
    $("st-ds-upload").parentNode.hidden = viewing;
    $("st-ds-del").hidden = adding || viewing;
    var extracting = adding && dsSrc === "shot";
    dsSave.textContent = viewing ? (hasPro ? "Duplicate to edit" : "Make your own") : extracting ? (dsBusy ? "Extracting…" : "Extract values") : dsEditing ? "Save changes" : "Save design system";
    dsSave.disabled = dsBusy || (extracting && !dsShots.count() && !dsNotes.value.trim());
    dsCount();
  }
  dsNotes.addEventListener("input", dsPaint);
  dsText.addEventListener("input", dsCount);

  function openDesign(ds) {
    var go = function () {
      dsRun++;
      dsBusy = false;
      dsEditing = ds;
      dsShowErr("");
      dsStatus.hidden = true;
      dsNote.hidden = !ds;
      dsNote.textContent = ds !== MODERN ? "" : hasPro ? "Built in. Duplicate it to make your own version." : "Built in. With Pro or Business you can start your own from it.";
      $("st-ds-title").textContent = !ds ? "Add a design system" : ds === MODERN ? "Modern" : "Edit design system";
      dsName.value = ds ? ds.name : "";
      dsText.value = ds && !ds.builtin ? ds.content : "";
      dsNotes.value = "";
      dsShots.clear();
      if (ds === MODERN) {
        dsText.value = "Loading…";
        modernText().then(function (t) { if (dsEditing === MODERN) { dsText.value = t; dsText.setSelectionRange(0, 0); dsText.scrollTop = 0; dsCount(); } });
      }
      if (!ds) { dsSrc = "shot"; pickSrc("shot", true); }
      dsPaint();
      showDialog(dsDlg);
      setTimeout(function () {
        if (!ds) pickSrc(dsSrc, true);
        (ds ? dsText : $("st-ds-drop")).focus();
        if (ds) { dsText.setSelectionRange(0, 0); dsText.scrollTop = 0; }
      }, 50);
    };
    if (ds === MODERN) go(); else C.withAccount(go);
  }
  function closeDesign() { dsRun++; dsBusy = false; hideDialog(dsDlg); }
  dsDlg.addEventListener("click", function (e) {
    if (e.target === dsDlg || e.target.closest("[data-close]")) closeDesign();
  });
  $("st-ds-drop").addEventListener("click", function () { $("st-ds-file").click(); });
  $("st-ds-file").addEventListener("change", function () { dsShots.add(this.files); this.value = ""; });
  $("st-ds-upload").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 200000) { dsShowErr("That file is too large. Paste the relevant part instead."); return; }
    f.text().then(function (text) {
      dsText.value = text.slice(0, 20000);
      if (!dsName.value.trim()) dsName.value = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 60);
      dsCount();
    });
  });

  function extract() {
    if (dsShots.busy()) { C.toast("Images are still loading."); return; }
    var run = ++dsRun;
    dsBusy = true;
    dsShowErr("");
    dsStatus.hidden = false;
    $("st-ds-status-text").textContent = "Reading the screenshot";
    dsPaint();
    C.api.extractDesignSystem(dsShots.items(), dsNotes.value.trim(), function (ev) {
      if (run !== dsRun || ev.type !== "status") return;
      $("st-ds-status-text").textContent = ev.text;
    }).then(function (r) {
      if (run !== dsRun) return;
      dsBusy = false;
      dsStatus.hidden = true;
      if (r.quota) paintQuota(r.quota);
      if (r.error || !r.content) { dsShowErr(C.errorText(r.error || "generation_failed")); dsPaint(); return; }
      dsName.value = r.name || "";
      dsText.value = r.content;
      dsNote.textContent = "Extracted from your screenshot. Check the values, edit anything, then save.";
      dsNote.hidden = false;
      dsSrc = "paste";
      pickSrc("paste", true);
      dsPaint();
      dsText.scrollTop = 0;
      dsName.focus();
    });
  }

  dsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (dsBusy) return;
    if (dsEditing === MODERN) {
      if (!hasPro) { closeDesign(); upsellDesign(); return; }
      var text = dsText.value;
      dsEditing = null;
      dsSrc = "paste";
      pickSrc("paste", true);
      $("st-ds-title").textContent = "Add a design system";
      dsName.value = "Modern copy";
      dsText.value = text;
      dsNote.hidden = true;
      C.withAccount(function () { dsPaint(); dsName.focus(); });
      return;
    }
    if (!dsEditing && dsSrc === "shot") { extract(); return; }
    dsBusy = true;
    dsPaint();
    C.api.saveDesignSystem({ id: dsEditing ? dsEditing.id : undefined, name: dsName.value.trim(), content: dsText.value }).then(function (r) {
      dsBusy = false;
      if (r.error) { dsShowErr(C.errorText(r.error)); dsPaint(); return; }
      var d = r.design_system;
      var i = designSystems.map(function (x) { return x.id; }).indexOf(d.id);
      if (i >= 0) designSystems[i] = d; else designSystems.unshift(d);
      ctx.ds = d.id;
      saveCtx();
      paintDesign();
      closeDesign();
      C.toast(dsEditing ? "Design system saved" : "“" + d.name + "” is now the design system");
    });
  });
  $("st-ds-del").addEventListener("click", function () {
    var d = dsEditing;
    if (!d || d === MODERN) return;
    C.confirm({ title: "Delete “" + d.name + "”?", body: "Components already made keep their look. The agent goes back to Modern if this one is picked.", ok: "Delete", danger: true }).then(function (ok) {
      if (!ok) return;
      C.api.deleteDesignSystem(d.id).then(function (r) {
        if (r.error) { dsShowErr(C.errorText(r.error)); return; }
        designSystems = designSystems.filter(function (x) { return x.id !== d.id; });
        if (ctx.ds === d.id) { ctx.ds = "modern"; saveCtx(); }
        paintDesign();
        closeDesign();
      });
    });
  });

  // ── Agent chat ──────────────────────────────────────────────────────────────
  // libraries.dev Studio transcript: your turns right in a chip, the agent's
  // as plain text, an applied change as a ruled receipt, errors in red.
  var aiForm = $("st-ai");
  var aiInput = $("st-ai-input");
  var aiSend = $("st-ai-send");
  var log = $("st-chat-log");
  var quotaEl = $("st-chat-quota");
  var busy = false;

  // Images for the agent: the Image chip, drag and drop on the panel, paste.
  var attach = C.attachments({ list: $("st-imgs"), drop: document.querySelector('[data-panel-body="agent"]'), paste: aiInput, onChange: function () { aiSize(); } });
  $("st-img-btn").addEventListener("click", function () { $("st-img-file").click(); });
  $("st-img-file").addEventListener("change", function () {
    attach.add(this.files);
    this.value = "";
    aiInput.focus();
  });

  function aiSize() {
    aiInput.style.height = "auto";
    aiInput.style.height = Math.min(aiInput.scrollHeight, 7 * 14 + 25) + "px";
    aiSend.disabled = (!aiInput.value.trim() && !(attach && attach.count())) || busy;
  }
  function submitAI() {
    if (aiSend.disabled) return;
    if (attach.busy()) { C.toast("Images are still loading."); return; }
    runAI(aiInput.value.trim(), attach.items());
  }
  aiInput.addEventListener("input", aiSize);
  aiInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitAI();
    }
  });
  aiForm.addEventListener("submit", function (e) { e.preventDefault(); submitAI(); });

  // Fade the bottom edge only while there is more transcript below.
  function fade() {
    var more = log.scrollHeight - log.scrollTop - log.clientHeight > 2;
    log.style.setProperty("--fade-bottom", more ? "36px" : "0px");
  }
  log.addEventListener("scroll", fade);

  function say(role, html) {
    var empty = $("st-chat-empty");
    if (empty) empty.remove();
    var el = document.createElement("p");
    el.className = "st-chat-msg";
    el.setAttribute("data-role", role);
    el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    fade();
    return el;
  }

  // Pending turn: the P28 thinking-states line, showing what the agent is
  // actually doing (the generate stream's steps), swapped with the
  // cross-blur. Each step stays up at least 700ms so it can be read; a
  // step's line count updates in place.
  function thinking(first) {
    var empty = $("st-chat-empty");
    if (empty) empty.remove();
    // The working line, and under it the agent's reasoning: collapsed to the
    // line's chevron, opened into a box that streams it with the library's
    // Reasoning stream motion (P29: masked viewport, 2-line steps).
    var wrap = document.createElement("div");
    wrap.className = "st-reason";
    wrap.innerHTML =
      '<div class="st-chat-thinking" aria-expanded="false">' +
        '<span class="st-think-dot" aria-hidden="true"></span>' +
        '<span class="st-think-swap"><span class="st-think-sizer" aria-hidden="true"></span></span>' +
        '<span class="st-think-meta" aria-hidden="true"></span>' +
        '<svg class="st-reason-chev" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</div>" +
      '<div class="st-reason-box"><div class="st-reason-inner"><div class="st-reason-card"><div class="st-reason-viewport">' +
        '<div class="st-reason-scroll"><p class="st-reason-text"></p></div>' +
      "</div></div></div></div>";
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    var row = wrap.querySelector(".st-chat-thinking");
    var viewport = wrap.querySelector(".st-reason-viewport");
    var scroller = wrap.querySelector(".st-reason-scroll");
    var reasonText = wrap.querySelector(".st-reason-text");
    var reason = "", open = false, offset = 0, stepTimer = null, started = Date.now(), finished = false;
    // P29 timing: a 2-line step over 500ms on the smooth-out ease, held 840ms.
    function stepReason() {
      clearTimeout(stepTimer);
      if (!open || finished) return;
      var lineH = parseFloat(getComputedStyle(reasonText).lineHeight) || 18;
      var max = Math.max(0, scroller.offsetHeight - viewport.clientHeight + lineH);
      if (offset < max) {
        offset = Math.min(max, offset + lineH * 2);
        scroller.style.transition = "transform 500ms cubic-bezier(0.22, 1, 0.36, 1)";
        scroller.style.transform = "translateY(" + -offset + "px)";
      }
      stepTimer = setTimeout(stepReason, 500 + 840);
    }
    function toggleReason() {
      if (!reason) return;
      open = !open;
      wrap.classList.toggle("is-open", open);
      row.setAttribute("aria-expanded", String(open));
      if (open && !finished) stepTimer = setTimeout(stepReason, 840);
      else clearTimeout(stepTimer);
    }
    row.addEventListener("click", toggleReason);
    row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleReason(); } });
    function thought(t) {
      if (!reason) {
        wrap.classList.add("has-reason");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.setAttribute("aria-label", "Show the agent's reasoning");
      }
      reason += t;
      reasonText.textContent = reason;
    }
    var swap = row.querySelector(".st-think-swap");
    var sizer = row.querySelector(".st-think-sizer");
    var meta = row.querySelector(".st-think-meta");
    var shown = null, next = null, lastSwap = 0, timer = null;
    function put(step) {
      var cur = swap.querySelector(".st-think-text:not(.is-exit)");
      var el = document.createElement("span");
      el.className = "st-think-text" + (cur ? " is-enter-start" : "");
      el.setAttribute("role", "status");
      el.textContent = step.text;
      el.setAttribute("data-text", step.text);
      sizer.textContent = step.text;
      swap.appendChild(el);
      meta.textContent = step.meta || "";
      if (cur) {
        cur.classList.add("is-exit");
        requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.remove("is-enter-start"); }); });
        setTimeout(function () { cur.remove(); }, 200);
      }
      shown = step.text;
      lastSwap = Date.now();
    }
    function set(text, metaText) {
      if (text === shown) { meta.textContent = metaText || ""; return; }
      next = { text: text, meta: metaText };
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        if (next && next.text !== shown) put(next);
        else if (next) meta.textContent = next.meta || "";
        next = null;
      }, shown ? Math.max(0, 700 - (Date.now() - lastSwap)) : 0);
    }
    set(first || "Sending your request");
    // Done: without reasoning the line goes; with it, the line stays as
    // "Thought for Ns", and the box scrolls freely.
    function stop() {
      clearTimeout(timer);
      clearTimeout(stepTimer);
      finished = true;
      if (!reason) { wrap.remove(); return; }
      reason = reason.trim();
      reasonText.textContent = reason;
      wrap.classList.add("is-done");
      scroller.style.transition = "none";
      scroller.style.transform = "none";
      var secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      swap.innerHTML = '<span class="st-think-done">Thought for ' + secs + "s</span>";
      meta.textContent = "";
    }
    return { set: set, row: wrap, thought: thought, stop: stop };
  }

  // The working pill on the preview: 16 dots, twinkling in the library's
  // Matrix dot loader order (P33), beside the agent's current step.
  (function buildDots() {
    var order = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];
    var html = "";
    for (var i = 0; i < 16; i++) html += '<i style="--d:' + Math.round(order[i] * 1200 / 16) + '"></i>';
    $("st-dots").innerHTML = html;
  })();
  function setWorking(text) { $("st-working-text").textContent = text; }

  function setBusy(on) {
    busy = on;
    preview.classList.toggle("is-working", on);
    if (on) setWorking("Working");
    if (on) aiForm.setAttribute("data-busy", ""); else aiForm.removeAttribute("data-busy");
    if (on) preview.setAttribute("aria-busy", "true"); else preview.removeAttribute("aria-busy");
    aiSize();
  }

  function paintQuota(q) {
    if (!q) return;
    quotaEl.textContent = q.remaining + " of " + q.limit + " drafts left this month";
    quotaEl.hidden = false;
  }

  // images: [{ media_type, data }]. With images and no text, the agent
  // builds (or restyles to) what the images show.
  function convertTo(m) {
    runAI(m === "react"
      ? "Convert this component to React: one TSX module with a default export and the same CSS, keeping its look, states and motion exactly."
      : "Convert this component to plain HTML, CSS and vanilla JS, keeping its look, states and motion exactly.", [], { mode: m });
  }

  // opts.mode: build in that format instead of the current one (a conversion).
  function runAI(text, images, opts) {
    images = images || [];
    opts = opts || {};
    if ((!text && !images.length) || busy) return;
    C.withAccount(function () {
      var fresh = isStarter() || (!S.files.html.trim() && !S.files.js.trim());
      if (!text) text = fresh ? "Build the component in the attached image." : "Update the component to match the attached image.";
      var picked = target;
      say("user", (images.length ? C.imageStrip(images) : "") +
        (picked ? '<code class="st-chat-target">' + C.esc(targetLabel(picked)) + "</code> " : "") + C.esc(text));
      aiInput.value = "";
      attach.clear();
      setBusy(true);
      var status = thinking();
      // The agent's plan (its thinking summary) streams into the working
      // line's reasoning box.
      function onEvent(ev) {
        if (ev.type === "status") {
          status.set(ev.text, ev.lines ? ev.lines + (ev.lines === 1 ? " line" : " lines") : "");
          setWorking(ev.text);
        }
        else if (ev.type === "thought" && ev.text) status.thought(ev.text);
      }
      var current = fresh ? null : { html: S.files.html, css: S.files.css, js: S.files.js };
      agentContext(text).catch(function (e) { return { error: e.message || "context_too_large" }; }).then(function (context) {
        if (context && context.error) return { error: context.error };
        return C.api.generate(text, opts.mode || S.mode, current, context, images, onEvent, picked);
      }).then(function (r) {
        status.stop();
        setBusy(false);
        if (r.error || !r.component) {
          say("error", C.esc(C.errorText(r.error || "generation_failed")));
          if (r.quota) paintQuota(r.quota);
          return;
        }
        var c = r.component;
        if (picked && target === picked) { target = null; paintTarget(); }
        var before = { html: S.files.html, css: S.files.css, js: S.files.js };
        if (opts.mode && opts.mode !== S.mode) S.stash[S.mode] = before;
        // The agent on someone else's component makes it your remix.
        if (!S.owner) remixOf({ id: S.id, title: S.title, mode: S.mode, html: S.files.html, css: S.files.css, js: S.files.js, author: S.author });
        if (fresh || S.title === "Untitled") S.title = c.title || S.title;
        if (c.description) S.description = c.description;
        S.mode = c.mode === "react" ? "react" : "html";
        S.files = { html: c.html || "", css: c.css || "", js: c.js || "" };
        S.file = S.mode === "react" ? "js" : "html";
        markDirty();
        editor.reload && editor.reload();
        paintHeader();
        paintTabs();
        paintLibs();
        render();
        if (controls) controls.refresh();
        say("agent", (fresh ? "Built " : "Updated ") + "<strong>" + C.esc(S.title) + "</strong>" + (c.description ? ". " + C.esc(c.description) : "."));
        // What the component cannot show, such as a libraries.dev Pro option left out.
        if (r.note) say("agent", C.esc(r.note));
        var changed = ["html", "css", "js"].filter(function (k) { return before[k] !== S.files[k] && S.files[k]; })
          .map(function (k) { return k === "js" ? (S.mode === "react" ? "Component" : "JS") : k.toUpperCase(); });
        if (changed.length) say("applied", "Changed " + changed.join(", "));
        paintQuota(r.quota);
      });
    });
  }

  aiSize();

  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__studioEval = { agentContext: agentContext, pickRecipes: pickRecipes, recipes: recipes };

  // Your community profile: the name in the credit line on your own work.
  function loadMe() {
    C.auth().then(function (st) {
      if (!st || !st.authenticated) { meProfile = null; paintCredit(); return; }
      C.api.me().then(function (r) {
        meProfile = (r && r.profile) || null;
        if (hasPro !== !!(r && r.pro)) { hasPro = !!(r && r.pro); paintSkills(); paintDesign(); }
        paintCredit();
        if (r && r.quota) paintQuota(r.quota);
      });
    });
  }
  document.addEventListener("pro:me", loadMe);
  loadMe();
  setInterval(paintCredit, 60000);

  // ── Boot ────────────────────────────────────────────────────────────────────
  function boot() {
    var id = params.get("id");
    var remix = params.get("remix");
    var lib = params.get("lib");
    if (id) {
      preview.setAttribute("aria-busy", "true");
      C.api.get(id, true).then(function (r) {
        preview.removeAttribute("aria-busy");
        if (r.error) {
          C.toast(r.error === "not_found" ? "That component is not available." : C.errorText(r.error), "err");
          startNew(null, false);
          history.replaceState(null, "", "studio.html");
          return;
        }
        apply(r);
      });
    } else if (remix) {
      C.api.get(remix).then(function (r) {
        if (r.error) { C.toast("That component is not available to remix.", "err"); startNew(null, false); return; }
        remixOf(r);
      });
    } else if (lib) {
      startNew("html", false);
      startFromLibrary(lib);
    } else if (params.get("ai") === "1") {
      // From the community composer: a prompt, images, and maybe a library
      // transition to remix first.
      var handoff = null;
      try { handoff = JSON.parse(sessionStorage.getItem("tdev:studio:ai") || "null"); sessionStorage.removeItem("tdev:studio:ai"); } catch (e) {}
      var fresh = handoff && Date.now() - (handoff.t || 0) < 10 * 60 * 1000;
      var images = fresh && Array.isArray(handoff.images) ? handoff.images.slice(0, 4) : [];
      var go = function () { if (fresh && (handoff.prompt || images.length)) runAI(String(handoff.prompt || ""), images); };
      if (fresh && handoff.lib) {
        startNew("html", false);
        startFromLibrary(String(handoff.lib)).then(function (ok) { if (ok) go(); });
      } else {
        startNew(params.get("mode") === "react" ? "react" : "html", false);
        history.replaceState(null, "", "studio.html");
        go();
      }
    } else {
      startNew(params.get("mode"), !params.get("mode"));
      if (params.get("pick") === "library") openLibrary();
    }
  }

  boot();

  // Upgrade the textarea to CodeMirror once it loads; keep the textarea if not.
  loadCodeMirror().then(function (cmEditor) {
    editor.destroy();
    editor = cmEditor;
    paintTabs();
  }).catch(function (e) {
    console.warn("[studio] code editor unavailable, using plain text", e);
  });
})();
