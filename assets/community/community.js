// Community runtime shared by community.html, studio.html and profile.html:
// the API client, the sandboxed preview, and the component card.
//
// Security model: community code is untrusted. Every preview is an iframe with
// sandbox="allow-scripts" and no allow-same-origin, so it runs at an opaque
// origin: no cookies, no storage, no access to this page. A CSP inside the
// frame limits network access to esm.sh (React mode imports), and the API
// rejects cookie-authenticated writes whose Origin is not the site, so a
// preview cannot like, publish or spend AI quota as the viewer.
(function () {
  "use strict";

  var API = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "http://localhost:8787"
    : "https://api.transitions.dev";

  function call(path, method, body) {
    return fetch(API + path, {
      method: method || "GET",
      credentials: "include",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var data = {};
        try { data = t ? JSON.parse(t) : {}; } catch (e) { data = { error: "bad_response" }; }
        if (!r.ok && !data.error) data.error = "http_" + r.status;
        data.__status = r.status;
        return data;
      });
    }).catch(function () { return { error: "network", __status: 0 }; });
  }

  var api = {
    feed: function (sort, offset) { return call("/community/feed?sort=" + (sort || "recent") + "&offset=" + (offset || 0)); },
    get: function (id) { return call("/community/c/" + encodeURIComponent(id)); },
    profile: function (handle) { return call("/community/u/" + encodeURIComponent(handle)); },
    me: function () { return call("/community/me"); },
    updateMe: function (fields) { return call("/community/me", "POST", fields); },
    create: function (c) { return call("/community/c", "POST", c); },
    update: function (id, c) { return call("/community/c/" + encodeURIComponent(id), "POST", c); },
    remove: function (id) { return call("/community/c/" + encodeURIComponent(id) + "/delete", "POST", {}); },
    like: function (id, liked) { return call("/community/c/" + encodeURIComponent(id) + "/like", "POST", { liked: liked }); },
    report: function (id, reason) { return call("/community/c/" + encodeURIComponent(id) + "/report", "POST", { reason: reason }); },
    generate: function (prompt, mode, current) { return call("/community/generate", "POST", { prompt: prompt, mode: mode, current: current || null }); },
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function siteTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  // Signed in? Resolves once pro-client's own /me call has answered, so a
  // signed-in visitor is never shown the sign-in box while it is in flight.
  function auth() {
    var tp = window.TransitionsPro;
    if (!tp) return Promise.resolve({ authenticated: false });
    if (tp.state && tp.state.resolved) return Promise.resolve(tp.state);
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; resolve(tp.state); }
      document.addEventListener("pro:me", finish, { once: true });
      setTimeout(function () {
        if (done) return;
        (tp.refresh ? tp.refresh() : Promise.resolve()).then(finish, finish);
      }, 4000);
    });
  }

  // Run `fn` with an account, opening the community sign-in first if needed.
  function withAccount(fn) {
    var tp = window.TransitionsPro;
    if (!tp || !tp.joinCommunity) { fn(); return; }
    auth().then(function () { tp.joinCommunity(fn); });
  }

  // ── React mode: compile + imports ───────────────────────────────────────────
  // Sucrase only rewrites text (TSX to JS), so it runs here on the page; the
  // result executes inside the sandbox.
  var REACT = "19.1.0";
  var sucraseP = null;
  function loadSucrase() {
    if (!sucraseP) {
      sucraseP = import("https://esm.sh/sucrase@3.35.0?bundle").catch(function (e) {
        sucraseP = null;
        throw e;
      });
    }
    return sucraseP;
  }
  function compileReact(src) {
    return loadSucrase().then(function (s) {
      return s.transform(src, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "automatic",
        production: true,
        filePath: "Component.tsx",
      }).code;
    });
  }

  function bareImports(code) {
    var specs = {};
    var re = /\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
    var m;
    while ((m = re.exec(code))) {
      var s = m[1] || m[2] || m[3];
      if (!s || /^(\.|\/|https?:|data:|blob:)/.test(s)) continue;
      specs[s] = true;
    }
    return Object.keys(specs);
  }

  function importMap(code) {
    var map = {
      "react": "https://esm.sh/react@" + REACT,
      "react/jsx-runtime": "https://esm.sh/react@" + REACT + "/jsx-runtime",
      "react-dom": "https://esm.sh/react-dom@" + REACT + "?external=react",
      "react-dom/client": "https://esm.sh/react-dom@" + REACT + "/client?external=react",
    };
    bareImports(code).forEach(function (s) {
      if (!map[s]) map[s] = "https://esm.sh/" + s + "?external=react,react-dom";
    });
    return { imports: map };
  }

  // ── Sandbox document ────────────────────────────────────────────────────────
  var CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src data: https://fonts.gstatic.com",
    "img-src data: blob: https://images.unsplash.com",
    "media-src data: blob:",
    "connect-src https://esm.sh",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  // Matches the library card stage, so a preview blends into the card.
  var STAGE_CSS =
    ":root{--stage-bg:#f9f9f9;--stage-fg:#0d0d0d;--stage-muted:#6c6c6c;--stage-border:rgba(0,0,0,.08);" +
    "--stage-surface:#fff;--stage-accent:#0073e5;--stage-on-accent:#fff;color-scheme:light}" +
    "html[data-theme=dark]{--stage-bg:#131313;--stage-fg:#f2f2f2;--stage-muted:rgba(202,202,202,.7);" +
    "--stage-border:rgba(255,255,255,.08);--stage-surface:#1d1d1d;--stage-accent:#55cfff;--stage-on-accent:#04131a;color-scheme:dark}" +
    "html,body{margin:0;height:100%}" +
    "body{background:var(--stage-bg);color:var(--stage-fg);display:grid;place-items:center;overflow:hidden;" +
    "font:14px/1.45 Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
    "-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}";

  // Reports errors (and, in the studio, console output) to the page, and
  // follows the site's light/dark switch without a reload.
  var BRIDGE =
    "(function(){function s(m){try{m.__tdev=1;parent.postMessage(m,'*')}catch(e){}}" +
    "window.__tdevSend=s;" +
    "addEventListener('error',function(e){s({type:'error',message:String(e.message||'Error'),line:e.lineno||0})});" +
    "addEventListener('unhandledrejection',function(e){var r=e.reason;s({type:'error',message:String(r&&r.message||r)})});" +
    "['log','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){try{s({type:'console',level:k," +
    "text:[].map.call(arguments,function(a){try{return typeof a==='string'?a:JSON.stringify(a)}catch(e){return String(a)}}).join(' ').slice(0,2000)})}catch(e){}" +
    "return o.apply(console,arguments)}});" +
    "addEventListener('message',function(e){var d=e.data;if(d&&d.__tdev&&d.type==='theme')document.documentElement.setAttribute('data-theme',d.theme)});" +
    "})();";

  function scriptSafe(s) { return String(s).replace(/<\/script/gi, "<\\/script"); }

  function srcdoc(c, compiled, theme) {
    var head =
      '<!doctype html><html data-theme="' + (theme || "light") + '"><head><meta charset="utf-8">' +
      '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      "<style>" + STAGE_CSS + "</style><script>" + BRIDGE + "</script>";
    if (c.mode === "react") {
      return head +
        '<script type="importmap">' + scriptSafe(JSON.stringify(importMap(compiled))) + "</script>" +
        "<style>" + scriptSafe(c.css || "") + "</style></head><body><div id=\"root\"></div>" +
        '<script type="module">' +
        "import React from 'react';import {createRoot} from 'react-dom/client';" +
        "const code=" + scriptSafe(JSON.stringify(compiled)) + ";" +
        "try{const u=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));const m=await import(u);" +
        "const C=m.default||Object.values(m).find(v=>typeof v==='function');" +
        "if(!C)throw new Error('Export a component: export default function MyComponent() { ... }');" +
        "createRoot(document.getElementById('root')).render(React.createElement(C));window.__tdevSend({type:'ready'});" +
        "}catch(e){window.__tdevSend({type:'error',message:String(e&&e.message||e)})}" +
        "</script></body></html>";
    }
    // A meta refresh would navigate the frame to a page without our CSP.
    var html = String(c.html || "").replace(/<meta\b[^>]*http-equiv[^>]*>/gi, "");
    return head +
      "<style>" + scriptSafe(c.css || "") + "</style></head><body>" + html +
      "<script>" + scriptSafe(c.js || "") + "\n;window.__tdevSend({type:'ready'})</script></body></html>";
  }

  // Frames listen for theme changes; one observer serves every preview.
  var frames = new Set();
  new MutationObserver(function () {
    var t = siteTheme();
    frames.forEach(function (f) {
      if (!f.isConnected) { frames.delete(f); return; }
      try { f.contentWindow.postMessage({ __tdev: 1, type: "theme", theme: t }, "*"); } catch (e) {}
    });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // Messages from previews: only trusted when they come from a frame we made.
  var handlers = new WeakMap();
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || !d.__tdev) return;
    frames.forEach(function (f) {
      if (f.contentWindow === e.source) {
        var h = handlers.get(f);
        if (h) h(d);
      }
    });
  });

  // Renders a component into `host` (replacing any previous preview).
  // opts.onMessage receives {type:'ready'|'error'|'console', ...}.
  function mountPreview(host, c, opts) {
    opts = opts || {};
    var token = (host.__cmToken || 0) + 1;
    host.__cmToken = token;
    var ready = c.mode === "react"
      ? compileReact(c.js || "").then(function (code) { return { code: code }; }, function (e) { return { err: e }; })
      : Promise.resolve({ code: "" });
    return ready.then(function (res) {
      if (host.__cmToken !== token) return null;
      var old = host.querySelector("iframe.cm-frame");
      var f = document.createElement("iframe");
      f.className = "cm-frame";
      f.setAttribute("sandbox", "allow-scripts");
      f.setAttribute("title", (c.title || "Component") + " preview");
      f.setAttribute("referrerpolicy", "no-referrer");
      // A preview gets exactly one document. A second load means the code
      // navigated the frame somewhere else (a page our CSP no longer
      // covers), so the frame is dropped instead of shown.
      var loads = 0;
      f.addEventListener("load", function () {
        loads++;
        if (loads === 1) { f.classList.add("is-loaded"); return; }
        frames.delete(f);
        f.remove();
        host.setAttribute("data-state", "error");
        if (opts.onMessage) opts.onMessage({ type: "error", message: "Previews cannot navigate to another page." });
      });
      handlers.set(f, function (m) {
        if (m.type === "ready") host.setAttribute("data-state", "ready");
        if (m.type === "error") host.setAttribute("data-state", "error");
        if (opts.onMessage) opts.onMessage(m);
      });
      frames.add(f);
      if (res.err) {
        var msg = String(res.err && res.err.message || res.err);
        f.srcdoc = srcdoc({ mode: "html", html: "", css: "", js: "" }, "", siteTheme());
        setTimeout(function () { if (opts.onMessage) opts.onMessage({ type: "error", message: msg }); }, 0);
        host.setAttribute("data-state", "error");
      } else {
        f.srcdoc = srcdoc(c, res.code, siteTheme());
      }
      host.appendChild(f);
      if (old) {
        // Swap only once the new frame has painted, so edits do not flash.
        f.addEventListener("load", function () { if (old.parentNode) old.remove(); frames.delete(old); }, { once: true });
        setTimeout(function () { if (old.parentNode) old.remove(); frames.delete(old); }, 1500);
      }
      return f;
    });
  }

  function unmountPreview(host) {
    host.__cmToken = (host.__cmToken || 0) + 1;
    host.querySelectorAll("iframe.cm-frame").forEach(function (f) { frames.delete(f); f.remove(); });
    host.removeAttribute("data-state");
  }

  // Grid previews mount near the viewport and unmount far from it, so a long
  // feed never keeps dozens of live documents running at once.
  var lazy = new WeakMap();
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var c = lazy.get(en.target);
      if (!c) return;
      if (en.isIntersecting) {
        if (!en.target.querySelector("iframe.cm-frame")) mountPreview(en.target, c);
      } else {
        unmountPreview(en.target);
      }
    });
  }, { rootMargin: "400px 0px" }) : null;

  function lazyPreview(host, c) {
    lazy.set(host, c);
    if (io) io.observe(host); else mountPreview(host, c);
  }

  // ── Card ────────────────────────────────────────────────────────────────────
  var HEART =
    '<svg class="cm-heart" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.6s-5.5-3.2-5.5-7.1A2.9 2.9 0 0 1 8 4.7a2.9 2.9 0 0 1 5.5 1.8c0 3.9-5.5 7.1-5.5 7.1Z" ' +
    'fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  function initials(a) {
    var n = (a && (a.display_name || a.handle)) || "?";
    return n.trim().charAt(0).toUpperCase();
  }

  function studioUrl(c) { return "studio.html?id=" + encodeURIComponent(c.id); }
  function profileUrl(handle) { return "profile.html?u=" + encodeURIComponent(handle); }

  function card(c, opts) {
    opts = opts || {};
    var el = document.createElement("article");
    el.className = "card cm-card";
    el.setAttribute("data-id", c.id);
    var a = c.author || {};
    var status = !c.published ? '<span class="cm-badge">Draft</span>' : c.hidden ? '<span class="cm-badge cm-badge--warn">Hidden</span>' : "";
    el.innerHTML =
      '<div class="card-stage cm-stage" data-cm-stage></div>' +
      '<a class="cm-open" href="' + esc(studioUrl(c)) + '" aria-label="Open ' + esc(c.title) + '">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.2 3.8 7.5 8.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      "</a>" +
      '<div class="card-meta cm-meta">' +
        '<a class="card-title cm-title" href="' + esc(studioUrl(c)) + '">' + esc(c.title) + status + "</a>" +
        (opts.hideAuthor || !a.handle ? '<span class="card-subtitle cm-sub">' + (c.mode === "react" ? "React" : "HTML/CSS") + "</span>"
          : '<a class="card-subtitle cm-author" href="' + esc(profileUrl(a.handle)) + '"><span class="cm-avatar" aria-hidden="true">' +
            esc(initials(a)) + "</span>" + esc(a.display_name || a.handle) + "</a>") +
      "</div>" +
      (c.published && !c.hidden
        ? '<button type="button" class="cm-like" aria-pressed="' + (c.liked ? "true" : "false") + '" aria-label="Like">' +
            HEART + '<span class="cm-like-count">' + (c.likes || 0) + "</span></button>"
        : "");
    lazyPreview(el.querySelector("[data-cm-stage]"), c);
    var like = el.querySelector(".cm-like");
    if (like) wireLike(like, c);
    return el;
  }

  // Optimistic like: flip now, reconcile with the server's count after.
  function wireLike(btn, c) {
    var countEl = btn.querySelector(".cm-like-count");
    btn.addEventListener("click", function () {
      withAccount(function () {
        var next = btn.getAttribute("aria-pressed") !== "true";
        var n = parseInt(countEl.textContent, 10) || 0;
        btn.setAttribute("aria-pressed", String(next));
        countEl.textContent = String(Math.max(0, n + (next ? 1 : -1)));
        if (next) { btn.classList.remove("is-popping"); void btn.offsetWidth; btn.classList.add("is-popping"); }
        api.like(c.id, next).then(function (r) {
          if (r.error) {
            btn.setAttribute("aria-pressed", String(!next));
            countEl.textContent = String(n);
            return;
          }
          countEl.textContent = String(r.likes);
          c.liked = next; c.likes = r.likes;
        });
      });
    });
  }

  function toast(msg, kind) {
    var t = document.createElement("div");
    t.className = "cm-toast" + (kind ? " cm-toast--" + kind : "");
    t.setAttribute("role", "status");
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("is-open"); });
    setTimeout(function () {
      t.classList.remove("is-open");
      setTimeout(function () { t.remove(); }, 250);
    }, 2600);
  }

  var ERRORS = {
    unauthenticated: "Sign in to continue.",
    bad_origin: "This action has to come from transitions.dev.",
    quota_exceeded: "You have used this month’s AI drafts. They reset on the 1st.",
    capacity: "AI drafts are busy today. Try again tomorrow.",
    busy: "The AI is busy right now. Try again in a minute.",
    refused: "That request could not be drafted. Try describing it differently.",
    too_long: "That draft ran too long. Try a smaller component.",
    generation_failed: "The draft did not come through. Try again.",
    ai_unavailable: "AI drafts are not available right now.",
    code_too_large: "That code is over the 100 KB limit.",
    too_many_components: "You have reached the component limit.",
    handle_taken: "That handle is taken.",
    invalid_handle: "Handles are 3 to 24 lowercase letters, numbers or dashes.",
    rate_limited: "Too many requests. Slow down for a moment.",
    network: "Network error. Check your connection.",
  };
  function errorText(code) { return ERRORS[code] || "Something went wrong. Please try again."; }

  window.Community = {
    api: api,
    esc: esc,
    auth: auth,
    withAccount: withAccount,
    mountPreview: mountPreview,
    unmountPreview: unmountPreview,
    lazyPreview: lazyPreview,
    compileReact: compileReact,
    card: card,
    wireLike: wireLike,
    toast: toast,
    errorText: errorText,
    studioUrl: studioUrl,
    profileUrl: profileUrl,
    initials: initials,
    siteTheme: siteTheme,
  };
})();
