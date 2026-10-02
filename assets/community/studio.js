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

  // Dropdown: the button toggles its .st-menu; outside click or Escape closes.
  var menus = [];
  function dropdown(btn, panel) {
    function set(open) {
      panel.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !panel.classList.contains("is-open");
      menus.forEach(function (m) { if (m !== set) m(false); });
      set(open);
    });
    menus.push(set);
    return set;
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".st-menu")) menus.forEach(function (m) { m(false); });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") menus.forEach(function (m) { m(false); }); });
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
    $("st-format").textContent = S.mode === "react" ? "React (TSX) + CSS" : "HTML, CSS and JS";
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
    S.stash[S.mode] = { html: S.files.html, css: S.files.css, js: S.files.js };
    S.mode = m;
    S.files = S.stash[m] ? S.stash[m] : (starter ? clone(STARTER[m]) : { html: m === "react" ? "" : S.files.html, css: S.files.css, js: m === "react" ? STARTER.react.js : "" });
    S.file = m === "react" ? "js" : "html";
    markDirty();
    editor.reload && editor.reload();
    paintTabs();
    render();
  });

  function clone(o) { return { html: o.html, css: o.css, js: o.js }; }

  // ── Preview / Code ──────────────────────────────────────────────────────────
  var stageBar = $("st-stage-bar");
  var codePanel = $("st-code-panel");
  pillTabs($("st-view-tabs"), "data-show", function (v) {
    stageBar.setAttribute("data-show", v);
    codePanel.hidden = v !== "code";
    if (v === "code" && editor.refresh) editor.refresh();
  });

  // ── Panel: Agent / Details ──────────────────────────────────────────────────
  pillTabs($("st-panel-tabs"), "data-panel", function (v) {
    document.querySelectorAll("[data-panel-body]").forEach(function (el) {
      el.hidden = el.getAttribute("data-panel-body") !== v;
    });
  });
  var descEl = $("st-desc");
  descEl.addEventListener("input", function () { S.description = descEl.value; markDirty(); });

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
      },
    });
  }
  $("st-replay").addEventListener("click", render);

  // ── Header: title, credit, actions ──────────────────────────────────────────
  var titleEl = $("st-title");
  titleEl.addEventListener("input", function () { S.title = titleEl.value; markDirty(); });
  titleEl.addEventListener("keydown", function (e) { if (e.key === "Enter") titleEl.blur(); });

  function link(href, text) { return '<a href="' + C.esc(href) + '">' + C.esc(text) + "</a>"; }

  function paintHeader() {
    titleEl.value = S.title;
    titleEl.readOnly = !S.owner;
    var parts = [];
    if (!S.owner && S.author) parts.push("by " + link(C.profileUrl(S.author.handle), S.author.display_name || "@" + S.author.handle));
    if (S.owner && S.id) parts.push(S.published ? "Published" : "Draft");
    if (S.owner && !S.id) parts.push("New component");
    if (S.remix) {
      if (S.remix.kind === "library") {
        parts.push("Remix of the " + link("detail.html?t=" + S.remix.id, S.remix.title || S.remix.id) + " transition");
      } else if (S.remix.title) {
        parts.push("Remix of " + link(C.studioUrl({ id: S.remix.id }), S.remix.title) + (S.remix.handle ? " by " + link(C.profileUrl(S.remix.handle), "@" + S.remix.handle) : ""));
      }
    }
    $("st-credit").innerHTML = parts.join(" · ");

    document.querySelectorAll("[data-edit]").forEach(function (el) { el.hidden = !S.owner; });
    document.querySelectorAll("[data-view]").forEach(function (el) { el.hidden = S.owner; });
    document.querySelectorAll("[data-owner]").forEach(function (el) {
      el.hidden = !(S.owner && S.id) || (el.getAttribute("data-act") === "unpublish" && !S.published);
    });
    document.querySelectorAll("[data-viewer]").forEach(function (el) { el.hidden = S.owner; });
    document.querySelectorAll("[data-needs-id]").forEach(function (el) { el.hidden = !S.id || !S.published; });
    $("st-save").textContent = S.published ? "Save changes" : "Save draft";
    $("st-save").className = "cm-btn" + (S.published ? " cm-btn--primary" : "");
    $("st-publish").hidden = !S.owner || S.published;
    var like = $("st-like");
    like.setAttribute("aria-pressed", String(!!S.liked));
    like.querySelector(".cm-like-count").textContent = String(S.likes || 0);
    modeBtn.hidden = !S.owner;
    editor.setReadOnly(false);
    descEl.value = S.description || "";
    descEl.readOnly = !S.owner;
    descEl.placeholder = S.owner ? "What does the interaction do?" : "No description";
    $("st-made-by").innerHTML = !S.owner && S.author
      ? link(C.profileUrl(S.author.handle), (S.author.display_name || "@" + S.author.handle))
      : "You";
    var remixOfEl = $("st-remix-of");
    $("st-remix-field").hidden = !S.remix;
    if (S.remix) {
      remixOfEl.innerHTML = S.remix.kind === "library"
        ? link("detail.html?t=" + S.remix.id, (S.remix.title || S.remix.id) + " (library)")
        : link(C.studioUrl({ id: S.remix.id }), S.remix.title || "A community component") +
          (S.remix.handle ? " by " + link(C.profileUrl(S.remix.handle), "@" + S.remix.handle) : "");
    }
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
    S.likes = c.likes || 0;
    S.liked = !!c.liked;
    S.remix = opts.remix || (c.remix ? { kind: c.remix.kind, id: c.remix.id, title: c.remix.source && c.remix.source.title, handle: c.remix.source && c.remix.source.handle } : null);
    S.file = S.mode === "react" ? "js" : "html";
    S.dirty = false;
    savedEl.hidden = true;
    paintHeader();
    paintTabs();
    render();
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
  var libP = null;
  function library() {
    if (!libP) libP = fetch("assets/community/library.json?v=2").then(function (r) { return r.json(); }).catch(function () { libP = null; return []; });
    return libP;
  }
  function startFromLibrary(slug) {
    return library().then(function (items) {
      var t = items.filter(function (x) { return x.slug === slug; })[0];
      if (!t) { C.toast("That transition is not available to remix.", "err"); return false; }
      apply({ mode: "react", title: t.title + " remix", html: "", css: t.css, js: t.jsx }, { asNew: true, remix: { kind: "library", id: t.slug, title: t.title } });
      history.replaceState(null, "", "studio.html?lib=" + encodeURIComponent(slug));
      markDirty();
      return true;
    });
  }

  var dlg = $("st-lib");
  function openLibrary() {
    dlg.hidden = false;
    requestAnimationFrame(function () { dlg.classList.add("is-open"); });
    var list = $("st-lib-list");
    list.innerHTML = '<div class="cm-empty" style="padding:24px">Loading…</div>';
    library().then(function (items) {
      list.innerHTML = items.map(function (t) {
        return '<button type="button" data-slug="' + C.esc(t.slug) + '">' + C.esc(t.title) + "<span>React</span></button>";
      }).join("") || '<div class="cm-empty" style="padding:24px">No transitions available.</div>';
      var first = list.querySelector("button");
      if (first) first.focus();
    });
  }
  function closeLibrary() {
    dlg.classList.remove("is-open");
    setTimeout(function () { dlg.hidden = true; }, 200);
  }
  dlg.addEventListener("click", function (e) {
    if (e.target === dlg || e.target.closest("[data-close]")) { closeLibrary(); return; }
    var b = e.target.closest("button[data-slug]");
    if (!b) return;
    if (S.dirty && !isStarter() && !confirm("Replace the current code with this transition?")) return;
    startFromLibrary(b.getAttribute("data-slug")).then(closeLibrary);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !dlg.hidden) closeLibrary(); });

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

  function codeAsText() {
    if (S.mode === "react") {
      return "// " + S.title + " (React)\n" + S.files.js + "\n\n/* CSS */\n" + S.files.css;
    }
    return "<!-- " + S.title + " -->\n<style>\n" + S.files.css + "</style>\n\n" + S.files.html +
      (S.files.js.trim() ? "\n<script>\n" + S.files.js + "</script>\n" : "");
  }

  var copyBtn = $("st-copy");
  copyBtn.addEventListener("click", function () {
    navigator.clipboard.writeText(codeAsText()).then(function () {
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
      if (S.dirty && S.owner && !confirm("Start a new component? Unsaved changes will be lost.")) return;
      try { localStorage.removeItem(SCRATCH_KEY); } catch (err) {}
      history.replaceState(null, "", "studio.html");
      startNew(S.mode, false);
    } else if (act === "library") {
      openLibrary();
    } else if (act === "link") {
      navigator.clipboard.writeText(location.origin + "/studio.html?id=" + encodeURIComponent(S.id)).then(function () { C.toast("Link copied"); });
    } else if (act === "unpublish") {
      save(false, null);
    } else if (act === "delete") {
      if (!confirm("Delete “" + S.title + "”? This cannot be undone.")) return;
      C.api.remove(S.id).then(function (r) {
        if (r.error) { C.toast(C.errorText(r.error), "err"); return; }
        S.dirty = false;
        location.href = "community.html";
      });
    } else if (act === "report") {
      C.withAccount(function () {
        var reason = prompt("What is wrong with this component?", "");
        if (reason == null) return;
        C.api.report(S.id, reason || "unspecified").then(function (r) {
          C.toast(r.error ? C.errorText(r.error) : "Thanks. We will take a look.", r.error ? "err" : undefined);
        });
      });
    }
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

  function aiSize() {
    aiInput.style.height = "auto";
    aiInput.style.height = Math.min(aiInput.scrollHeight, 7 * 14 + 25) + "px";
    aiSend.disabled = !aiInput.value.trim() || busy;
  }
  aiInput.addEventListener("input", aiSize);
  aiInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!aiSend.disabled) runAI(aiInput.value.trim());
    }
  });
  aiForm.addEventListener("submit", function (e) { e.preventDefault(); if (!aiSend.disabled) runAI(aiInput.value.trim()); });

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

  // Pending turn: P28 thinking states, one line at a time with a cross-blur.
  var THINKING = ["Reading your request", "Sketching the markup", "Tuning the motion", "Checking the result"];
  function thinking() {
    var empty = $("st-chat-empty");
    if (empty) empty.remove();
    var row = document.createElement("div");
    row.className = "st-chat-thinking";
    var longest = THINKING.reduce(function (a, b) { return b.length > a.length ? b : a; }, "");
    row.innerHTML = '<span class="st-think-dot" aria-hidden="true"></span>' +
      '<span class="st-think-swap"><span class="st-think-sizer" aria-hidden="true">' + C.esc(longest) + "</span>" +
      '<span class="st-think-text" role="status"></span></span>';
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    var swap = row.querySelector(".st-think-swap");
    var i = 0;
    function set(el, t) { el.textContent = t; el.setAttribute("data-text", t); }
    set(row.querySelector(".st-think-text"), THINKING[0]);
    var timer = setInterval(function () {
      var cur = swap.querySelector(".st-think-text:not(.is-exit)");
      i = (i + 1) % THINKING.length;
      var next = document.createElement("span");
      next.className = "st-think-text is-enter-start";
      next.setAttribute("role", "status");
      set(next, THINKING[i]);
      swap.appendChild(next);
      cur.classList.add("is-exit");
      requestAnimationFrame(function () { requestAnimationFrame(function () { next.classList.remove("is-enter-start"); }); });
      setTimeout(function () { cur.remove(); }, 200);
    }, 2000);
    return function stop() { clearInterval(timer); row.remove(); };
  }

  function setBusy(on) {
    busy = on;
    if (on) aiForm.setAttribute("data-busy", ""); else aiForm.removeAttribute("data-busy");
    if (on) preview.setAttribute("aria-busy", "true"); else preview.removeAttribute("aria-busy");
    aiSize();
  }

  function paintQuota(q) {
    if (!q) return;
    quotaEl.textContent = q.remaining + " of " + q.limit + " drafts left this month";
    quotaEl.hidden = false;
  }

  function runAI(text) {
    if (!text || busy) return;
    C.withAccount(function () {
      say("user", C.esc(text));
      aiInput.value = "";
      setBusy(true);
      var stop = thinking();
      var fresh = isStarter() || (!S.files.html.trim() && !S.files.js.trim());
      var current = fresh ? null : { html: S.files.html, css: S.files.css, js: S.files.js };
      C.api.generate(text, S.mode, current).then(function (r) {
        stop();
        setBusy(false);
        if (r.error || !r.component) {
          say("error", C.esc(C.errorText(r.error || "generation_failed")));
          if (r.quota) paintQuota(r.quota);
          return;
        }
        var c = r.component;
        var before = { html: S.files.html, css: S.files.css, js: S.files.js };
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
        render();
        say("agent", (fresh ? "Built " : "Updated ") + "<strong>" + C.esc(S.title) + "</strong>" + (c.description ? ". " + C.esc(c.description) : "."));
        var changed = ["html", "css", "js"].filter(function (k) { return before[k] !== S.files[k] && S.files[k]; })
          .map(function (k) { return k === "js" ? (S.mode === "react" ? "Component" : "JS") : k.toUpperCase(); });
        if (changed.length) say("applied", "Changed " + changed.join(", "));
        paintQuota(r.quota);
      });
    });
  }

  aiSize();

  // ── Boot ────────────────────────────────────────────────────────────────────
  function boot() {
    var id = params.get("id");
    var remix = params.get("remix");
    var lib = params.get("lib");
    if (id) {
      preview.setAttribute("aria-busy", "true");
      C.api.get(id).then(function (r) {
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
      startNew("react", false);
      startFromLibrary(lib);
    } else if (params.get("ai") === "1") {
      var handoff = null;
      try { handoff = JSON.parse(sessionStorage.getItem("tdev:studio:ai") || "null"); sessionStorage.removeItem("tdev:studio:ai"); } catch (e) {}
      startNew(params.get("mode") === "react" ? "react" : "html", false);
      history.replaceState(null, "", "studio.html");
      if (handoff && handoff.prompt && Date.now() - (handoff.t || 0) < 10 * 60 * 1000) {
        aiInput.value = handoff.prompt;
        aiSize();
        runAI(handoff.prompt);
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
