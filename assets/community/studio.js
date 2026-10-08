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

  // A new component starts empty: no sample button, the agent builds the first one.
  var STARTER = {
    html: { html: "", css: "", js: "" },
    react: { html: "", css: "", js: "" },
  };
  // The sample buttons new components used to start with ("Hover me", "Save"):
  // a scratch still holding one starts empty too.
  function legacyStarter(f) {
    return !!f && ((/>Hover me<\/button>/.test(f.html || "") && /^\.pill \{/.test(f.css || "")) ||
      (/export default function SaveButton\(\)/.test(f.js || "") && /^\.save \{/.test(f.css || "")));
  }

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
    return { title: S.title, description: S.description, mode: S.mode, html: S.files.html, css: S.files.css, js: S.files.js, ai: !!S.ai };
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
    var btns = tabsEl.querySelectorAll("button[data-file]");
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
    $("st-file-copy").setAttribute("aria-label", "Copy " + (S.file === "js" ? (S.mode === "react" ? "component" : "JS") : S.file.toUpperCase()));
    editor.show(S.file);
  }

  tabsEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-file]");
    if (!b) return;
    S.file = b.getAttribute("data-file");
    paintTabs();
  });

  // Copy the open file.
  var fileCopyTimer = null;
  $("st-file-copy").addEventListener("click", function () {
    var btn = this;
    navigator.clipboard.writeText(S.files[S.file] || "").then(function () {
      btn.setAttribute("data-copied", "true");
      clearTimeout(fileCopyTimer);
      fileCopyTimer = setTimeout(function () { btn.setAttribute("data-copied", "false"); }, 1400);
    }, function () { C.toast("Could not copy"); });
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

  // The preview's layout check (text running under a button): shown once
  // after an agent build, and sent with the next request so the agent fixes it.
  var layoutIssues = [], sayLayout = false;
  function render() {
    logs = [];
    layoutIssues = []; sayLayout = false;
    consoleEl.hidden = true;
    consoleEl.textContent = "";
    // Nothing written yet: an empty stage (an empty React module would not compile).
    var empty = !S.files.html.trim() && !S.files.css.trim() && !S.files.js.trim();
    C.mountPreview(preview, { mode: empty ? "html" : S.mode, html: S.files.html, css: S.files.css, js: S.files.js, title: S.title }, {
      onMessage: function (m) {
        if (m.type === "error") showConsole("error", m.message + (m.line ? " (line " + m.line + ")" : ""));
        if (m.type === "console") showConsole(m.level === "error" ? "error" : "log", m.text);
        // A fresh preview frame starts outside select mode.
        if (m.type === "ready" && tool === "select") C.tellPreview(preview, { type: "select", on: true });
        if (m.type === "selected") onSelected(m);
        if (m.type === "snapshot" && snapWait) snapWait(m);
        if (m.type === "layout") {
          layoutIssues = (m.issues || []).slice(0, 8);
          if (sayLayout && layoutIssues.length) {
            sayLayout = false;
            say("scan", "Layout check · " + layoutIssues.length + (layoutIssues.length === 1 ? " issue" : " issues") +
              layoutIssues.slice(0, 3).map(function (t) { return '<span class="st-scan-issue">' + C.esc(String(t).split(/(?<=\.)\s/)[0]) + "</span>"; }).join("") +
              '<span class="st-scan-issue">The agent fixes it with your next change.</span>');
          }
        }
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
  // The title input is as wide as its text, so the credit can follow it on
  // the same line.
  var measureCtx = document.createElement("canvas").getContext("2d");
  function fitTitle() {
    var cs = getComputedStyle(titleEl);
    measureCtx.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    var w = measureCtx.measureText(titleEl.value || titleEl.placeholder || "Untitled").width;
    titleEl.style.width = Math.ceil(w + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2) + "px";
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle);
  titleEl.addEventListener("input", function () { S.title = titleEl.value; fitTitle(); markDirty(); });
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

  // The author's view of review and moderation: waiting for review, not
  // approved (with the reviewer's reason), or hidden after reports (the
  // statement of reasons and a way to ask for a review, EU Digital Services
  // Act). A reviewer opening it from the admin page gets Approve / Reject.
  function moderationState() {
    if (S.reviewer) return "reviewer";
    if (!S.owner) return "";
    if (S.hidden) return "hidden";
    if (S.review === "rejected") return "rejected";
    if (S.published && S.review === "pending") return "pending";
    return "";
  }
  function paintModeration() {
    var el = $("st-mod");
    var state = moderationState();
    if (!state) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "st-mod";
      el.setAttribute("role", "status");
      document.querySelector(".st-work").before(el);
    }
    el.className = "st-mod" + (state === "pending" || state === "reviewer" ? " st-mod--review" : "");
    el.hidden = false;
    if (state === "pending") {
      el.innerHTML = "<p><b>In review.</b> A person checks every new component before it appears in the Community. " +
        "Only you can see it until then, and we’ll email you when it’s live.</p>";
      return;
    }
    if (state === "rejected") {
      el.innerHTML = "<p><b>Not approved.</b> " + C.esc(S.reviewReason || "") +
        " Change it and publish again to send it for another review.</p>";
      return;
    }
    if (state === "reviewer") { paintReviewer(el); return; }
    el.innerHTML = '<p><b>Hidden from the Community.</b> ' + C.esc(S.hiddenReason || "") + "</p>" +
      '<button type="button" class="cm-btn" id="st-appeal">Ask for a review</button>';
    $("st-appeal").addEventListener("click", function () {
      C.ask({
        title: "Ask for a review",
        body: "Tell us why it should be visible again. A person reviews it and emails you the outcome.",
        placeholder: "What we got wrong",
        max: 1000,
        ok: "Send",
      }).then(function (message) {
        if (!message) return;
        C.api.appeal(S.id, message).then(function (r) {
          C.toast(r.error ? C.errorText(r.error) : "Sent. We will email you the outcome.", r.error ? "err" : undefined);
        });
      });
    });
  }

  // Review mode (studio.html?id=...&review=1 from the admin page): the
  // component read-only, what the automated checks found, and the decision.
  // Uses the admin token the admin page keeps in this browser.
  var ADMIN_TOKEN_KEY = "tdev:admin-token";
  function adminToken() { try { return localStorage.getItem(ADMIN_TOKEN_KEY) || ""; } catch (e) { return ""; } }
  function adminCall(path, body) {
    return fetch(C.apiUrl(path), {
      method: body ? "POST" : "GET",
      headers: body ? { Authorization: "Bearer " + adminToken(), "content-type": "application/json" } : { Authorization: "Bearer " + adminToken() },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    }).then(function (r) { return r.json(); }).catch(function () { return { error: "network" }; });
  }
  function paintReviewer(el) {
    var flags = (S.reviewFlags || []).map(function (f) { return "<li>" + C.esc(f.label) + "</li>"; }).join("");
    var label = { pending: "Waiting for review", approved: "Approved", rejected: "Rejected", none: "Draft" }[S.review] || S.review;
    // The author's profile goes public with their first approved component,
    // so it is reviewed here too: name, handle, photo, bio, X link.
    var p = S.authorProfile;
    var who = p
      ? '<div class="st-mod-author">' +
          (p.avatar ? '<img alt="" src="' + C.esc(p.avatar) + '">' : "") +
          "<span><b>" + C.esc(p.display_name || "(no name)") + "</b> @" + C.esc(p.handle) +
          (p.x_handle ? " · x.com/" + C.esc(p.x_handle) : "") +
          (p.public_components ? " · " + p.public_components + " public" : " · first component: the profile goes public with it") +
          (p.avatar_review === "pending" ? " · photo waiting for review" : "") +
          (p.bio ? "<br>" + C.esc(p.bio) : "") + "</span></div>"
      : "";
    el.innerHTML = "<div><p><b>Reviewing.</b> " + C.esc(label) +
      (S.description ? " · " + C.esc(S.description) : "") + "</p>" + who +
      (flags ? '<ul class="st-mod-flags">' + flags + "</ul>" : "<p>The automated checks found nothing to look at.</p>") + "</div>" +
      '<span class="st-mod-actions"><button type="button" class="cm-btn" id="st-reject">Reject</button>' +
      '<button type="button" class="cm-btn cm-btn--primary" id="st-approve">Approve</button></span>';
    function decide(approve, reason) {
      adminCall("/admin/community/review", { id: S.id, approve: approve, reason: reason }).then(function (r) {
        if (r.error) { C.toast(C.errorText(r.error), "err"); return; }
        S.review = r.review;
        paintModeration();
        C.toast(approve ? "Approved. It's public now." : "Rejected. The author has the reason by email.");
      });
    }
    $("st-approve").addEventListener("click", function () { decide(true); });
    $("st-reject").addEventListener("click", function () {
      C.ask({
        title: "Reject this component",
        body: "The author gets this reason by email and sees it in the Studio.",
        placeholder: "It doesn't meet the Community rules in our Terms.",
        max: 400,
        ok: "Reject",
      }).then(function (reason) {
        if (reason === null || reason === undefined || reason === false) return;
        decide(false, String(reason));
      });
    });
  }

  // A report is a notice under the EU Digital Services Act: what kind of
  // problem, why, and a good-faith statement. The account says who sent it.
  function reportDialog() {
    return new Promise(function (resolve) {
      var last = document.activeElement;
      var wrap = document.createElement("div");
      wrap.className = "st-dialog cm-ask";
      wrap.innerHTML =
        '<form class="st-dialog-card cm-ask-card st-report" role="dialog" aria-modal="true" aria-labelledby="st-report-title" novalidate>' +
          '<h2 id="st-report-title">Report this component</h2>' +
          '<label class="st-field"><span>What is wrong</span><select class="cm-ask-input st-report-cat">' +
            '<option value="illegal">Illegal content</option>' +
            '<option value="ip">Copyright or stolen work</option>' +
            '<option value="harmful">Harmful or abusive content</option>' +
            '<option value="spam">Spam or misleading</option>' +
            '<option value="other" selected>Something else</option>' +
          "</select></label>" +
          '<label class="st-field"><span>Why</span><textarea class="cm-ask-input st-report-why" rows="3" maxlength="500" placeholder="Explain what breaks the rules or the law, and where"></textarea></label>' +
          '<label class="st-report-check"><input type="checkbox" class="st-report-ok" /> <span>I believe the information in this report is accurate and complete.</span></label>' +
          '<p class="st-report-note">We email you a receipt and our decision. The author is not told who reported it.</p>' +
          '<div class="cm-ask-row"><button type="button" class="cm-btn cm-btn--ghost" data-no>Cancel</button>' +
          '<button type="submit" class="cm-btn cm-btn--primary" disabled>Report</button></div>' +
        "</form>";
      document.body.appendChild(wrap);
      var form = wrap.querySelector("form");
      var why = wrap.querySelector(".st-report-why");
      var ok = wrap.querySelector(".st-report-ok");
      var submit = wrap.querySelector("[type=submit]");
      function sync() { submit.disabled = !why.value.trim() || !ok.checked; }
      why.addEventListener("input", sync);
      ok.addEventListener("change", sync);
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        wrap.classList.remove("is-open");
        document.removeEventListener("keydown", onKey, true);
        setTimeout(function () { wrap.remove(); if (last && last.focus) last.focus(); }, 200);
        resolve(v);
      }
      function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); finish(null); } }
      document.addEventListener("keydown", onKey, true);
      wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) finish(null); });
      wrap.querySelector("[data-no]").addEventListener("click", function () { finish(null); });
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (submit.disabled) return;
        finish({ category: wrap.querySelector(".st-report-cat").value, reason: why.value.trim(), good_faith: true });
      });
      requestAnimationFrame(function () { wrap.classList.add("is-open"); });
      setTimeout(function () { wrap.querySelector(".st-report-cat").focus(); }, 30);
    });
  }

  // Publishing makes the component and your profile public, so say exactly
  // what others will see before the first time (GDPR: transparency, nothing
  // public without your action).
  function confirmPublish() {
    if (S.published) return Promise.resolve(true);
    var p = meProfile;
    var who = p ? (p.display_name ? p.display_name + " (@" + p.handle + ")" : "@" + p.handle) : "your profile";
    return C.confirm({
      title: "Publish to the Community?",
      body: "A person reviews it first, then anyone can see it, open its code and remix it. It shows " + who + (p && p.avatar_url ? " and your profile photo" : "") +
        ". Change your name on your profile or account page. You can unpublish or delete it at any time.",
      ok: "Publish",
    });
  }

  function paintHeader() {
    paintModeration();
    titleEl.value = S.title;
    titleEl.readOnly = !S.owner;
    fitTitle();
    paintCredit();

    document.querySelectorAll("[data-edit]").forEach(function (el) { el.hidden = !S.owner; });
    document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = S.owner; });
    document.querySelectorAll("[data-owner]").forEach(function (el) {
      el.hidden = !(S.owner && S.id) || (el.getAttribute("data-act") === "unpublish" && !S.published);
    });
    document.querySelectorAll("[data-viewer]").forEach(function (el) { el.hidden = S.owner; });
    // Copy link: any saved component, published or not (a link opens drafts too).
    document.querySelectorAll("[data-needs-id]").forEach(function (el) { el.hidden = !S.id; });
    var dangerRule = document.querySelector("[data-danger-rule]");
    if (dangerRule) dangerRule.hidden = !menu.querySelector(".is-danger:not([hidden])");
    $("st-save").textContent = S.published ? "Save changes" : "Save draft";
    $("st-save").className = "cm-btn" + (S.published ? " cm-btn--primary" : "");
    $("st-publish").hidden = !S.owner || S.published;
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
    // Whether the agent worked on it travels with the code (recorded, not shown);
    // moderation state is the author's alone.
    S.ai = !!c.ai;
    S.hidden = !opts.asNew && !!c.hidden;
    S.hiddenReason = opts.asNew ? "" : c.hidden_reason || "";
    S.review = opts.asNew ? "none" : c.review || (c.published ? "approved" : "none");
    S.reviewReason = opts.asNew ? "" : c.review_reason || "";
    S.reviewFlags = opts.asNew ? [] : c.review_flags || [];
    S.reviewer = !opts.asNew && !!opts.reviewer;
    S.authorProfile = opts.reviewer ? c.author_profile || null : null;
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
    if (restored && restored.s && legacyStarter(restored.s)) restored = null;
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
      // The remix is now an unsaved draft kept in local storage; a plain URL
      // means a reload restores it instead of starting from the card again.
      history.replaceState(null, "", "studio.html");
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
    if (!libsDlg.hidden) hideDialog(libsDlg);
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

  // Free accounts keep 10 private drafts at a time (published work does not
  // count). The work stays in the Studio, and in this browser when it is new.
  function draftLimit(d, unpublishing) {
    var n = (d && d.limit) || 10;
    C.confirm({
      title: "You have " + n + " private drafts",
      body: (unpublishing ? "Unpublishing makes this a private draft. " : "") +
        "Free accounts keep " + n + " private drafts at a time, and published components don’t count. " +
        "Publish or delete a draft to make room, or get Pro for unlimited private drafts." +
        (!S.id && !unpublishing ? " This one stays here in your browser until you save it." : ""),
      ok: "Get Pro",
      alt: "Manage drafts",
      cancel: "Not now",
    }).then(function (v) {
      if (v === true) location.href = "pro.html";
      else if (v === "alt") window.open("projects.html?show=drafts", "_blank", "noopener");
    });
  }

  // then: runs after a successful save.
  function save(publish, btn, then) {
    C.withAccount(function () {
      if (btn) btn.disabled = true;
      var req = S.id ? C.api.update(S.id, payload(publish)) : C.api.create(payload(!!publish));
      req.then(function (r) {
        if (btn) btn.disabled = false;
        if (r.error) {
          if (r.error === "not_found" && S.id) {
            // Signed in as someone else since opening: keep the work as a new copy.
            S.id = null;
            return save(publish, btn, then);
          }
          if (r.error === "draft_limit") { draftLimit(r.drafts, publish === false); return; }
          C.toast(r.message || C.errorText(r.error), "err");
          return;
        }
        var wasNew = !S.id;
        S.id = r.id;
        S.owner = true;
        S.published = !!r.published;
        var wasReview = S.review;
        if (r.review) S.review = r.review;
        if (r.review !== "rejected") S.reviewReason = "";
        if (wasNew) {
          try { localStorage.removeItem(SCRATCH_KEY); } catch (e) {}
          history.replaceState(null, "", "studio.html?id=" + encodeURIComponent(r.id));
        }
        markSaved("Saved");
        paintHeader();
        if (publish === true) C.toast(S.review === "approved" ? "Published to the Community" : "Sent for review. We’ll email you when it’s live.");
        else if (publish === false) C.toast("Unpublished. Only you can see it now.");
        else if (wasReview === "approved" && S.review === "pending") C.toast("Saved. This change goes to review before it’s public again.");
        if (then) then();
      });
    });
  }
  $("st-save").addEventListener("click", function () { save(undefined, this); });
  $("st-publish").addEventListener("click", function () {
    var btn = this;
    confirmPublish().then(function (ok) { if (ok) save(true, btn); });
  });
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (S.owner) save(undefined, $("st-save"));
    }
  });

  // ── View mode actions ───────────────────────────────────────────────────────

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
    // Only real imports (import … from "x", import "x", import("x")) with a
    // valid package name: a string like ["--from" as any] is not one.
    var re = /(?:^|[;\n])\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"'./][^"']*)["']|\bimport\s*\(?\s*["']([^"'./][^"']*)["']/g, m;
    while ((m = re.exec(S.files.js))) {
      var name = m[1] || m[2];
      if (!/^(@[a-z0-9-~][\w.-]*\/)?[a-z0-9-~][\w.-]*(\/[\w./-]*)?$/i.test(name)) continue;
      var spec = name.match(/^(@[^/]+\/[^/]+|[^/]+)/)[1];
      if (spec === "react" || spec === "react-dom" || pkgs.indexOf(spec) >= 0) continue;
      pkgs.push(spec);
    }
    var pins = (C.preinstalled || {});
    var install = pkgs.map(function (p) { return pins[p] ? p + "@" + pins[p] : p; });
    if (pkgs.indexOf("img-fx") >= 0 && install.indexOf("three@" + pins.three) < 0) install.push("three@" + pins.three);
    var url = S.id && S.published && S.review === "approved" ? location.origin + "/studio.html?id=" + encodeURIComponent(S.id) : "";
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
      // The credit line (author, date, remix source) lives here,
      // not in the header.
      var credit = document.createElement("div");
      credit.innerHTML = $("st-credit").innerHTML;
      var about = [S.description, credit.textContent.trim()].filter(Boolean).join("\n\n");
      C.confirm({ title: S.title || "Untitled", body: about, ok: "Close", cancel: false });
    } else if (act === "link") {
      navigator.clipboard.writeText(location.origin + "/studio.html?id=" + encodeURIComponent(S.id)).then(function () { C.confirmToast("Link copied"); });
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
        reportDialog().then(function (rep) {
          if (!rep) return;
          C.api.report(S.id, rep).then(function (r) {
            C.toast(r.error ? C.errorText(r.error) : "Thanks. We emailed you a receipt and will tell you what we decide.", r.error ? "err" : undefined);
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
    { id: "builtin", name: "Transitions.dev", sub: "UI motion skill", file: "transitions-dev.md?v=1" },
    { id: "polish", name: "Make interfaces feel better", sub: "By Jakub Krehel", file: "make-interfaces-feel-better.md?v=1" },
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
  var ICON_EXT = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v2.5a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5h2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_SPARK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3L8 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12.5 11v3M11 12.5h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var ICON_STAR = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M7.5 2.3c.2-.4.8-.4 1 0l1.4 2.9 3.2.5c.5.1.7.6.3 1l-2.3 2.2.5 3.2c.1.5-.4.8-.8.6L8 11.2l-2.9 1.5c-.4.2-.9-.1-.8-.6l.5-3.2L2.6 6.7c-.4-.4-.2-.9.3-1l3.2-.5 1.4-2.9Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  // Library glyphs: flat, one colour, same box as the skill rows.
  var LIB_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">';
  var LIB_ICONS = {
    beam: LIB_SVG + '<rect x="2.5" y="2.5" width="11" height="11" rx="3"/><path d="M9 2.5h1.5a3 3 0 0 1 3 3V7" stroke-width="2.2"/></svg>',
    orbs: LIB_SVG + '<circle cx="8" cy="8" r="5" stroke-dasharray="0.1 2.6" stroke-width="1.8"/></svg>',
    gooey: LIB_SVG + '<circle cx="5.5" cy="8" r="3"/><circle cx="10.5" cy="8" r="3"/></svg>',
    voice: LIB_SVG + '<path d="M3 7v2M5.5 5v6M8 3v10M10.5 5v6M13 7v2"/></svg>',
    bots: LIB_SVG + '<rect x="3" y="4.5" width="10" height="8" rx="2.5"/><path d="M8 2.5v2"/><circle cx="6" cy="8.5" r=".6" fill="currentColor"/><circle cx="10" cy="8.5" r=".6" fill="currentColor"/></svg>',
    metal: LIB_SVG + '<path d="M8 2.5c2.3 3 3.8 5 3.8 7a3.8 3.8 0 0 1-7.6 0c0-2 1.5-4 3.8-7Z"/><path d="M6.4 10.2a1.7 1.7 0 0 0 1.4 1.4"/></svg>',
    image: LIB_SVG + '<rect x="2.5" y="3" width="11" height="10" rx="2"/><circle cx="6" cy="6.5" r="1"/><path d="m3 11.5 3-3 2.5 2.5 1.5-1.5 2.5 2.5"/></svg>',
  };
  var ICON_PLUS = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" width="16" height="16" style="margin-right:8px;flex:none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';

  function sw(on, label) {
    return '<button type="button" class="st-check" role="menuitemcheckbox" aria-checked="' + (on ? "true" : "false") + '" aria-label="' + C.esc(label) + '"></button>';
  }

  var skillsMenu = $("st-skills-menu");
  var libsDlg = $("st-libs-dlg");
  var libsList = $("st-libs-list");
  var setSkillsMenu = dropdown($("st-skills-btn"), skillsMenu);
  $("st-libs-btn").addEventListener("click", function () { paintLibs(); showDialog(libsDlg); });
  libsDlg.addEventListener("click", function (e) {
    if (e.target === libsDlg || e.target.closest("[data-close]")) hideDialog(libsDlg);
  });

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
    // Libraries are for every account (free tier of each library).
    libsList.innerHTML = libraries.map(function (l) {
      var on = !!ctx.libs[l.id];
      return '<div class="tl-menu-item st-pop-row st-lib-row" role="listitem" data-lib="' + C.esc(l.id) + '">' +
        '<span class="st-pop-ico" aria-hidden="true">' + (LIB_ICONS[l.id] || ICON_BOOK) + "</span>" +
        '<span class="st-pop-main"><b>' + C.esc(l.name) + "</b><span><code>" + C.esc(l.pkg) + "</code> · " + C.esc(l.desc) + "</span></span>" +
        '<a class="st-pop-act" href="https://libraries.dev/' + C.esc(l.id) + '.html" target="_blank" rel="noopener"' +
          ' aria-label="Open ' + C.esc(l.name) + ' on libraries.dev (new tab)" title="Open on libraries.dev">' + ICON_EXT + "</a>" +
        '<button type="button" class="st-check" role="switch" aria-checked="' + on + '"' +
          ' aria-label="Add ' + C.esc(l.name) + ' to the agent"></button></div>';
    }).join("");
    var note = $("st-libs-note");
    note.hidden = react;
    note.innerHTML = react ? "" : 'Libraries are React components. <button type="button" data-react>Switch to React</button>';
    paintCounts();
  }

  libsDlg.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("[data-react]")) {
      hideDialog(libsDlg);
      var reactBtn = modeMenu.querySelector('[data-mode="react"]');
      if (reactBtn && S.owner) reactBtn.click();
      return;
    }
    // The libraries.dev link opens in a new tab without toggling the row.
    if (t.closest("a.st-pop-act")) return;
    var row = t.closest("[data-lib]");
    if (!row) return;
    var id = row.getAttribute("data-lib");
    ctx.libs[id] = !ctx.libs[id];
    saveCtx();
    row.querySelector(".st-check").setAttribute("aria-checked", String(!!ctx.libs[id]));
    paintCounts();
  });

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

  // The transitions.dev recipes that fit this request best: scored by their
  // trigger words in the request (strongly) and in the current component
  // (lightly), up to five. The agent gets every recipe from the API; these
  // are named as a hint so it reaches for the right ones first.
  var recipesP = null;
  function recipes() {
    if (!recipesP) recipesP = fetch("assets/community/skills/recipes.json?v=12").then(function (r) { return r.ok ? r.json() : []; }).catch(function () { recipesP = null; return []; });
    return recipesP;
  }
  function pickRecipes(list, request) {
    var ask = " " + String(request || "").toLowerCase() + " ";
    var code = (" " + S.files.html + " " + S.files.css + " " + S.files.js + " ").toLowerCase();
    function has(hay, w) {
      // Whole words with their usual endings: swap, swaps, swapped, swapping.
      if (/^[\w ]+$/.test(w)) return new RegExp("[^a-z0-9]" + w.replace(/ /g, "[ -]") + "(?:s|es|d|ed|[a-z]?ing)?[^a-z0-9]").test(hay);
      return hay.indexOf(w) >= 0;
    }
    var scored = list.map(function (r) {
      var fromAsk = r.triggers.filter(function (w) { return has(ask, w); }).length;
      var inCode = r.triggers.filter(function (w) { return w.length >= 4 && has(code, w); }).length;
      return { r: r, score: fromAsk * 3 + Math.min(2, inCode), inCode: inCode };
    }).filter(function (x) { return x.score >= 2; });
    // Ties (an edit whose request names no pattern) go to the recipe the
    // current code matches most, so a component's own toggles get theirs.
    scored.sort(function (a, b) { return b.score - a.score || b.inCode - a.inCode; });
    var out = [];
    scored.forEach(function (x) {
      if (out.length >= 5) return;
      out.push(x.r);
    });
    return out;
  }

  // What the agent reads besides the request, in the order it should weigh it.
  // mode: the format this draft builds in (a conversion may differ from S.mode).
  function agentContext(request, mode) {
    var on = BUILTINS.filter(function (b) { return skillOn(b.id); });
    var withRecipes = skillOn("builtin");
    var ds = dsCurrent();
    // Built-in skills, Modern and the recipes go by id: the API holds their
    // text in its cached system prompt, so nothing large is uploaded or
    // billed again per draft. Only the recipe list is read here, for the hint.
    return (withRecipes ? recipes() : Promise.resolve([])).then(function (list) {
      var items = [];
      items.push({ kind: "design_system", id: ds.builtin ? "modern" : ds.id, name: ds.name });
      on.forEach(function (b) { items.push({ kind: "builtin", id: b.id, name: b.name }); });
      // Every recipe goes with the draft (the API keeps them in its cached
      // system prompt); the page only names the ones that fit best.
      if (withRecipes) items.push({ kind: "recipes", ids: pickRecipes(list, request).map(function (r) { return r.id; }) });
      // The API builds this one from the paid recipes; the page only asks.
      if (proOn()) items.push({ kind: "pro", name: "Transitions Pro" });
      customSkills.forEach(function (k) { if (skillOn(k.id)) items.push({ kind: "skill", name: k.name, content: k.content }); });
      if ((mode || S.mode) === "react" && libraries.length) {
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
    id: "modern", name: "Modern", builtin: true, file: "modern.md?v=24",
    sub: "Default · the transitions.dev look",
    spec: {
      light: { bg: "#f9f9f9", surface: "#ffffff", text: "#0d0d0d", muted: "#6c6c6c", accent: "#17181c", onAccent: "#ffffff", radius: "40px" },
      dark: { bg: "#131313", surface: "#1d1d1d", text: "#f2f2f2", muted: "rgba(202, 202, 202, .7)", accent: "#ffffff", onAccent: "#0d0d0d", radius: "40px" },
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
      '<span class="st-ds-spec-check"><svg viewBox="0 0 16 16" fill="none"><path d="M4 8.4268L6.46155 11.19223L12 4.97001" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
    "</span>";
  }

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
        '<button type="button" class="st-pop-act st-ds-act" data-ds-open="' + C.esc(ds.id) + '" aria-label="Edit ' + C.esc(ds.name) + '" title="Edit">' +
          ICON_EDIT + "</button>" +
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

  // ── Design system dialog: add (screenshot, style or values), edit, view ────
  // Tabs: Screenshot (adding only; the agent extracts values), Style (colors,
  // text sizes and the basic elements, set visually) and Code (the values as
  // text). Style writes a ds:style block at the top of the values, which the
  // agent reads like any other text. Editing and saving is Pro and Business;
  // the primary action always saves a new design system.
  var dsDlg = $("st-ds-dlg");
  var dsForm = dsDlg.querySelector("form");
  var dsName = $("st-ds-name");
  var dsText = $("st-ds-content");
  var dsNotes = $("st-ds-notes");
  var dsErr = $("st-ds-err");
  var dsSave = $("st-ds-save");
  var dsUpdate = $("st-ds-update");
  var dsNote = $("st-ds-note");
  var dsStatus = $("st-ds-status");
  var dsTabsEl = $("st-ds-tabs");
  var dsEditing = null;     // the custom system being edited, MODERN when viewing it, null when adding
  var dsSrc = "shot";
  var dsRun = 0;            // the extraction in flight; closing the dialog drops its result
  var dsBusy = false;
  var dsShots = C.attachments({ list: $("st-ds-imgs"), drop: dsDlg.querySelector(".st-ds-shot"), paste: dsForm, onChange: function () { if (dsShots) dsPaint(); } });
  var pickSrc = pillTabs(dsTabsEl, "data-src", function (v) {
    if (v === "style") styleFromText();
    dsSrc = v;
    dsPaint();
  });

  // ── Style model ──
  var SHADOWS = {
    none: { label: "None", light: "none", dark: "none" },
    // The site's CTA (.cm-btn--primary): a soft drop under the button.
    cta: { label: "CTA", light: "0 1px 2px 0 rgba(0,0,0,.2)", dark: "0 1px 2px 0 rgba(0,0,0,.4)" },
    hairline: { label: "Hairline", light: "0 0 0 1px {border}", dark: "0 0 0 1px {border}" },
    soft: { label: "Soft", light: "0 0 0 1px rgba(0,0,0,.04), 0 8px 32px -4px rgba(0,0,0,.06), 0 1px 3px 0 rgba(0,0,0,.04)", dark: "0 1px 3px rgba(0,0,0,.3), inset 0 0 0 1px rgba(255,255,255,.08)" },
    raised: { label: "Raised", light: "0 4px 42px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.05), 0 0 0 1px rgba(0,0,0,.06)", dark: "0 8px 32px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.04), inset 0 0 0 1px rgba(196,196,196,.08)" },
    lifted: { label: "Lifted", light: "0 1px 2px rgba(0,0,0,.12), 0 2px 6px rgba(0,0,0,.08), inset 0 1px 0 rgba(255,255,255,.14)", dark: "0 1px 2px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.12)" },
  };
  var COLOR_ROLES = [
    ["bg", "Background", "the page or stage"],
    ["surface", "Surface", "cards, menus, inputs"],
    ["text", "Text", ""],
    ["muted", "Secondary text", "and icons"],
    ["border", "Hairline", "dividers and outlines"],
    ["accent", "Accent", "primary buttons, focus"],
    ["onAccent", "On accent", "text on the accent"],
    ["accentSoft", "Accent soft", "badges, chips, selected rows"],
    ["onAccentSoft", "On accent soft", "text on accent soft"],
  ];
  function styleDefaults() {
    return {
      v: 1,
      // Accent: the transitions.dev CTA (.cm-btn--primary), ink in light and
      // white in dark. Accent soft: the blue wash on the Pro badge and chips.
      light: { bg: "#f9f9f9", surface: "#ffffff", text: "#0d0d0d", muted: "#6c6c6c", border: "rgba(0,0,0,.08)", accent: "#17181c", onAccent: "#ffffff", accentSoft: "rgba(0,115,229,.06)", onAccentSoft: "rgba(0,83,227,.8)" },
      dark: { bg: "#131313", surface: "#1d1d1d", text: "#f2f2f2", muted: "rgba(202,202,202,.7)", border: "rgba(255,255,255,.08)", accent: "#ffffff", onAccent: "#0d0d0d", accentSoft: "rgba(0,115,229,.16)", onAccentSoft: "rgba(122,168,255,.95)" },
      font: "Inter",
      // The UI design guidelines' scale: caption 12, body 13, title 16, display 28.
      type: { small: 12, body: 13, title: 16, display: 28 },
      shape: { roundness: 50, pill: true, tiny: 5 },
      // Accent fill: with the default accent that is the transitions.dev CTA.
      button: { fill: "accent", height: 36, radius: 40, shadow: "cta" },
      card: { padding: 24, radius: 24, shadow: "soft" },
      input: { height: 36, radius: 10, shadow: "hairline" },
    };
  }
  // One Corner radius control for every size of thing: tiny (chips, badges,
  // menu items), small (inputs, buttons) and large (cards, menus, dialogs)
  // grow together, 0 sharp to 100 soft; 50 is Modern (5, 10, 24 px). Pill
  // buttons ignore it. The fields under Elements can still fine-tune. 50 is
  // the guidelines' default card: 24px corners.
  function radii(roundness) {
    var r = roundness / 100;
    return { tiny: Math.round(10 * r), small: Math.round(20 * r), large: Math.round(48 * r) };
  }
  function applyRoundness() {
    var rr = radii(dsStyle.shape.roundness);
    dsStyle.shape.tiny = rr.tiny;
    dsStyle.input.radius = rr.small;
    dsStyle.card.radius = rr.large;
    dsStyle.button.radius = dsStyle.shape.pill ? 40 : rr.small;
  }
  var dsStyle = styleDefaults();
  var styleTouched = false;  // the Style tab changed something, so the values carry a ds:style block
  var styleTheme = "light";
  var STYLE_BLOCK = /<!-- ds:style (\{[\s\S]*?\}) -->[\s\S]*?<!-- \/ds:style -->\s*/;
  function clampNum(v, lo, hi, d) { v = Math.round(Number(v)); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; }
  // Values come from people's files: keep what parses, defaults for the rest.
  function cleanStyle(raw) {
    var d = styleDefaults(), o = styleDefaults();
    if (!raw || typeof raw !== "object") return d;
    ["light", "dark"].forEach(function (t) {
      COLOR_ROLES.forEach(function (r) { var v = raw[t] && raw[t][r[0]]; if (typeof v === "string" && SAFE_COLOR.test(v.trim())) o[t][r[0]] = v.trim(); });
    });
    if (typeof raw.font === "string" && SAFE_FONT.test(raw.font)) o.font = raw.font.trim();
    var lim = { type: { small: [9, 20], body: [11, 24], title: [13, 40], display: [18, 96] },
      shape: { roundness: [0, 100], tiny: [0, 20] },
      button: { height: [24, 56], radius: [0, 40] }, card: { padding: [8, 40], radius: [0, 40] }, input: { height: [24, 56], radius: [0, 40] } };
    Object.keys(lim).forEach(function (g) {
      Object.keys(lim[g]).forEach(function (k) { o[g][k] = clampNum(raw[g] && raw[g][k], lim[g][k][0], lim[g][k][1], d[g][k]); });
      if (g !== "type" && g !== "shape" && raw[g] && SHADOWS[raw[g].shadow]) o[g].shadow = raw[g].shadow;
    });
    if (raw.shape && typeof raw.shape.pill === "boolean") o.shape.pill = raw.shape.pill;
    if (raw.button && (raw.button.fill === "accent" || raw.button.fill === "ink")) o.button.fill = raw.button.fill;
    return o;
  }
  // A style for values without a ds:style block, read off their colors and font.
  function styleFromValues(text, ds) {
    var o = styleDefaults();
    var sp = ds === MODERN ? MODERN.spec : dsSpec({ content: text || "" });
    ["light", "dark"].forEach(function (t) {
      var side = sp[t];
      if (!side) return;
      // Modern keeps the CTA accent of the defaults; another system brings its own.
      (ds === MODERN ? ["bg", "surface", "text", "muted"] : ["bg", "surface", "text", "muted", "accent", "onAccent"]).forEach(function (k) { if (side[k]) o[t][k] = side[k]; });
    });
    // Their accent's soft wash, when they bring their own accent.
    if (ds !== MODERN) ["light", "dark"].forEach(function (t) {
      var a = sp[t] && sp[t].accent;
      if (!a || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(a)) return;
      var h = toHex(a).slice(1);
      o[t].accentSoft = "rgba(" + [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }).join(",") + "," + (t === "dark" ? ".16" : ".08") + ")";
      o[t].onAccentSoft = a;
    });
    if (sp.font) o.font = sp.font.split(",")[0].replace(/["']/g, "").trim() || o.font;
    // Their radius: a pill means pill buttons; otherwise it sets how round.
    var r = sp.light && sp.light.radius && parseInt(sp.light.radius, 10);
    if (r >= 24) o.shape.pill = true;
    else if (r >= 0 && ds !== MODERN) { o.shape.pill = false; o.shape.roundness = Math.min(100, Math.round(r * 5)); }
    applyRoundness();
    return o;
  }
  function styleFromText() {
    var m = STYLE_BLOCK.exec(dsText.value);
    if (m) { try { dsStyle = cleanStyle(JSON.parse(m[1])); styleTouched = true; paintStyle(); return; } catch (e) {} }
    if (!styleTouched) { dsStyle = styleFromValues(dsText.value, dsEditing); paintStyle(); }
  }
  function shadowCss(name, theme) {
    return (SHADOWS[name] || SHADOWS.none)[theme].replace("{border}", dsStyle[theme].border);
  }
  // The block the agent reads: roles as custom properties with light and dark
  // values, the text scale and the elements, in words and CSS.
  function styleBlock() {
    var s = dsStyle, L = s.light, D = s.dark;
    var vars = [["bg", "--ds-bg"], ["surface", "--ds-surface"], ["text", "--ds-text"], ["muted", "--ds-muted"], ["border", "--ds-border"], ["accent", "--ds-accent"], ["onAccent", "--ds-on-accent"], ["accentSoft", "--ds-accent-soft"], ["onAccentSoft", "--ds-on-accent-soft"]];
    var rad = function (n) { return n >= 40 ? "pill (" + n + "px)" : n + "px"; };
    var el = function (g, name) { return "shadow `" + shadowCss(s[g].shadow, "light") + "` (dark: `" + shadowCss(s[g].shadow, "dark") + "`)"; };
    return "<!-- ds:style " + JSON.stringify(s) + " -->\n" +
      "## Style (set in the Studio)\n\n" +
      "These values win over anything written below. Define the colors as custom properties on :root, with the dark values under html[data-theme=\"dark\"], and use them everywhere:\n\n" +
      "```css\n:root {\n" + vars.map(function (v) { return "  " + v[1] + ": " + L[v[0]] + ";"; }).join("\n") + "\n}\n" +
      "html[data-theme=\"dark\"] {\n" + vars.map(function (v) { return "  " + v[1] + ": " + D[v[0]] + ";"; }).join("\n") + "\n}\n```\n\n" +
      "Roles: --ds-bg is the page, --ds-surface cards, menus and inputs, --ds-text text, --ds-muted secondary text and icons, --ds-border dividers and outlines, --ds-accent primary buttons, selection and focus, --ds-on-accent text on the accent, --ds-accent-soft the tinted wash for badges, chips, date tiles and selected rows, with --ds-on-accent-soft text on it.\n\n" +
      "Text: font `" + s.font + "` first in a stack that ends in inherit. Sizes: small " + s.type.small + "px (captions, meta), body " + s.type.body + "px, title " + s.type.title + "px (card and dialog titles), display " + s.type.display + "px (big numbers, page titles). Body line height about 1.45, titles about 1.2.\n\n" +
      "Corners: tiny " + s.shape.tiny + "px (chips, badges, menu items, checkboxes), small " + s.input.radius + "px (inputs" + (s.shape.pill ? "" : ", buttons") + "), large " + s.card.radius + "px (cards, menus, dialogs)" + (s.shape.pill ? "; buttons are pills" : "") + ". Nested radii are concentric: the outer radius is the inner one plus the padding between them.\n\n" +
      "Elements:\n" +
      "- Primary button: " + s.button.height + "px tall, radius " + rad(s.button.radius) + ", " +
        (s.button.fill === "ink" ? "--ds-text fill with --ds-surface text (an ink button, like the transitions.dev CTA)" : "--ds-accent fill, --ds-on-accent text") + ", " + s.type.body + "px weight 500, " + el("button") + ".\n" +
      "- Secondary button: the same shape, --ds-surface fill, --ds-text text, shadow `0 0 0 1px` --ds-border.\n" +
      "- Card, menu, panel: --ds-surface, padding " + s.card.padding + "px, radius " + s.card.radius + "px, " + el("card") + ". Nested radii are concentric.\n" +
      "- Input: " + s.input.height + "px tall, radius " + rad(s.input.radius) + ", --ds-surface fill, " + el("input") + ", focus ring `0 0 0 3px` of the accent at low opacity plus 1px accent.\n" +
      "<!-- /ds:style -->\n";
  }
  function composeText() {
    var rest = dsText.value.replace(STYLE_BLOCK, "").replace(/^\s+/, "");
    dsText.value = (styleBlock() + (rest ? "\n" + rest : "")).slice(0, 20000);
    dsCount();
  }

  // ── Style controls ──
  var colorsEl = $("st-ds-colors");
  colorsEl.innerHTML = COLOR_ROLES.map(function (r) {
    return '<div class="st-ds-color" data-role="' + r[0] + '"' + (r[2] ? ' title="' + C.esc(r[1] + ": " + r[2]) + '"' : "") + ">" +
      '<span class="st-ds-sw"><input type="color" aria-label="' + C.esc(r[1]) + ' color" /></span>' +
      '<span class="st-ds-cl"><b>' + C.esc(r[1]) + "</b></span>" +
      '<input type="text" class="st-ds-hex" aria-label="' + C.esc(r[1]) + ' value" spellcheck="false" maxlength="60" />' +
    "</div>";
  }).join("");
  dsForm.querySelectorAll("[data-ds-shadow]").forEach(function (sel) {
    sel.innerHTML = Object.keys(SHADOWS).map(function (k) { return '<option value="' + k + '">' + SHADOWS[k].label + "</option>"; }).join("");
  });
  function toHex(v) {
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return ("#" + v.slice(1).replace(/./g, "$&$&")).toLowerCase();
    var m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
    if (m) return "#" + [m[1], m[2], m[3]].map(function (n) { return ("0" + Math.min(255, +n).toString(16)).slice(-2); }).join("");
    return v === "white" ? "#ffffff" : "#000000";
  }
  function getK(path) { return path.split(".").reduce(function (o, k) { return o && o[k]; }, dsStyle); }
  function setK(path, v) { var ks = path.split("."), o = dsStyle; for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
  function paintStyle() {
    var side = dsStyle[styleTheme];
    colorsEl.querySelectorAll(".st-ds-color").forEach(function (row) {
      var v = side[row.getAttribute("data-role")];
      row.querySelector(".st-ds-sw").style.setProperty("--sw", v);
      row.querySelector("input[type=color]").value = toHex(v);
      var hex = row.querySelector(".st-ds-hex");
      if (document.activeElement !== hex) hex.value = v;
    });
    dsForm.querySelectorAll("[data-ds-theme]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-ds-theme") === styleTheme)); });
    dsForm.querySelectorAll("[data-ds-k]").forEach(function (inp) {
      if (document.activeElement === inp && inp.type !== "range") return;
      if (inp.type === "checkbox") inp.checked = !!getK(inp.getAttribute("data-ds-k"));
      else inp.value = getK(inp.getAttribute("data-ds-k"));
    });
    paintRadii();
    paintPreview();
  }
  function paintPreview() {
    var p = $("st-dsp"), s = dsStyle, t = styleTheme, c = s[t];
    var set = function (k, v) { p.style.setProperty(k, v); };
    set("--p-bg", c.bg); set("--p-surface", c.surface); set("--p-text", c.text); set("--p-muted", c.muted);
    set("--p-border", c.border); set("--p-accent", c.accent); set("--p-on-accent", c.onAccent);
    set("--p-accent-soft", c.accentSoft); set("--p-on-accent-soft", c.onAccentSoft);
    set("--p-font", '"' + s.font.replace(/"/g, "") + '", inherit');
    ["small", "body", "title", "display"].forEach(function (k) { set("--p-" + k, s.type[k] + "px"); });
    set("--p-tiny", s.shape.tiny + "px");
    set("--p-btn-bg", s.button.fill === "ink" ? c.text : c.accent);
    set("--p-btn-fg", s.button.fill === "ink" ? c.surface : c.onAccent);
    set("--p-btn-h", s.button.height + "px"); set("--p-btn-r", s.button.radius + "px"); set("--p-btn-sh", shadowCss(s.button.shadow, t));
    set("--p-card-pad", s.card.padding + "px"); set("--p-card-r", s.card.radius + "px"); set("--p-card-sh", shadowCss(s.card.shadow, t));
    set("--p-in-h", s.input.height + "px"); set("--p-in-r", s.input.radius + "px"); set("--p-in-sh", shadowCss(s.input.shadow, t));
  }
  function paintRadii() {
    var s = dsStyle;
    $("st-ds-round-out").textContent = s.shape.roundness;
    $("st-ds-radii").textContent = s.shape.tiny + " · " + s.input.radius + " · " + s.card.radius + " px";
  }
  function styleChanged() {
    paintRadii();
    styleTouched = true;
    composeText();
    paintPreview();
  }
  colorsEl.addEventListener("input", function (e) {
    var row = e.target.closest(".st-ds-color");
    if (!row || dsLocked()) return;
    var role = row.getAttribute("data-role"), v = e.target.value.trim();
    if (e.target.type === "color") row.querySelector(".st-ds-hex").value = v;
    if (!SAFE_COLOR.test(v)) { row.classList.add("is-bad"); return; }
    row.classList.remove("is-bad");
    dsStyle[styleTheme][role] = v;
    row.querySelector(".st-ds-sw").style.setProperty("--sw", v);
    if (e.target.type !== "color") row.querySelector("input[type=color]").value = toHex(v);
    styleChanged();
  });
  colorsEl.addEventListener("focusout", function (e) {
    var row = e.target.closest(".st-ds-color");
    if (row && e.target.classList.contains("st-ds-hex")) { row.classList.remove("is-bad"); e.target.value = dsStyle[styleTheme][row.getAttribute("data-role")]; }
  });
  dsForm.querySelectorAll("[data-ds-k]").forEach(function (inp) {
    inp.addEventListener(inp.tagName === "SELECT" || inp.type === "checkbox" ? "change" : "input", function () {
      if (dsLocked()) return;
      var k = inp.getAttribute("data-ds-k");
      if (k === "shape.roundness" || k === "shape.pill") {
        if (k === "shape.pill") dsStyle.shape.pill = inp.checked; else dsStyle.shape.roundness = clampNum(inp.value, 0, 100, 50);
        applyRoundness();
        paintStyle();
        styleChanged();
        return;
      }
      if (k === "font") { if (!inp.value.trim() || !SAFE_FONT.test(inp.value)) return; setK(k, inp.value.trim()); }
      else if (inp.tagName === "SELECT") setK(k, inp.value);
      else { if (inp.value === "") return; setK(k, clampNum(inp.value, +inp.min, +inp.max, getK(k))); }
      styleChanged();
    });
    if (inp.type === "number") inp.addEventListener("blur", function () { inp.value = getK(inp.getAttribute("data-ds-k")); });
  });
  dsForm.querySelectorAll("[data-ds-theme]").forEach(function (b) {
    b.addEventListener("click", function () { styleTheme = b.getAttribute("data-ds-theme"); paintStyle(); });
  });

  function dsCount() { $("st-ds-count").textContent = dsText.value.length.toLocaleString() + " / 20,000"; }
  function dsShowErr(t) { dsErr.textContent = t || ""; dsErr.hidden = !t; }
  function dsOwn() { return !!dsEditing && dsEditing !== MODERN; }
  // Modern without Pro: look, do not touch.
  function dsLocked() { return !hasPro; }
  function dsPaint() {
    var adding = !dsEditing;
    var locked = dsLocked();
    dsTabsEl.querySelector('[data-src="shot"]').hidden = !adding;
    dsForm.querySelectorAll("[data-src-body]").forEach(function (el) { el.hidden = el.getAttribute("data-src-body") !== dsSrc; });
    $("st-ds-namef").hidden = dsSrc === "shot";
    $("st-ds-meta").hidden = dsSrc === "shot";
    $("st-ds-upload").parentNode.hidden = locked;
    dsName.readOnly = dsText.readOnly = locked;
    dsForm.querySelectorAll(".st-ds-style input, .st-ds-style select").forEach(function (el) { el.disabled = locked; });
    $("st-ds-del").hidden = !dsOwn();
    dsUpdate.hidden = !dsOwn() || dsSrc === "shot";
    dsUpdate.disabled = dsBusy;
    var extracting = adding && dsSrc === "shot";
    dsSave.textContent = extracting ? (dsBusy ? "Extracting…" : "Extract values") : locked ? "Get Pro to make your own" : "Save as new design system";
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
      dsNote.hidden = ds !== MODERN;
      dsNote.textContent = ds !== MODERN ? "" : hasPro ? "Built in. Change anything and save it as your own design system." : "Built in. With Pro or Business you can change it and save your own.";
      $("st-ds-title").textContent = !ds ? "Add a design system" : ds === MODERN ? "Modern" : "Edit design system";
      dsName.value = !ds ? "" : ds === MODERN && hasPro ? "Modern copy" : ds.name;
      dsText.value = ds && !ds.builtin ? ds.content : "";
      dsNotes.value = "";
      dsShots.clear();
      styleTouched = false;
      styleTheme = "light";
      dsStyle = ds ? styleFromValues(dsText.value, ds) : styleDefaults();
      styleFromText();
      paintStyle();
      if (ds === MODERN) {
        dsText.value = "Loading…";
        modernText().then(function (t) {
          if (dsEditing !== MODERN) return;
          dsText.value = t;
          if (styleTouched) composeText();
          dsText.setSelectionRange(0, 0); dsText.scrollTop = 0; dsCount();
        });
      }
      dsSrc = ds ? "style" : "shot";
      pickSrc(dsSrc, true);
      dsPaint();
      showDialog(dsDlg);
      setTimeout(function () {
        pickSrc(dsSrc, true);
        (ds ? dsName : $("st-ds-drop")).focus();
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
  // Import a file: tokens (CSS variables, JSON, a Tailwind theme) or a written
  // spec. It becomes the values; the Style tab reads its colors and font.
  $("st-ds-upload").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f || dsLocked()) return;
    if (f.size > 200000) { dsShowErr("That file is too large. Paste the relevant part instead."); return; }
    f.text().then(function (text) {
      dsShowErr("");
      dsText.value = text.slice(0, 20000);
      if (!dsName.value.trim() || dsName.value === "Modern copy") dsName.value = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 60);
      styleTouched = false;
      styleFromText();
      if (!STYLE_BLOCK.test(dsText.value)) { dsStyle = styleFromValues(dsText.value, null); paintStyle(); }
      dsCount();
      C.toast("Imported " + f.name);
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
      dsNote.textContent = "Extracted from your screenshot. Check the style, change anything, then save.";
      dsNote.hidden = false;
      styleTouched = false;
      dsStyle = styleFromValues(r.content, null);
      paintStyle();
      dsSrc = "style";
      pickSrc("style", true);
      dsPaint();
      dsName.focus();
    });
  }

  function saveDesign(asNew) {
    var name = dsName.value.trim();
    if (!name) { dsShowErr("Give it a name."); dsName.focus(); return; }
    if (asNew && dsAll().some(function (x) { return x.name.toLowerCase() === name.toLowerCase(); })) name = (name + " copy").slice(0, 60);
    dsBusy = true;
    dsShowErr("");
    dsPaint();
    var editing = dsOwn() && !asNew;
    C.api.saveDesignSystem({ id: editing ? dsEditing.id : undefined, name: name, content: dsText.value }).then(function (r) {
      dsBusy = false;
      if (r.error) { dsShowErr(C.errorText(r.error)); dsPaint(); return; }
      var d = r.design_system;
      var i = designSystems.map(function (x) { return x.id; }).indexOf(d.id);
      if (i >= 0) designSystems[i] = d; else designSystems.unshift(d);
      ctx.ds = d.id;
      saveCtx();
      paintDesign();
      closeDesign();
      C.toast(editing ? "Design system saved" : "“" + d.name + "” saved and in use");
    });
  }
  dsForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (dsBusy) return;
    if (!dsEditing && dsSrc === "shot") { extract(); return; }
    if (dsLocked()) { closeDesign(); upsellDesign(); return; }
    saveDesign(true);
  });
  dsUpdate.addEventListener("click", function () { if (!dsBusy && !dsLocked()) saveDesign(false); });
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
  // +: the Builder's menu. Attach an image, or open the skill editor or the
  // libraries.
  var setPlusMenu = dropdown($("st-plus"), $("st-plus-menu"));
  $("st-plus-menu").addEventListener("click", function (e) {
    var b = e.target.closest("[data-plus]");
    if (!b) return;
    setPlusMenu(false);
    var what = b.getAttribute("data-plus");
    if (what === "image") $("st-img-file").click();
    else if (what === "skill") openSkill(null);
    else if (what === "library") { paintLibs(); showDialog(libsDlg); }
  });
  $("st-img-file").addEventListener("change", function () {
    attach.add(this.files);
    this.value = "";
    aiInput.focus();
  });

  function aiSize() {
    aiInput.style.height = "auto";
    aiInput.style.height = Math.min(aiInput.scrollHeight, 7 * 20 + 12) + "px";
    // While the agent works the button is Stop, so it stays active.
    aiSend.disabled = !busy && !aiInput.value.trim() && !(attach && attach.count());
  }
  // The send button: an arrow, or a stop square while the agent works.
  var ICON_SEND = aiSend.innerHTML;
  var ICON_STOP = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/></svg>';
  var aiAbort = null;
  function stopAI() { if (aiAbort) aiAbort.abort(); }
  function submitAI() {
    if (busy) { stopAI(); return; }
    if (aiSend.disabled) return;
    if (attach.busy()) { C.toast("Images are still loading."); return; }
    runAI(aiInput.value.trim(), attach.items());
  }
  aiInput.addEventListener("input", aiSize);
  aiInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      // Enter never stops a running draft; only the button does.
      if (!busy) submitAI();
    }
  });
  aiForm.addEventListener("submit", function (e) { e.preventDefault(); submitAI(); });

  // Fade the bottom edge only while there is more transcript below.
  function fade() {
    var more = log.scrollHeight - log.scrollTop - log.clientHeight > 2;
    log.style.setProperty("--fade-bottom", more ? "36px" : "0px");
  }
  log.addEventListener("scroll", fade);

  // copyText: the visitor's own messages get a time and a copy button under
  // the bubble, shown on hover (as in Claude Code).
  var ICON_CHECK = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 8.4l2.5 2.8L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function say(role, html, copyText) {
    var empty = $("st-chat-empty");
    if (empty) empty.remove();
    var el = document.createElement("p");
    el.className = "st-chat-msg";
    el.setAttribute("data-role", role);
    el.innerHTML = html;
    if (role === "user") {
      var turn = document.createElement("div");
      turn.className = "st-chat-turn";
      var now = new Date();
      var meta = document.createElement("div");
      meta.className = "st-chat-meta";
      meta.innerHTML = '<time datetime="' + now.toISOString() + '" title="' + C.esc(now.toLocaleString()) + '">' +
        C.esc(now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + "</time>" +
        // Both icons stacked; the library's Icon swap (P5) crossfades them.
        '<button type="button" class="st-chat-copy" data-copied="false" aria-label="Copy message" title="Copy">' +
          '<span class="st-swap-ico st-swap-copy">' + ICON_COPY + '</span><span class="st-swap-ico st-swap-check">' + ICON_CHECK + "</span></button>";
      var copyBtn = meta.querySelector(".st-chat-copy");
      var copyTimer = null;
      copyBtn.addEventListener("click", function () {
        var t = copyText != null ? copyText : el.textContent;
        navigator.clipboard.writeText(t).then(function () {
          copyBtn.setAttribute("data-copied", "true");
          copyBtn.setAttribute("aria-label", "Copied");
          clearTimeout(copyTimer);
          copyTimer = setTimeout(function () { copyBtn.setAttribute("data-copied", "false"); copyBtn.setAttribute("aria-label", "Copy message"); }, 1400);
        }, function () {});
      });
      turn.appendChild(el);
      turn.appendChild(meta);
      log.appendChild(turn);
    } else {
      log.appendChild(el);
    }
    log.scrollTop = log.scrollHeight;
    fade();
    return el;
  }

  // Pending turn: the P28 thinking-states line, showing what the agent is
  // actually doing (the generate stream's steps), swapped with the
  // cross-blur. Each step stays up at least 700ms so it can be read; a
  // step's line count updates in place.
  // The agent's working mark: the Thinking orbs library's small working orb
  // ("working" at size 20), loaded from esm.sh the first time the agent runs.
  // The CSS dot shows until it arrives, and stays if it cannot load.
  var orbKit = null;
  function orbLib() {
    if (!orbKit) {
      var R = "react@19.1.0";
      orbKit = Promise.all([
        import("https://esm.sh/" + R),
        import("https://esm.sh/react-dom@19.1.0/client?deps=" + R),
        import("https://esm.sh/thinking-orbs@" + C.preinstalled["thinking-orbs"] + "?deps=" + R + ",react-dom@19.1.0"),
      ]).then(function (m) { return { React: m[0].default || m[0], createRoot: m[1].createRoot, ThinkingOrb: m[2].ThinkingOrb }; });
      orbKit.catch(function () { orbKit = null; });
    }
    return orbKit;
  }
  function mountOrb(slot) {
    var root = null, gone = false, watch = null;
    // The site's own theme, pinned: in light mode the site sets no
    // data-theme, so "auto" would follow a dark OS and draw light dots on
    // the white panel.
    function theme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
    orbLib().then(function (k) {
      if (gone || !k.ThinkingOrb) return;
      root = k.createRoot(slot);
      function paint() { if (root) root.render(k.React.createElement(k.ThinkingOrb, { state: "working", size: 20, theme: theme() })); }
      paint();
      watch = new MutationObserver(paint);
      watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      slot.classList.add("has-orb");
    }).catch(function () {});
    // Unmounted when the work ends, as the library asks.
    return function () {
      gone = true;
      if (watch) { watch.disconnect(); watch = null; }
      if (root) { root.unmount(); root = null; }
      slot.classList.remove("has-orb");
    };
  }

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
    var unmountOrb = mountOrb(wrap.querySelector(".st-think-dot"));
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
      unmountOrb();
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

  // The working mark on the preview: a 60 by 24 field of dots (15 by 6),
  // twinkling in a scattered order like the library's Matrix dot loader (P33).
  // The field is a rectangle with 6px corners: only dots whose centre falls
  // outside a corner's curve stay in the grid, unseen.
  (function buildDots() {
    var COLS = 15, ROWS = 6, W = 60, H = 24, GAP = 2, R = 6, N = COLS * ROWS, html = "";
    var cw = (W - GAP * (COLS - 1)) / COLS, ch = (H - GAP * (ROWS - 1)) / ROWS;
    function outside(i) {
      var x = (i % COLS) * (cw + GAP) + cw / 2, y = Math.floor(i / COLS) * (ch + GAP) + ch / 2;
      // Only the four corner squares round off; the straight edges keep every dot.
      if ((x >= R && x <= W - R) || (y >= R && y <= H - R)) return false;
      var cx = x < R ? R : W - R, cy = y < R ? R : H - R;
      return Math.hypot(x - cx, y - cy) > R;
    }
    // 37 is coprime with 90, so i * 37 % 90 visits every slot once, scattered.
    for (var i = 0; i < N; i++) html += '<i style="--d:' + Math.round((i * 37 % N) * 1200 / N) + '"' + (outside(i) ? " data-off" : "") + "></i>";
    $("st-dots").innerHTML = html;
  })();
  function setWorking(text) { $("st-working-text").textContent = text; }

  function setBusy(on) {
    busy = on;
    preview.classList.toggle("is-working", on);
    if (on) setWorking("Working");
    if (on) aiForm.setAttribute("data-busy", ""); else aiForm.removeAttribute("data-busy");
    aiSend.innerHTML = on ? ICON_STOP : ICON_SEND;
    aiSend.setAttribute("aria-label", on ? "Stop" : "Send");
    aiSend.title = on ? "Stop" : "";
    if (on) preview.setAttribute("aria-busy", "true"); else preview.removeAttribute("aria-busy");
    aiSize();
  }

  var quotaText = C.quotaText;
  function paintQuota(q) {
    if (q) lastQuota = q;
    if (agentChoice() === "chatgpt") {
      // OpenAI's wording: say the plan is in use, and where to manage it.
      quotaEl.innerHTML = 'ChatGPT plan · <a href="' + CHATGPT_USAGE_URL + '" target="_blank" rel="noopener">Manage usage</a>';
      quotaEl.title = "Using ChatGPT plan: drafts use your ChatGPT plan, not your Transitions credits.";
      quotaEl.hidden = false;
    } else if (q) {
      quotaEl.textContent = quotaText(q, true);
      quotaEl.title = quotaText(q);
      quotaEl.hidden = false;
    }
    if (q && aiPaid !== (q.tier === "paid")) { aiPaid = q.tier === "paid"; paintAgent(); }
  }

  // ── Agent: which model drafts. Sonnet for everyone, Opus for Pro and
  // Business subscriptions (the API decides; a lifetime purchase drafts on
  // the free tier). The pick is a per-browser preference.
  var AGENTS = [
    { id: "sonnet", label: "Sonnet 5.5", sub: "Fast, everyday edits · usually 5 to 20 credits" },
    { id: "opus", label: "Opus 5.5", sub: "Best for complex work · usually 10 to 35 credits", paid: true },
    // Sign in with ChatGPT: drafts run on the person's own ChatGPT plan
    // (Plus or Pro), so they use no credits. Listed once the API offers it.
    { id: "chatgpt", label: "ChatGPT", sub: "Your ChatGPT plan · no credits", plan: true },
  ];
  // OpenAI's page for the usage limit a person gives each connected app.
  var CHATGPT_USAGE_URL = "https://chatgpt.com/#settings";
  var aiPaid = false;
  var chatgpt = { available: false, connected: false };
  var lastQuota = null;
  var agentMenu = $("st-agent-menu");
  var setAgentMenu = dropdown($("st-agent"), agentMenu);
  function agentChoice() {
    if (ctx.agent === "chatgpt" && chatgpt.available && chatgpt.connected) return "chatgpt";
    return aiPaid && ctx.agent === "opus" ? "opus" : "sonnet";
  }
  var CHECK = '<span class="tl-menu-check st-agent-check" aria-hidden="true">' +
    '<svg viewBox="0 0 16 16" fill="none"><path d="M4 8.4268L6.46155 11.19223L12 4.97001" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  function agentRow(a, cur) {
    var locked = a.paid && !aiPaid;
    var connect = a.plan && !chatgpt.connected;
    return '<div class="tl-menu-item st-pop-row' + (locked ? " is-locked" : "") + '" role="menuitemradio" aria-checked="' + (a.id === cur) + '"' +
      (locked ? ' aria-disabled="true"' : "") + ' data-agent="' + a.id + '">' +
      '<span class="st-pop-main"><b>' + a.label + "</b><span>" + a.sub + "</span></span>" +
      (locked ? '<a class="st-pop-badge" href="pro.html">Pro</a>'
        : connect ? '<button type="button" class="st-pop-badge" data-connect="chatgpt">Connect</button>'
        : CHECK) +
      "</div>";
  }
  function paintAgent() {
    var cur = agentChoice();
    // The button says "Agent"; the model shows in its tooltip and the menu.
    $("st-agent").title = "Agent: " + (cur === "chatgpt" ? "ChatGPT plan" : AGENTS.filter(function (a) { return a.id === cur; })[0].label);
    agentMenu.innerHTML = '<p class="tl-menu-group">Transitions UI agent</p>' +
      AGENTS.filter(function (a) { return !a.plan; }).map(function (a) { return agentRow(a, cur); }).join("") +
      (chatgpt.available
        ? '<div class="tl-menu-divider"></div><p class="tl-menu-group">Your ChatGPT plan</p>' + agentRow(AGENTS[2], cur)
        : "") +
      '<div class="tl-menu-divider"></div><p class="tl-menu-note">Opus needs a Pro or Business subscription.' +
      (chatgpt.available ? " ChatGPT uses your Plus or Pro plan instead of credits." : "") + "</p>";
    paintQuota(lastQuota);
  }
  // Connecting leaves the page for ChatGPT and comes back here. New work is
  // already kept in this browser; a saved component's changes are saved first.
  function connectChatGPT() {
    var tp = window.TransitionsPro;
    if (!tp || !tp.oauth) return;
    ctx.agent = "chatgpt";
    saveCtx();
    C.withAccount(function () {
      if (S.dirty && S.owner && S.id) save(undefined, null, function () { tp.oauth("chatgpt", "link"); });
      else tp.oauth("chatgpt", "link");
    });
  }
  // OpenAI asks apps to say, once, that drafts now use the person's plan.
  function chatgptIntro() {
    var KEY = "tdev:studio:chatgpt-intro";
    try { if (localStorage.getItem(KEY)) return; localStorage.setItem(KEY, "1"); } catch (e) {}
    C.confirm({
      title: "You’re using your ChatGPT plan",
      body: "Eligible usage in the Studio now uses your ChatGPT plan, not your Transitions credits. " +
        "You set how much Transitions.dev may use in your ChatGPT settings.",
      ok: "Got it",
      alt: "Manage usage",
      cancel: false,
    }).then(function (v) { if (v === "alt") window.open(CHATGPT_USAGE_URL, "_blank", "noopener"); });
  }
  agentMenu.addEventListener("click", function (e) {
    if (e.target.closest("[data-connect]")) { setAgentMenu(false); connectChatGPT(); return; }
    var row = e.target.closest("[data-agent]");
    if (!row || e.target.closest("a") || row.classList.contains("is-locked")) return;
    var id = row.getAttribute("data-agent");
    if (id === "chatgpt" && !chatgpt.connected) { setAgentMenu(false); connectChatGPT(); return; }
    ctx.agent = id;
    saveCtx();
    paintAgent();
    setAgentMenu(false);
    if (id === "chatgpt") chatgptIntro();
  });
  // Back from ChatGPT: the Studio picks the plan up (and says the errors
  // that belong to connecting).
  var oauthSeen = null;
  function onOAuth(d) {
    if (!d || d === oauthSeen || d.provider !== "chatgpt") return;
    oauthSeen = d;
    if (d.error) { C.toast(d.text || C.errorText("chatgpt_failed"), "err"); return; }
    loadMe(function () {
      if (!chatgpt.connected) return;
      ctx.agent = "chatgpt";
      saveCtx();
      paintAgent();
      C.toast("ChatGPT connected. Drafts now use your plan.");
      chatgptIntro();
    });
  }
  document.addEventListener("tp:oauth", function (e) { onOAuth(e.detail); });
  if (window.TransitionsPro && window.TransitionsPro.lastOAuth) onOAuth(window.TransitionsPro.lastOAuth);
  paintAgent();

  // images: [{ media_type, data }]. With images and no text, the agent
  // builds (or restyles to) what the images show.
  function convertTo(m) {
    runAI(m === "react"
      ? "Convert this component to React: one TSX module with a default export and the same CSS, keeping its look, states and motion exactly."
      : "Convert this component to plain HTML, CSS and vanilla JS, keeping its look, states and motion exactly.", [], { mode: m });
  }

  // A failed draft: say why, and for the ChatGPT plan offer the way on.
  function aiError(r, text, images, opts) {
    var code = r.error || "generation_failed";
    var msg = C.errorText(code);
    if (code === "hourly_limit" && r.retry_at) {
      var mins = Math.max(1, Math.ceil((r.retry_at - Date.now()) / 60000));
      msg = "That's a lot of edits in one hour. Try again in " + mins + (mins === 1 ? " minute." : " minutes.");
    }
    say("error", C.esc(msg));
    if (code === "chatgpt_limit") {
      // OpenAI's order: manage the plan's usage first, our credits second.
      C.confirm({
        title: "ChatGPT usage limit reached",
        body: msg + " Raise it in ChatGPT, or keep going with your Transitions credits.",
        ok: "Manage usage",
        alt: "Use Transitions credits",
        cancel: "Close",
      }).then(function (v) {
        if (v === true) window.open(CHATGPT_USAGE_URL, "_blank", "noopener");
        else if (v === "alt") { ctx.agent = "sonnet"; saveCtx(); paintAgent(); runAI(text, images, opts); }
      });
    } else if (code === "chatgpt_disconnected" || code === "chatgpt_not_connected") {
      chatgpt.connected = false;
      paintAgent();
      C.confirm({ title: "Connect ChatGPT again", body: msg, ok: "Connect ChatGPT", cancel: "Not now" })
        .then(function (v) { if (v === true) connectChatGPT(); });
    } else if (code === "chatgpt_not_eligible") {
      ctx.agent = "sonnet";
      saveCtx();
      paintAgent();
    }
  }

  // Libraries are React components. In HTML mode, a request that names a
  // library that is turned on (its name, package or id) builds in React, so
  // the agent can use it.
  function librariesAsked(text) {
    var t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    return libraries.filter(function (l) {
      if (!ctx.libs[l.id]) return false;
      return [l.name, l.pkg, l.id].some(function (w) {
        var k = String(w || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        return k.length >= 3 && t.indexOf(" " + k + " ") >= 0;
      });
    });
  }

  // opts.mode: build in that format instead of the current one (a conversion).
  function runAI(text, images, opts) {
    images = images || [];
    opts = opts || {};
    if (!opts.mode && S.mode === "html" && text) {
      var asked = librariesAsked(text);
      if (asked.length) {
        opts.mode = "react";
        opts.libNote = asked.map(function (l) { return l.name; }).join(" and ");
      }
    }
    if ((!text && !images.length) || busy) return;
    C.withAccount(function () {
      var fresh = isStarter() || (!S.files.html.trim() && !S.files.js.trim());
      if (!text) text = fresh ? "Build the component in the attached image." : "Update the component to match the attached image.";
      var picked = target;
      say("user", (images.length ? C.imageStrip(images) : "") +
        (picked ? '<code class="st-chat-target">' + C.esc(targetLabel(picked)) + "</code> " : "") + C.esc(text), text);
      if (opts.libNote) say("agent", "Building in React to use " + C.esc(opts.libNote) + ": libraries are React components.");
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
      var current = fresh ? null : { html: S.files.html, css: S.files.css, js: S.files.js, title: S.title, description: S.description, layout: layoutIssues.slice() };
      agentContext(text, opts.mode || S.mode).catch(function (e) { return { error: e.message || "context_too_large" }; }).then(function (context) {
        if (context && context.error) return { error: context.error };
        aiAbort = new AbortController();
        // Switched to React for a library: say so in the request too.
        var ask = opts.libNote
          ? text + "\n\nBuild it as a React component (one TSX module) so it can use " + opts.libNote + ", keeping its look, states and motion."
          : text;
        return C.api.generate(ask, opts.mode || S.mode, current, context, images, onEvent, picked, agentChoice(), aiAbort.signal);
      }).then(function (r) {
        aiAbort = null;
        status.stop();
        setBusy(false);
        // Stopped: nothing changes. The tokens used so far still count.
        if (r.error === "stopped") { say("agent", "Stopped. The component did not change."); return; }
        if (r.error || !r.component) {
          aiError(r, text, images, opts);
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
        S.ai = true;
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
        if (changed.length) say("applied", "Changed " + changed.join(", ") +
          (r.plan === "chatgpt" ? " · on your ChatGPT plan" : r.credits ? " · " + r.credits + " credit" + (r.credits === 1 ? "" : "s") : ""));
        sayScan(r.scan);
        sayLayout = true;
        paintQuota(r.quota);
      });
    });
  }

  // The Motion Agent's scan of the draft (the API runs it, no tokens): the
  // recipes it follows, or what to fix, in the receipt style.
  function sayScan(scan) {
    if (!scan) return;
    var issues = (scan.findings || []).filter(function (f) { return f.rule !== "recipe-available"; });
    var names = (scan.components || []).map(function (c) { return c.name; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
    if (!issues.length) {
      say("scan", "Motion check " + scan.score + (names.length ? " · follows " + C.esc(names.join(", ")) : ""));
      return;
    }
    var first = function (m) { return String(m).split(/(?<=\.)\s/)[0]; };
    say("scan", "Motion check " + scan.score + " · " + issues.length + (issues.length === 1 ? " issue" : " issues") +
      issues.slice(0, 4).map(function (f) { return '<span class="st-scan-issue">' + C.esc(first(f.message)) + "</span>"; }).join("") +
      (issues.length > 4 ? '<span class="st-scan-issue">and ' + (issues.length - 4) + " more</span>" : ""));
  }

  aiSize();

  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__studioEval = { agentContext: agentContext, pickRecipes: pickRecipes, recipes: recipes, files: function () { return S.files; }, sayScan: sayScan };

  // Your community profile: the name in the credit line on your own work.
  function loadMe(then) {
    C.auth().then(function (st) {
      if (!st || !st.authenticated) { meProfile = null; paintCredit(); return; }
      C.api.me().then(function (r) {
        meProfile = (r && r.profile) || null;
        if (hasPro !== !!(r && r.pro)) { hasPro = !!(r && r.pro); paintSkills(); paintDesign(); }
        var cg = (r && r.chatgpt) || {};
        if (chatgpt.available !== !!cg.available || chatgpt.connected !== !!cg.connected) {
          chatgpt = { available: !!cg.available, connected: !!cg.connected };
          paintAgent();
        }
        paintCredit();
        if (r && r.quota) paintQuota(r.quota);
        if (typeof then === "function") then();
      });
    });
  }
  document.addEventListener("pro:me", loadMe);
  loadMe();

  // Signed out: the whole agent panel sits under a sign-in wall (as on the
  // library's detail page), with Join for free and Sign in. The preview and
  // the code stay open to look at.
  var panelEl = document.querySelector(".st-panel");
  var wall = null;
  function paintWall() {
    var tp = window.TransitionsPro;
    var st = tp && tp.state;
    var walled = !!(st && st.resolved && !st.authenticated);
    if (walled && !wall) {
      wall = document.createElement("div");
      wall.className = "st-wall";
      wall.innerHTML =
        '<div><h2 class="st-wall-title">Build with the agent</h2>' +
        '<p class="st-wall-sub">Join for free to remix this, tune its motion and build your own with the Transitions UI Agent.</p></div>' +
        '<div class="st-wall-actions">' +
          '<button type="button" class="cm-btn cm-btn--primary st-wall-btn" data-wall-join>Join for free</button>' +
          '<button type="button" class="cm-btn st-wall-btn" data-wall-signin>Sign in</button>' +
        "</div>";
      wall.querySelector("[data-wall-join]").addEventListener("click", function () { if (tp.joinCommunity) tp.joinCommunity(); });
      wall.querySelector("[data-wall-signin]").addEventListener("click", function () { if (tp.openSignIn) tp.openSignIn({ mode: "signin" }); });
      panelEl.appendChild(wall);
    }
    if (wall) wall.hidden = !walled;
    panelEl.classList.toggle("is-walled", walled);
    // Nothing under the wall can be reached by keyboard either.
    Array.prototype.forEach.call(panelEl.children, function (c) {
      if (c === wall) return;
      if (walled) c.setAttribute("inert", ""); else c.removeAttribute("inert");
    });
  }
  document.addEventListener("pro:me", paintWall);
  paintWall();
  setInterval(paintCredit, 60000);

  // ── Boot ────────────────────────────────────────────────────────────────────
  function boot() {
    var id = params.get("id");
    var remix = params.get("remix");
    var lib = params.get("lib");
    if (id && params.get("review") === "1" && adminToken()) {
      adminCall("/admin/community/c/" + encodeURIComponent(id)).then(function (r) {
        if (r.error) { C.toast(C.errorText(r.error), "err"); return; }
        apply(r, { reviewer: true });
      });
    } else if (id) {
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
      // A reload of an older ?lib= link keeps the draft made from that card.
      var draft = null;
      try { draft = JSON.parse(localStorage.getItem(SCRATCH_KEY) || "null"); } catch (e) {}
      if (draft && draft.remix && draft.remix.kind === "library" && draft.remix.id === lib) {
        startNew(null, true);
        history.replaceState(null, "", "studio.html");
      } else {
        startNew("html", false);
        startFromLibrary(lib);
      }
    } else if (params.get("ai") === "1") {
      // From the community composer: a prompt, images, and maybe a library
      // transition to remix first.
      var handoff = null;
      try { handoff = JSON.parse(sessionStorage.getItem("tdev:studio:ai") || "null"); sessionStorage.removeItem("tdev:studio:ai"); } catch (e) {}
      var fresh = handoff && Date.now() - (handoff.t || 0) < 10 * 60 * 1000;
      var images = fresh && Array.isArray(handoff.images) ? handoff.images.slice(0, 4) : [];
      // A library remix in React: the card loads as HTML/CSS and the agent
      // builds the React version (with the request, or as a straight conversion).
      var toReact = fresh && handoff.lib && handoff.mode === "react";
      var go = function () {
        if (!fresh) return;
        if (handoff.prompt || images.length) runAI(String(handoff.prompt || ""), images, toReact ? { mode: "react" } : undefined);
        else if (toReact) convertTo("react");
      };
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
    // From the Builder's + menu: what was typed there, then the skill editor
    // or the libraries.
    var prefill = null;
    try { prefill = sessionStorage.getItem("tdev:studio:prefill"); sessionStorage.removeItem("tdev:studio:prefill"); } catch (e) {}
    if (prefill) { aiInput.value = prefill; aiSize(); }
    var add = params.get("add");
    if (add === "skill") openSkill(null);
    else if (add === "library") { paintLibs(); showDialog(libsDlg); }
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
