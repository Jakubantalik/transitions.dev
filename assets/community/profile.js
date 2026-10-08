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
    // Avvvatars-style letters and colors, as in the nav (pro-client avatarFor).
    var tp = window.TransitionsPro;
    av.textContent = tp && tp.paintAvatar ? tp.paintAvatar(av, p.display_name, p.handle).text : C.initials(p);
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
    // X, public; the email only on your own profile, and marked so.
    var links = [];
    if (p.x_handle) {
      links.push('<a class="pf-link" href="https://x.com/' + encodeURIComponent(p.x_handle) + '" target="_blank" rel="noopener noreferrer">' +
        '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M12.2 1.5h2.2L9.6 7l5.7 7.5h-4.5L7.3 10l-4 4.5H1.1l5.2-5.9L.8 1.5h4.6l3.2 4.2 3.6-4.2Zm-.8 11.7h1.2L4.7 2.8H3.4l8 10.4Z"/></svg>' +
        "@" + C.esc(p.x_handle) + "</a>");
    }
    $("pf-links").innerHTML = links.join("");
    $("pf-links").hidden = !links.length;
    $("pf-actions").hidden = !r.owner;
    $("pf-photo").hidden = !r.owner;
    document.title = name + " (@" + p.handle + ") | Transitions.dev Community";

    var grid = $("pf-grid");
    grid.innerHTML = "";
    if (!r.items.length) {
      grid.innerHTML = r.owner
        ? '<div class="cm-empty"><strong>No components yet.</strong><a class="cm-link" href="builder.html">Build your first one</a> with the agent.</div>'
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
    $("pf-in-x").value = profile.x_handle ? "@" + profile.x_handle : "";
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
      x_handle: $("pf-in-x").value,
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

  // Change the photo: crop to a 256px square, then the account page's upload
  // (POST /account/avatar), which checks it and may hold it for a review.
  function squareImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var side = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement("canvas");
        cv.width = cv.height = 256;
        var g = cv.getContext("2d");
        g.fillStyle = "#ffffff"; g.fillRect(0, 0, 256, 256);
        g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
        URL.revokeObjectURL(url);
        var out = cv.toDataURL("image/webp", 0.88);
        if (out.indexOf("data:image/webp") !== 0) out = cv.toDataURL("image/jpeg", 0.88);
        resolve({ media_type: out.slice(5, out.indexOf(";")), data: out.slice(out.indexOf(",") + 1) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      img.src = url;
    });
  }
  $("pf-photo").addEventListener("click", function () { $("pf-photo-file").click(); });
  $("pf-photo-file").addEventListener("change", function () {
    var f = this.files && this.files[0];
    this.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { C.toast("Use a PNG, JPEG or WebP image.", "err"); return; }
    var wrap = document.querySelector(".pf-avatar-wrap");
    wrap.setAttribute("aria-busy", "true");
    var tp = window.TransitionsPro;
    squareImage(f).then(function (im) {
      return fetch(tp.apiBase + "/account/avatar", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(im),
      }).then(function (r) { return r.json().catch(function () { return {}; }); });
    }).then(function (r) {
      wrap.removeAttribute("aria-busy");
      if (!r || !r.ok) {
        var why = { image_too_large: "That image is too large.", image_dimensions: "That image is too large.",
          image_not_allowed: "That photo can't be used. Try a different one.", invalid_image: "Couldn't read that image. Try a PNG, JPEG or WebP." }[r && r.error];
        C.toast(why || "Couldn't upload the photo. Please try again.", "err");
        return;
      }
      if (tp.setProfile) tp.setProfile({ avatar_url: r.avatar_url });
      var av = $("pf-avatar"), img = av.querySelector("img") || av.appendChild(document.createElement("img"));
      img.alt = "";
      img.src = C.apiUrl(r.avatar_url) + (r.avatar_url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
      C.toast(r.review === "pending" ? "Photo updated. Others see it after a quick review." : "Photo updated");
    }).catch(function () {
      wrap.removeAttribute("aria-busy");
      C.toast("Couldn't read that image.", "err");
    });
  });
})();
