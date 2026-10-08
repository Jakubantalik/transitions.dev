// Studio agent eval: does the Transitions UI Agent apply the transitions.dev
// patterns?
//
// Paste into the browser console on a localhost Studio page (studio.html,
// signed in, local API running). Each case runs the real agent with the same
// context the Studio sends (built-in skills and the names of the recipes that
// fit best; the API adds every recipe), then checks the code for the pattern
// the case needs. Rerun after
// changing the agent's instructions (transitions-pro/api/src/ui-agent/
// INSTRUCTIONS.md), the skill, or the recipes
// (scripts/build-community-libraries.mjs). Each case spends one AI draft, and
// the API allows 30 drafts an hour on the free tier: run a subset with
//   window.__evalOnly = /toast|modal/;   // prompts matching this
// before pasting. Every case also checks the Motion tab structure: an @motion
// manifest with at most 3 main groups (the rest marked "more [Name]", shown
// collapsed) of at most 3 main controls each, each token in one group only,
// every token in some group, and no literal timings left in transition rules.
//
// To add a case: a prompt (p), the build mode (html or react), and named
// checks over the generated code. Add one for every weak draft you fix.
(async () => {
  const E = window.__studioEval, C = window.Community;
  if (!E) throw new Error("Open studio.html on localhost first");
  const swap = (a) => /is-exit/.test(a) && /is-enter-start/.test(a);
  const digits = (a) => /t-digit|digit-group|--digit-/.test(a);
  const slide = (a) => /indicator|--tab-|t-tab/.test(a);
  const scaleIn = (a) => /scale\(0?\.9\d*\)/.test(a) && /opacity/.test(a);
  const origin = (a) => /transform-origin/.test(a);
  const shake = (a) => /@keyframes/.test(a) && /translateX/.test(a);
  const collapse = (a) => /grid-template-rows|interpolate-size|height/.test(a);
  const timedExit = (a) => /setTimeout/.test(a) && /(is-exit|is-leaving|is-closing|data-state|hidden)/.test(a);
  const press99 = (a) => /--press-scale\s*:\s*0?\.99\b/.test(a) || /:active[^{]*\{[^}]*scale\(0?\.99\)/.test(a);
  const reactModule = (a) => /export\s+default\s+function/.test(a) && !/styled\.|css`/.test(a);
  // Icons are Heroicons placeholders the API inlines (class "hi"), never
  // paths the model drew.
  const heroicons = (a) => /class(Name)?="hi\b/.test(a) && !/<svg(?![^>]*class(Name)?="hi\b)[^>]*>\s*<path/.test(a);
  const CASES = [
    { p: "A pricing card with Monthly and Yearly tabs; switching tabs changes the price", need: { "text or number swap": (a) => swap(a) || digits(a), "tabs sliding": slide } },
    // Content that changes inside a button swaps (INSTRUCTIONS.md): text swap for
    // the label, icon swap for an icon; buttons press to 99%.
    { p: "A copy button that changes to Copied when clicked", need: { "label swaps": swap, "press 99%": press99 } },
    { p: "A Show modal button that opens a dialog and reads Hide modal while it is open", need: { "label swaps": swap, "modal scale + fade": scaleIn } },
    { p: "A notification bell with an unread count that goes up each time you click it", need: { "number pop-in": digits } },
    { p: "A settings row with a dark mode toggle and an On / Off label next to it", need: { "text swap": swap } },
    { p: "An order status line that goes from Processing to Shipped to Delivered", need: { "text swap": swap } },
    { p: "A weather card with city tabs; switching city changes the temperature, the condition and the stats", need: { "number pop-in": digits, "text swap": swap } },
    { p: "A modal dialog with an Open button, a title, some text and Cancel / Confirm buttons", need: { "modal scale + fade": scaleIn } },
    { p: "A dropdown menu that opens from a More button with three actions", need: { "menu scale + fade": scaleIn, "opens from its button": origin } },
    { p: "A toast that appears when you click Save and goes away after 3 seconds", need: { "enter + timed exit": timedExit } },
    { p: "An email field with a Subscribe button that shakes when you submit it empty", need: { "error shake": shake } },
    { p: "An FAQ accordion with three questions that expand and collapse", need: { "height animates": collapse } },
    // Recipes are copied, not paraphrased: the swap's exit / enter classes,
    // the accordion's own expand and collapse tokens, one tab indicator.
    { p: "A meeting card with date, time, location, attendees, a sliding RSVP switch, a swapping status line and an expandable agenda", need: { "text swap recipe": swap, "tabs sliding": slide, "accordion recipe tokens": (a) => /--acc-expand/.test(a) && /--acc-collapse/.test(a) } },
    // Tab panels slide side by side (Page side-by-side), the bar slides its pill.
    { p: "An event card with Details and Guests tabs that switch the content below", need: { "tabs sliding": slide, "page side-by-side panels": (a) => /t-page|data-page/.test(a) } },
    // Photos come from the curated set (data-photo), never made-up URLs.
    { p: "A travel destination card with a photo, the place name, a rating and a Save button", need: { "photo from the set": (a) => /images\.unsplash\.com\/photo-\d+-[0-9a-f]+\?auto=format/.test(a) && !/data-photo="[^"]*"[^>]*src="(?!https:\/\/images\.unsplash)/.test(a) } },
    // A disclosure that is not called an accordion still is one (INSTRUCTIONS.md).
    { p: "An event card with a Details button that reveals the agenda and the call link", need: { "accordion rows": (a) => /grid-template-rows/.test(a), "no display toggle": (a) => !/\.hidden\s*=|style\.display\s*=|max-height/.test(a) } },
    { p: "A like button with a heart and a count; liking pops the heart and counts up", need: { "pop": (a) => /scale\(/.test(a), "number pop-in": digits } },
    { p: "A search field with a magnifying glass icon and a clear button that appears once you type", need: { "Heroicons": heroicons } },
    { p: "A media player bar with play / pause, skip and a volume icon", mode: "react", need: { "React module, plain CSS": reactModule, "Heroicons": heroicons } },
    { p: "A toggle switch with a label", mode: "react", need: { "React module, plain CSS": reactModule } },
    { p: "Tabs with a sliding indicator and three panels", mode: "react", need: { "React module, plain CSS": reactModule, "tabs sliding": slide } },
  ].filter((c) => !window.__evalOnly || window.__evalOnly.test(c.p));
  const SC = window.StudioControls;
  // Literal durations in transition / animation rules outside :root and the
  // reduced-motion block mean a value the Motion tab cannot group.
  const literalTimings = (css) => {
    const body = css.replace(/@media[^{]*prefers-reduced-motion[^{]*\{[\s\S]*?\}\s*\}/g, "").replace(/:root\s*\{[^}]*\}/g, "");
    return (body.match(/(transition|animation)(-duration|-timing-function)?\s*:[^;}]*\b\d*\.?\d+m?s\b/g) || []).length;
  };
  const motion = (css) => {
    const groups = SC.manifest(css);
    if (!groups) return { manifest: "FAIL", "one group per token": "-", "main groups <= 3, controls <= 3": "-", "no stray tokens": "-" };
    const names = groups.flatMap((g) => g.main.concat(g.more).map((r) => r.name));
    // Tokens the manifest leaves out land in the panel's "Other tokens" pile.
    const stray = SC.groupTokens(SC.scan(css).tokens, css).some((g) => g.name === "Other tokens");
    return {
      manifest: "pass",
      "one group per token": new Set(names).size === names.length ? "pass" : "FAIL",
      "main groups <= 3, controls <= 3": groups.filter((g) => !g.secondary).length <= 3 && groups.every((g) => g.main.length <= 3) ? "pass" : "FAIL",
      "no stray tokens": stray ? "FAIL" : "pass",
    };
  };
  const rows = await Promise.all(CASES.map(async (c) => {
    const ctx = await E.agentContext(c.p);
    const r = await C.api.generate(c.p, c.mode || "html", null, ctx, [], null);
    if (r.error) return { prompt: c.p, error: r.error };
    const all = [r.component.html, r.component.css, r.component.js].join("\n");
    const row = { prompt: (c.mode === "react" ? "[React] " : "") + c.p, hinted: E.pickRecipes(await E.recipes(), c.p).map((x) => x.title).join(", ") };
    for (const [name, test] of Object.entries(c.need)) row[name] = test(all) ? "pass" : "FAIL";
    row["reduced motion"] = /prefers-reduced-motion/.test(r.component.css) ? "pass" : "FAIL";
    row["no instant text"] = c.mode === "react" ? "-" : /\.(textContent|innerText)\s*=/.test(r.component.js) && !/is-exit|is-animating|is-enter/.test(r.component.js) ? "FAIL" : "pass";
    Object.assign(row, motion(r.component.css));
    row["timings in tokens"] = literalTimings(r.component.css) ? "FAIL" : "pass";
    // The API's motion scan (the Motion Agent's scanner plus the recipe checks).
    const issues = r.scan ? r.scan.findings.filter((f) => f.rule !== "recipe-available") : null;
    row["motion scan"] = r.scan ? r.scan.score + (issues.length ? " (" + issues.map((f) => f.rule).join(", ") + ")" : "") : "-";
    return row;
  }));
  console.table(rows);
  // One line to compare runs: checks passed / total.
  const cells = rows.flatMap((r) => Object.values(r)).filter((v) => v === "pass" || v === "FAIL");
  console.log("Score:", cells.filter((v) => v === "pass").length + " / " + cells.length, rows.some((r) => r.error) ? "(some cases failed to draft)" : "");
  return rows;
})();
