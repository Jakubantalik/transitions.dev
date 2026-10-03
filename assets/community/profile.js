// profile.html?u=<handle>: a member's published components (and, for the
// owner, drafts), plus profile editing. Without ?u= it opens your own.
(function () {
  "use strict";
  var C = window.Community;
  if (!C) return;
  var $ = function (id) { return document.getElementById(id); };
  var handle = new URLSearchParams(location.search).get("u");
  var profile = null;

  function paint(r) {
    profile = r.profile;
    var p = r.profile;
    var name = p.display_name || p.handle;
    // The account picture when there is one, the initial otherwise.
    var av = $("pf-avatar");
    av.textContent = C.initials(p);
    if (p.avatar_url) {
      var img = document.createElement("img");
      img.src = C.apiUrl(p.avatar_url);
      img.alt = "";
      av.appendChild(img);
    }
    $("pf-name").textContent = name;
    $("pf-handle").textContent = "@" + p.handle;
    $("pf-bio").textContent = p.bio || "";
    $("pf-bio").hidden = !p.bio;
    var st = r.stats || {};
    $("pf-stats").innerHTML =
      "<span><strong>" + (st.components || 0) + "</strong> " + (st.components === 1 ? "component" : "components") + "</span>" +
      "<span><strong>" + (st.views || 0) + "</strong> " + (st.views === 1 ? "view" : "views") + "</span>";
    $("pf-stats").hidden = false;
    $("pf-actions").hidden = !r.owner;
    document.title = name + " (@" + p.handle + ") | Transitions.dev Community";

    var grid = $("pf-grid");
    grid.innerHTML = "";
    if (!r.items.length) {
      grid.innerHTML = r.owner
        ? '<div class="cm-empty"><strong>No components yet.</strong><a class="cm-link" href="studio.html">Build your first one</a> or <a class="cm-link" href="community.html">describe one to the AI</a>.</div>'
        : '<div class="cm-empty"><strong>No published components yet.</strong></div>';
      return;
    }
    r.items.forEach(function (c, i) {
      var el = C.card(c, { hideAuthor: true });
      el.style.animationDelay = Math.min(i, 8) * 40 + "ms";
      grid.appendChild(el);
    });
  }

  function load() {
    if (!handle) {
      // No handle: your own profile, created on first visit.
      C.auth().then(function (s) {
        if (!s || !s.authenticated) {
          C.withAccount(function () { location.reload(); });
          $("pf-name").textContent = "Sign in to see your profile";
          return;
        }
        C.api.me().then(function (r) {
          if (r.profile) {
            handle = r.profile.handle;
            history.replaceState(null, "", C.profileUrl(handle));
            load();
          }
        });
      });
      return;
    }
    C.api.profile(handle).then(function (r) {
      if (r.error) {
        $("pf-name").textContent = r.error === "not_found" ? "Profile not found" : "Profile did not load";
        $("pf-handle").textContent = r.error === "not_found" ? "No member uses @" + handle + "." : C.errorText(r.error);
        return;
      }
      paint(r);
    });
  }

  // ── Edit ────────────────────────────────────────────────────────────────────
  var form = $("pf-form");
  var err = $("pf-form-err");
  $("pf-edit").addEventListener("click", function () {
    $("pf-in-name").value = profile.display_name || "";
    $("pf-in-handle").value = profile.handle;
    $("pf-in-bio").value = profile.bio || "";
    err.hidden = true;
    form.hidden = false;
    $("pf-actions").hidden = true;
    $("pf-in-name").focus();
  });
  $("pf-cancel").addEventListener("click", function () {
    form.hidden = true;
    $("pf-actions").hidden = false;
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    C.api.updateMe({
      display_name: $("pf-in-name").value,
      handle: $("pf-in-handle").value.trim().toLowerCase(),
      bio: $("pf-in-bio").value,
    }).then(function (r) {
      btn.disabled = false;
      if (r.error) { err.textContent = C.errorText(r.error); err.hidden = false; return; }
      form.hidden = true;
      handle = r.profile.handle;
      history.replaceState(null, "", C.profileUrl(handle));
      load();
      C.toast("Profile saved");
    });
  });

  load();
})();
