// builder.html: the AI composer and your recent projects. community.html:
// the feed of published components. Each part runs when its markup is on
// the page.
(function () {
  "use strict";
  var C = window.Community;
  if (!C) return;
  // This script's ?v= (the page's asset version), for scripts loaded later.
  var ASSET_V = ((document.currentScript && document.currentScript.src) || "").replace(/^[^?]*/, "");

  // ── Tabs: the detail page's sliding-pill component (.proto-modal-tabs) ─────
  // The indicator takes the selected tab's offset and width; the first paint
  // snaps, later picks slide.
  function tabs(root, attr, onPick) {
    var ind = root.querySelector(".proto-modal-tabs-indicator");
    var btns = Array.prototype.slice.call(root.querySelectorAll(".proto-modal-tab"));
    function place(animate) {
      var sel = btns.filter(function (b) { return b.getAttribute("aria-selected") === "true"; })[0];
      if (!sel || !ind) return;
      if (!animate) ind.style.transition = "none";
      ind.style.transform = "translateX(" + sel.offsetLeft + "px)";
      ind.style.width = sel.offsetWidth + "px";
      if (!animate) { void ind.offsetWidth; ind.style.transition = ""; }
    }
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("aria-selected") === "true") return;
        btns.forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
        place(true);
        onPick(b.getAttribute(attr));
      });
    });
    place(false);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(false); });
    window.addEventListener("resize", function () { place(false); });
  }

  if (document.getElementById("cm-composer")) (function () {
    // ── Composer ────────────────────────────────────────────────────────────────
    var form = document.getElementById("cm-composer");
    var prompt = document.getElementById("cm-prompt");
    var send = document.getElementById("cm-send");
    var quotaEl = document.getElementById("cm-quota");
    var agentMenu = document.getElementById("cm-agent-menu");
    var fileInput = document.getElementById("cm-file");
    var remixBtn = document.getElementById("cm-remix-btn");
    var remixClear = document.getElementById("cm-remix-clear");
    var PLACEHOLDER = prompt.getAttribute("placeholder");
    var mode = "html";
    try { mode = localStorage.getItem("tdev:community:mode") === "react" ? "react" : "html"; } catch (e) {}
    var remix = null; // the library transition picked in the Remix pill

    if (window.TdevBeam) window.TdevBeam.mount(document.getElementById("cm-beam"));
    // The beam's tuning panel: localhost, or ?dev in the URL. Never for visitors.
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]dev\b/.test(location.search)) {
      var dev = document.createElement("script");
      dev.src = "assets/community/beam-dev.js" + ASSET_V;
      document.body.appendChild(dev);
    }

    // Both menus are the nav's 3-dot menu component (Community.dropdown).
    var setPlusMenu = C.dropdown(document.getElementById("cm-plus"), document.getElementById("cm-plus-menu"));
    var setAgentMenu = C.dropdown(document.getElementById("cm-agent"), agentMenu);

    var attach = C.attachments({ list: document.getElementById("cm-imgs"), drop: form, paste: prompt, onChange: canSend });
    document.getElementById("cm-upload").addEventListener("click", function () {
      setPlusMenu(false);
      fileInput.click();
    });
    // Add skill / Add library: both live in the Studio, so the + menu opens it
    // on that dialog, starting from the picked remix and keeping what was typed.
    document.querySelectorAll("#cm-plus-menu [data-add]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        setPlusMenu(false);
        var text = prompt.value.trim();
        try { if (text) sessionStorage.setItem("tdev:studio:prefill", text); } catch (err) {}
        location.href = "studio.html?add=" + a.getAttribute("data-add") +
          (remix ? "&lib=" + encodeURIComponent(remix.slug) : "&mode=" + buildMode());
      });
    });
    fileInput.addEventListener("change", function () {
      attach.add(fileInput.files);
      fileInput.value = "";
      prompt.focus();
    });

    // A remix in React starts from the library card (HTML/CSS) and the agent
    // rebuilds it as a React component.
    function buildMode() { return mode; }
    function paintMode() {
      var m = buildMode();
      agentMenu.querySelectorAll("[data-mode]").forEach(function (b) {
        b.setAttribute("aria-checked", String(b.getAttribute("data-mode") === m));
      });
    }
    agentMenu.addEventListener("click", function (e) {
      if (e.target.closest("[data-connect]")) {
        setAgentMenu(false);
        C.withAccount(function () { saveAgent("chatgpt"); window.TransitionsPro.oauth("chatgpt", "link"); });
        return;
      }
      var row = e.target.closest("[data-agent]");
      if (row) {
        if (e.target.closest("a") || row.classList.contains("is-locked")) return;
        var id = row.getAttribute("data-agent");
        if (id === "chatgpt" && !chatgpt.connected) {
          setAgentMenu(false);
          C.withAccount(function () { saveAgent("chatgpt"); window.TransitionsPro.oauth("chatgpt", "link"); });
          return;
        }
        saveAgent(id);
        paintAgents();
        setAgentMenu(false);
        prompt.focus();
        return;
      }
      var b = e.target.closest("[data-mode]");
      if (!b || b.disabled) return;
      mode = b.getAttribute("data-mode");
      try { localStorage.setItem("tdev:community:mode", mode); } catch (err) {}
      paintMode();
      setAgentMenu(false);
      prompt.focus();
    });

    // The model, the Studio's agent picker: Sonnet for everyone, Opus for Pro
    // and Business, ChatGPT on the person's own plan once the API offers it.
    // The pick lives in the Studio's context, so it carries over there.
    var CTX_KEY = "tdev:studio:context";
    var AGENTS = [
      { id: "sonnet", label: "Sonnet 5.5", sub: "Fast, everyday edits · usually 5 to 20 credits" },
      { id: "opus", label: "Opus 5.5", sub: "Best for complex work · usually 10 to 35 credits", paid: true },
      { id: "chatgpt", label: "ChatGPT", sub: "Your ChatGPT plan · no credits", plan: true },
    ];
    var CHECK = '<span class="tl-menu-check st-agent-check" aria-hidden="true">' +
      '<svg viewBox="0 0 16 16" fill="none"><path d="M4 8.4268L6.46155 11.19223L12 4.97001" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    var aiPaid = false;
    var chatgpt = { available: false, connected: false };
    function readCtx() { try { return JSON.parse(localStorage.getItem(CTX_KEY) || "null") || {}; } catch (e) { return {}; } }
    function saveAgent(id) {
      var c = readCtx();
      c.agent = id;
      try { localStorage.setItem(CTX_KEY, JSON.stringify(c)); } catch (e) {}
    }
    function agentChoice() {
      var a = readCtx().agent;
      if (a === "chatgpt" && chatgpt.available && chatgpt.connected) return "chatgpt";
      return aiPaid && a === "opus" ? "opus" : "sonnet";
    }
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
    var agentsEl = document.createElement("div");
    agentMenu.insertBefore(agentsEl, agentMenu.firstChild);
    function paintAgents() {
      var cur = agentChoice();
      // The button says "Agent"; the model shows in its tooltip and the menu.
      document.getElementById("cm-agent").title = "Agent: " + (cur === "chatgpt" ? "ChatGPT plan" : AGENTS.filter(function (a) { return a.id === cur; })[0].label);
      agentsEl.innerHTML = '<p class="tl-menu-group">Transitions UI agent</p>' +
        agentRow(AGENTS[0], cur) + agentRow(AGENTS[1], cur) +
        (chatgpt.available ? '<div class="tl-menu-divider"></div><p class="tl-menu-group">Your ChatGPT plan</p>' + agentRow(AGENTS[2], cur) : "") +
        '<div class="tl-menu-divider"></div>';
    }
    paintAgents();

    // Remix: right of +, opens the library picker. A pick shows its title,
    // and the chevron gives way to a clear button.
    function paintRemix() {
      document.getElementById("cm-remix").classList.toggle("is-picked", !!remix);
      document.getElementById("cm-remix-val").textContent = remix ? remix.title : "";
      remixBtn.setAttribute("aria-label", remix ? "Remixing " + remix.title + ". Pick another transition" : "Remix a library transition");
      remixClear.hidden = !remix;
      prompt.setAttribute("placeholder", remix ? "Describe your component or change" : PLACEHOLDER);
      paintMode();
      canSend();
    }
    remixBtn.addEventListener("click", function () {
      C.pickLibrary().then(function (t) {
        if (t) { remix = t; paintRemix(); }
        prompt.focus();
      });
    });
    remixClear.addEventListener("click", function () {
      remix = null;
      paintRemix();
      remixBtn.focus();
    });
    // Remix starts on Modal open/close, so the first send has something to
    // build from. Clear it to start from a prompt alone.
    var REMIX_DEFAULT = "modal-open-close";
    var remixTouched = false;
    remixBtn.addEventListener("click", function () { remixTouched = true; });
    remixClear.addEventListener("click", function () { remixTouched = true; });
    // A library card's Remix link opens the Builder with ?remix=<slug>.
    var REMIX_ASKED = new URLSearchParams(location.search).get("remix");
    C.library().then(function (items) {
      if (remix || remixTouched) return;
      var pick = function (slug) { return (items || []).filter(function (x) { return x.slug === slug; })[0]; };
      var t = (REMIX_ASKED && pick(REMIX_ASKED)) || pick(REMIX_DEFAULT);
      if (t) { remix = t; paintRemix(); }
      if (REMIX_ASKED) prompt.focus();
    });

    function canSend() {
      send.disabled = !prompt.value.trim() && !(attach && attach.count()) && !remix;
    }
    function autosize() {
      prompt.style.height = "auto";
      prompt.style.height = Math.min(prompt.scrollHeight, 200) + "px";
      canSend();
    }
    prompt.addEventListener("input", autosize);
    prompt.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!send.disabled) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit"));
      }
    });
    paintRemix();

    // The studio runs the draft so the visitor watches it land in the editor;
    // the prompt and images travel in sessionStorage to keep them out of the URL.
    // A remix with nothing to change just opens in the Studio.
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = prompt.value.trim();
      if (attach.busy()) { C.toast("Images are still loading."); return; }
      var images = attach.items();
      if (!text && !images.length) {
        if (!remix) return;
        // HTML/CSS: open the card as it is. React: the agent converts it.
        if (buildMode() !== "react") { location.href = "studio.html?lib=" + encodeURIComponent(remix.slug); return; }
      }
      send.setAttribute("aria-busy", "true");
      C.withAccount(function () {
        var m = buildMode();
        try {
          sessionStorage.setItem("tdev:studio:ai", JSON.stringify({
            prompt: text, mode: m, images: images, lib: remix ? remix.slug : null, t: Date.now(),
          }));
        } catch (err) {
          send.removeAttribute("aria-busy");
          C.toast("Those images are too large to send together. Remove one and try again.", "err");
          return;
        }
        location.href = "studio.html?ai=1&mode=" + m;
      });
      // Closing the sign-in without finishing leaves the composer usable.
      setTimeout(function () { send.removeAttribute("aria-busy"); }, 1200);
    });

    function paintQuota() {
      C.auth().then(function (s) {
        var rule = document.getElementById("cm-quota-rule");
        if (!s || !s.authenticated) { quotaEl.hidden = true; rule.hidden = true; return; }
        C.api.me().then(function (r) {
          if (!r || !r.quota) return;
          aiPaid = r.quota.tier === "paid";
          chatgpt = { available: !!(r.chatgpt && r.chatgpt.available), connected: !!(r.chatgpt && r.chatgpt.connected) };
          paintAgents();
          quotaEl.textContent = C.quotaText(r.quota);
          quotaEl.hidden = false;
          rule.hidden = false;
        });
      });
    }
    document.addEventListener("pro:me", paintQuota);
    paintQuota();
  })();

  // ── "Your projects" in the Community hero: signed-in visitors only ─────────
  // Shown at once from pro-client's cached sign-in, then confirmed by /me.
  if (document.getElementById("cm-hero-projects")) (function () {
    var btn = document.getElementById("cm-hero-projects");
    try { btn.hidden = !JSON.parse(localStorage.getItem("tdev:auth") || "{}").a; } catch (e) {}
    function paint() { C.auth().then(function (s) { btn.hidden = !(s && s.authenticated); }); }
    document.addEventListener("pro:me", paint);
    paint();
  })();

  // ── Your recent projects (Builder, signed in) ───────────────────────────────
  if (document.getElementById("cm-recent")) (function () {
    var box = document.getElementById("cm-recent");
    var grid = document.getElementById("cm-recent-grid");
    function load() {
      C.auth().then(function (s) {
        if (!s || !s.authenticated) { box.hidden = true; return; }
        C.api.me().then(function (r) {
          if (!r || !r.profile) return;
          C.api.profile(r.profile.handle).then(function (p) {
            var items = ((p && p.items) || []).slice().sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); }).slice(0, 4);
            box.hidden = !items.length;
            grid.innerHTML = "";
            items.forEach(function (c, i) {
              var el = C.card(c, { hideAuthor: true });
              el.style.animationDelay = i * 40 + "ms";
              grid.appendChild(el);
            });
          });
        });
      });
    }
    document.addEventListener("pro:me", load);
    load();
  })();

  if (document.getElementById("cm-grid")) (function () {
    // ── Feed ────────────────────────────────────────────────────────────────────
    var grid = document.getElementById("cm-grid");
    var more = document.getElementById("cm-more");
    var sort = "recent";
    var next = 0;
    var loading = false;
    var seq = 0;

    function ghosts(n) {
      var html = "";
      for (var i = 0; i < n; i++) {
        html += '<div class="card cm-ghost" aria-hidden="true"><div class="card-stage"></div>' +
          '<div class="card-meta"><span class="cm-ghost-line" style="width:60%"></span><span class="cm-ghost-line" style="width:36%"></span></div></div>';
      }
      return html;
    }

    function load(reset) {
      if (loading && !reset) return;
      var my = ++seq;
      loading = true;
      if (reset) { next = 0; grid.innerHTML = ghosts(6); more.hidden = true; }
      more.disabled = true;
      C.api.feed(sort, next).then(function (r) {
        if (my !== seq) return;
        loading = false;
        more.disabled = false;
        grid.querySelectorAll(".cm-ghost").forEach(function (g) { g.remove(); });
        if (r.error) {
          if (!grid.children.length) grid.innerHTML = '<div class="cm-empty"><strong>The feed did not load.</strong>' + C.esc(C.errorText(r.error)) + "</div>";
          return;
        }
        if (!r.items.length && !grid.children.length) {
          grid.innerHTML = '<div class="cm-empty"><strong>Nothing here yet.</strong>Be the first: <a class="cm-link" href="builder.html">build a component</a> and publish it.</div>';
        }
        r.items.forEach(function (c, i) {
          var el = C.card(c);
          el.style.animationDelay = Math.min(i, 8) * 40 + "ms";
          grid.appendChild(el);
        });
        next = r.next_offset;
        more.hidden = next == null;
      });
    }

    tabs(document.getElementById("cm-sort"), "data-sort", function (s) {
      sort = s;
      document.getElementById("cm-feed-title").textContent = s === "popular" ? "Most viewed" : "Recently built";
      load(true);
    });
    more.addEventListener("click", function () { load(false); });
    load(true);
  })();
})();
