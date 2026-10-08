// projects.html: everything you built, drafts and published, newest change
// first, with All / Published / Drafts tabs.
(function () {
  "use strict";
  var C = window.Community;
  if (!C) return;
  var $ = function (id) { return document.getElementById(id); };
  var grid = $("pj-grid");
  var items = [];
  var show = "all";
  var drafts = null;   // { used, limit }: limit null on Pro and Business

  // The detail page's sliding-pill tabs (.proto-modal-tabs).
  var tabsRoot = $("pj-tabs");
  var ind = tabsRoot.querySelector(".proto-modal-tabs-indicator");
  var btns = Array.prototype.slice.call(tabsRoot.querySelectorAll(".proto-modal-tab"));
  function place(animate) {
    var sel = btns.filter(function (b) { return b.getAttribute("aria-selected") === "true"; })[0];
    if (!sel || !ind) return;
    if (!animate) ind.style.transition = "none";
    ind.style.width = sel.offsetWidth + "px";
    ind.style.transform = "translateX(" + sel.offsetLeft + "px)";
    if (!animate) { void ind.offsetWidth; ind.style.transition = ""; }
  }
  btns.forEach(function (b) {
    b.addEventListener("click", function () {
      btns.forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      place(true);
      show = b.getAttribute("data-show");
      paint();
    });
  });
  // projects.html?show=drafts opens on that tab (the Studio links here when
  // the free draft limit is reached).
  var wanted = new URLSearchParams(location.search).get("show");
  btns.forEach(function (b) {
    if (wanted && b.getAttribute("data-show") === wanted) {
      btns.forEach(function (x) { x.setAttribute("aria-selected", String(x === b)); });
      show = wanted;
    }
  });
  place(false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { place(false); });
  window.addEventListener("resize", function () { place(false); });

  function paint() {
    var list = items.filter(function (c) {
      return show === "all" || (show === "published" ? c.published : !c.published);
    });
    var pub = items.filter(function (c) { return c.published && c.review !== "pending"; }).length;
    var waiting = items.filter(function (c) { return c.published && c.review === "pending"; }).length;
    var count = $("pj-count");
    count.textContent = items.length
      ? items.length + (items.length === 1 ? " project" : " projects") + " · " + pub + " published" +
        (waiting ? " · " + waiting + " in review" : "")
      : "";
    // Free accounts keep 10 private drafts at a time; published work does not count.
    if (drafts && drafts.limit !== null) {
      count.appendChild(document.createTextNode((items.length ? " · " : "") + drafts.used + " of " + drafts.limit + " private drafts"));
      if (drafts.used >= drafts.limit) {
        var a = document.createElement("a");
        a.className = "cm-link";
        a.href = "pro.html";
        a.textContent = "Get Pro for unlimited";
        count.appendChild(document.createTextNode(" · "));
        count.appendChild(a);
      }
    }
    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = items.length
        ? '<div class="cm-empty"><strong>' + (show === "published" ? "Nothing published yet." : "No drafts.") + "</strong></div>"
        : '<div class="cm-empty"><strong>No projects yet.</strong><a class="cm-link" href="builder.html">Build your first one</a> with the agent, or start from a library transition.</div>';
      return;
    }
    list.forEach(function (c, i) {
      var el = C.card(c, { hideAuthor: true });
      el.style.animationDelay = Math.min(i, 8) * 40 + "ms";
      grid.appendChild(el);
    });
  }

  function load() {
    C.auth().then(function (s) {
      if (!s || !s.authenticated) {
        grid.innerHTML = '<div class="cm-empty"><strong>Sign in to see your projects.</strong><button type="button" class="cm-link" id="pj-signin">Sign in</button></div>';
        $("pj-signin").addEventListener("click", function () { C.withAccount(function () { load(); }); });
        return;
      }
      C.api.me().then(function (r) {
        if (!r || !r.profile) return;
        drafts = r.drafts || null;
        C.api.profile(r.profile.handle).then(function (p) {
          if (p.error) { grid.innerHTML = '<div class="cm-empty"><strong>Projects did not load.</strong>' + C.esc(C.errorText(p.error)) + "</div>"; return; }
          items = (p.items || []).slice().sort(function (a, b) { return (b.updated_at || 0) - (a.updated_at || 0); });
          paint();
        });
      });
    });
  }
  document.addEventListener("pro:me", load);
  load();
})();
