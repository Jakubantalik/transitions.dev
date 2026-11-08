// The nav's Cmd+K search, shared by every page: the remix picker's layout (search
// field, category pills, thumbnail grid) plus a Community category. Pages and
// actions show as rows once there is a query. Community previews come from
// community.js, loaded the first time they are needed.
//
// Add new transitions to TRANSITIONS. The thumbnails are the picker's,
// assets/community/thumbs/<slug>.jpg.
(function () {
  "use strict";

  // [title, detail.html slug, thumbnail slug, pro, categories, search terms]
  var TRANSITIONS = [
    ["Card resize","card-resize","card-resize",0,["essential"],"essential expand grow height smooth card resize transition"],
    ["Number pop-in","number-pop-in","number-pop-in",0,["texts"],"text count digits digit swap drum bounce blur stagger"],
    ["Notification badge","notification-badge","notification-badge",0,["essential"],"essential bell unread alert diagonal slide with spring pop-in"],
    ["Text states swap","text-states-swap","text-states-swap",0,["essential"],"essential label change text swap transition with blur"],
    ["Menu dropdown","menu-dropdown","menu-dropdown",0,["essential"],"essential select popover origin-aware open / close transition"],
    ["Confetti burst","confetti-burst","confetti-burst",1,["effects"],"effects celebrate party particles success physics confetti lands on the button"],
    ["Modal open/close","modal-open-close","modal-open-close",0,["essential"],"essential dialog popup overlay modal transition with scale"],
    ["Panel reveal","panel-reveal","panel-reveal",0,["essential"],"essential drawer sidebar sheet panel open / close transition"],
    ["Gooey plus menu","gooey-plus-menu","gooey-plus-menu",1,["effects"],"effects fab floating action liquid split into a fan of actions"],
    ["Page side-by-side","page-side-by-side","page-side-by-side",0,["essential"],"essential slide navigation route forward / back page transition"],
    ["Icon swap","icon-swap","icon-swap",0,["essential"],"essential morph replace scale and blur icon swap"],
    ["Success check","success-check","success-check",0,["essential"],"essential done confirm tick succes check with blur and rotate"],
    ["Avatar group hover","avatar-group-hover","avatar-group-hover",0,["effects"],"effects stack people faces distance-falloff lift with bouncy return"],
    ["Card stack hover","card-stack-hover","card-stack-hover",1,["effects"],"effects fan deck photos stack fans out with a spring on hover"],
    ["Error state shake","error-state-shake","error-state-shake",0,["essential"],"essential invalid form wiggle cubic-bezier shake on error"],
    ["Input clear with dissolve","input-clear-with-dissolve","input-clear-with-dissolve",0,["effects"],"effects search field reset clear with per-word dissolve"],
    ["Skeleton loader and reveal","skeleton-loader-and-reveal","skeleton-loader-and-reveal",0,["essential"],"essential loading placeholder pulse to content cross-fade"],
    ["Texts reveal","texts-reveal","texts-reveal",0,["texts"],"text stagger words headline two lines rise with offset stagger"],
    ["Tabs sliding","tabs-sliding","tabs-sliding",0,["essential"],"essential segmented control pill pill indicator follows the active tab"],
    ["Drag & drop with physics","drag-drop-with-physics","drag-drop-physics",1,["effects","images"],"effects image photo upload spring zone morphs into the image"],
    ["Shimmer text","shimmer-text","shimmer-text",0,["texts","ai"],"text ai agents loading shine thinking masked gradient sweep across text"],
    ["Organic shimmer","organic-shimmer","organic-shimmer",1,["effects","ai"],"effects ai agents loading gradient wavy shimmer with edge glow"],
    ["Tooltip open/close","tooltip-open-close","tooltip-open-close",0,["essential"],"essential hint popover delayed in, travels, instant out"],
    ["3D tilt","3d-tilt","3d-tilt",0,["effects"],"effects hover glare perspective 3d pointer tilt with cursor glare"],
    ["Dropdown menu morph","dropdown-menu-morph","dropdown-menu-morph",0,["essential"],"essential select popover fab button morphs into a menu surface"],
    ["Accordion","accordion","accordion",0,["essential"],"essential collapse expand disclosure faq grid-rows height with chevron morph"],
    ["Toast open/close","toast-open-close","toast-open-close",0,["essential"],"essential snackbar notification alert rises in with fade, blur and scale"],
    ["Like button","like-button","like-button",0,["effects"],"effects heart favorite heart fills and bursts particles"],
    ["Image open tilt","image-open-tilt","image-open-tilt",1,["effects","images"],"effects image photo lightbox gallery viewer zoom with 3d tilt and bend"],
    ["Learn more hover","learn-more-hover","learn-more-hover",0,["essential"],"essential arrow link cta chevron shifts and opens on hover"],
    ["Checkbox check","checkbox-check","checkbox-check",0,["essential"],"essential tick form check draws on with a stroke path"],
    ["Spinner to check morph","spinner-to-check-morph","spinner-check-morph",1,["ai"],"ai agents loading done success task spinner pops into a drawn check"],
    ["Spinning counter","spinning-counter","spinning-counter",0,["texts"],"text odometer slot digits number digits roll on a 3d drum to the value"],
    ["Number subtle change","number-subtle-change","number-subtle-change",0,["texts"],"text count digits number stat metric dashboard ticker live quiet cross-fade in place"],
    ["Toggle","toggle","toggle",0,["essential"],"essential switch thumb slides with a double bounce"],
    ["Pro gradient text","pro-gradient-text","pro-gradient-text",1,["texts","ai"],"text ai agents shine badge colour washes orbit the letters"],
    ["Delete with smoky dissolve","delete-with-smoky-dissolve","smoky-dissolve",1,["effects","images"],"effects image photo remove delete disintegrate image shreds and falls into smoke"],
    ["Thinking states","thinking-states","thinking-states",0,["ai"],"ai agents chat agent loading status line shimmers, then swaps to the next"],
    ["Reasoning stream","reasoning-stream","reasoning-stream",0,["ai"],"ai agents chat agent thinking agent reasoning scrolls by two lines"],
    ["Streaming text","streaming-text","streaming-text",0,["ai"],"ai agents chat typing typewriter words resolve through a soft cross-blur"],
    ["Matrix dot loader","matrix-dot-loader","matrix-dot-loader",0,["ai"],"ai agents loading spinner 16-dot matrix pulses in four patterns"],
    ["Banner stacking","banner-stacking","banner-stacking",0,["essential"],"essential notification alert stack banners stack like toasts, three deep"],
    ["Image generation placeholder","image-generation-placeholder","image-gen-placeholder",1,["ai","effects","images"],"ai agents effects image photo ai generation dots loading dot noise wakes, then resolves into the image"],
    ["Get Pro button","get-pro-button","get-pro-button",1,["effects"],"effects upgrade cta shine pro gradient glows in from the pill’s rim"]
  ];
  var ITEMS = [{"group":"Pages","label":"Home","hint":"Transitions.dev","href":"/","ic":"grid"},{"group":"Pages","label":"Library","hint":"Every transition, filterable","href":"/library.html","ic":"grid"},{"group":"Pages","label":"Community","hint":"Components built by the community","href":"/community.html","ic":"grid"},{"group":"Pages","label":"Builder","hint":"Build a component with the AI agent","href":"/builder.html","ic":"wand"},{"group":"Pages","label":"Projects","hint":"Your saved and published components","href":"/projects.html","ic":"grid"},{"group":"Pages","label":"Studio","hint":"Build or remix a component","href":"/studio.html","ic":"wand"},{"group":"Pages","label":"Docs","hint":"Introduction, installation, accessibility","href":"/detail.html?doc=introduction","ic":"spark"},{"group":"Pages","label":"Motion Skill","hint":"Agent skill","href":"/skill.html","ic":"spark"},{"group":"Pages","label":"MCP","hint":"Builder agent in your coding agent","href":"/mcp.html","ic":"spark"},{"group":"Pages","label":"Motion Agent","hint":"Motion fixes + PRs","href":"/agent.html","ic":"wand"},{"group":"Pages","label":"Transitions Pro","hint":"Pricing","href":"/pro.html","ic":"pro"},{"group":"Actions","label":"Get Pro access","href":"mailto:jakubja@gmail.com?subject=Transitions%20Pro%20access","ic":"pro"},{"group":"Actions","label":"View on GitHub","href":"https://github.com/Jakubantalik/transitions.dev","ext":true,"ic":"github"},{"group":"Actions","label":"Contact support","href":"mailto:jakubja@gmail.com","ic":"mail"},{"group":"Actions","label":"Toggle dark mode","action":"theme","ic":"moon"}];
  var ICONS = {"grid":"<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M1.33333 8L7.76149 11.2141C7.84894 11.2578 7.89267 11.2797 7.93853 11.2883C7.97916 11.2959 8.02084 11.2959 8.06147 11.2883C8.10733 11.2797 8.15106 11.2578 8.23851 11.2141L14.6667 8M1.33333 11.3333L7.76149 14.5474C7.84894 14.5911 7.89267 14.613 7.93853 14.6216C7.97916 14.6292 8.02084 14.6292 8.06147 14.6216C8.10733 14.613 8.15106 14.5911 8.23851 14.5474L14.6667 11.3333M7.76149 7.88074L2.76442 5.38221C2.30381 5.1519 2.07351 5.03675 1.9996 4.88093C1.93529 4.74533 1.93529 4.58801 1.9996 4.4524C2.07351 4.29658 2.30381 4.18143 2.76442 3.95112L7.76149 1.45259C7.84894 1.40886 7.89267 1.387 7.93853 1.37839C7.97916 1.37077 8.02084 1.37077 8.06147 1.37839C8.10733 1.387 8.15106 1.40886 8.23851 1.45259L13.2356 3.95112C13.6962 4.18143 13.9265 4.29658 14.0004 4.4524C14.0647 4.58801 14.0647 4.74533 14.0004 4.88093C13.9265 5.03675 13.6962 5.1519 13.2356 5.38221L8.23851 7.88074C8.15106 7.92447 8.10733 7.94633 8.06147 7.95494C8.02084 7.96256 7.97916 7.96256 7.93853 7.95494C7.89267 7.94633 7.84894 7.92447 7.76149 7.88074Z\"/></svg>","spark":"<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M11.196 8.86766L11.5622 8.77611C12.4742 8.54812 12.9302 8.43412 13.0364 8.25291C13.128 8.09674 13.128 7.90326 13.0364 7.74709C12.9302 7.56588 12.4742 7.45188 11.5622 7.22389L11.196 7.13233C10.5188 6.96302 10.1801 6.87837 9.90461 6.70206C9.66088 6.5461 9.4539 6.33912 9.29794 6.09539C9.12163 5.81985 9.03697 5.48123 8.86766 4.80399L8.77611 4.43779C8.54812 3.52581 8.43412 3.06982 8.25291 2.96357C8.09674 2.87199 7.90326 2.87199 7.74709 2.96357C7.56588 3.06982 7.45188 3.52581 7.22389 4.43779L7.13233 4.80399C6.96302 5.48123 6.87837 5.81985 6.70206 6.09539C6.5461 6.33912 6.33912 6.5461 6.09539 6.70206C5.81985 6.87837 5.48123 6.96303 4.80399 7.13233L4.43779 7.22389C3.52581 7.45188 3.06982 7.56588 2.96357 7.74709C2.87199 7.90326 2.87199 8.09674 2.96357 8.25291C3.06982 8.43412 3.52581 8.54812 4.43779 8.77611L4.80399 8.86766C5.48123 9.03697 5.81985 9.12163 6.09539 9.29794C6.33912 9.4539 6.5461 9.66088 6.70206 9.90461C6.87837 10.1801 6.96303 10.5188 7.13233 11.196L7.22389 11.5622C7.45188 12.4742 7.56588 12.9302 7.74709 13.0364C7.90326 13.128 8.09674 13.128 8.25291 13.0364C8.43412 12.9302 8.54812 12.4742 8.77611 11.5622L8.86766 11.196C9.03697 10.5188 9.12163 10.1801 9.29794 9.90461C9.4539 9.66088 9.66088 9.4539 9.90461 9.29794C10.1801 9.12163 10.5188 9.03697 11.196 8.86766Z\"/></svg>","wand":"<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8.66667 9.33333L6.66667 7.33333M10.0069 2.33333V1.33333M12.6331 3.37377L13.3402 2.66667M12.6331 8.66667L13.3402 9.37377M7.34023 3.37377L6.63313 2.66667M13.6736 6H14.6736M4.08758 13.9124L10.2458 7.75425C10.5098 7.49024 10.6418 7.35823 10.6912 7.20601C10.7347 7.07212 10.7347 6.92788 10.6912 6.79399C10.6418 6.64177 10.5098 6.50976 10.2458 6.24575L9.75425 5.75425C9.49024 5.49024 9.35823 5.35823 9.20601 5.30877C9.07212 5.26527 8.92788 5.26527 8.79399 5.30877C8.64177 5.35823 8.50976 5.49024 8.24575 5.75425L2.08758 11.9124C1.82357 12.1764 1.69156 12.3084 1.6421 12.4607C1.5986 12.5946 1.5986 12.7388 1.6421 12.8727C1.69156 13.0249 1.82357 13.1569 2.08758 13.4209L2.57909 13.9124C2.8431 14.1764 2.9751 14.3084 3.12732 14.3579C3.26122 14.4014 3.40545 14.4014 3.53934 14.3579C3.69156 14.3084 3.82357 14.1764 4.08758 13.9124Z\"/></svg>","pro":"<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7.52176 2.3022C7.67541 1.99091 7.75224 1.83526 7.85654 1.78553C7.94729 1.74227 8.05271 1.74227 8.14346 1.78553C8.24776 1.83526 8.32459 1.99091 8.47824 2.3022L9.93603 5.25551C9.98139 5.34742 10.0041 5.39337 10.0372 5.42904C10.0666 5.46063 10.1018 5.48623 10.1409 5.50441C10.185 5.52494 10.2357 5.53235 10.3371 5.54717L13.598 6.0238C13.9414 6.07399 14.1131 6.09908 14.1925 6.18295C14.2616 6.25592 14.2942 6.35619 14.281 6.45584C14.2659 6.57038 14.1416 6.69145 13.893 6.93358L11.5343 9.23094C11.4608 9.30255 11.424 9.33836 11.4003 9.38097C11.3793 9.41869 11.3658 9.46013 11.3606 9.503C11.3547 9.55141 11.3634 9.60199 11.3808 9.70315L11.9373 12.9481C11.996 13.2903 12.0253 13.4614 11.9702 13.563C11.9222 13.6513 11.8369 13.7133 11.738 13.7316C11.6244 13.7527 11.4707 13.6719 11.1634 13.5103L8.24824 11.9772C8.15741 11.9294 8.112 11.9056 8.06415 11.8962C8.02179 11.8879 7.97821 11.8879 7.93585 11.8962C7.888 11.9056 7.84259 11.9294 7.75176 11.9772L4.8366 13.5103C4.52927 13.6719 4.3756 13.7527 4.26197 13.7316C4.16311 13.7133 4.0778 13.6513 4.02981 13.563C3.97466 13.4614 4.00401 13.2903 4.06271 12.9481L4.61925 9.70315C4.6366 9.60199 4.64527 9.55141 4.6394 9.503C4.6342 9.46013 4.62073 9.41869 4.59973 9.38097C4.576 9.33836 4.53924 9.30255 4.46571 9.23094L2.10703 6.93358C1.85843 6.69145 1.73413 6.57038 1.71901 6.45584C1.70585 6.35619 1.73836 6.25592 1.80749 6.18295C1.88695 6.09908 2.05864 6.07399 2.40202 6.0238L5.66286 5.54717C5.76427 5.53235 5.81498 5.52494 5.85913 5.50441C5.89823 5.48623 5.93343 5.46063 5.96278 5.42904C5.99593 5.39337 6.01861 5.34742 6.06397 5.25551L7.52176 2.3022Z\"/></svg>","github":"<svg viewBox=\"0 0 16 16\" fill=\"currentColor\"><path d=\"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z\"/></svg>","mail":"<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M1.33333 4.66667L6.77661 8.47696C7.21739 8.78551 7.43778 8.93978 7.67751 8.99954C7.88926 9.05232 8.11074 9.05232 8.32249 8.99954C8.56222 8.93978 8.78261 8.78551 9.22339 8.47696L14.6667 4.66667M4.53333 13.3333H11.4667C12.5868 13.3333 13.1468 13.3333 13.5746 13.1153C13.951 12.9236 14.2569 12.6176 14.4487 12.2413C14.6667 11.8135 14.6667 11.2534 14.6667 10.1333V5.86667C14.6667 4.74656 14.6667 4.18651 14.4487 3.75869C14.2569 3.38236 13.951 3.0764 13.5746 2.88465C13.1468 2.66667 12.5868 2.66667 11.4667 2.66667H4.53333C3.41323 2.66667 2.85318 2.66667 2.42535 2.88465C2.04903 3.0764 1.74307 3.38236 1.55132 3.75869C1.33333 4.18651 1.33333 4.74656 1.33333 5.86667V10.1333C1.33333 11.2534 1.33333 11.8135 1.55132 12.2413C1.74307 12.6176 2.04903 12.9236 2.42535 13.1153C2.85318 13.3333 3.41323 13.3333 4.53333 13.3333Z\"/></svg>","moon":"<svg viewBox=\"0 0 16 16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"><path d=\"M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z\"/></svg>"};
  var GROUPS = [["all", "All"], ["essential", "Essential"], ["ai", "AI Agents"], ["effects", "Effects"], ["texts", "Texts"], ["images", "Images"], ["community", "Community"]];
  var COMMUNITY_JS = "/assets/community/community.js?v=256";
  var THUMB_V = { free: 2, pro: 3 };
  var SEARCH_ICON = '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5"/><path d="M14 14l-3.5-3.5"/></svg>';

  var transitions = TRANSITIONS.map(function (t) {
    return { group: "Transitions", label: t[0], hint: t[3] ? "Pro transition" : "Transition", href: "/detail.html?t=" + t[1], thumb: t[2], pro: !!t[3], cats: t[4], terms: t[5] };
  });

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ── Search ──────────────────────────────────────────────────────────────
  function haystack(it) {
    return (it.label + " " + (it.hint || "") + " " + it.group + " " + (it.terms || "")).toLowerCase();
  }

  // Edit distance with swapped neighbours counted as one edit.
  function distance(a, b) {
    var prev2 = null, prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var row = [i];
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], prev2[j - 2] + 1);
      }
      prev2 = prev;
      prev = row;
    }
    return prev[b.length];
  }

  function nearWord(token, words) {
    var allowed = token.length >= 6 ? 2 : token.length >= 4 ? 1 : 0;
    if (!allowed) return false;
    return words.some(function (w) { return Math.abs(w.length - token.length) <= allowed && distance(token, w) <= allowed; });
  }

  // Lower is better: the title first, then a word in it, then anything else.
  function rank(it, q) {
    var label = it.label.toLowerCase();
    if (label.indexOf(q) === 0) return 0;
    if ((" " + label).indexOf(" " + q) >= 0) return 1;
    if (label.indexOf(q) >= 0) return 2;
    return 3;
  }

  function search(all, q) {
    if (!q) return all;
    var tokens = q.split(/\s+/);
    var found = all.filter(function (it) {
      var hay = haystack(it);
      return tokens.every(function (t) { return hay.indexOf(t) >= 0; });
    });
    // Nothing matched as typed: allow typos ("conffeti").
    if (!found.length) {
      found = all.filter(function (it) {
        var words = haystack(it).split(/[^a-z0-9]+/);
        return tokens.every(function (t) { return words.some(function (w) { return w.indexOf(t) >= 0; }) || nearWord(t, words); });
      });
    }
    return found.map(function (it, i) { return { it: it, i: i, r: rank(it, q) }; })
      .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
      .map(function (x) { return x.it; });
  }

  // ── Community ───────────────────────────────────────────────────────────
  var communityP = null;
  function community() {
    if (window.Community) return Promise.resolve(window.Community);
    if (!communityP) {
      communityP = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = COMMUNITY_JS;
        s.onload = function () { resolve(window.Community); };
        s.onerror = function () { communityP = null; reject(new Error("community.js")); };
        document.head.appendChild(s);
      });
    }
    return communityP;
  }

  // A component lays out at its real size and is scaled down to the thumbnail.
  function fit(host, w, h, full) {
    var f = host.querySelector("iframe.cm-frame");
    if (!f) return;
    var W = host.clientWidth, H = host.clientHeight;
    var k = full || !w || !h ? 0.5 : Math.min(1, (W - 16) / w, (H - 16) / h);
    if (!(k > 0)) return;
    f.style.width = W / k + "px";
    f.style.height = H / k + "px";
    f.style.transform = "scale(" + k + ")";
  }

  // ── Palette ─────────────────────────────────────────────────────────────
  var overlay, input, list, chips;
  var cat = "all", active = 0, shown = [], hosts = [], paintId = 0, timer = null;

  function build() {
    overlay = document.createElement("div");
    overlay.className = "cmdk-overlay cmdk-lib";
    overlay.setAttribute("data-open", "false");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Search");
    overlay.innerHTML =
      '<div class="cmdk-panel">' +
        '<div class="cmdk-search">' + SEARCH_ICON +
          '<input class="cmdk-input" type="text" placeholder="Search transitions, components and pages…" aria-label="Search" autocomplete="off" spellcheck="false" />' +
          '<span class="cmdk-esc">esc</span>' +
        "</div>" +
        '<div class="cmdk-lib-chips" role="tablist" aria-label="Filter by category">' +
          GROUPS.map(function (g, i) {
            return '<button type="button" class="cmdk-lib-chip" data-cat="' + g[0] + '" data-active="' + (i === 0) + '" role="tab" aria-selected="' + (i === 0) + '">' + g[1] +
              (g[0] === "community" ? '<span class="nav-new-badge">New</span>' : "") + "</button>";
          }).join("") +
        "</div>" +
        '<div class="cmdk-list cmdk-lib-list" role="listbox" aria-label="Results"></div>' +
      "</div>";
    document.body.appendChild(overlay);
    input = overlay.querySelector(".cmdk-input");
    list = overlay.querySelector(".cmdk-lib-list");
    chips = overlay.querySelector(".cmdk-lib-chips");

    list.addEventListener("scroll", function () { overlay.classList.toggle("is-scrolled", list.scrollTop > 0); }, { passive: true });
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    input.addEventListener("input", function () { active = 0; paint(); });
    chips.addEventListener("click", function (e) {
      var b = e.target.closest(".cmdk-lib-chip");
      if (!b) return;
      setCat(b.getAttribute("data-cat"));
      list.scrollTop = 0;
      active = 0;
      paint();
      input.focus();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { e.preventDefault(); setActive(active + 1, true); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setActive(active - 1, true); }
      else if (e.key === "ArrowDown") { e.preventDefault(); moveRow(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveRow(-1); }
      else if (e.key === "Enter") { e.preventDefault(); var el = itemEls()[active]; if (el) run(shown[+el.getAttribute("data-i")]); }
    });
    overlay.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    list.addEventListener("click", function (e) {
      var el = e.target.closest(".cmdk-item");
      if (!el) return;
      // Cmd or Ctrl click opens the link in a new tab as usual.
      if (el.tagName === "A" && (e.metaKey || e.ctrlKey || e.shiftKey)) return;
      e.preventDefault();
      run(shown[+el.getAttribute("data-i")]);
    });
    list.addEventListener("mousemove", function (e) {
      var el = e.target.closest(".cmdk-item");
      if (!el) return;
      var i = itemEls().indexOf(el);
      if (i !== active) setActive(i, false);
    });
  }

  function itemEls() { return Array.prototype.slice.call(list.querySelectorAll(".cmdk-item")); }

  function setCat(next) {
    cat = next;
    chips.querySelectorAll(".cmdk-lib-chip").forEach(function (b) {
      var on = b.getAttribute("data-cat") === cat;
      b.setAttribute("data-active", String(on));
      b.setAttribute("aria-selected", String(on));
    });
  }

  function setActive(i, scroll) {
    var els = itemEls();
    if (!els.length) return;
    active = Math.max(0, Math.min(els.length - 1, i));
    els.forEach(function (el, k) {
      el.setAttribute("data-active", String(k === active));
      if (k === active && scroll) el.scrollIntoView({ block: "nearest" });
    });
  }

  // Up and down go to the nearest item in the row above or below, across the
  // grids and the rows alike.
  function moveRow(dir) {
    var els = itemEls(), cur = els[active];
    if (!cur) return;
    var c = cur.getBoundingClientRect(), best = -1, bestY = Infinity, bestX = Infinity;
    els.forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      var dy = dir > 0 ? r.top - c.bottom : c.top - r.bottom;
      if (dy < -2) return;
      var dx = Math.abs(r.left + r.width / 2 - (c.left + c.width / 2));
      if (dy < bestY - 2 || (Math.abs(dy - bestY) <= 2 && dx < bestX)) { best = i; bestY = dy; bestX = dx; }
    });
    if (best >= 0) setActive(best, true);
  }

  // Community previews mount only near the visible part of the list and
  // unmount far from it, so the tab never runs every component at once.
  var liveIO = null, moreIO = null;
  function unmountHosts() {
    if (liveIO) { liveIO.disconnect(); liveIO = null; }
    if (moreIO) { moreIO.disconnect(); moreIO = null; }
    if (window.Community) hosts.forEach(function (h) { Community.unmountPreview(h); });
    hosts = [];
  }

  function register(it) { shown.push(it); return shown.length - 1; }

  function transitionCard(it) {
    var v = it.pro ? THUMB_V.pro : THUMB_V.free, base = "/assets/community/thumbs/" + encodeURIComponent(it.thumb);
    return '<a class="cmdk-item cmdk-lib-item" role="option" href="' + esc(it.href) + '" data-i="' + register(it) + '">' +
      '<span class="cmdk-lib-thumb">' +
        (it.pro ? '<span class="card-pro-badge" aria-hidden="true">Pro</span>' : "") +
        '<img class="is-light" src="' + base + ".jpg?v=" + v + '" alt="" width="296" height="260" loading="lazy" decoding="async" />' +
        '<img class="is-dark" src="' + base + "-dark.jpg?v=" + v + '" alt="" width="296" height="260" loading="lazy" decoding="async" />' +
      "</span>" +
      '<span class="cmdk-lib-name">' + esc(it.label) + "</span></a>";
  }

  function rowItem(it) {
    var tag = it.href ? "a" : "button";
    return "<" + tag + ' class="cmdk-item" role="option"' + (it.href ? ' href="' + esc(it.href) + '"' : ' type="button"') + ' data-i="' + register(it) + '">' +
      '<span class="cmdk-item-ic">' + (ICONS[it.ic] || "") + "</span>" +
      '<span class="cmdk-item-label">' + esc(it.label) + "</span>" +
      (it.hint ? '<span class="cmdk-item-hint">' + esc(it.hint) + "</span>" : "") + "</" + tag + ">";
  }

  function paint() {
    var id = ++paintId;
    clearTimeout(timer);
    unmountHosts();
    shown = [];
    var q = input.value.trim().toLowerCase();
    var pool = cat === "community" ? [] : transitions.filter(function (t) { return cat === "all" || t.cats.indexOf(cat) >= 0; });
    var rows = cat === "all" && q ? ITEMS : [];
    var found = search(rows.concat(pool), q);
    var inGroup = function (g) { return found.filter(function (it) { return it.group === g; }); };
    var html = "", pages = inGroup("Pages"), grid = inGroup("Transitions"), actions = inGroup("Actions");
    var wantsCommunity = cat === "community" || (cat === "all" && q.length >= 2);
    if (pages.length) html += '<div class="cmdk-group-label">Pages</div>' + pages.map(rowItem).join("");
    if (grid.length) {
      html += (q || cat !== "all" ? '<div class="cmdk-group-label">' + (cat === "all" ? "Transitions" : esc(GROUPS.filter(function (g) { return g[0] === cat; })[0][1])) + "</div>" : "") +
        '<div class="cmdk-lib-grid">' + grid.map(transitionCard).join("") + "</div>";
    }
    if (wantsCommunity) html += '<div class="cmdk-lib-community"></div>';
    if (actions.length) html += '<div class="cmdk-group-label">Actions</div>' + actions.map(rowItem).join("");
    if (!pages.length && !grid.length && !actions.length && !wantsCommunity) html = '<div class="cmdk-empty">No results</div>';
    list.innerHTML = html;
    setActive(active, false);
    if (wantsCommunity) {
      // One request per pause in typing; the first view of the category at once.
      timer = setTimeout(function () { paintCommunity(id, q); }, q ? 220 : 0);
      if (cat === "community") list.querySelector(".cmdk-lib-community").innerHTML = '<div class="cmdk-lib-grid">' + skeletonCards(12) + "</div>";
    }
  }

  // Skeleton loader (the library's Skeleton reveal): a card keeps its final
  // size from the start, its placeholder pulses, and the preview cross-fades
  // in with a soft blur once it is laid out and fitted, so nothing jumps.
  var SKEL = '<span class="cmdk-skel" aria-hidden="true"><span class="cmdk-skel-stage"></span></span>';
  function skeletonCards(n) {
    var out = "";
    for (var i = 0; i < n; i++) {
      out += '<div class="cmdk-lib-item cmdk-lib-skel" aria-hidden="true"><span class="cmdk-lib-thumb">' + SKEL +
        '</span><span class="cmdk-lib-name"><span class="cmdk-skel-line"></span></span></div>';
    }
    return out;
  }

  function communityCard(c) {
    var href = "/studio.html?id=" + encodeURIComponent(c.id);
    return '<a class="cmdk-item cmdk-lib-item" role="option" href="' + esc(href) + '" data-i="' + register({ href: href }) + '">' +
      '<span class="cmdk-lib-thumb cmdk-lib-live">' + SKEL + '</span><span class="cmdk-lib-name">' + esc(c.title) + "</span></a>";
  }

  // Previews are sandboxed frames that rest until opened: no pointer events
  // here, so a click goes to the link. Revealed after the first fit.
  // A preview measures itself twice: 60ms after it is ready, while fonts and
  // images may still be settling, and again at 700ms with its final size.
  // The card stays on its skeleton until that second size, so it never shows
  // at one scale and then refits. A size seen before (scrolling back to a
  // card) reveals on the first measure when it matches.
  var settled = {};
  function mountLive(C, host) {
    var c = host.__cmdkItem, known = settled[c.id], seen = 0, done = false, fallback = null;
    var reveal = function () {
      if (done) return;
      done = true;
      clearTimeout(fallback);
      requestAnimationFrame(function () { host.classList.add("is-revealed"); });
    };
    C.mountPreview(host, c, { rest: true, onMessage: function (m) {
      if (m.type === "size") {
        seen++;
        fit(host, m.w, m.h, m.full);
        if (seen >= 2) { settled[c.id] = { w: m.w, h: m.h }; reveal(); }
        else if (known && Math.abs(known.w - m.w) < 1 && Math.abs(known.h - m.h) < 1) reveal();
      } else if (m.type === "ready") {
        fallback = setTimeout(reveal, 1200);
      } else if (m.type === "error") {
        reveal();
      }
    } });
  }

  function addCards(C, grid, items) {
    var tmp = document.createElement("div");
    tmp.innerHTML = items.map(communityCard).join("");
    var cards = Array.prototype.slice.call(tmp.children);
    if (!liveIO && "IntersectionObserver" in window) {
      liveIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          var h = en.target;
          if (en.isIntersecting) {
            if (!h.querySelector("iframe.cm-frame")) mountLive(C, h);
          } else if (h.querySelector("iframe.cm-frame")) {
            // Out of view: back to the placeholder, without animating.
            C.unmountPreview(h);
            h.classList.remove("is-revealed");
          }
        });
      }, { root: list, rootMargin: "300px 0px" });
    }
    cards.forEach(function (card, i) {
      grid.appendChild(card);
      var host = card.querySelector(".cmdk-lib-live");
      host.__cmdkItem = items[i];
      hosts.push(host);
      if (liveIO) liveIO.observe(host); else mountLive(C, host);
    });
  }

  // The Community tab loads a page at a time: a row of skeleton cards closes
  // the grid while more remain, and loads the next page as it nears the view.
  function loadMore(C, id, q, grid, next) {
    if (next == null) return;
    grid.insertAdjacentHTML("beforeend", skeletonCards(3));
    var skels = Array.prototype.slice.call(grid.querySelectorAll(".cmdk-lib-skel"));
    var busy = false;
    if (moreIO) moreIO.disconnect();
    moreIO = new IntersectionObserver(function (entries) {
      if (busy || !entries.some(function (en) { return en.isIntersecting; })) return;
      busy = true;
      C.api.feed("popular", next, q ? { q: q } : {}).then(function (r) {
        if (id !== paintId) return;
        skels.forEach(function (k) { k.remove(); });
        var items = r && r.items || [];
        addCards(C, grid, items);
        setActive(active, false);
        loadMore(C, id, q, grid, items.length ? r.next_offset : null);
      }).catch(function () {
        if (id !== paintId) return;
        skels.forEach(function (k) { k.remove(); });
      });
    }, { root: list, rootMargin: "400px 0px" });
    moreIO.observe(skels[0]);
  }

  function paintCommunity(id, q) {
    var isCat = cat === "community";
    var nothingElse = function () { return !list.querySelector(".cmdk-item"); };
    community().then(function (C) {
      return C.api.feed("popular", 0, q ? { q: q } : {}).then(function (r) { return { C: C, r: r }; });
    }).then(function (res) {
      if (id !== paintId) return;
      var box = list.querySelector(".cmdk-lib-community");
      if (!box) return;
      var items = res.r && res.r.items || [];
      if (!isCat) items = items.slice(0, 6);
      if (!items.length) {
        box.innerHTML = nothingElse() ? '<div class="cmdk-empty">No results</div>' : "";
        return;
      }
      box.innerHTML = (isCat ? "" : '<div class="cmdk-group-label">Community</div>') + '<div class="cmdk-lib-grid"></div>';
      var grid = box.querySelector(".cmdk-lib-grid");
      addCards(res.C, grid, items);
      if (isCat && "IntersectionObserver" in window) loadMore(res.C, id, q, grid, res.r.next_offset);
      setActive(active, false);
    }).catch(function () {
      if (id !== paintId) return;
      var box = list.querySelector(".cmdk-lib-community");
      if (box && nothingElse()) box.innerHTML = '<div class="cmdk-empty">Could not load the community</div>';
    });
  }

  function run(it) {
    if (!it) return;
    close();
    if (it.action === "theme") { if (window.tdevToggleTheme) window.tdevToggleTheme(); return; }
    if (it.ext) { window.open(it.href, "_blank", "noopener"); return; }
    window.location.href = it.href;
  }

  function open() {
    if (!overlay) build();
    overlay.setAttribute("data-open", "true");
    input.value = "";
    setCat("all");
    active = 0;
    list.scrollTop = 0;
    paint();
    setTimeout(function () { input.focus(); }, 20);
  }

  function close() {
    paintId++;
    clearTimeout(timer);
    unmountHosts();
    overlay.setAttribute("data-open", "false");
    var btn = document.getElementById("nav-search-btn");
    if (btn) btn.blur();
  }

  var btn = document.getElementById("nav-search-btn");
  if (btn) btn.addEventListener("click", open);
  document.addEventListener("keydown", function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      if (overlay && overlay.getAttribute("data-open") === "true") close(); else open();
    }
  });
})();
