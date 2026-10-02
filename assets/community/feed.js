// community.html: the AI composer and the feed of published components.
(function () {
  "use strict";
  var C = window.Community;
  if (!C) return;

  // ── Segmented controls ──────────────────────────────────────────────────────
  function seg(root, attr, onPick) {
    var btns = Array.prototype.slice.call(root.querySelectorAll("button"));
    var pressedAttr = root.getAttribute("role") === "tablist" ? "aria-selected" : "aria-pressed";
    function pick(i, silent) {
      btns.forEach(function (b, k) { b.setAttribute(pressedAttr, String(k === i)); });
      root.style.setProperty("--seg-i", String(i));
      if (!silent) onPick(btns[i].getAttribute(attr));
    }
    btns.forEach(function (b, i) { b.addEventListener("click", function () { pick(i); }); });
    return pick;
  }

  // ── Dropdown menus (composer + and Agent) ────────────────────────────────────
  // Shared with the studio's menus: .st-menu toggled by its anchor's button.
  function menu(btn, panel) {
    function set(open) {
      panel.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
    }
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !panel.classList.contains("is-open");
      document.querySelectorAll(".st-menu.is-open").forEach(function (m) { if (m !== panel) m.classList.remove("is-open"); });
      document.querySelectorAll("[aria-haspopup=menu][aria-expanded=true]").forEach(function (b) { if (b !== btn) b.setAttribute("aria-expanded", "false"); });
      set(open);
    });
    document.addEventListener("click", function (e) { if (!panel.contains(e.target)) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
    return set;
  }

  // ── Composer ────────────────────────────────────────────────────────────────
  var form = document.getElementById("cm-composer");
  var prompt = document.getElementById("cm-prompt");
  var send = document.getElementById("cm-send");
  var scratch = document.getElementById("cm-scratch");
  var quotaEl = document.getElementById("cm-quota");
  var agentMenu = document.getElementById("cm-agent-menu");
  var mode = "html";
  try { mode = localStorage.getItem("tdev:community:mode") === "react" ? "react" : "html"; } catch (e) {}

  menu(document.getElementById("cm-plus"), document.getElementById("cm-plus-menu"));
  var setAgentMenu = menu(document.getElementById("cm-agent"), agentMenu);

  function paintMode() {
    agentMenu.querySelectorAll("[data-mode]").forEach(function (b) {
      b.setAttribute("aria-checked", String(b.getAttribute("data-mode") === mode));
    });
    document.getElementById("cm-agent").setAttribute("title", "Agent builds in " + (mode === "react" ? "React" : "HTML/CSS"));
    scratch.href = "studio.html?mode=" + mode;
  }
  agentMenu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-mode]");
    if (!b) return;
    mode = b.getAttribute("data-mode");
    try { localStorage.setItem("tdev:community:mode", mode); } catch (err) {}
    paintMode();
    setAgentMenu(false);
    prompt.focus();
  });
  paintMode();

  function autosize() {
    prompt.style.height = "auto";
    prompt.style.height = Math.min(prompt.scrollHeight, 200) + "px";
    send.disabled = !prompt.value.trim();
  }
  prompt.addEventListener("input", autosize);
  prompt.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!send.disabled) form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit"));
    }
  });

  // The studio runs the draft so the visitor watches it land in the editor;
  // the prompt travels in sessionStorage to keep it out of the URL.
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = prompt.value.trim();
    if (!text) return;
    send.setAttribute("aria-busy", "true");
    C.withAccount(function () {
      try { sessionStorage.setItem("tdev:studio:ai", JSON.stringify({ prompt: text, mode: mode, t: Date.now() })); } catch (err) {}
      location.href = "studio.html?ai=1&mode=" + mode;
    });
    // Closing the sign-in without finishing leaves the composer usable.
    setTimeout(function () { send.removeAttribute("aria-busy"); }, 1200);
  });

  function paintQuota() {
    C.auth().then(function (s) {
      if (!s || !s.authenticated) { quotaEl.hidden = true; return; }
      C.api.me().then(function (r) {
        if (!r || !r.quota) return;
        quotaEl.textContent = r.quota.remaining + " of " + r.quota.limit + " drafts left this month";
        quotaEl.hidden = false;
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

  seg(document.getElementById("cm-sort"), "data-sort", function (s) {
    sort = s;
    document.getElementById("cm-feed-title").textContent = s === "popular" ? "Most liked" : "Recently built";
    load(true);
  });
  more.addEventListener("click", function () { load(false); });
  load(true);
})();
