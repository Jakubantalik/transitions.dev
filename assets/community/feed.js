// community.html: the AI composer and the feed of published components.
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

  // ── Composer ────────────────────────────────────────────────────────────────
  var form = document.getElementById("cm-composer");
  var prompt = document.getElementById("cm-prompt");
  var send = document.getElementById("cm-send");
  var scratch = document.getElementById("cm-scratch");
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
  fileInput.addEventListener("change", function () {
    attach.add(fileInput.files);
    fileInput.value = "";
    prompt.focus();
  });

  // A remix starts from the library card itself (HTML, CSS and JS).
  function buildMode() { return remix ? "html" : mode; }
  function paintMode() {
    var m = buildMode();
    agentMenu.querySelectorAll("[data-mode]").forEach(function (b) {
      var locked = !!remix && b.getAttribute("data-mode") === "react";
      b.setAttribute("aria-checked", String(b.getAttribute("data-mode") === m));
      b.disabled = locked;
      if (locked) b.title = "A remix starts from the library card's HTML/CSS"; else b.removeAttribute("title");
    });
    document.getElementById("cm-agent").setAttribute("title", "Agent builds in " + (m === "react" ? "React" : "HTML/CSS"));
    scratch.href = "studio.html?mode=" + mode;
  }
  agentMenu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-mode]");
    if (!b || b.disabled) return;
    mode = b.getAttribute("data-mode");
    try { localStorage.setItem("tdev:community:mode", mode); } catch (err) {}
    paintMode();
    setAgentMenu(false);
    prompt.focus();
  });

  // Remix: right of +, opens the library picker. A pick shows its thumbnail
  // and title, and the chevron gives way to a clear button.
  function paintRemix() {
    var thumb = document.getElementById("cm-remix-thumb");
    document.getElementById("cm-remix").classList.toggle("is-picked", !!remix);
    document.getElementById("cm-remix-val").textContent = remix ? remix.title : "Pick one";
    thumb.innerHTML = remix
      ? '<img class="is-light" src="' + C.thumbUrl(remix.slug) + '" alt="" /><img class="is-dark" src="' + C.thumbUrl(remix.slug, true) + '" alt="" />'
      : "";
    thumb.hidden = !remix;
    remixBtn.setAttribute("aria-label", remix ? "Remixing " + remix.title + ". Pick another transition" : "Remix a library transition");
    remixClear.hidden = !remix;
    prompt.setAttribute("placeholder", remix ? "Describe your changes, or just send" : PLACEHOLDER);
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
      if (remix) location.href = "studio.html?lib=" + encodeURIComponent(remix.slug);
      return;
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
        quotaEl.textContent = r.quota.remaining + " of " + r.quota.limit + " drafts left this month";
        quotaEl.hidden = false;
        rule.hidden = false;
      });
    });
  }
  document.addEventListener("pro:me", paintQuota);
  paintQuota();

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
        grid.innerHTML = '<div class="cm-empty"><strong>Nothing here yet.</strong>Be the first: describe a component above, or <a class="cm-link" href="studio.html">start from scratch</a>.</div>';
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
