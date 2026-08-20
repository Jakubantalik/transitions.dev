/* Transitions Pro — front-end client for the Pro platform API.
 *
 * Talks to the hosted Worker (api.transitions.dev in production, localhost:8787 in
 * local dev). Wires the existing Pro UI — the "Get access" CTA, the Sign in menu item,
 * and logged-in / entitled state — without changing page markup. All lookups are
 * defensive: on a page missing an element, that piece simply no-ops.
 *
 * Session is a cookie on .transitions.dev, so every call uses credentials:"include".
 */
(function () {
  "use strict";

  var API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "http://localhost:8787"
    : "https://api.transitions.dev";

  function api(path, opts) {
    opts = opts || {};
    opts.credentials = "include";
    return fetch(API_BASE + path, opts);
  }
  function apiJSON(path, method, body) {
    return api(path, {
      method: method || "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  // `resolved` flips true only once /me has actually ANSWERED (2xx JSON) —
  // pages must not present a definitive "signed out" UI before that, or a
  // transient fetch failure paints a signed-in user as logged out.
  var state = { authenticated: false, email: null, pro: false, subscription: null, ppp: null, resolved: false };

  // Last-known auth state, cached so a navigation can paint the signed-in UI
  // on the FIRST frame instead of flashing the signed-out version for the
  // length of a /me round-trip. Only the two booleans the nav needs are kept,
  // and /me still overwrites them the moment it answers.
  var AUTH_CACHE_KEY = "tdev:auth";
  var AUTH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

  function readAuthCache() {
    try {
      var raw = localStorage.getItem(AUTH_CACHE_KEY);
      if (!raw) return null;
      var c = JSON.parse(raw);
      if (!c || typeof c.t !== "number" || Date.now() - c.t > AUTH_CACHE_TTL) return null;
      return c;
    } catch (e) { return null; }
  }
  function writeAuthCache() {
    try {
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
        a: !!state.authenticated,
        p: !!state.pro,
        t: Date.now(),
      }));
    } catch (e) {}
  }
  function clearAuthCache() {
    try { localStorage.removeItem(AUTH_CACHE_KEY); } catch (e) {}
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }

  // Expose a tiny global so other page scripts (index gallery, activate page) can use it.
  window.TransitionsPro = {
    apiBase: API_BASE,
    get state() { return state; },
    refresh: refreshMe,
    checkout: startCheckout,
    signIn: signIn,
    portal: startPortal,
    magicLink: magicLink,
    approveDevice: approveDevice,
    mountBadges: mountProBadges,
    openSignIn: signIn,
    fetchContent: fetchProContent,
    logout: logout,
    signInFromCheckout: signInFromCheckout,
    refreshGeo: refreshGeo,
    get ppp() { return state.ppp; },
    get team() { return team; },
  };

  // ── Purchasing-power parity ───────────────────────────────────────────────────
  // Ask the API for the visitor's country + any parity discount, then paint the
  // banner. The discount itself is auto-applied server-side at checkout by the
  // same geo, so this is purely informational.
  function refreshGeo() {
    return apiJSON("/geo").then(function (g) {
      state.ppp = g && g.ppp ? g.ppp : null;
      renderPPP();
      document.dispatchEvent(new CustomEvent("pro:geo", { detail: state.ppp }));
      return state.ppp;
    }).catch(function () { return null; });
  }

  // The discount auto-applies at checkout by geo, so the bar is purely
  // informational (Figma 2361:84298) — no code shown, no copy button.
  function renderPPP() {
    var slot = document.getElementById("pro-ppp");
    if (!slot) return;
    var p = state.ppp;
    if (!p) { slot.hidden = true; slot.innerHTML = ""; return; }
    var label =
      "We will apply " + esc(String(p.percent)) + "% parity discount in " +
      esc(p.name || p.country) + " in checkout";
    slot.innerHTML = '<div class="pro-ppp-bar">' + label + "</div>";
    slot.hidden = false;
  }

  // /me is the auth authority. Only a 2xx JSON answer may update the state —
  // a network failure or 5xx must NOT flip a signed-in user to signed out
  // (Chrome tab freezing / bfcache restores made that happen intermittently).
  // Transient failures retry with backoff before giving up quietly.
  function refreshMe(attempt) {
    attempt = attempt || 0;
    return api("/me")
      .then(function (r) {
        if (!r.ok) throw new Error("me_" + r.status);
        return r.json();
      })
      .then(function (me) {
        state.authenticated = !!me.authenticated;
        state.email = me.email || null;
        state.pro = !!(me.entitlements && me.entitlements.pro);
        state.lifetime = !!me.lifetime;
        state.subscription = me.subscription || null;
        state.resolved = true;
        writeAuthCache();
        paintAuth();
        document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
        return state;
      })
      .catch(function () {
        if (attempt < 2) {
          return new Promise(function (res) {
            setTimeout(function () { res(refreshMe(attempt + 1)); }, attempt === 0 ? 600 : 2000);
          });
        }
        // Give up for now — state stays unresolved; pages keep whatever they
        // last knew instead of claiming the user is signed out.
        document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
        return state;
      });
  }

  // Re-verify after bfcache restores and tab un-freezes — Chrome resumes the
  // page without re-running scripts, and a pre-freeze failure would otherwise
  // stick until a manual reload.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) refreshMe();
  });
  // Always re-verify on return to the tab — entitlement may have changed in
  // another tab (purchase, sign-in, sign-out) and stale state must never stick.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshMe();
  });

  // Sign out (this device, or ?all=1 for every device), then refresh state.
  function logout(allDevices) {
    clearAuthCache();
    return api("/auth/logout" + (allDevices ? "?all=1" : ""), { method: "POST" })
      .then(function () { return refreshMe(); });
  }

  function paintAuth() {
    // 3-dot menu: "Sign in" becomes "Account", plus a "Sign out" item appears
    // right below it, only while authenticated (Figma: profile under the ⋮ menu).
    var signin = document.getElementById("pm-signin");
    if (signin) {
      var signinLabel = signin.querySelector(".tl-menu-item-label");
      if (signinLabel) signinLabel.textContent = state.authenticated ? "Account" : "Sign in";

      var signout = document.getElementById("pm-signout");
      if (state.authenticated && !signout) {
        signout = document.createElement("div");
        signout.className = "tl-menu-item";
        signout.id = "pm-signout";
        signout.setAttribute("role", "menuitem");
        signout.setAttribute("tabindex", "0");
        signout.innerHTML = '<span class="tl-menu-item-label">Sign out</span>';
        signout.addEventListener("click", function (e) {
          e.preventDefault();
          logout(false).then(function () {
            if (/\/account(\.html)?$/.test(location.pathname)) location.href = "/";
          });
        });
        signin.parentNode.insertBefore(signout, signin.nextSibling);
      } else if (!state.authenticated && signout) {
        signout.remove();
      }
    }
    // Pro-page nav pill (replaces "Get Pro" there): Sign in -> Account.
    var navSigninLabel = document.querySelector("#nav-signin-btn .pill-label");
    if (navSigninLabel) {
      navSigninLabel.textContent = state.authenticated ? "Account" : "Sign in";
    }
    // "Get Pro" nav pill (every page except /pro): once the visitor is signed
    // in AND entitled there is nothing left to sell, so the pill becomes a
    // neutral "Account" link. data-state drives the styling swap.
    var getPro = document.querySelector(".nav-get-pro");
    if (getPro) {
      var entitled = state.authenticated && state.pro;
      var getProLabel = getPro.querySelector(".nav-get-pro-label");
      if (getProLabel) {
        getProLabel.innerHTML = entitled
          ? "Account"
          : '<span class="nav-get-pro-word">Get </span>Pro';
      }
      getPro.setAttribute("href", entitled ? "account.html" : "/pro.html");
      getPro.setAttribute("data-state", entitled ? "account" : "get-pro");
      getPro.setAttribute("aria-label", entitled ? "Account" : "Get Transitions Pro");
    }
    // Same swap in the mobile menu.
    var mobilePro = document.querySelector(".mobile-menu-link--pro");
    if (mobilePro) {
      var mobileEntitled = state.authenticated && state.pro;
      mobilePro.textContent = mobileEntitled ? "Account" : "Get Pro";
      mobilePro.setAttribute("href", mobileEntitled ? "account.html" : "/pro.html");
      mobilePro.setAttribute("data-state", mobileEntitled ? "account" : "get-pro");
    }
    // Footer "Sign in" link (present on every page): label follows auth state.
    var footerLink = document.getElementById("footer-signin");
    if (footerLink) {
      footerLink.textContent = state.authenticated ? "Account" : "Sign in";
    }
    // CTA reflects entitlement: entitled users manage their plan instead of buying.
    var cta = document.getElementById("pro-price-cta");
    if (cta && state.pro) {
      cta.textContent = "Manage subscription";
      cta.setAttribute("data-action", "portal");
    }
  }

  function selectedBilling() {
    var billing = document.getElementById("pro-billing");
    return (billing && billing.getAttribute("data-billing")) || "monthly";
  }
  function selectedPlan() {
    return selectedBilling() === "annual" ? "yearly" : "monthly";
  }
  function teamSelected() {
    return !!document.querySelector('.pro-price-tab[data-plan="team"][data-active="true"]');
  }

  function setBusy(el, busy) {
    if (!el) return;
    if (busy) el.setAttribute("aria-busy", "true");
    else el.removeAttribute("aria-busy");
  }

  // A ?code= on the pricing page URL (comp / press / sponsor codes) is passed to
  // checkout, where it takes precedence over the automatic parity discount.
  function urlPromoCode() {
    try {
      var c = new URLSearchParams(location.search).get("code");
      return c ? c.trim().toUpperCase().slice(0, 40) : null;
    } catch (e) { return null; }
  }

  function startCheckout() {
    // Team → per-seat subscription (buyer adjusts seat count on Stripe Checkout).
    // The billing toggle carries monthly / annual / lifetime; lifetime is a
    // one-time payment plan on both Solo and Team.
    var billingKind = selectedBilling();
    var payload;
    if (billingKind === "lifetime") {
      payload = { plan: teamSelected() ? "team-lifetime" : "lifetime" };
    } else if (teamSelected()) {
      payload = { plan: "team", interval: billingKind === "annual" ? "year" : "month" };
    } else {
      payload = { plan: selectedPlan() };
    }
    var cta = document.getElementById("pro-price-cta");
    setBusy(cta, true);
    var promo = urlPromoCode();
    if (promo) payload.code = promo;
    apiJSON("/checkout", "POST", payload)
      .then(function (data) {
        if (data && data.url) location.href = data.url;
        else notify("Checkout is unavailable right now" + (data && data.error ? " (" + data.error + ")" : "") + ".");
      })
      .catch(function () { notify("Couldn't start checkout. Please try again."); })
      .finally(function () { setBusy(cta, false); });
  }

  // ── Team API ────────────────────────────────────────────────────────────────
  var team = {
    get: function () { return apiJSON("/team"); },
    invite: function (email, role) { return apiJSON("/team/invite", "POST", { email: email, role: role }); },
    resend: function (id) { return apiJSON("/team/invite/resend", "POST", { id: id }); },
    cancel: function (id) { return apiJSON("/team/invite/cancel", "POST", { id: id }); },
    accept: function (token) { return apiJSON("/team/invite/accept", "POST", { token: token }); },
    previewInvite: function (token) { return apiJSON("/team/invite/preview?token=" + encodeURIComponent(token)); },
    remove: function (userId) { return apiJSON("/team/member/remove", "POST", { user_id: userId }); },
    role: function (userId, role) { return apiJSON("/team/member/role", "POST", { user_id: userId, role: role }); },
    transfer: function (userId) { return apiJSON("/team/transfer", "POST", { user_id: userId }); },
    seats: function (n) { return apiJSON("/team/seats", "POST", { seats: n }); },
    rename: function (name) { return apiJSON("/team/rename", "POST", { name: name }); },
  };

  function startPortal() {
    apiJSON("/portal", "POST").then(function (data) {
      if (data && data.url) location.href = data.url;
      else notify("Billing portal is unavailable right now." + (data && data.detail ? "\n(" + data.detail + ")" : ""));
    }).catch(function () { notify("Couldn't open the billing portal."); });
  }

  // Send a magic-link email. Optional deviceCode ties the login to a device-activate
  // flow; optional inviteToken makes signing in also accept a team invitation.
  function magicLink(email, deviceCode, inviteToken) {
    var body = { email: (email || "").trim() };
    if (deviceCode) body.device_code = deviceCode;
    if (inviteToken) body.invite_token = inviteToken;
    return apiJSON("/auth/magic-link", "POST", body);
  }

  // Approve a device user_code for the currently signed-in user.
  function approveDevice(userCode) {
    return apiJSON("/device/approve", "POST", { user_code: (userCode || "").trim().toUpperCase() });
  }

  // After checkout: resolve the buyer's email from the Stripe session and email a sign-in link.
  function signInFromCheckout(sessionId) {
    return apiJSON("/auth/from-checkout", "POST", { session_id: sessionId });
  }

  function signIn() { openAuthModal(); }

  function notify(msg) { window.alert(msg); }

  // Fetch a Pro recipe (markdown) from the API. Resolves to the text or throws.
  function fetchProContent(id, variant) {
    return api("/content/" + encodeURIComponent(id) + "/" + encodeURIComponent(variant || "css"))
      .then(function (r) {
        if (!r.ok) { var e = new Error("content " + r.status); e.status = r.status; throw e; }
        return r.text();
      });
  }

  // Pro copy buttons (.card-copy[data-pro-copy]): entitled users copy the real
  // recipe from the API; everyone else is routed to the Pro page. Delegated so
  // it works on any page that renders Pro cards.
  function wireProCopy() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".card-copy[data-pro-copy]") : null;
      if (!btn) return;
      e.preventDefault();
      var id = btn.getAttribute("data-pro-copy");
      if (!state.pro) { location.href = "pro.html"; return; }
      btn.setAttribute("aria-busy", "true");
      fetchProContent(id, "css")
        .then(function (text) {
          return navigator.clipboard && navigator.clipboard.writeText
            ? navigator.clipboard.writeText(text)
            : Promise.reject(new Error("no clipboard"));
        })
        .then(function () {
          btn.setAttribute("data-copied", "true");
          setTimeout(function () { btn.removeAttribute("data-copied"); }, 1600);
        })
        .catch(function () { notify("Couldn’t copy the Pro recipe. Please try again."); })
        .finally(function () { btn.removeAttribute("aria-busy"); });
    });
  }

  // ── Sign-in modal ──────────────────────────────────────────────────────────
  // Minimal, reusable email → magic-link dialog (placeholder styling; restyle later).
  // Replaces the old prompt()/alert() flow. Injected once, reused across pages.
  var modalEl = null, lastFocus = null;

  function ensureAuthModal() {
    if (modalEl) return modalEl;
    injectModalStyle();
    modalEl = document.createElement("div");
    modalEl.className = "tp-modal";
    modalEl.setAttribute("hidden", "");
    // Sign-in card (Figma 2330:2574) + input states (Figma 2330:2712).
    modalEl.innerHTML =
      '<div class="tp-modal-backdrop" data-tp-close></div>' +
      '<div class="tp-modal-card" role="dialog" aria-modal="true" aria-labelledby="tp-modal-title">' +
        '<button type="button" class="tp-modal-x" aria-label="Close" data-tp-close>&times;</button>' +
        '<p class="tp-modal-intro" id="tp-modal-title">Enter your email you used at checkout.' +
          ' <span class="tp-modal-intro-muted">We’ll send you a sign-in link.</span></p>' +
        '<form class="tp-modal-form" novalidate>' +
          '<div class="tp-modal-field">' +
            '<label class="tp-modal-label" for="tp-modal-email">Your email</label>' +
            '<input class="tp-modal-input" id="tp-modal-email" type="email" name="email" placeholder="name@example.com" autocomplete="email" />' +
            '<p class="tp-modal-error" role="alert" hidden>Please enter a valid email.</p>' +
          '</div>' +
          '<button class="tp-modal-btn" type="submit">Send login link</button>' +
        '</form>' +
        '<p class="tp-modal-note" role="status" hidden></p>' +
        '<form class="tp-modal-form tp-modal-code-form" novalidate hidden>' +
          '<div class="tp-modal-field">' +
            '<label class="tp-modal-label" for="tp-modal-code">Or enter the code from the email</label>' +
            '<input class="tp-modal-input" id="tp-modal-code" type="text" name="code" placeholder="XXXX-XXXX" autocomplete="one-time-code" spellcheck="false" style="text-transform:uppercase" />' +
            '<p class="tp-modal-error" role="alert" hidden>That code didn\u2019t work \u2014 check it and try again.</p>' +
          '</div>' +
          '<button class="tp-modal-btn" type="submit">Sign in with code</button>' +
        '</form>' +
        '<p class="tp-modal-foot">No access? <a href="pro.html">Get Pro</a></p>' +
      "</div>";
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-tp-close")) closeAuthModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modalEl.hasAttribute("hidden")) closeAuthModal();
    });

    var input = modalEl.querySelector(".tp-modal-input");
    var errEl = modalEl.querySelector(".tp-modal-error");
    function setError(on) {
      input.classList.toggle("is-error", on);
      errEl.hidden = !on;
      if (on) {
        // Replay the shake from a clean baseline (remove → reflow → add).
        input.classList.remove("is-shaking");
        void input.offsetWidth;
        input.classList.add("is-shaking");
        setTimeout(function () { input.classList.remove("is-shaking"); }, 300);
      }
    }
    input.addEventListener("input", function () { setError(false); });

    modalEl.querySelector(".tp-modal-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = modalEl.querySelector(".tp-modal-btn");
      var note = modalEl.querySelector(".tp-modal-note");
      var email = input.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError(true); input.focus(); return; }
      setError(false);
      btn.disabled = true; btn.textContent = "Sending…";
      magicLink(email)
        .then(function () {
          setModalNote(note, "Check your email — click the link, or type the code below.", "ok");
          var cf = modalEl.querySelector(".tp-modal-code-form");
          if (cf) { cf.hidden = false; cf.querySelector("input").focus(); }
        })
        .catch(function () { setModalNote(note, "Couldn’t send the link. Please try again.", "err"); })
        .finally(function () { btn.disabled = false; btn.textContent = "Send login link"; });
    });

    // Typed-code path: signs this browser in even when the emailed link was
    // opened elsewhere (mail apps often open links in their own in-app browser).
    var codeForm = modalEl.querySelector(".tp-modal-code-form");
    codeForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var cInput = codeForm.querySelector("input");
      var cErr = codeForm.querySelector(".tp-modal-error");
      var cBtn = codeForm.querySelector(".tp-modal-btn");
      var note = modalEl.querySelector(".tp-modal-note");
      var code = cInput.value.trim();
      if (!code) { cErr.hidden = false; cInput.focus(); return; }
      cErr.hidden = true;
      cBtn.disabled = true; cBtn.textContent = "Signing in…";
      apiJSON("/auth/code", "POST", { email: input.value.trim(), code: code })
        .then(function (r) {
          if (r && r.ok) {
            setModalNote(note, "Signed in.", "ok");
            return refreshMe().then(function () { closeAuthModal(); });
          }
          cErr.textContent = r && r.error === "too_many_attempts"
            ? "Too many tries — request a fresh link and use its new code."
            : "That code didn’t work — check it and try again.";
          cErr.hidden = false;
          cInput.classList.remove("is-shaking"); void cInput.offsetWidth; cInput.classList.add("is-shaking");
          setTimeout(function () { cInput.classList.remove("is-shaking"); }, 300);
        })
        .catch(function () { cErr.hidden = false; })
        .finally(function () { cBtn.disabled = false; cBtn.textContent = "Sign in with code"; });
    });
    return modalEl;
  }

  function setModalNote(note, msg, kind) {
    note.textContent = msg; note.hidden = !msg;
    note.setAttribute("data-kind", kind || "");
  }

  function openAuthModal() {
    var m = ensureAuthModal();
    lastFocus = document.activeElement;
    setModalNote(m.querySelector(".tp-modal-note"), "", "");
    m.classList.remove("is-closing");
    m.removeAttribute("hidden");
    // Reflow so the enter transition plays from the closed (scale .96 / opacity 0) state.
    void m.offsetWidth;
    m.classList.add("is-open");
    var input = m.querySelector(".tp-modal-input");
    setTimeout(function () { input.focus(); }, 0);
  }

  function closeAuthModal() {
    if (!modalEl || modalEl.hasAttribute("hidden")) return;
    modalEl.classList.remove("is-open");
    modalEl.classList.add("is-closing");
    setTimeout(function () {
      modalEl.classList.remove("is-closing");
      modalEl.setAttribute("hidden", "");
    }, 150);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function injectModalStyle() {
    if (document.getElementById("tp-modal-base")) return;
    // Sign-in card: 369px, r24, white, ring shadows (Figma 2330:2574).
    // Inputs: 40px pill, #dcdcdc → focus #585858 1.5px → error #e23014 (2330:2712).
    var s = document.createElement("style");
    s.id = "tp-modal-base";
    s.textContent =
      ".tp-modal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;" +
      "font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}" +
      ".tp-modal[hidden]{display:none}" +
      // Modal open/close (transitions-dev 06): backdrop fades, card scales 0.96 -> 1.
      ".tp-modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.45);opacity:0;" +
      "transition:opacity 250ms cubic-bezier(0.22,1,0.36,1)}" +
      ".tp-modal-card{position:relative;width:min(92vw,369px);box-sizing:border-box;background:#fff;color:#0d0d0d;" +
      "border-radius:24px;padding:20px;display:flex;flex-direction:column;gap:24px;" +
      "box-shadow:0 1px 3px rgba(0,0,0,.04)," +
      "inset 0 0 0 1px rgba(0,0,0,.06),inset 0 -1px 0 0 rgba(0,0,0,.06),inset 0 0 0 1px rgba(196,196,196,.1);" +
      "opacity:0;transform:scale(.96);transform-origin:center;will-change:transform,opacity;" +
      "transition:transform 250ms cubic-bezier(0.22,1,0.36,1),opacity 250ms cubic-bezier(0.22,1,0.36,1)}" +
      ".tp-modal.is-open .tp-modal-backdrop{opacity:1}" +
      ".tp-modal.is-open .tp-modal-card{opacity:1;transform:scale(1)}" +
      ".tp-modal.is-closing .tp-modal-backdrop{opacity:0;transition:opacity 150ms cubic-bezier(0.22,1,0.36,1)}" +
      ".tp-modal.is-closing .tp-modal-card{opacity:0;transform:scale(.96);" +
      "transition:transform 150ms cubic-bezier(0.22,1,0.36,1),opacity 150ms cubic-bezier(0.22,1,0.36,1)}" +
      'html[data-theme="dark"] .tp-modal-card{background:#1b1b1d;color:#f2f2f2}' +
      ".tp-modal-x{position:absolute;top:14px;right:16px;border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:inherit;opacity:.55;padding:2px;" +
      "transition:opacity 120ms ease,scale 120ms cubic-bezier(0.22,1,0.36,1)}" +
      ".tp-modal-x:hover{opacity:.9}" +
      ".tp-modal-x:active{scale:.9}" +
      ".tp-modal-intro{margin:0;font-size:16px;line-height:24.2px;font-weight:400;padding-right:20px}" +
      ".tp-modal-intro-muted{color:#8a8a8a}" +
      ".tp-modal-form{display:flex;flex-direction:column;gap:24px}" +
      ".tp-modal-field{display:flex;flex-direction:column;gap:6px}" +
      ".tp-modal-label{font-size:13px;line-height:1.4;color:#4d4d4d}" +
      'html[data-theme="dark"] .tp-modal-label{color:#b5b5b5}' +
      ".tp-modal-input{width:100%;box-sizing:border-box;height:40px;padding:4px 4px 4px 12px;" +
      "font-family:inherit;font-size:13px;line-height:1.4;color:#0f0f0f;" +
      "background:#fff;border:1px solid #dcdcdc;border-radius:60px;outline:none;" +
      "will-change:transform;transition:border-color 120ms ease}" +
      ".tp-modal-input::placeholder{color:#828282}" +
      ".tp-modal-input:focus{border:1.5px solid #585858;padding-left:11.5px}" +
      ".tp-modal-input.is-error,.tp-modal-input.is-error:focus{border:1.5px solid #e23014;padding-left:11.5px}" +
      'html[data-theme="dark"] .tp-modal-input{background:#151517;color:#f2f2f2;border-color:#3a3a3d}' +
      'html[data-theme="dark"] .tp-modal-input:focus{border-color:#a5a5a5}' +
      'html[data-theme="dark"] .tp-modal-input.is-error{border-color:#e23014}' +
      ".tp-modal-error{margin:-2px 0 0;font-size:13px;line-height:1.4;color:#d62b11}" +
      ".tp-modal-btn{width:100%;height:40px;border:0;border-radius:26px;background:#17181c;color:#fff;" +
      "font-family:inherit;font-size:13px;line-height:13px;font-weight:500;cursor:pointer;" +
      "box-shadow:0 1px 2px rgba(0,0,0,.2);transition:scale 120ms cubic-bezier(0.22,1,0.36,1),opacity 120ms ease}" +
      ".tp-modal-btn:not([disabled]):active{scale:.96}" +
      ".tp-modal-btn[disabled]{opacity:.6;cursor:default}" +
      'html[data-theme="dark"] .tp-modal-btn{background:#f2f2f2;color:#111}' +
      ".tp-modal-note{margin:0;font-size:13px;line-height:1.4}" +
      '.tp-modal-note[data-kind="ok"]{color:#16a34a}' +
      '.tp-modal-note[data-kind="err"]{color:#d62b11}' +
      ".tp-modal-foot{margin:0;font-size:13px;line-height:16px;color:#17181c}" +
      ".tp-modal-foot a{color:inherit;font-weight:500;text-decoration:none}" +
      ".tp-modal-foot a:hover{text-decoration:underline}" +
      'html[data-theme="dark"] .tp-modal-foot{color:#e5e5e5}' +
      // Error-state-shake (transitions-dev 12) on invalid submit.
      ".tp-modal-input.is-shaking{animation:tp-shake 280ms linear}" +
      "@keyframes tp-shake{" +
      "0%{transform:translateX(0);animation-timing-function:cubic-bezier(0.22,1,0.36,1)}" +
      "28.57%{transform:translateX(6px);animation-timing-function:cubic-bezier(0.22,1,0.36,1)}" +
      "57.14%{transform:translateX(-6px);animation-timing-function:cubic-bezier(0.22,1,0.36,1)}" +
      "78.57%{transform:translateX(4px);animation-timing-function:cubic-bezier(0.22,1,0.36,1)}" +
      "100%{transform:translateX(0)}}" +
      "@media (prefers-reduced-motion:reduce){" +
      ".tp-modal-card,.tp-modal-backdrop,.tp-modal-btn,.tp-modal-x{transition:none!important}" +
      ".tp-modal-input{animation:none!important;transform:none!important}}";
    document.head.appendChild(s);
  }

  // Inject a "Pro" badge into any card tagged data-pro="true". Purely visual — the base
  // style is minimal and low-specificity so page CSS added later overrides it easily.
  function mountProBadges() {
    injectBadgeStyle();
    var cards = document.querySelectorAll('.card[data-pro="true"]');
    cards.forEach(function (card) {
      if (card.querySelector(".card-pro-badge")) return;
      var badge = document.createElement("span");
      badge.className = "card-pro-badge";
      badge.textContent = "Pro";
      var host = card.querySelector(".card-stage") || card;
      host.appendChild(badge);
    });
  }

  function injectBadgeStyle() {
    if (document.getElementById("pro-badge-base")) return;
    // Blue "Pro" pill (Figma 2330:2845): 18px tall, radius 50, blue-6% wash,
    // layered inset rings. Positioned top-right of the card stage.
    var style = document.createElement("style");
    style.id = "pro-badge-base";
    style.textContent =
      '.card[data-pro="true"]{position:relative}' +
      ".card-pro-badge{position:absolute;top:10px;right:10px;z-index:11;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "height:18px;padding:0 6px;border-radius:50px;" +
      "background:rgba(0,115,255,0.06);" +
      "font:500 11px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;" +
      "color:rgba(0,83,227,0.8);pointer-events:none;" +
      "box-shadow:0 1px 3px rgba(0,0,0,0.04)," +
      "inset 0 0 0 1px rgba(0,101,208,0.1)," +
      "inset 0 -1px 0 0 rgba(0,0,0,0.06)," +
      "inset 0 0 0 1px rgba(196,196,196,0.1)}" +
      'html[data-theme="dark"] .card-pro-badge{background:rgba(0,115,255,0.16);color:rgba(122,168,255,0.95)}';
    document.head.appendChild(style);
  }

  function wire() {
    var cta = document.getElementById("pro-price-cta");
    if (cta) {
      cta.addEventListener("click", function (e) {
        e.preventDefault();
        if (cta.getAttribute("data-action") === "portal") startPortal();
        else startCheckout();
      });
    }
    var signin = document.getElementById("pm-signin");
    if (signin) {
      signin.addEventListener("click", function (e) {
        e.preventDefault();
        // Signed-in users go to their account; everyone else gets the modal.
        if (state.authenticated) location.href = "account.html";
        else signIn();
      });
    }
    var navSignin = document.getElementById("nav-signin-btn");
    if (navSignin) {
      navSignin.addEventListener("click", function (e) {
        e.preventDefault();
        // Label reads "Account" once signed in — go there, don't re-prompt.
        if (state.authenticated) location.href = "account.html";
        else signIn();
      });
    }
    // Footer "Sign in" — opens the modal on pages that load this client;
    // its href="/pro.html" is the fallback on pages that don't.
    var footerSignin = document.getElementById("footer-signin");
    if (footerSignin) {
      footerSignin.addEventListener("click", function (e) {
        e.preventDefault();
        if (state.authenticated) location.href = "account.html";
        else signIn();
      });
    }
    // Mobile menu "Sign in" — same behaviour as the footer link; the
    // href="/pro.html" is the fallback on pages without this client.
    var mobileSignin = document.getElementById("mobile-signin");
    if (mobileSignin) {
      mobileSignin.addEventListener("click", function (e) {
        e.preventDefault();
        if (state.authenticated) location.href = "account.html";
        else signIn();
      });
    }
    // Paint the cached (optimistic) auth state first so the nav doesn't flash
    // "Get Pro" before /me answers. `resolved` stays false, so nothing that
    // needs a confirmed answer treats this as authoritative.
    var cached = readAuthCache();
    if (cached) {
      state.authenticated = !!cached.a;
      state.pro = !!cached.p;
      paintAuth();
      // Page gates (detail paywall, index badges) listen for pro:me — without
      // this they stayed locked until /me answered, so a returning Pro user saw
      // an "Account" nav above a signed-out paywall for the whole round trip.
      // `resolved` is still false, so nothing treats this as authoritative, and
      // /me re-locks the moment it disagrees.
      document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
    }
    mountProBadges();
    wireProCopy();
    refreshMe();
    refreshGeo();
  }

  if (document.readyState !== "loading") wire();
  else document.addEventListener("DOMContentLoaded", wire);
})();
