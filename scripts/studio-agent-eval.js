// Studio agent eval: does the agent apply the transitions.dev patterns?
//
// Paste into the browser console on a localhost Studio page (studio.html,
// signed in, local API running). Each case runs the real agent with the same
// context the Studio sends (built-in skills + the recipes picked for the
// prompt), then checks the code for the pattern the case needs. Rerun after
// changing the skill, the recipes (scripts/build-community-libraries.mjs) or
// the system prompt (transitions-pro/api/src/community.js). Each case spends
// one AI draft.
(async () => {
  const E = window.__studioEval, C = window.Community;
  if (!E) throw new Error("Open studio.html on localhost first");
  const swap = (a) => /is-exit/.test(a) && /is-enter-start/.test(a);
  const digits = (a) => /t-digit|digit-group|--digit-/.test(a);
  const slide = (a) => /indicator|--tab-|t-tab/.test(a);
  const CASES = [
    { p: "A pricing card with Monthly and Yearly tabs; switching tabs changes the price", need: { "text or number swap": (a) => swap(a) || digits(a), "tabs sliding": slide } },
    { p: "A copy button that changes to Copied when clicked", need: { "text swap": swap } },
    { p: "A notification bell with an unread count that goes up each time you click it", need: { "number pop-in": digits } },
    { p: "A settings row with a dark mode toggle and an On / Off label next to it", need: { "text swap": swap } },
    { p: "An order status line that goes from Processing to Shipped to Delivered", need: { "text swap": swap } },
  ];
  const rows = await Promise.all(CASES.map(async (c) => {
    const ctx = await E.agentContext(c.p);
    const r = await C.api.generate(c.p, "html", null, ctx, [], null);
    if (r.error) return { prompt: c.p, error: r.error };
    const all = [r.component.html, r.component.css, r.component.js].join("\n");
    const row = { prompt: c.p, recipes: E.pickRecipes(await E.recipes(), c.p).map((x) => x.title).join(", ") };
    for (const [name, test] of Object.entries(c.need)) row[name] = test(all) ? "pass" : "FAIL";
    row["reduced motion"] = /prefers-reduced-motion/.test(r.component.css) ? "pass" : "FAIL";
    row["no instant text"] = /\.(textContent|innerText)\s*=/.test(r.component.js) && !/is-exit|is-animating|is-enter/.test(r.component.js) ? "FAIL" : "pass";
    return row;
  }));
  console.table(rows);
  return rows;
})();
