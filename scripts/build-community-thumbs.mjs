#!/usr/bin/env node
// Captures a static thumbnail of every remixable library transition for the
// Studio's library picker: the card stage as it looks on the home page, in
// light and dark. Writes assets/community/thumbs/<slug>.jpg and
// <slug>-dark.jpg at 2x (592 x 520) for sharp retina screens. The demo's own
// controls (Animate, Toggle, Play) are hidden: the picker shows the component.
//
// Needs the site served locally and playwright-core with a Chrome install:
//   python3 -m http.server 8123          (in the repo root, another terminal)
//   npm i --no-save playwright-core
//   node scripts/build-community-thumbs.mjs
// SITE=<origin> and CHROME=<path to a Chrome binary> override the defaults.

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.env.SITE || "http://localhost:8123";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = join(root, "assets/community/thumbs");
mkdirSync(out, { recursive: true });

const items = JSON.parse(readFileSync(join(root, "assets/community/library.json"), "utf8"));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2, colorScheme: theme });
  await ctx.addInitScript((t) => { try { localStorage.setItem("tdev:theme", t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  await page.goto(SITE + "/library.html", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.addStyleTag({ content: ".card-stage .btn-animate { visibility: hidden !important; }" });
  await page.mouse.move(2, 2);
  let n = 0;
  for (const t of items) {
    const stage = page.locator(`.card:has([data-copy-key="${t.key}"]) .card-stage`).first();
    if (!(await stage.count())) { console.warn("no card for", t.key, t.slug); continue; }
    await stage.scrollIntoViewIfNeeded();
    await page.mouse.move(2, 2);
    await page.waitForTimeout(500);
    await stage.screenshot({ path: join(out, t.slug + (theme === "dark" ? "-dark" : "") + ".jpg"), type: "jpeg", quality: 90 });
    n++;
  }
  console.log(theme, n, "thumbnails");
  await ctx.close();
}
await browser.close();
