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
  var state = { authenticated: false, email: null, name: null, pro: false, lifetime: false, billing: false, subscription: null, ppp: null, resolved: false };

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
      var prev = readAuthCache();
      if (prev && !!prev.a === !!state.authenticated && !!prev.p === !!state.pro &&
          (prev.e || null) === (state.email || null) && (prev.v || null) === (state.avatar || null)) return;
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({
        a: !!state.authenticated,
        p: !!state.pro,
        // The avatar is the picture, or the email's initial without one, so
        // the optimistic paint needs both.
        e: state.authenticated ? state.email : null,
        v: state.authenticated ? state.avatar || null : null,
        t: Date.now(),
      }));
    } catch (e) {}
  }
  function clearAuthCache() {
    try { localStorage.removeItem(AUTH_CACHE_KEY); } catch (e) {}
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  // The API answers with paths (/avatar/...); resolve them against its base.
  function apiUrl(u) { return !u ? null : u.charAt(0) === "/" ? API_BASE + u : u; }

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
    joinCommunity: joinCommunity,
    // Sign in with (or, signed in, connect) GitHub or ChatGPT: a full-page
    // redirect that comes back to `returnTo` (default: this page).
    oauth: startOAuth,
    providers: providers,
    get lastOAuth() { return lastOAuth; },
    disconnect: function (provider) { return apiJSON("/auth/oauth/" + encodeURIComponent(provider) + "/disconnect", "POST", {}); },
    fetchContent: fetchProContent,
    logout: logout,
    signInFromCheckout: signInFromCheckout,
    refreshGeo: refreshGeo,
    get ppp() { return state.ppp; },
    get team() { return team; },
    avatarFor: avatarFor,
    paintAvatar: paintAvatar,
    // The account page saved a name or picture: repaint the nav and tell the page.
    setProfile: function (p) {
      if ("first_name" in p) state.firstName = p.first_name || null;
      if ("last_name" in p) state.lastName = p.last_name || null;
      if ("name" in p) state.name = p.name || null;
      if ("avatar_url" in p) state.avatar = apiUrl(p.avatar_url);
      writeAuthCache();
      paintAuth();
      document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
    },
  };

  // ── Purchasing-power parity ───────────────────────────────────────────────────
  // Ask the API for the visitor's country + any parity discount, then paint the
  // banner. The discount itself is auto-applied server-side at checkout by the
  // same geo, so this is purely informational.
  // A visitor's country does not change between page views, so asking on every
  // navigation multiplied Worker requests by the number of pages browsed for an
  // answer that was always the same. Cached for a day; the discount is applied
  // server-side at checkout regardless, so a stale banner cannot mis-sell.
  var GEO_CACHE_KEY = "tdev:geo";
  var GEO_CACHE_TTL = 24 * 60 * 60 * 1000;

  function applyGeo(ppp) {
    state.ppp = ppp || null;
    renderPPP();
    document.dispatchEvent(new CustomEvent("pro:geo", { detail: state.ppp }));
    return state.ppp;
  }

  function refreshGeo(force) {
    if (!force) {
      try {
        var raw = localStorage.getItem(GEO_CACHE_KEY);
        var c = raw ? JSON.parse(raw) : null;
        if (c && typeof c.t === "number" && Date.now() - c.t < GEO_CACHE_TTL) {
          return Promise.resolve(applyGeo(c.ppp));
        }
      } catch (e) {}
    }
    return apiJSON("/geo").then(function (g) {
      var ppp = g && g.ppp ? g.ppp : null;
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify({ ppp: ppp, t: Date.now() })); } catch (e) {}
      return applyGeo(ppp);
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
  var lastMeAt = 0;
  function refreshMe(attempt) {
    attempt = attempt || 0;
    lastMeAt = Date.now();
    return api("/me")
      .then(function (r) {
        // 429 means the throttle answered, not that anything is broken.
        // Retrying is the one response guaranteed to make it worse, and the
        // state must stay exactly as it was: a throttled Pro user keeps the
        // entitlement the last good answer gave them.
        if (r.status === 429) throw { rateLimited: true };
        if (!r.ok) throw new Error("me_" + r.status);
        return r.json();
      })
      .then(function (me) {
        state.authenticated = !!me.authenticated;
        state.email = me.email || null;
        state.name = me.name || null;
        state.firstName = me.first_name || null;
        state.lastName = me.last_name || null;
        state.avatar = apiUrl(me.avatar_url);
        state.pro = !!(me.entitlements && me.entitlements.pro);
        state.lifetime = !!me.lifetime;
        state.business = !!me.business;
        state.subscription = me.subscription || null;
        state.billing = !!me.billing;
        state.providers = me.providers || {};
        state.resolved = true;
        writeAuthCache();
        paintAuth();
        document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
        return state;
      })
      .catch(function (err) {
        if (err && err.rateLimited) {
          document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
          return state;
        }
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

  // Every tab focus used to re-run /me, so a single open tab could issue
  // hundreds of requests a day. Entitlement rarely changes mid-session and the
  // server re-checks on every content fetch anyway, so a short floor between
  // background re-verifies costs nothing. Explicit calls (sign-in, checkout
  // return, manual refresh) bypass it.
  var ME_MIN_AGE_MS = 60 * 1000;
  function refreshMeIfStale() {
    // Time-based only. Gating on `resolved` meant an API outage removed the
    // floor entirely — every tab focus would retry (three times each, with
    // backoff) exactly when the API was least able to take it.
    //
    // The floor must never suppress a real state change though: signing in
    // happens in another tab (the emailed link), and the user returns here
    // expecting the page unlocked. The other tab's /me rewrote the shared
    // cache, so a cache/state disagreement is exactly that signal — re-verify
    // immediately regardless of the floor.
    var cached = readAuthCache();
    var drift = cached && (!!cached.a !== state.authenticated || !!cached.p !== state.pro);
    if (!drift && Date.now() - lastMeAt < ME_MIN_AGE_MS) return Promise.resolve(state);
    return refreshMe();
  }

  // Cross-tab sign-in/out: every /me success rewrites the shared cache, and
  // the storage event delivers that to all OTHER tabs the moment it happens.
  // Without this, a page left on the paywall stayed locked after the user
  // signed in from the emailed link (a different tab) until they refreshed.
  window.addEventListener("storage", function (e) {
    if (e.key !== AUTH_CACHE_KEY) return;
    var moved = true;
    if (e.newValue) {
      try {
        var c = JSON.parse(e.newValue);
        moved = !!c.a !== !!state.authenticated || !!c.p !== !!state.pro;
        state.authenticated = !!c.a;
        state.pro = !!c.p;
        state.email = c.e || null;
        state.avatar = c.v || null;
        paintAuth();
        document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
      } catch (err) {}
    }
    // Confirm against the server only when the shared cache actually
    // disagreed with this tab (also covers a sign-out that cleared it).
    // Re-verifying on every write turned two open tabs into a request
    // loop: each /me answer rewrote the cache, which woke the other tab,
    // which ran /me again.
    if (moved) refreshMe();
  });

  // Re-verify after bfcache restores and tab un-freezes — Chrome resumes the
  // page without re-running scripts, and a pre-freeze failure would otherwise
  // stick until a manual reload.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) refreshMeIfStale();
  });
  // Always re-verify on return to the tab — entitlement may have changed in
  // another tab (purchase, sign-in, sign-out) and stale state must never stick.
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") refreshMeIfStale();
  });

  // Sign out (this device, or ?all=1 for every device), then refresh state.
  function logout(allDevices) {
    // Reflect the sign-out locally FIRST. The old flow relied on a follow-up
    // /me to repaint; when that request failed, the page kept an entitled nav
    // ("Account") over a locked paywall — a half-signed-out UI that read as a
    // broken account. Clearing the cookie can't fail meaningfully, so the
    // signed-out state is authoritative locally regardless of network fate.
    clearAuthCache();
    state.authenticated = false;
    state.pro = false;
    state.email = null;
    state.name = null;
    state.firstName = null;
    state.lastName = null;
    state.avatar = null;
    state.lifetime = false;
    state.billing = false;
    state.subscription = null;
    state.resolved = true;
    paintAuth();
    document.dispatchEvent(new CustomEvent("pro:me", { detail: state }));
    return api("/auth/logout" + (allDevices ? "?all=1" : ""), { method: "POST" })
      .then(function () { return refreshMe(); })
      .catch(function () { return state; });
  }

  function paintAuth() {
    // 3-dot menu: "Sign in" becomes "Account", and while authenticated a
    // "Sign out" item closes the menu, after a divider (Figma: profile under the ⋮ menu).
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
        var rule = document.createElement("div");
        rule.className = "tl-menu-divider";
        rule.id = "pm-signout-rule";
        signin.parentNode.appendChild(rule);
        signin.parentNode.appendChild(signout);
      } else if (!state.authenticated && signout) {
        signout.remove();
        var oldRule = document.getElementById("pm-signout-rule");
        if (oldRule) oldRule.remove();
      }
      // Signed in: your Community profile and your projects, above Account.
      [["pm-profile", "Profile", "/profile.html"], ["pm-projects", "Projects", "/projects.html"]].forEach(function (it) {
        var el = document.getElementById(it[0]);
        if (state.authenticated && !el) {
          el = document.createElement("a");
          el.className = "tl-menu-item";
          el.id = it[0];
          el.href = it[2];
          el.setAttribute("role", "menuitem");
          el.innerHTML = '<span class="tl-menu-item-label">' + it[1] + "</span>";
          signin.parentNode.insertBefore(el, signin);
        } else if (!state.authenticated && el) {
          el.remove();
        }
      });
    }
    // The 3-dot "More" button becomes the user's avatar while signed in, as on
    // Libraries.dev: the menu behind it stays the same and already reads
    // Account / Sign out in this state. The dots stay in the DOM; the class
    // hides them and shows the email's initial.
    var moreBtn = document.getElementById("more-btn");
    if (moreBtn) {
      injectAvatarStyle();
      var initial = moreBtn.querySelector(".nav-avatar-initial");
      if (state.authenticated && state.email) {
        if (!initial) {
          initial = document.createElement("span");
          initial.className = "nav-avatar-initial";
          initial.setAttribute("aria-hidden", "true");
          moreBtn.appendChild(initial);
        }
        var who = [state.firstName, state.lastName].filter(Boolean).join(" ") || state.name || "";
        initial.textContent = paintAvatar(moreBtn, who, state.email).text;
        // The account picture, when the user set one (account page).
        var pic = moreBtn.querySelector(".nav-avatar-img");
        if (state.avatar) {
          if (!pic) {
            pic = document.createElement("img");
            pic.className = "nav-avatar-img";
            pic.alt = "";
            pic.setAttribute("aria-hidden", "true");
            moreBtn.appendChild(pic);
          }
          if (pic.getAttribute("src") !== state.avatar) pic.src = state.avatar;
        } else if (pic) pic.remove();
        moreBtn.classList.toggle("icon-btn--pic", !!state.avatar);
        moreBtn.classList.add("icon-btn--avatar");
        moreBtn.setAttribute("aria-label", "Account menu");
        moreBtn.setAttribute("title", state.email);
      } else {
        moreBtn.classList.remove("icon-btn--avatar", "icon-btn--pic");
        moreBtn.setAttribute("aria-label", "More");
        moreBtn.removeAttribute("title");
        if (initial) initial.remove();
        var oldPic = moreBtn.querySelector(".nav-avatar-img");
        if (oldPic) oldPic.remove();
      }
    }
    // Pro-page nav pill (replaces "Get Pro" there): Sign in -> Account.
    // Signed in, the avatar button is the way to the account, so the pill hides.
    var navSigninLabel = document.querySelector("#nav-signin-btn .pill-label");
    if (navSigninLabel) {
      navSigninLabel.textContent = "Sign in";
      document.getElementById("nav-signin-btn").style.display = state.authenticated ? "none" : "";
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
      // Entitled: nothing left to sell and the avatar covers the account.
      getPro.style.display = entitled ? "none" : "";
    }
    // Same swap in the mobile menu.
    var mobilePro = document.querySelector(".mobile-menu-link--pro");
    if (mobilePro) {
      var mobileEntitled = state.authenticated && state.pro;
      mobilePro.textContent = mobileEntitled ? "Account" : "Get Pro";
      mobilePro.setAttribute("href", mobileEntitled ? "account.html" : "/pro.html");
      mobilePro.setAttribute("data-state", mobileEntitled ? "account" : "get-pro");
      // Entitled: the avatar and the Sign in CTA already lead to the account.
      var mobileProItem = mobilePro.closest("li") || mobilePro;
      mobileProItem.style.display = mobileEntitled ? "none" : "";
    }
    // Footer "Sign in" link (present on every page): label follows auth state.
    var footerLink = document.getElementById("footer-signin");
    if (footerLink) {
      footerLink.textContent = state.authenticated ? "Account" : "Sign in";
    }
    // CTAs reflect entitlement: entitled users manage their plan instead of
    // buying. Only the paid cards switch; "Start free" stays as it is.
    // A plain Pro subscriber is offered the upgrade: checkout reuses their
    // Stripe customer and the webhook retires the Pro subscription, prorated.
    if (state.pro) {
      var soloCta = document.querySelector('.pro-price-cta[data-plan="solo"]');
      var teamCta = document.querySelector('.pro-price-cta[data-plan="team"]');
      if (state.business) {
        if (teamCta) { teamCta.textContent = "Manage subscription"; teamCta.setAttribute("data-action", "portal"); }
        if (soloCta) { soloCta.textContent = "Included in Business"; soloCta.setAttribute("data-action", "portal"); }
      } else {
        if (soloCta) { soloCta.textContent = "Manage subscription"; soloCta.setAttribute("data-action", "portal"); }
        if (teamCta) { teamCta.textContent = "Upgrade to Business"; teamCta.setAttribute("data-action", "upgrade"); }
      }
      paintCreditsCta();
    }
  }

  // Builder credits: the subscriber's own card starts on their tier (the
  // pricing page's picker, window.TDevPricing), and picking another tier there
  // turns "Manage subscription" into the switch. Lifetime and annual-vs-monthly
  // changes stay in the billing portal.
  var creditsSynced = false;
  function paintCreditsCta() {
    var sub = state.subscription;
    if (!state.pro || !sub || !sub.credits || state.lifetime) return;
    var plan = state.business ? "team" : "solo";
    var cta = document.querySelector('.pro-price-cta[data-plan="' + plan + '"]');
    if (!cta) return;
    if (!creditsSynced && window.TDevPricing) {
      creditsSynced = true;
      window.TDevPricing.setCredits(plan, sub.credits);
      if (window.TDevPricing.setBilling) window.TDevPricing.setBilling(sub.interval === "year" ? "annual" : "monthly");
    }
    var picked = +cta.getAttribute("data-credits") || sub.credits;
    var sameInterval = (selectedBilling() === "annual") === (sub.interval === "year");
    if (picked !== sub.credits && sameInterval) {
      cta.textContent = "Switch to " + picked.toLocaleString("en-US") + " credits";
      cta.setAttribute("data-action", "credits");
    } else {
      cta.textContent = "Manage subscription";
      cta.setAttribute("data-action", "portal");
    }
  }
  document.addEventListener("pro:credits", function () { paintCreditsCta(); });

  function selectedBilling() {
    var billing = document.getElementById("pro-billing");
    return (billing && billing.getAttribute("data-billing")) || "monthly";
  }

  // Free plan has no checkout: "Start free" creates the account (email + code)
  // and emails the free Agent key. A visitor who is already signed in has an
  // account, so it takes them there.
  function startFree(ctaEl) {
    if (state.authenticated) { location.href = "account.html"; return; }
    openAuthModal({ mode: "signup", plan: "free", cta: ctaEl });
  }

  // Paid plans: a signed-out visitor creates the account first, then goes to
  // Stripe for the plan they picked; a signed-in one goes straight to Stripe.
  function startPaid(plan, ctaEl) {
    if (state.authenticated) { startCheckout(plan, ctaEl); return; }
    openAuthModal({ mode: "signup", plan: plan, cta: ctaEl });
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

  // Terms version the buyer accepts at checkout (bump with terms.html).
  var TERMS_VERSION = "2026-10-03";

  // EU consumer law: digital content that starts at once is only exempt from
  // the 14-day withdrawal right if the buyer asks for immediate access and
  // acknowledges losing the right, before paying. This asks, and the API
  // records the answer on the Stripe session and in the confirmation email.
  // Resolves true to continue, false to stop.
  function buyCss() {
    if (!document.getElementById("tp-buy-css")) {
      var css = document.createElement("style");
      css.id = "tp-buy-css";
      css.textContent =
        ".tp-buy{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(15,15,15,.28);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);opacity:0;transition:opacity 200ms cubic-bezier(.22,1,.36,1)}" +
        'html[data-theme="dark"] .tp-buy{background:rgba(0,0,0,.5)}' +
        ".tp-buy.is-open{opacity:1}" +
        ".tp-buy-card{width:100%;max-width:440px;box-sizing:border-box;padding:22px;border-radius:20px;background:var(--card-bg,#fff);color:var(--text,#0d0d0d);" +
        "box-shadow:0 20px 60px rgba(0,0,0,.25);font:14px/20px var(--font-sans,Inter,system-ui,sans-serif);transform:scale(.96);opacity:0;transition:transform 150ms cubic-bezier(.22,1,.36,1),opacity 150ms cubic-bezier(.22,1,.36,1)}" +
        // The search modal's open/close: scale 0.96 to 1 with a fade, 250ms in, 150ms out.
        ".tp-buy.is-open .tp-buy-card{transform:scale(1);opacity:1;transition:transform 250ms cubic-bezier(.22,1,.36,1),opacity 250ms cubic-bezier(.22,1,.36,1)}" +
        ".tp-buy h2{margin:0 0 8px;font-size:17px;line-height:24px;font-weight:500}" +
        ".tp-buy p{margin:0 0 12px;color:var(--text-muted,#6c6c6c);font-size:13px;line-height:19px}" +
        ".tp-buy a{color:inherit;text-decoration:underline;text-underline-offset:2px}" +
        ".tp-buy label{display:flex;gap:10px;align-items:flex-start;margin:4px 0 16px;font-size:13px;line-height:19px;cursor:pointer}" +
        ".tp-buy input{margin:3px 0 0;flex:none;accent-color:var(--accent,#0073e5)}" +
        ".tp-buy-row{display:flex;justify-content:flex-end;gap:8px}" +
        ".tp-buy button{height:36px;padding:0 16px;border:0;border-radius:40px;font:500 13px/16px var(--font-sans,Inter,system-ui,sans-serif);cursor:pointer}" +
        ".tp-buy-no{background:var(--chip-bg,#f4f4f4);color:var(--text,#0d0d0d)}" +
        ".tp-buy-go{background:var(--text,#0d0d0d);color:var(--bg,#fff)}" +
        ".tp-buy-go:disabled{opacity:.4;cursor:default}" +
        "@media (prefers-reduced-motion: reduce){.tp-buy,.tp-buy-card{transition:none}}";
      document.head.appendChild(css);
    }
  }
  function confirmPurchase(plan, billingKind) {
    return new Promise(function (resolve) {
      buyCss();
      var lifetime = billingKind === "lifetime" && plan !== "team";
      var wrap = document.createElement("div");
      wrap.className = "tp-buy";
      wrap.innerHTML =
        '<div class="tp-buy-card" role="dialog" aria-modal="true" aria-labelledby="tp-buy-title">' +
          '<h2 id="tp-buy-title">Before you pay</h2>' +
          "<p>" + (lifetime
            ? "Lifetime is a one-time payment."
            : "Your plan renews automatically each " + (billingKind === "annual" ? "year" : "month") + " until you cancel, which you can do any time from your account.") +
            " VAT is added at checkout where it applies, and Stripe shows the full amount before you confirm.</p>" +
          '<label><input type="checkbox" class="tp-buy-ok" /><span>I agree to the <a href="/terms.html" target="_blank" rel="noopener">Terms</a> and want access to start right away. ' +
            'I understand that I lose my 14-day <a href="/terms.html#withdrawal" target="_blank" rel="noopener">right of withdrawal</a> once access begins.</span></label>' +
          '<div class="tp-buy-row"><button type="button" class="tp-buy-no">Cancel</button>' +
          '<button type="button" class="tp-buy-go" disabled>Continue to payment</button></div>' +
        "</div>";
      document.body.appendChild(wrap);
      var ok = wrap.querySelector(".tp-buy-ok");
      var go = wrap.querySelector(".tp-buy-go");
      var last = document.activeElement;
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        wrap.classList.remove("is-open");
        setTimeout(function () { wrap.remove(); if (last && last.focus) last.focus(); }, 200);
        resolve(v);
      }
      function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); finish(false); } }
      document.addEventListener("keydown", onKey, true);
      ok.addEventListener("change", function () { go.disabled = !ok.checked; });
      go.addEventListener("click", function () { if (ok.checked) finish(true); });
      wrap.querySelector(".tp-buy-no").addEventListener("click", function () { finish(false); });
      wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) finish(false); });
      requestAnimationFrame(function () { wrap.classList.add("is-open"); });
      setTimeout(function () { ok.focus(); }, 30);
    });
  }

  // Moving a subscription to another Builder credit tier: prorated now, so an
  // upgrade charges the difference today and a downgrade credits the next
  // invoice. Resolves true to go ahead.
  function confirmChange(label, price) {
    return new Promise(function (resolve) {
      buyCss();
      var wrap = document.createElement("div");
      wrap.className = "tp-buy";
      wrap.innerHTML =
        '<div class="tp-buy-card" role="dialog" aria-modal="true" aria-labelledby="tp-buy-title">' +
          '<h2 id="tp-buy-title">Switch to ' + esc(label) + "</h2>" +
          "<p>Your plan changes now to " + esc(price) + ". Stripe prorates the change: moving up charges the difference for the rest of this period today, moving down credits it to your next invoice.</p>" +
          '<div class="tp-buy-row"><button type="button" class="tp-buy-no">Cancel</button>' +
          '<button type="button" class="tp-buy-go">Switch plan</button></div>' +
        "</div>";
      document.body.appendChild(wrap);
      var last = document.activeElement;
      var done = false;
      function finish(v) {
        if (done) return;
        done = true;
        document.removeEventListener("keydown", onKey, true);
        wrap.classList.remove("is-open");
        setTimeout(function () { wrap.remove(); if (last && last.focus) last.focus(); }, 200);
        resolve(v);
      }
      function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); finish(false); } }
      document.addEventListener("keydown", onKey, true);
      wrap.querySelector(".tp-buy-go").addEventListener("click", function () { finish(true); });
      wrap.querySelector(".tp-buy-no").addEventListener("click", function () { finish(false); });
      wrap.addEventListener("mousedown", function (e) { if (e.target === wrap) finish(false); });
      requestAnimationFrame(function () { wrap.classList.add("is-open"); });
      setTimeout(function () { wrap.querySelector(".tp-buy-go").focus(); }, 30);
    });
  }
  function changeCredits(cta) {
    var n = +cta.getAttribute("data-credits");
    var label = n.toLocaleString("en-US") + " credits" + (cta.getAttribute("data-plan") === "team" ? " per seat" : "");
    return confirmChange(label, cta.getAttribute("data-price") || "the new price").then(function (ok) {
      if (!ok) return;
      setBusy(cta, true);
      return apiJSON("/billing/credits", "POST", { credits: n })
        .then(function (r) {
          if (r && r.ok) { refreshMe(); return; }
          notify(r && r.error === "no_subscription"
            ? "Only the person who pays for the plan can change it."
            : "Couldn't change the plan" + (r && r.error ? " (" + r.error + ")" : "") + ".");
        })
        .catch(function () { notify("Couldn't change the plan. Please try again."); })
        .finally(function () { setBusy(cta, false); });
    });
  }

  function startCheckout(plan, ctaEl) {
    if (plan === "free") { startFree(ctaEl); return Promise.resolve(); }
    // Business (team) → per-seat subscription (buyer adjusts the seat count on
    // Stripe Checkout). The billing toggle carries monthly / annual / lifetime;
    // lifetime exists for Pro only — Business includes the hosted Agent, which
    // runs on live AI, so it falls back to monthly.
    var billingKind = selectedBilling();
    var payload;
    if (plan === "team") {
      payload = { plan: "team", interval: billingKind === "annual" ? "year" : "month" };
    } else if (billingKind === "lifetime") {
      payload = { plan: "lifetime" };
    } else {
      payload = { plan: billingKind === "annual" ? "yearly" : "monthly" };
    }
    var cta = ctaEl || document.querySelector('.pro-price-cta[data-plan="' + (plan || "solo") + '"]');
    // A larger Builder credit tier picked on the card (not for Lifetime).
    var credits = cta ? +cta.getAttribute("data-credits") : 0;
    if (credits && credits !== (plan === "team" ? 900 : 600) && payload.plan !== "lifetime") payload.credits = credits;
    return confirmPurchase(plan, billingKind).then(function (agreed) {
      if (!agreed) return;
      // What the buyer agreed to, recorded with the order.
      payload.consent = { terms: TERMS_VERSION, immediate_access: true, withdrawal_waiver: true };
      return toCheckout(payload, cta);
    });
  }

  function toCheckout(payload, cta) {
    setBusy(cta, true);
    var promo = urlPromoCode();
    if (promo) payload.code = promo;
    // Prefill Stripe with the signed-in email so the purchase lands on this
    // account instead of whatever address gets typed at checkout.
    if (state.authenticated && state.email) payload.email = state.email;
    return apiJSON("/checkout", "POST", payload)
      .then(function (data) {
        if (data && data.url) { location.href = data.url; return; }
        // No checkout: show the page again (a gift link hides it while it loads).
        document.documentElement.removeAttribute("data-redeem");
        // A blocked market carries its own explanation — showing "unavailable"
        // would read as an outage rather than a deliberate limit.
        if (data && data.message) notify(data.message);
        else notify("Checkout is unavailable right now" + (data && data.error ? " (" + data.error + ")" : "") + ".");
      })
      .catch(function () { document.documentElement.removeAttribute("data-redeem"); notify("Couldn't start checkout. Please try again."); })
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
      else if (data && data.error === "no_billing_customer")
        notify("There's no billing history on this account.\nIf you bought Pro with a different email, sign out and sign in with that one.");
      else notify("Billing portal is unavailable right now." + (data && data.detail ? "\n(" + data.detail + ")" : ""));
    }).catch(function () { notify("Couldn't open the billing portal."); });
  }

  // Send a magic-link email. Optional deviceCode ties the login to a device-activate
  // flow; optional inviteToken makes signing in also accept a team invitation.
  // `signup` lets a new address through: the create-account modal sends it,
  // the sign-in modal does not (so a mistyped checkout email is still caught).
  function magicLink(email, deviceCode, inviteToken, signup) {
    var body = { email: (email || "").trim() };
    if (deviceCode) body.device_code = deviceCode;
    if (inviteToken) body.invite_token = inviteToken;
    if (signup) body.signup = true;
    // The sign-in box says "By continuing, you agree to our Terms".
    body.terms = TERMS_VERSION;
    return apiJSON("/auth/magic-link", "POST", body);
  }

  // Approve a device user_code for the currently signed-in user.
  function approveDevice(userCode) {
    return apiJSON("/device/approve", "POST", { user_code: (userCode || "").trim().toUpperCase() });
  }

  // After checkout: resolve the buyer's email from the Stripe session and email a sign-in code.
  function signInFromCheckout(sessionId) {
    return apiJSON("/auth/from-checkout", "POST", { session_id: sessionId });
  }

  function signIn(opts) { openAuthModal(opts); }

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

  // What the open modal is for. "signin" is the returning-user box; "signup"
  // creates an account for the plan the visitor picked on the pricing page,
  // then either finishes (free) or hands over to Stripe Checkout (Pro,
  // Business). Both share the same email -> code steps.
  var authCtx = { mode: "signin", plan: null, cta: null };
  var PLAN_NAMES = { free: "Free", solo: "Pro", team: "Business" };

  function stepCopy(step, email) {
    var signup = authCtx.mode === "signup";
    var plan = authCtx.plan;
    // GitHub or ChatGPT gave an address that already has an account: the
    // emailed code proves it is theirs before the two are linked.
    if (authCtx.pending && step === "code") {
      return {
        title: "Confirm it’s you",
        sub: "This email already has an account. Enter the code we sent to " + (authCtx.pending.email || "your inbox") +
          " to link " + (PROVIDER_NAMES[authCtx.pending.provider] || "it") + ".",
        btn: "Continue",
      };
    }
    // Community: one door for new and returning members, since a free
    // account is all a like, a remix or a publish needs.
    if (plan === "community") {
      if (step === "code") return { title: "Enter one-time password", sub: "We sent it to " + (email || "your inbox") + ".", btn: "Continue" };
      return { title: "Join the Community", sub: "Free account to build, publish and like components.", btn: "Continue" };
    }
    if (step === "code") {
      return {
        title: "Enter one-time password",
        sub: "We sent it to " + (email || "your inbox") + ".",
        btn: signup ? (plan && plan !== "free" ? "Continue to checkout" : "Create account") : "Verify",
      };
    }
    if (step === "done") {
      return {
        title: "You’re all set",
        sub: "You’re signed in. Your free Agent key is on its way to " + (email || "your inbox") + ".",
      };
    }
    if (!signup) {
      return { title: "Sign in", sub: "Enter the email you signed up with.", btn: "Send code" };
    }
    // Sign-up header copy (Figma 1674:35924).
    return {
      title: "Get Started.",
      sub: "Make your motion UI better",
      btn: plan && plan !== "free" ? "Continue to " + PLAN_NAMES[plan] : "Continue",
    };
  }

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
        // One question per screen: the email, then the code, then (free
        // sign-up only) a short confirmation.
        // Sign-up header mark (Figma 1674:35924, ar-cube-3): the brand cube.
        '<span class="tp-modal-mark" aria-hidden="true" hidden><svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 1.85265L15.5409 3.84441L14.5604 5.58756L13 4.70985V7H11V4.70985L9.43962 5.58756L8.45909 3.84441L12 1.85265ZM17.3613 4.86837L21 6.91515V11H19V9.23205L17.0359 10.366L16.0359 8.63397L17.9804 7.51132L16.3807 6.61152L17.3613 4.86837ZM7.61925 6.61152L6.01961 7.51132L7.9641 8.63397L6.9641 10.366L5 9.23205L5 11H3L3 6.91515L6.63873 4.86837L7.61925 6.61152ZM5 13V14.7679L6.9641 13.634L7.9641 15.366L6.0196 16.4887L7.61925 17.3885L6.63873 19.1316L3 17.0848V13H5ZM21 13V17.0848L17.3613 19.1316L16.3807 17.3885L17.9804 16.4887L16.0359 15.366L17.0359 13.634L19 14.7679V13H21ZM13 17V19.2902L14.5604 18.4124L15.5409 20.1556L12 22.1473L8.45908 20.1556L9.43961 18.4124L11 19.2902V17H13Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M15.0981 11.366L13 12.5774V15H11V12.5774L8.90192 11.366L9.90192 9.63397L12 10.8453L14.0981 9.63397L15.0981 11.366Z" fill="currentColor"/></svg></span>' +
        '<p class="tp-modal-intro" id="tp-modal-title"><span data-step-title>Sign in</span>' +
          '<span class="tp-modal-intro-muted" data-step-sub></span></p>' +
        // GitHub and ChatGPT, shown once /auth/providers says they are set up.
        // The ChatGPT button needs OpenAI's approved logo before it goes live.
        '<div class="tp-modal-oauth" hidden>' +
          '<button type="button" class="tp-modal-btn tp-modal-btn--ghost tp-modal-oauth-btn" data-oauth="github" hidden>' +
            '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>Continue with GitHub</span></button>' +
          '<button type="button" class="tp-modal-btn tp-modal-btn--ghost tp-modal-oauth-btn" data-oauth="chatgpt" hidden>' +
            '<span>Continue with ChatGPT</span></button>' +
          '<p class="tp-modal-or"><span>or</span></p>' +
        '</div>' +
        '<form class="tp-modal-form tp-modal-email-form" novalidate>' +
          '<div class="tp-modal-field">' +
            '<input class="tp-modal-input" id="tp-modal-email" type="email" name="email" placeholder="you@example.com" autocomplete="email" aria-label="Email address" />' +
            '<p class="tp-modal-error" role="alert" hidden>Please enter a valid email.</p>' +
          '</div>' +
          '<button class="tp-modal-btn" type="submit">Continue</button>' +
        '</form>' +
        '<form class="tp-modal-form tp-modal-code-form" novalidate hidden>' +
          '<div class="tp-modal-field">' +
            '<input class="tp-modal-input" id="tp-modal-code" type="text" name="code" placeholder="XXXX-XXXX" autocomplete="one-time-code" spellcheck="false" inputmode="text" style="text-transform:uppercase" aria-label="One-time code" />' +
            '<p class="tp-modal-error" role="alert" hidden>That code didn’t work. Check it and try again.</p>' +
          '</div>' +
          '<button class="tp-modal-btn" type="submit">Verify</button>' +
          '<button class="tp-modal-btn tp-modal-btn--ghost" type="button" data-tp-restart>Use a different email</button>' +
        '</form>' +
        '<div class="tp-modal-form tp-modal-done" hidden>' +
          '<button class="tp-modal-btn" type="button" data-tp-close>Done</button>' +
        '</div>' +
        '<p class="tp-modal-note" role="status" hidden></p>' +
        '<p class="tp-modal-foot" data-foot></p>' +
        '<p class="tp-modal-legal" data-legal>By continuing, you agree to our <a href="/terms.html" target="_blank" rel="noopener">Terms</a> ' +
          'and acknowledge our <a href="/privacy.html" target="_blank" rel="noopener">Privacy notice</a>.</p>' +
      "</div>";
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-tp-close")) closeAuthModal();
      var ob = e.target.closest("[data-oauth]");
      if (ob) { ob.disabled = true; startOAuth(ob.getAttribute("data-oauth"), "signin"); return; }
      // Footer switch between "Sign in" and "Create an account". Switching to
      // sign-up from the plain sign-in box starts the free plan.
      var sw = e.target.closest("[data-tp-switch]");
      if (sw) {
        e.preventDefault();
        var toSignup = sw.getAttribute("data-tp-switch") === "signup";
        authCtx = { mode: toSignup ? "signup" : "signin", plan: toSignup ? (authCtx.plan || "free") : authCtx.plan, cta: authCtx.cta, onDone: authCtx.onDone };
        setModalNote(modalEl.querySelector(".tp-modal-note"), "", "");
        showStep("email");
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !modalEl.hasAttribute("hidden")) closeAuthModal();
    });

    var emailForm = modalEl.querySelector(".tp-modal-email-form");
    var codeFormEl = modalEl.querySelector(".tp-modal-code-form");
    var doneEl = modalEl.querySelector(".tp-modal-done");
    var titleEl = modalEl.querySelector("[data-step-title]");
    var subEl = modalEl.querySelector("[data-step-sub]");
    var footEl = modalEl.querySelector("[data-foot]");
    var markEl = modalEl.querySelector(".tp-modal-mark");
    var oauthEl = modalEl.querySelector(".tp-modal-oauth");
    var legalEl = modalEl.querySelector("[data-legal]");
    var onEmailStep = true;
    function paintProviders(p) {
      var any = false;
      oauthEl.querySelectorAll("[data-oauth]").forEach(function (b) {
        var on = !!(p && p[b.getAttribute("data-oauth")]);
        b.hidden = !on;
        b.disabled = false;
        any = any || on;
      });
      oauthEl.hidden = !any || !onEmailStep;
    }
    providers().then(paintProviders);
    function showStep(step, email) {
      var copy = stepCopy(step, email);
      emailForm.hidden = step !== "email";
      codeFormEl.hidden = step !== "code";
      doneEl.hidden = step !== "done";
      onEmailStep = step === "email";
      providers().then(paintProviders);
      legalEl.hidden = step === "done";
      // A provider's confirmation code has no email to change.
      codeFormEl.querySelector("[data-tp-restart]").textContent = authCtx.pending ? "Cancel" : "Use a different email";
      titleEl.textContent = copy.title;
      subEl.textContent = copy.sub;
      // The cube heads the sign-up screen only.
      markEl.hidden = !(authCtx.mode === "signup" && step === "email");
      if (copy.btn) {
        var btn = (step === "code" ? codeFormEl : emailForm).querySelector(".tp-modal-btn");
        btn.textContent = copy.btn;
        btn.setAttribute("data-label", copy.btn);
      }
      // The footer offers the other door, and only on the email step.
      footEl.hidden = step !== "email" || authCtx.plan === "community";
      footEl.innerHTML = authCtx.mode === "signup"
        ? 'Already have an account? <button type="button" data-tp-switch="signin">Sign in</button>'
        : 'New here? <button type="button" data-tp-switch="signup">Create an account</button>';
      var focusEl = step === "email" ? modalEl.querySelector("#tp-modal-email")
        : step === "code" ? modalEl.querySelector("#tp-modal-code")
        : doneEl.querySelector(".tp-modal-btn");
      setTimeout(function () { if (focusEl) focusEl.focus(); }, 0);
    }
    modalEl.__showStep = showStep;

    // "Use a different email" returns to step one rather than closing, so a
    // typo in the address costs one click instead of restarting the flow.
    modalEl.querySelector("[data-tp-restart]").addEventListener("click", function () {
      if (authCtx.pending) { authCtx.pending = null; closeAuthModal(); return; }
      setModalNote(modalEl.querySelector(".tp-modal-note"), "", "");
      codeFormEl.querySelector(".tp-modal-error").hidden = true;
      codeFormEl.querySelector(".tp-modal-input").value = "";
      showStep("email");
    });

    var input = modalEl.querySelector("#tp-modal-email");
    var errEl = emailForm.querySelector(".tp-modal-error");
    function shake(el) {
      // Replay the shake from a clean baseline (remove, reflow, add).
      el.classList.remove("is-shaking");
      void el.offsetWidth;
      el.classList.add("is-shaking");
      setTimeout(function () { el.classList.remove("is-shaking"); }, 300);
    }
    function setError(on) {
      input.classList.toggle("is-error", on);
      errEl.hidden = !on;
      if (on) shake(input);
    }
    input.addEventListener("input", function () { setError(false); });

    emailForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = emailForm.querySelector(".tp-modal-btn");
      var label = btn.getAttribute("data-label") || btn.textContent;
      var note = modalEl.querySelector(".tp-modal-note");
      var email = input.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setError(true); input.focus(); return; }
      setError(false);
      btn.disabled = true; btn.textContent = "Sending code…";
      magicLink(email, null, null, authCtx.mode === "signup")
        .then(function (data) {
          // apiJSON resolves on any status, so a refusal arrives here, not in
          // .catch.
          if (data && data.error === "no_plan") {
            footEl.hidden = false;
            setModalNote(note,
              "No Transitions.dev account uses that email. Signed up with a different address? Try that one, or create an account below.",
              "err");
            return;
          }
          if (data && data.error) {
            setModalNote(note, "Couldn’t send the code. Please try again.", "err");
            return;
          }
          setModalNote(note, "", "");
          showStep("code", email);
          // Local dev: no email is sent, so the API returns the code. Fill it in.
          if (data && data.dev_code) {
            codeFormEl.querySelector("input").value = data.dev_code;
            setModalNote(note, "Local dev: code filled in. Press Continue.", "ok");
          }
        })
        .catch(function () { setModalNote(note, "Couldn’t send the code. Please try again.", "err"); })
        .finally(function () { btn.disabled = false; btn.textContent = label; });
    });

    // Typed code: opens the session in THIS browser, so the visitor is signed
    // in the moment it verifies, with no link to click.
    codeFormEl.addEventListener("submit", function (e) {
      e.preventDefault();
      var cInput = codeFormEl.querySelector("input");
      var cErr = codeFormEl.querySelector(".tp-modal-error");
      var cBtn = codeFormEl.querySelector(".tp-modal-btn");
      var label = cBtn.getAttribute("data-label") || cBtn.textContent;
      var note = modalEl.querySelector(".tp-modal-note");
      var code = cInput.value.trim();
      var email = input.value.trim();
      if (!code) { cErr.hidden = false; shake(cInput); cInput.focus(); return; }
      cErr.hidden = true;
      cBtn.disabled = true; cBtn.textContent = "Signing in…";
      var keepBusy = false;
      if (authCtx.pending) {
        var pend = authCtx.pending;
        apiJSON("/auth/oauth/confirm", "POST", { pending: pend.id, code: code })
          .then(function (r) {
            if (!(r && r.ok)) {
              cErr.textContent = r && r.error === "expired"
                ? "This confirmation expired. Close this and sign in again."
                : "That code didn’t work. Check it and try again.";
              cErr.hidden = false;
              shake(cInput);
              return;
            }
            authCtx.pending = null;
            return refreshMe().then(function () {
              closeAuthModal();
              oauthDone({ status: "signed_in", provider: pend.provider });
              afterProviderSignIn(r.plan || authCtx.plan, false);
            });
          })
          .catch(function () { cErr.hidden = false; })
          .finally(function () { cBtn.disabled = false; cBtn.textContent = label; });
        return;
      }
      apiJSON("/auth/code", "POST", { email: email, code: code, terms: TERMS_VERSION })
        .then(function (r) {
          if (!(r && r.ok)) {
            cErr.textContent = r && r.error === "too_many_attempts"
              ? "Too many tries. Request a fresh code and use that one."
              : "That code didn’t work. Check it and try again.";
            cErr.hidden = false;
            shake(cInput);
            return;
          }
          return refreshMe().then(function () {
            var plan = authCtx.plan;
            if (authCtx.mode !== "signup") { closeAuthModal(); return; }
            // Community: back to whatever the visitor was doing (a like, a
            // publish, an AI draft), which the caller resumes in onDone.
            if (plan === "community") {
              var done = authCtx.onDone;
              closeAuthModal();
              if (typeof done === "function") done();
              return;
            }
            if (plan === "free") {
              // The free plan includes the Agent: email its key now, the same
              // thing `npx transitions-agent signup` does from the terminal.
              apiJSON("/agent/signup", "POST", { email: email }).catch(function () {});
              showStep("done", email);
              return;
            }
            // Already on Pro and picked Pro again: nothing to buy. The card's
            // CTA now reads "Manage subscription".
            if (plan === "solo" && state.pro) { closeAuthModal(); return; }
            keepBusy = true;
            cBtn.textContent = "Opening checkout…";
            return startCheckout(plan, authCtx.cta).then(function () {
              // Checkout navigates away on success; anything else leaves the
              // visitor signed in on the pricing page with the error shown.
              setTimeout(function () { cBtn.disabled = false; cBtn.textContent = label; closeAuthModal(); }, 1200);
            });
          });
        })
        .catch(function () { cErr.hidden = false; })
        .finally(function () { if (!keepBusy) { cBtn.disabled = false; cBtn.textContent = label; } });
    });
    return modalEl;
  }

  function setModalNote(note, msg, kind) {
    note.textContent = msg; note.hidden = !msg;
    note.setAttribute("data-kind", kind || "");
  }

  // ── GitHub / ChatGPT ──────────────────────────────────────────────────────
  var PROVIDER_NAMES = { github: "GitHub", chatgpt: "ChatGPT" };
  // The last provider result, kept for page scripts that start after it.
  var lastOAuth = null;
  function oauthDone(detail) {
    lastOAuth = detail;
    document.dispatchEvent(new CustomEvent("tp:oauth", { detail: detail }));
  }
  var providersP = null;
  // Which providers the API has set up: { github, chatgpt, chatgpt_plan }.
  function providers() {
    if (!providersP) providersP = apiJSON("/auth/providers").catch(function () { return {}; });
    return providersP;
  }

  // intent "signin" (also creates a free account for a new address) or
  // "link" (signed in: connect it to this account).
  function startOAuth(provider, intent, returnTo) {
    var u = new URL(API_BASE + "/auth/oauth/" + encodeURIComponent(provider) + "/start");
    u.searchParams.set("return", returnTo || location.href);
    u.searchParams.set("intent", intent === "link" ? "link" : "signin");
    u.searchParams.set("terms", TERMS_VERSION);
    if (intent !== "link" && authCtx.plan) u.searchParams.set("plan", authCtx.plan);
    location.href = u.toString();
  }

  // After a provider sign-in, finish what the visitor came for: the plan they
  // picked on the pricing page goes on to checkout, a new free account gets
  // its Agent key.
  function afterProviderSignIn(plan, isNew) {
    if (plan === "solo" || plan === "team") {
      if (plan === "solo" && state.pro) return;
      startCheckout(plan);
    } else if (plan === "free" && isNew && state.email) {
      apiJSON("/agent/signup", "POST", { email: state.email }).catch(function () {});
      var m = openAuthModal({ mode: "signup", plan: "free", step: "done" });
      if (m && m.__showStep) m.__showStep("done", state.email);
    }
  }

  var OAUTH_ERRORS = {
    denied: function (n) { return n + " sign-in was cancelled."; },
    in_use: function (n) { return "That " + n + " account is linked to another Transitions.dev account."; },
    no_email: function (n) { return "Your " + n + " account has no verified email we can use. Add one there, or continue with email."; },
    signed_out: function (n) { return "Sign in first, then connect " + n + "."; },
    unavailable: function (n) { return n + " sign-in isn’t available right now. Continue with email."; },
    expired: function (n) { return "That " + n + " sign-in took too long. Please try again."; },
    failed: function (n) { return "Couldn’t sign in with " + n + ". Please try again, or continue with email."; },
  };

  // The API sends the browser back with ?oauth=… (done), ?oauth_error=… or
  // ?oauth_confirm=<id> (an existing account: enter the emailed code).
  function handleOAuthReturn() {
    var q = new URLSearchParams(location.search);
    var status = q.get("oauth"), err = q.get("oauth_error"), pending = q.get("oauth_confirm");
    if (!status && !err && !pending) return;
    var provider = q.get("provider") || "", plan = q.get("plan") || "";
    ["oauth", "oauth_error", "oauth_confirm", "provider", "plan"].forEach(function (k) { q.delete(k); });
    var qs = q.toString();
    history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    var name = PROVIDER_NAMES[provider] || "that account";
    if (pending) {
      apiJSON("/auth/oauth/confirm/" + encodeURIComponent(pending)).then(function (r) {
        if (!r || r.error) {
          var m = openAuthModal({ mode: "signin", plan: plan || null });
          setModalNote(m.querySelector(".tp-modal-note"), OAUTH_ERRORS.expired(name), "err");
          return;
        }
        openAuthModal({ mode: "signin", plan: plan || null, step: "code", pending: { id: pending, provider: r.provider, email: r.email } });
      });
      return;
    }
    if (err) {
      // "Connect" errors belong to the page that asked (the Studio says them).
      if (err === "in_use" || err === "signed_out") {
        oauthDone({ error: err, provider: provider, text: OAUTH_ERRORS[err](name) });
        if (state.authenticated) return;
      }
      var m = openAuthModal({ mode: plan ? "signup" : "signin", plan: plan || null });
      setModalNote(m.querySelector(".tp-modal-note"), (OAUTH_ERRORS[err] || OAUTH_ERRORS.failed)(name), "err");
      return;
    }
    refreshMe().then(function () {
      oauthDone({ status: status, provider: provider });
      if (status !== "connected") afterProviderSignIn(plan, status === "signed_up");
    });
  }

  // Community actions need an account. Signed in: run `onDone` now.
  // Otherwise open the community sign-in, which creates the account when the
  // address is new and runs `onDone` once the code verifies.
  function joinCommunity(onDone) {
    if (state.authenticated) { if (typeof onDone === "function") onDone(); return; }
    openAuthModal({ mode: "signup", plan: "community", onDone: onDone });
  }

  // opts: { mode: "signin" | "signup", plan: "free" | "solo" | "team" | "community", cta, onDone }
  function openAuthModal(opts) {
    opts = opts || {};
    authCtx = {
      mode: opts.mode === "signup" ? "signup" : "signin",
      plan: opts.plan || null,
      cta: opts.cta || null,
      onDone: opts.onDone || null,
      pending: opts.pending || null,
    };
    var m = ensureAuthModal();
    lastFocus = document.activeElement;
    setModalNote(m.querySelector(".tp-modal-note"), "", "");
    var codeInput = m.querySelector("#tp-modal-code");
    if (codeInput) codeInput.value = "";
    if (m.__showStep) m.__showStep(opts.step || "email");
    m.classList.remove("is-closing");
    m.removeAttribute("hidden");
    // Reflow so the enter transition plays from the closed (scale .96 / opacity 0) state.
    void m.offsetWidth;
    m.classList.add("is-open");
    var input = m.querySelector("#tp-modal-email");
    setTimeout(function () { (opts.step === "code" ? m.querySelector("#tp-modal-code") : input).focus(); }, 0);
    return m;
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
      ".tp-modal-backdrop{position:absolute;inset:0;background:rgba(15,15,15,.28);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);opacity:0;" +
      "transition:opacity 200ms cubic-bezier(0.22,1,0.36,1)}" +
      'html[data-theme="dark"] .tp-modal-backdrop{background:rgba(0,0,0,.5)}' +
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
      ".tp-modal-intro-muted{color:#8a8a8a;display:block}" +
      ".tp-modal-mark{display:block;width:24px;height:24px;color:#1d1d1d;margin-bottom:-9px}" +
      ".tp-modal-mark[hidden]{display:none}" +
      ".tp-modal-mark svg{display:block;width:24px;height:24px}" +
      'html[data-theme="dark"] .tp-modal-mark{color:#f2f2f2}' +
      ".tp-modal-form{display:flex;flex-direction:column;gap:12px}" +
      // An author display rule outranks the UA [hidden] style, so every element
      // this modal toggles needs its own companion rule. Without it the code
      // form was permanently on screen: the card showed two inputs and two
      // submit buttons at once, and the "step" it advanced to was already there.
      ".tp-modal-form[hidden],.tp-modal-note[hidden],.tp-modal-error[hidden],.tp-modal-foot[hidden]{display:none}" +
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
      // Site secondary tokens, matching the paywall's secondary action: the
      // 0 1px 2px shadow belongs to the PRIMARY variant only, so the secondary
      // drops it rather than inheriting it from the base class. Doubled class
      // so this outranks the themed base rule whatever the sheet order.
      ".tp-modal-btn.tp-modal-btn--ghost{background:#e9e9e9;color:#17181c;box-shadow:none}" +
      ".tp-modal-btn.tp-modal-btn--ghost:hover{background:#e0e0e0}" +
      'html[data-theme="dark"] .tp-modal-btn.tp-modal-btn--ghost{background:#2a2a2c;color:#f2f2f2}' +
      'html[data-theme="dark"] .tp-modal-btn.tp-modal-btn--ghost:hover{background:#333336}' +
      'html[data-theme="dark"] .tp-modal-btn{background:#f2f2f2;color:#111}' +
      ".tp-modal-note{margin:0;font-size:13px;line-height:1.4}" +
      '.tp-modal-note[data-kind="ok"]{color:#16a34a}' +
      '.tp-modal-note[data-kind="err"]{color:#d62b11}' +
      ".tp-modal-foot{margin:0;font-size:13px;line-height:16px;color:#17181c}" +
      ".tp-modal-oauth{display:flex;flex-direction:column;gap:8px}" +
      ".tp-modal-oauth[hidden],.tp-modal-oauth-btn[hidden],.tp-modal-legal[hidden]{display:none}" +
      ".tp-modal-oauth-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px}" +
      ".tp-modal-oauth-btn svg{flex:none}" +
      ".tp-modal-or{display:flex;align-items:center;gap:12px;margin:4px 0 -12px;font-size:12px;line-height:16px;color:#8a8a8a}" +
      ".tp-modal-or::before,.tp-modal-or::after{content:\"\";flex:1;height:1px;background:rgba(0,0,0,.08)}" +
      'html[data-theme="dark"] .tp-modal-or::before,html[data-theme="dark"] .tp-modal-or::after{background:rgba(255,255,255,.1)}' +
      ".tp-modal-legal{margin:-12px 0 0;font-size:12px;line-height:17px;color:#8a8a8a}" +
      ".tp-modal-legal a{color:inherit;text-decoration:underline;text-underline-offset:2px}" +
      ".tp-modal-legal a:hover{color:#17181c}" +
      'html[data-theme="dark"] .tp-modal-legal a:hover{color:#f2f2f2}' +
      ".tp-modal-foot a{color:inherit;font-weight:500;text-decoration:none}" +
      ".tp-modal-foot a:hover{text-decoration:underline}" +
      ".tp-modal-foot button{border:0;background:none;padding:0;font:inherit;font-weight:500;color:inherit;cursor:pointer}" +
      ".tp-modal-foot button:hover{text-decoration:underline}" +
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

  // Signed-in avatar on the 3-dot "More" button, same as Libraries.dev
  // (Figma 1425:38996): a raised white chip with the email's initial in light
  // mode, a #2a2a2a chip in dark. Injected here because every page that loads
  // this client carries its own copy of the nav CSS.
  // Initial avatars in the avvvatars style (avvvatars.com, MIT, by nusu): a
  // pastel background with matching ink, picked from its 20 pairs by a hash
  // of the person, so everyone keeps their color everywhere.
  var AV_BG = ["F7F9FC", "EEEDFD", "FFEBEE", "FDEFE2", "E7F9F3", "EDEEFD", "ECFAFE", "F2FFD1", "FFF7E0", "FDF1F7",
    "EAEFE6", "E0E6EB", "E4E2F3", "E6DFEC", "E2F4E8", "E6EBEF", "EBE6EF", "E8DEF6", "D8E8F3", "ECE1FE"];
  var AV_FG = ["060A23", "4409B9", "BD0F2C", "C56511", "216E55", "05128A", "1F84A3", "526E0C", "935F10", "973562",
    "69785E", "2D3A46", "280F6D", "37364F", "363548", "4D176E", "AB133E", "420790", "222A54", "192251"];
  // seed: what identifies the person (name, else email or handle). Returns the
  // two letters and the colors: { text, bg, fg }.
  function avatarFor(name, fallback) {
    var seed = String(name || fallback || "?").trim().toLowerCase();
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    var k = h % AV_BG.length;
    var words = String(name || "").trim().split(/\s+/).filter(Boolean);
    var text = words.length > 1 ? words[0].charAt(0) + words[words.length - 1].charAt(0)
      : (words[0] || String(fallback || "?").split("@")[0].replace(/[^\p{L}\p{N}]/gu, "")).slice(0, 2);
    return { text: (text || "?").toUpperCase(), bg: "#" + AV_BG[k], fg: "#" + AV_FG[k] };
  }
  // Paints an avatar element: the letters and its --av-bg / --av-fg.
  function paintAvatar(el, name, fallback) {
    var a = avatarFor(name, fallback);
    el.style.setProperty("--av-bg", a.bg);
    el.style.setProperty("--av-fg", a.fg);
    return a;
  }

  function injectAvatarStyle() {
    if (document.getElementById("tp-avatar-base")) return;
    var st = document.createElement("style");
    st.id = "tp-avatar-base";
    st.textContent =
      ".icon-btn.icon-btn--avatar{background:var(--av-bg,#fff);color:var(--av-fg,#17181c);" +
      "box-shadow:0 1px 3px 0 rgba(0,0,0,.04),inset 0 0 0 1px rgba(0,0,0,.06)," +
      "inset 0 -1px 0 0 rgba(0,0,0,.1),inset 0 0 0 1px rgba(196,196,196,.1)}" +
      ".icon-btn.icon-btn--avatar:hover{background:color-mix(in srgb,var(--av-bg,#fff) 95%,#000)}" +
      ".icon-btn.icon-btn--avatar:active{background:color-mix(in srgb,var(--av-bg,#fff) 90%,#000)}" +
      // Dark: the ink tints a dark chip and the pastel becomes the letters.
      'html[data-theme="dark"] .icon-btn.icon-btn--avatar{background:color-mix(in srgb,var(--av-fg,#e8e8e8) 30%,#202020);color:var(--av-bg,#e8e8e8);' +
      "box-shadow:0 1px 3px 0 rgba(0,0,0,.04),inset 0 1px 0 0 rgba(255,255,255,.04)," +
      "inset 0 0 0 1px rgba(0,0,0,.06),inset 0 -1px 0 0 rgba(0,0,0,.06),inset 0 0 0 1px rgba(196,196,196,.1)}" +
      'html[data-theme="dark"] .icon-btn.icon-btn--avatar:hover{background:color-mix(in srgb,var(--av-fg,#e8e8e8) 36%,#202020)}' +
      'html[data-theme="dark"] .icon-btn.icon-btn--avatar:active{background:color-mix(in srgb,var(--av-fg,#e8e8e8) 26%,#202020)}' +
      ".icon-btn.icon-btn--avatar svg{display:none!important}" +
      ".nav-avatar-initial{display:none;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;" +
      "font-size:12px;font-weight:500;line-height:13px;letter-spacing:-.01em;text-transform:uppercase}" +
      ".icon-btn--avatar .nav-avatar-initial{display:block}" +
      ".nav-avatar-img{display:none}" +
      ".icon-btn--avatar.icon-btn--pic{overflow:hidden;padding:0}" +
      ".icon-btn--avatar.icon-btn--pic .nav-avatar-initial{display:none}" +
      ".icon-btn--avatar.icon-btn--pic .nav-avatar-img{display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}";
    document.head.appendChild(st);
  }

  // Inject a "Pro" badge into any card tagged data-pro="true". Purely visual — the base
  // style is minimal and low-specificity so page CSS added later overrides it easily.
  function mountProBadges() {
    injectBadgeStyle();
    // "New" next to Community in the nav, Builder in the Products menu, and
    // both in the mobile menu.
    document.querySelectorAll('a[data-nav="community"], .mobile-menu-link[href="/community.html"], ' +
      '.nav-products-item[href="/builder.html"] .nav-products-name, .mobile-menu-link[href="/builder.html"]').forEach(function (a) {
      if (a.querySelector(".nav-new-badge")) return;
      var b = document.createElement("span");
      b.className = "nav-new-badge";
      b.textContent = "New";
      a.appendChild(b);
    });
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
      'html[data-theme="dark"] .card-pro-badge{background:rgba(0,115,255,0.16);color:rgba(122,168,255,0.95)}' +
      // The nav's "New" tag on Community: the same pill, inline.
      ".nav-new-badge{display:inline-flex;align-items:center;height:18px;margin-left:6px;padding:0 6px;border-radius:50px;" +
      "background:rgba(0,115,255,0.06);font:500 11px/1.4 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;" +
      "color:rgba(0,83,227,0.8);box-shadow:0 1px 3px rgba(0,0,0,0.04),inset 0 0 0 1px rgba(0,101,208,0.1)," +
      "inset 0 -1px 0 0 rgba(0,0,0,0.06),inset 0 0 0 1px rgba(196,196,196,0.1)}" +
      'html[data-theme="dark"] .nav-new-badge{background:rgba(0,115,255,0.16);color:rgba(122,168,255,0.95)}' +
      ".nav-products-name:has(.nav-new-badge){display:inline-flex;align-items:center}" +
      // A pill ending in the badge: the right padding equals the badge's gap from the top.
      ".nav-pill:has(>.nav-new-badge){padding-right:9px}";
    document.head.appendChild(style);
  }

  // ⋮ menu Feedback page (same as libraries.dev). The page scripts own the
  // menu's open/close and the Appearance page; this adds page 4, a note
  // form behind a back button. Watching the slide's data-page keeps the
  // menu's width and the form's note in step however the page changes
  // (back button, menu close, Appearance).
  function wireFeedback() {
    var slide = document.getElementById("pm-slide");
    var menu = document.getElementById("more-menu");
    var item = document.getElementById("pm-feedback");
    var back = document.getElementById("pm-fb-back");
    var form = document.getElementById("pm-feedback-form");
    if (!slide || !menu || !item || !form) return;
    var input = form.querySelector(".pm-feedback-input");
    var emailEl = form.querySelector(".pm-feedback-email");
    var note = form.querySelector(".pm-feedback-note");
    var btn = form.querySelector(".pm-feedback-btn");
    var sending = false;
    var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    function syncHeight() {
      var active = slide.querySelector('.t-page[data-page-id="' + slide.getAttribute("data-page") + '"]');
      if (active) slide.style.height = active.offsetHeight + "px";
    }
    function setPage(page) { slide.setAttribute("data-page", page); syncHeight(); }
    function setNote(kind, html) {
      if (!html) { note.hidden = true; note.removeAttribute("data-kind"); note.innerHTML = ""; }
      else { note.hidden = false; note.setAttribute("data-kind", kind); note.innerHTML = html; }
      syncHeight();
    }
    new MutationObserver(function () {
      var onForm = slide.getAttribute("data-page") === "4";
      menu.classList.toggle("is-feedback", onForm);
      // Leaving the form keeps an unsent draft but drops any note or error.
      if (!onForm) {
        input.classList.remove("is-error");
        if (emailEl) emailEl.classList.remove("is-error");
        if (!note.hidden) setNote(null, "");
      }
    }).observe(slide, { attributes: true, attributeFilter: ["data-page"] });

    function open() {
      setPage("4");
      // A signed-in visitor's address is known, so a reply can reach them.
      if (emailEl && !emailEl.value && state.email) emailEl.value = state.email;
      input.focus({ preventScroll: true });
    }
    function shake(el) {
      el.classList.add("is-error");
      el.classList.remove("is-shaking");
      void el.offsetWidth;
      el.classList.add("is-shaking");
      el.addEventListener("animationend", function () { el.classList.remove("is-shaking"); }, { once: true });
    }
    function send() {
      if (sending) return;
      var message = input.value.trim();
      if (!message) {
        shake(input);
        setNote("err", "Write a few words first.");
        input.focus();
        return;
      }
      var email = emailEl ? emailEl.value.trim() : "";
      if (email && !EMAIL_RE.test(email)) {
        shake(emailEl);
        setNote("err", "That email doesn't look right.");
        emailEl.focus();
        return;
      }
      sending = true;
      btn.disabled = true;
      btn.textContent = "Sending…";
      setNote(null, "");
      api("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, page: location.href, email: email || undefined })
      })
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function () {
          input.value = "";
          setNote("ok", "Sent. Thank you!");
          setTimeout(function () {
            var moreBtn = document.getElementById("more-btn");
            if (menu.classList.contains("is-open") && moreBtn) moreBtn.click();
          }, 1400);
        })
        .catch(function () {
          var subject = encodeURIComponent("Feedback on Transitions.dev");
          var body = encodeURIComponent(message + "\n\nFrom " + location.href);
          setNote("err", 'Could not send. <a href="mailto:jakubja@gmail.com?subject=' + subject + "&body=" + body + '">Email it instead</a>.');
        })
        .then(function () {
          sending = false;
          btn.disabled = false;
          btn.textContent = "Send feedback";
        });
    }

    item.addEventListener("click", function (e) { e.preventDefault(); open(); });
    item.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    if (back) back.addEventListener("click", function () { setPage("1"); item.focus({ preventScroll: true }); });
    form.addEventListener("submit", function (e) { e.preventDefault(); send(); });
    [input, emailEl].forEach(function (el) {
      if (!el) return;
      el.addEventListener("input", function () {
        el.classList.remove("is-error");
        if (note.getAttribute("data-kind") === "err") setNote(null, "");
      });
    });
    if (emailEl) emailEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); send(); }
    });
    // ⌘/Ctrl+Enter sends; Escape bubbles to the page's menu handler.
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    });
  }

  function wire() {
    document.querySelectorAll(".pro-price-cta[data-plan]").forEach(function (cta) {
      cta.addEventListener("click", function (e) {
        e.preventDefault();
        if (cta.getAttribute("aria-disabled") === "true") return;
        var plan = cta.getAttribute("data-plan");
        if (cta.getAttribute("data-action") === "credits") changeCredits(cta);
        else if (cta.getAttribute("data-action") === "portal") startPortal();
        else if (plan === "free") startFree(cta);
        else startPaid(plan, cta);
      });
    });
    // "Join for free": the free sign-up box; signed in, straight to the Builder.
    // The href (pricing) is the fallback without this client.
    document.querySelectorAll("[data-join-free]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
        if (state.authenticated) location.href = "/builder.html";
        else openAuthModal({ mode: "signup", plan: "free", cta: el });
      });
    });
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
      state.email = cached.e || null;
      state.avatar = cached.v || null;
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
    wireFeedback();
    refreshMe();
    refreshGeo();
    handleOAuthReturn();
    injectModalRing();
  }

  // Light theme: every modal card (search, sign-in, Before you pay, the
  // Studio's and Community's dialogs, the remix picker) is edged with a
  // white hairline instead of a grey one, over the dimmed backdrop. The
  // ring comes first so the drop shadows paint under it, not over it. Here
  // because this client loads on every page; dark mode keeps its own rings.
  function injectModalRing() {
    if (document.getElementById("tp-modal-ring")) return;
    var st = document.createElement("style");
    st.id = "tp-modal-ring";
    st.textContent =
      'html:not([data-theme="dark"]) .cmdk-panel{box-shadow:0 0 0 1px #fff,0 4px 42px 0 rgba(0,0,0,.08),0 2px 6px 0 rgba(0,0,0,.06)}' +
      'html:not([data-theme="dark"]) .st-dialog-card{box-shadow:0 0 0 1px #fff,0 20px 60px rgba(0,0,0,.25),0 1px 3px 0 rgba(0,0,0,.04)}' +
      'html:not([data-theme="dark"]) .tp-modal-card{box-shadow:0 0 0 1px #fff,0 1px 3px rgba(0,0,0,.04)}' +
      'html:not([data-theme="dark"]) .tp-buy-card{box-shadow:0 0 0 1px #fff,0 20px 60px rgba(0,0,0,.25)}';
    document.head.appendChild(st);
  }

  // Gift links: /pro.html?code=CODE&redeem=1 (or redeem=yearly) go straight
  // to Stripe Checkout for Pro with the code applied, no plan pick and no
  // purchase dialog. A 100% code checks out at $0 without a card; the
  // success page then signs the new account in.
  function redeemFromUrl() {
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    var redeem = params.get("redeem");
    if (!redeem || !urlPromoCode()) return;
    var cta = document.querySelector('.pro-price-cta[data-plan="solo"]');
    toCheckout({ plan: redeem === "yearly" ? "yearly" : "monthly" }, cta);
  }

  function boot() { wire(); redeemFromUrl(); }
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
