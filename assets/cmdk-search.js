// Search for the nav's Cmd+K palette, shared by every page.
//
// Each page's palette keeps its own Pages and Actions, but only pages with
// library cards in their DOM (home, library, detail) can list transitions from
// them. This index gives every page the same list, with the words people search
// for that a title does not hold: category, image-based or not, other names.
//
// Add new transitions to TRANSITIONS. Cards found in the DOM are kept too, so a
// new card still shows on the pages that have it.
(function () {
  "use strict";

  // [title, detail.html slug, pro, search terms]
  var TRANSITIONS = [
    ["Card resize","card-resize",0,"essential expand grow height smooth card resize transition"],
    ["Number pop-in","number-pop-in",0,"text count digits digit flip with blur and stagger"],
    ["Notification badge","notification-badge",0,"essential bell unread alert diagonal slide with spring pop-in"],
    ["Text states swap","text-states-swap",0,"essential label change text swap transition with blur"],
    ["Menu dropdown","menu-dropdown",0,"essential select popover origin-aware open / close transition"],
    ["Modal open/close","modal-open-close",0,"essential dialog popup overlay modal transition with scale"],
    ["Panel reveal","panel-reveal",0,"essential drawer sidebar sheet panel open / close transition"],
    ["Page side-by-side","page-side-by-side",0,"essential slide navigation route forward / back page transition"],
    ["Icon swap","icon-swap",0,"essential morph replace scale and blur icon swap"],
    ["Success check","success-check",0,"essential done confirm tick succes check with blur and rotate"],
    ["Avatar group hover","avatar-group-hover",0,"effects stack people faces distance-falloff lift with bouncy return"],
    ["Error state shake","error-state-shake",0,"essential invalid form wiggle cubic-bezier shake on error"],
    ["Input clear with dissolve","input-clear-with-dissolve",0,"effects search field reset clear with per-word dissolve"],
    ["Skeleton loader and reveal","skeleton-loader-and-reveal",0,"essential loading placeholder pulse to content cross-fade"],
    ["Texts reveal","texts-reveal",0,"text stagger words headline two lines rise with offset stagger"],
    ["Tabs sliding","tabs-sliding",0,"essential segmented control pill pill indicator follows the active tab"],
    ["Shimmer text","shimmer-text",0,"text ai agents loading shine thinking masked gradient sweep across text"],
    ["Tooltip open/close","tooltip-open-close",0,"essential hint popover delayed in, travels, instant out"],
    ["3D tilt","3d-tilt",0,"effects hover glare perspective 3d pointer tilt with cursor glare"],
    ["Dropdown menu morph","dropdown-menu-morph",0,"essential select popover fab button morphs into a menu surface"],
    ["Accordion","accordion",0,"essential collapse expand disclosure faq grid-rows height with chevron morph"],
    ["Toast open/close","toast-open-close",0,"essential snackbar notification alert rises in with fade, blur and scale"],
    ["Like button","like-button",0,"effects heart favorite heart fills and bursts particles"],
    ["Learn more hover","learn-more-hover",0,"essential arrow link cta chevron shifts and opens on hover"],
    ["Checkbox check","checkbox-check",0,"essential tick form check draws on with a stroke path"],
    ["Spinning counter","spinning-counter",0,"text odometer slot digits number digits spin like a reel to the value"],
    ["Toggle","toggle",0,"essential switch thumb slides with a double bounce"],
    ["Thinking states","thinking-states",0,"ai agents chat agent loading status line shimmers, then swaps to the next"],
    ["Reasoning stream","reasoning-stream",0,"ai agents chat agent thinking agent reasoning scrolls by two lines"],
    ["Streaming text","streaming-text",0,"ai agents chat typing typewriter words resolve through a soft cross-blur"],
    ["Matrix dot loader","matrix-dot-loader",0,"ai agents loading spinner 16-dot matrix pulses in four patterns"],
    ["Banner stacking","banner-stacking",0,"essential notification alert stack banners stack like toasts, three deep"],
    ["Confetti burst","confetti-burst",1,"effects celebrate party particles success physics confetti lands on the button"],
    ["Gooey plus menu","gooey-plus-menu",1,"effects fab floating action liquid split into a fan of actions"],
    ["Card stack hover","card-stack-hover",1,"effects fan deck photos stack fans out with a spring on hover"],
    ["Drag & drop with physics","drag-drop-with-physics",1,"effects image photo upload spring zone morphs into the image"],
    ["Organic shimmer","organic-shimmer",1,"effects ai agents loading gradient wavy shimmer with edge glow"],
    ["Image open tilt","image-open-tilt",1,"effects image photo lightbox gallery viewer zoom with 3d tilt and bend"],
    ["Spinner to check morph","spinner-to-check-morph",1,"ai agents loading done success task spinner pops into a drawn check"],
    ["Pro gradient text","pro-gradient-text",1,"text ai agents shine badge colour washes orbit the letters"],
    ["Delete with smoky dissolve","delete-with-smoky-dissolve",1,"effects image photo remove delete disintegrate image shreds and falls into smoke"],
    ["Image generation placeholder","image-generation-placeholder",1,"ai agents effects image photo ai generation dots loading dot noise wakes, then resolves into the image"],
    ["Get Pro button","get-pro-button",1,"effects upgrade cta shine pro gradient glows in from the pill’s rim"]
  ];

  var indexed = TRANSITIONS.map(function (t) {
    return { group: "Transitions", label: t[0], hint: t[2] ? "Pro transition" : "Transition", href: "detail.html?t=" + t[1], ic: "motion", terms: t[3] };
  });

  // The page's items with the index merged in, between Pages and Actions.
  var merged = null, source = null;
  function allItems(items) {
    if (source === items) return merged;
    var seen = {}, cards = [], rest = [];
    items.forEach(function (it) {
      if (it.group === "Transitions") { seen[it.href] = true; cards.push(it); }
      else rest.push(it);
    });
    var byHref = {};
    indexed.forEach(function (it) { byHref[it.href] = it; });
    // A card keeps its place and gains the index's terms.
    var transitions = cards.map(function (it) {
      return byHref[it.href] ? Object.assign({}, it, { terms: byHref[it.href].terms }) : it;
    }).concat(indexed.filter(function (it) { return !seen[it.href]; }));
    var at = rest.findIndex(function (it) { return it.group === "Actions"; });
    if (at < 0) at = rest.length;
    source = items;
    merged = rest.slice(0, at).concat(transitions, rest.slice(at));
    return merged;
  }

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

  // q is already trimmed and lowercased by the palette.
  function search(items, q) {
    var all = allItems(items);
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
    // Best first inside each group; the groups stay in order for their labels.
    var order = [];
    all.forEach(function (it) { if (order.indexOf(it.group) < 0) order.push(it.group); });
    var out = [];
    order.forEach(function (group) {
      out = out.concat(found.filter(function (it) { return it.group === group; }).map(function (it, i) {
        return { it: it, i: i, r: rank(it, q) };
      }).sort(function (a, b) { return a.r - b.r || a.i - b.i; }).map(function (x) { return x.it; }));
    });
    return out;
  }

  window.tdevCmdk = { search: search };
})();
