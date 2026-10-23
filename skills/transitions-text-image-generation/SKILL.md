---
name: transitions-text-image-generation
license: Free for personal and commercial use; see LICENSE.txt (no redistribution of the library itself)
description: Make large bold type and images appear as if an AI agent is generating them, in the dotted style of transitions-ui-generation. Every glyph of a headline is traced along its real outline in small flowing dots (drawn in the element's own font and traced, so the outline is the actual letter) over typographic guides (cap height, x-height, baseline, descender, font spec); smaller text gets a dotted line; every image is framed, sketched in tone lines and built up as a fine halftone of its own pixels that takes on the photo's colours. Then the real text fades in character by character (200ms each) and each photo resolves over its colour dots. Two modes, trace and trace + generation texts (an agent log of every glyph and image, and a step line). One dependency-free runtime for any framework (vanilla, React, Next.js, Vue, Svelte). Use when the user asks for a "headline generation animation", "text being generated", "letters drawn in dots", "type tracing", "glyph outline reveal", "image generation reveal", "halftone image reveal", "image sketch reveal", "hero generation", "editorial generation animation", "AI writing the headline", or for a landing page, article or launch moment where big type and photos should look generated. Also the commands transitions trace, transitions trace texts and transitions trace preview. For cards and UI components, use transitions-ui-generation.
---

# Transitions text and image generation

The type and image sibling of [`transitions-ui-generation`](../transitions-ui-generation/SKILL.md). That skill draws a component's boxes and text lines; this one is made for what a component skill can't draw well: **big bold headlines and photos**.

Nothing is faked. Each character of a headline is drawn alone in the element's own computed font on a canvas and traced with marching squares, so the dotted outline is the real letter, in the real place, with its counters. Each image is sampled from its own pixels into a halftone. Then the real type and photos come in.

Works in every agent that reads skills (Claude Code, Cursor, Codex, and others): install with `npx skills add Jakubantalik/transitions.dev`, or copy this folder into the project.

## What it draws

Over one build (default `3000ms`, about `3.2s` in all):

1. **Type guides.** For every display line: dotted guides for cap height, x-height, baseline and descender, running past both ends, labelled on the first line of each block with the font spec (`INTER TIGHT 800  92/86`).
2. **Glyphs.** Each letter is traced along its outline in small flowing dots, outer shape first and then its counters, left to right in overlapping waves. A dot flies in to where each letter starts, a reticle locks onto the current letter (`"g" 46×67`) and a readout follows the moving dot.
3. **Text lines.** Text under the display size (`32px` by default) gets one dotted line per line, like the wireframe skill.
4. **Images.** A dotted frame is drawn from the top centre in both directions with corner handles, a label (`IMAGE 464×580  COVER  3PX SCREEN`) and a live status (`SKETCH 42/108`, `SCREEN 24935 DOTS`, `COLOUR 64%`, `RESOLVING 80%`). Then, all from the photo's own pixels:
   - **Sketch.** Lines of equal tone (six levels through the softened photo, like a topographic drawing) are traced in fine flowing dots, in many short strokes at once.
   - **Screen.** A fine halftone (3 to 5px cells) sweeps in from the top left, every dot sized by the tone under it with the local contrast lifted, so texture survives.
   - **Colour.** The grey dots turn into a dot matrix in the photo's own colours.
5. **Ink.** The real text fades in character by character, `200ms` each: a display glyph `150ms` after it is traced (`fadeDelay`; its dots fade out with it), a smaller character that long after its line's dotted stroke passes it. Each photo fades in over its colour dots, sharpening from a soft blur.

## Options

| Mode | What you get | Use for | Reference |
| --- | --- | --- | --- |
| **`trace`** | The drawing and the ink. | Hero sections, article headers, image cards, quotes, launch pages. | [01-trace.md](./01-trace.md) |
| **`trace-texts`** | The same, plus an `AGENT.LOG` (one line per glyph and image with a progress bar) beside or under the element, and a step line ("Setting type" … "Ready"). | Showcase moments that tell the "agent at work" story. The texts are only placed where the page is empty. | [02-trace-texts.md](./02-trace-texts.md) |

## Decision rules

- **Big type or photos** (a hero, an article header, a quote, an image card) → this skill.
- **A card, panel or component** (buttons, inputs, icons, small text) → `transitions-ui-generation`.
- **The user wants pixels or a low-res build-up** → `transitions-ui-pixel-generation`.
- **A launch page, demo or video** → `trace-texts` on the hero, `trace` on the sections under it, each when it scrolls into view.
- **Several blocks in view at once** → `trace` on each with a `delay` of about `260ms` per block.
- **Body copy, long articles, or anything that appears often** → don't. Trace the headline and the lead image, not the paragraphs: a generation animation is a moment.

## Commands

### transitions trace

**Trigger phrases:** `transitions trace`, "make the headline look generated", "draw the type in dots", "generate the hero", "halftone the image in".

1. Find the element: a headline, an image, or the block that holds both (a hero, a card). If it's ambiguous, ask.
2. Pick the mode (default `trace`) and the trigger: on mount, on scroll into view (the attribute API), or on demand.
3. Propose it in one line, for example: "I'd play **trace** on the hero (`<HeroSection>`) when it scrolls into view. Confirm?"
4. On confirmation, follow `## Install` and `## Wiring`.

### transitions trace texts

Same, with `mode: "trace-texts"`. Mention that the log needs empty space beside or under the element.

### transitions trace preview

Open [`demo.html`](./demo.html) (serve the folder over http, for example `npx serve` here), or [`demo-text.html`](./demo-text.html) for a single title ("Generative skill", Saans Medium from the repo's `assets/fonts`, Inter when served on its own) with room for the agent log. The editorial page: a hero with the title "Generative skill" (Saans Medium, falling back to Inter) and a tall photo, two image cards with bold titles, and a closing quote, each generated as it scrolls into view, with both modes and a replay button. Light and dark. Both demos have a settings panel on the right (build duration, delay before the fade, fade duration, delay between characters, sequence easing with a draggable curve, fade by character, word or gradient, and switches for the focus bracket, coordinates, type guides and flying dots), remembered per browser.

## Install

1. Copy [`text-image-generation.js`](./text-image-generation.js) and [`text-image-generation.css`](./text-image-generation.css) into the project. No dependencies.
2. Import the CSS once, globally.
3. Import `generate` (and `auto` for the attribute API) where the element lives.

Do not rewrite the runtime or its timings: the glyph tracing, the fades, the sketch, the halftone and the colour are tuned together.

## Wiring

Call `generate` **after fonts and images have loaded**: glyphs are traced in the font the page renders, and the sketch and halftone read the image's pixels. The element is hidden until its drawing starts; its text blocks are then held behind a `mask` and its images at `opacity: 0` until they come in, and restored after.

**Vanilla**

```js
import { generate } from "./text-image-generation.js";
await document.fonts.ready;
await Promise.all([...hero.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
await generate(hero, { mode: "trace" }).finished;
```

**Attribute API** (plays each element once it scrolls into view)

```html
<section data-t-trace="trace-texts">…</section>
<script type="module">
  import { auto } from "./text-image-generation.js";
  await document.fonts.ready;
  auto();
</script>
```

**React / Next.js** (client component)

```jsx
"use client";
import { useLayoutEffect, useRef } from "react";
import { generate } from "@/lib/text-image-generation.js";

export function Hero() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    let run, live = true;
    const imgs = [...ref.current.querySelectorAll("img")].map((i) => i.decode().catch(() => {}));
    Promise.all([document.fonts.ready, ...imgs]).then(() => { if (live) run = generate(ref.current, { mode: "trace" }); });
    return () => { live = false; run && run.cancel(); };
  }, []);
  return <section ref={ref} className="hero">{/* … */}</section>;
}
```

**Vue**

```js
import { onMounted, onBeforeUnmount, ref } from "vue";
import { generate } from "@/lib/text-image-generation.js";
const el = ref(null); let run;
onMounted(async () => { await document.fonts.ready; run = generate(el.value, { mode: "trace" }); });
onBeforeUnmount(() => run && run.cancel());
```

**Svelte** (action)

```js
import { generate } from "$lib/text-image-generation.js";
export function tracing(node, mode = "trace") { let run; document.fonts.ready.then(() => (run = generate(node, { mode }))); return { destroy: () => run && run.cancel() }; }
// <section use:tracing={"trace-texts"}>…</section>
```

## Timeline (video tools)

`timeline(element, options)` builds the same drawing without running it: `seek(ms)` draws the build at that time, backwards too, so a video editor or a frame-by-frame renderer can scrub it. Before 0 the element is hidden; from `end` on it is as it was. Pass `parent` (a positioned element such as a scene) to put the overlay inside it so it shows and hides with it. `destroy()` restores everything.

```js
const tl = timeline(title, { duration: 3000, parent: scene });
tl.seek(1200); // e.g. from the video's render loop
```

## API

`generate(element, options)` returns `{ finished, cancel, element }`. `finished` resolves when everything is in. `cancel()` stops at once and shows the element as it is. Calling `generate` again on the same element cancels the previous run.

| Option | Default | Notes |
| --- | --- | --- |
| `mode` | `"trace"` | `"trace"` or `"trace-texts"`. |
| `duration` | `3000` | ms of building. The whole run is about `duration × 1.06`. Keep it between `2000` and `4500`; give long headlines more. |
| `delay` | `0` | ms before it starts. |
| `display` | `32` | px. Text at this size or larger is traced glyph by glyph; smaller text gets a dotted line. |
| `maxGlyphs` | `140` | Most glyphs traced; the rest only ink in. |
| `fade` | `200` | ms each character (or word) takes to fade in. |
| `fadeDelay` | `150` | ms between a character's dotted drawing finishing and its fade starting. A long delay runs the build past `duration`. |
| `fadeStagger` | `null` | ms between one character's fade and the next (one word's with `fadeBy: "word"`; with `"gradient"` it sets the sweep's pace). `null` follows the tracing. |
| `sequenceEase` | `"ease-in-out"` | How the starts of the glyphs, smaller lines and images (and so their fades) spread over the build: `"linear"`, `"ease-in"` (sparse first, then crowding in), `"ease-out"` (a burst first, then settling), `"ease-in-out"` or `"smooth-out"` (`--ease-smooth-out`: most of the text in early, the last characters settling slowly), or your own curve as `[x1, y1, x2, y2]` or `"cubic-bezier(x1, y1, x2, y2)"`. Also shapes `fadeStagger`, keeping its total. |
| `fadeBy` | `"character"` | `"character"`, `"word"` (a word fades in once its last character would; a word runs across inline elements and ends at whitespace or a new block) or `"gradient"` (a soft gradient mask sweeps left to right along each line, its edge reaching each character when that character would start to fade, as wide as the front travels in `fade`). |
| `guides` | `true` | Type guides (cap height, x-height, baseline, descender, font spec). |
| `focus` | `true` | The focus bracket on the glyph or image being drawn, with its label. |
| `readout` | `true` | The coordinate readout on the moving dot. |
| `particles` | `true` | Dots flying in to where each glyph starts. |
| `steps` | `["Setting type", "Tracing glyphs", "Sampling images", "Inking"]` | The step line (`trace-texts`). |
| `done` | `"Ready"` | The last step. |
| `onDone` | `null` | Called with the element when the run ends. |

Mark any child with `data-t-trace-skip` to leave it out. Attributes: `data-t-trace="trace" | "trace-texts"`, `data-t-trace-duration`, `data-t-trace-delay`, `data-t-trace-fade`, `data-t-trace-fade-delay`, `data-t-trace-fade-stagger`, `data-t-trace-fade-by`.

## Tunable variables

In [`text-image-generation.css`](./text-image-generation.css). Dark values switch with `prefers-color-scheme` or `[data-theme="dark"]`; on a dark page the halftone flips too (light dots grow with brightness).

| Variable | Default | Notes |
| --- | --- | --- |
| `--tig-line` | `#9a9a9a` | Dotted lines: glyph outlines, text lines, frames, guides. |
| `--tig-strong` | `#6c6c6c` | Dot heads, handles, reticle, labels, halftone dots as they land. |
| `--tig-ink` | `rgba(13, 13, 13, 0.5)` | Halftone dots once they settle. |
| `--tig-surface` | `#ffffff` | Fill of the corner handles. |
| `--tig-text` / `--tig-muted` | `#0d0d0d` / `#8b8b8b` | Log heading and copy (`trace-texts`). |
| `--tig-dot` | `2.1px` | Dot size on the traced lines. |
| `--tig-font` | Roboto Mono, monospace | Labels and texts. |

## How it works (for debugging)

- **Glyph outlines:** each character's range gives its box; its baseline comes from the font's ascent and descent. The character is drawn alone on a canvas in the computed `font-style font-weight font-size font-family` (`text-transform` applied), its alpha traced with marching squares and simplified (Ramer-Douglas-Peucker, `0.3px`). Outer shapes are traced before counters.
- **Ink:** each block that holds text gets a `mask-image`: an SVG with one rectangle per glyph (its cell across, its own ink box from `measureText` down, so it never reaches the line above or below) at its own `fill-opacity`, and one per smaller character (from its own range). `mask-clip: no-clip` and a padded mask keep descenders that overflow the block visible.
- **Images:** the image is drawn into a canvas at the size needed (honouring `object-fit` cover, contain and fill and `object-position`), its luminance stretched between its 1st and 99th percentile. The sketch is marching squares at six tone levels on a 3px grid, simplified, smoothed (Chaikin) and cut into strokes of up to 240px. The screen lifts local contrast (the tone minus its blur) before sizing the dots; landed dots are drawn once into a settled canvas, and the colour dot matrix is drawn once up front. A cross-origin image without CORS can't be read: no sketch, an even dot screen.
- **The overlay** is an SVG and a canvas over the element, `aria-hidden`, with no pointer input.

## Accessibility

- `prefers-reduced-motion: reduce` skips the drawing: the element fades in over `200ms` and `finished` resolves as usual. Never remove this.
- The real text stays in the DOM and in the accessibility tree the whole time; only its painting is clipped. Images keep their `alt`.

## Common mistakes to avoid

- **Running before fonts load.** The glyphs are traced in the fallback font and don't match the letters that arrive. Await `document.fonts.ready` first.
- **Running before images decode.** Their sketch and halftone are empty. Await `img.decode()`.
- **Variable fonts with optical sizing.** If the page uses an `opsz` axis automatically, the canvas may draw a different optical size and the outlines differ slightly. Load the font without the `opsz` axis, or set `font-optical-sizing: none` on the headline.
- **Tracing body copy.** Hundreds of glyphs make a busy, slow drawing. Trace the headline; let paragraphs get their dotted lines (they're under `display`).
- **Your own `mask` on the text blocks, or `opacity` / `filter` on the images, or an entrance animation on either.** The runtime owns them during the run and restores them after.
- **Importing on the server.** It needs `window` and the DOM.

## Reference files

- [01-trace.md](./01-trace.md): the trace mode, phase by phase.
- [02-trace-texts.md](./02-trace-texts.md): the agent log and the step line.
- [text-image-generation.js](./text-image-generation.js): the runtime (ES module; also `window.TextImageGeneration`).
- [text-image-generation.css](./text-image-generation.css): overlay styles and variables.
- [demo.html](./demo.html): an editorial page in both modes.
- [demo-text.html](./demo-text.html): one title in Saans, in both modes.
- [demo-panel.js](./demo-panel.js): the demos' settings panel.
- `timeline()` is also on `window.TextImageGeneration` for classic scripts.
