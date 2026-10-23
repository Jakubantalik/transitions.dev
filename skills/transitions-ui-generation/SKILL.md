---
name: transitions-ui-generation
license: Free for personal and commercial use; see LICENSE.txt (no redistribution of the library itself)
description: Make any UI, headline or image appear as if an AI agent is generating it. Five variants: ui (the default: a dotted wireframe drawn from the element's own structure, outline, boxes, text lines, icon paths, with guides, corner handles and size labels, then the real UI revealed behind a scan line), text (every glyph of a headline traced along its real outline in flowing dots, then fading in one by one), small text (a dotted line through each line of text), image (a frame, a sketch of the photo's tones, a halftone of its own pixels, colour dots, then the photo) and auto (text by size and images in one block). Two modes, skeleton and skeleton + generation texts (an agent log, the motion CSS being written, and a step line). One dependency-free runtime that works with any framework (vanilla, React, Next.js, Vue, Svelte). Use when the user asks for a "generation animation", "AI generating the UI", "agent building the component", "build-in animation", "wireframe to UI reveal", "skeleton generation", "dotted wireframe", "matrix dots", "make it look generated", "futuristic reveal", "generative UI loading", "headline generation animation", "letters drawn in dots", "glyph outline reveal", "image generation reveal", "halftone image reveal", or for an AI product that should show its output being built. Also the commands transitions generate, transitions generate texts and transitions generate preview.
---

# Transitions UI generation

Plays an "agent is generating this" animation over any element on the page, then hands over to the real UI. Nothing is faked: the drawing is measured from the element itself, so the dotted outline, text lines and icons land exactly where the real ones appear. Headlines are traced along their real glyph outlines, and images are drawn from their own pixels.

## Variants

| Variant | What it generates | Use for | Reference |
| --- | --- | --- | --- |
| **`ui`** (default) | The component's dotted wireframe: dot field, guides, outline, every box, text line and icon, then the real UI behind a scan line. | Cards, panels, components an agent produced. | [01-skeleton.md](./01-skeleton.md) |
| **`text`** | Every glyph traced along its real outline in flowing dots, then fading in one by one (140ms after its outline, 90ms each, 90ms apart on a gentle in-out curve), with dots flying in to each glyph. | Headlines, titles, pull quotes, slide titles. | [03-text.md](./03-text.md) |
| **`small-text`** | A dotted line through each line of text; the characters fade in as it passes. | Eyebrows, subtitles, captions, labels. | [04-small-text.md](./04-small-text.md) |
| **`image`** | A dotted frame, a sketch of the photo's tones, a fine halftone of its pixels, a dot matrix in its colours, then the photo. | Hero images, image cards, covers. | [05-image.md](./05-image.md) |
| **`auto`** | Text and images in one block: text at `display` (32px) or larger as `text`, smaller as `small-text`, every image as `image`. | A hero or editorial block mixing a headline, copy and a photo. | |

`text`, `small-text`, `image` and `auto` are drawn by [`text-image-generation.js`](./text-image-generation.js), which ships with this skill; `generate(el, { variant })` from `ui-generation.js` hands them over. Those variants generate only their own content; the rest of the element shows as it is.

Works in every agent that reads skills (Claude Code, Cursor, Codex, and others): install with `npx skills add Jakubantalik/transitions.dev`, or copy this folder into the project.

## What the ui variant draws

In order, over one build (default `2400ms` of drawing, about `2.6s` in all):

1. **Dot field.** A grid of small dots ripples out from the centre, with matrix rain falling down its columns and a probe line sweeping across.
2. **Construction.** Guides run along the element's edges past its corners, corner handles pop in, and a size label counts up to the real size with a build timer.
3. **Outline.** The outline is traced from the top centre in both directions in small flowing dots, while loose dots fly in and land on it.
4. **Parts.** Every box, text line and icon path is traced in document order. Key elements (buttons, inputs, the largest boxes) get their own guides, handles and size label, and a targeting reticle jumps from part to part with a coordinate readout.
5. **Reveal.** The real UI comes in top to bottom behind a scan line, fading and sharpening on `--ease-smooth-out`, while the drawing is wiped away and the dots clear.

## Modes

Every variant takes the same two modes (for the text and image variants, `skeleton` maps to their `trace` and `skeleton-texts` to `trace-texts`: an agent log of every glyph and image and a step line, see [06-text-image-texts.md](./06-text-image-texts.md)).

| Mode | What you get | Use for | Reference |
| --- | --- | --- | --- |
| **`skeleton`** | The dotted drawing and the reveal. | Most places: a card or panel an agent produced, an empty state filling in, a hero moment. | [01-skeleton.md](./01-skeleton.md) |
| **`skeleton-texts`** | The same, plus generation texts: an agent log (one line per part with a progress bar), the motion CSS being written (the element's own values on the transitions.dev token scale), and a step line ("Planning layout" … "Ready"). | Showcases and launch moments where the "agent at work" story matters: landing pages, demos, onboarding, product videos. Needs space beside or under the element; it places the texts only where the page is empty. | [02-skeleton-texts.md](./02-skeleton-texts.md) |

## Decision rules

- **A headline** → `text`. **Its subtitle or eyebrow** → `small-text`. **A photo** → `image`. **A hero mixing them** → `auto`, or each element with its own variant and a `delay`. **A card or component** → `ui`.
- **An AI feature returns UI** (a generated component, a chart, a summary card, a draft) → `skeleton`, played when the result arrives.
- **A launch page, demo or video** that should tell the "built by an agent" story → `skeleton-texts`, played when it scrolls into view.
- **The user asks for "the texts", "the log", "the code streaming", "the futuristic version"** → `skeleton-texts`.
- **Several elements at once** (a grid of results) → `skeleton` on each with a `delay` of about `260ms` per item. The texts only fit around one element at a time.
- **Small inline UI** (a badge, a single button, anything under about 120px) or **UI that appears often** (every route change, every list row) → don't use this. Use the `transitions-dev` skeleton reveal (`14-skeleton-reveal.md`) or texts reveal instead: a generation animation is a moment, not a loading state.
- **Unsure which mode** → `skeleton`. Ask before adding the texts.

## Commands

### transitions generate

**Trigger phrases:** `transitions generate`, "add the generation animation", "make this look AI generated", "animate this like an agent builds it".

**Behaviour:**

1. Find the element: the one the user named, the component in the open file, or the element nearest the cursor. If it is ambiguous, ask which.
2. Pick the variant (default `ui`; `text`, `small-text`, `image`, `auto`) and the mode with the decision rules (default `skeleton`), and the trigger: on mount, when data arrives, on scroll into view, or on demand.
3. Propose it in one line, for example: "I'd play **skeleton** on `<ResultCard>` when the response arrives. Confirm?"
4. On confirmation, follow `## Install` and `## Wiring` below. Keep the diff small.

### transitions generate texts

Same as `transitions generate` with `mode: "skeleton-texts"`. Mention that the texts need empty space beside or under the element and are skipped where there is none.

### transitions generate preview

Serve the folder over http (for example `npx serve` in this directory) and open:

- [`demo.html`](./demo.html): the `ui` variant on three components published on the transitions.dev Community (Heart Rate Monitor, Chart card, Music Player Likes), each in its own shadow root, with a one-card layout that shows the side panels.
- [`demo-text.html`](./demo-text.html): one title ("Generative skill", Saans Medium from the repo's `assets/fonts`, Inter when served on its own) in the `text` and `small-text` variants, with a settings panel (variant, build, delay, fade, delay between characters, sequence easing with a draggable curve, fade by, focus bracket, coordinates, type guides, flying dots) remembered per browser.
- [`demo-editorial.html`](./demo-editorial.html): an editorial page (hero, two image cards, a quote) in the `auto` variant, the same panel with all variants.

## Install

1. Copy [`ui-generation.js`](./ui-generation.js), [`text-image-generation.js`](./text-image-generation.js) (it imports this one, for the text and image variants), [`ui-generation.css`](./ui-generation.css) and [`text-image-generation.css`](./text-image-generation.css) into the project (for example `src/lib/` or `public/vendor/`). No dependencies.
2. Import both CSS files once, globally (a `<link>`, or `import "./ui-generation.css"` in the app entry).
3. Import `generate` (and `auto` for the attribute API) where the element lives.

Do not rewrite the runtime or its timings. They are tuned together: the drawing phases, the dot spacing, the flow speed and the reveal curve.

## Wiring

Call `generate` **after the element has rendered and has its final size**, with fonts loaded. It hides the element itself until the reveal, then restores its inline `opacity`, `clip-path` and `filter`.

**Text and image variants:** call `generate` after fonts and images have loaded (`await document.fonts.ready`, `await img.decode()`): glyphs are traced in the font the page renders, and the sketch and halftone read the image's pixels. Their text blocks are held behind a `mask` and their images at `opacity: 0` until they come in, and restored after.

```js
await generate(headline, { variant: "text" }).finished;
generate(subtitle, { variant: "small-text", delay: 400 });
generate(cover, { variant: "image", delay: 600 });
```

**Vanilla**

```js
import { generate } from "./ui-generation.js";
await document.fonts.ready;
const run = generate(document.querySelector("#result"), { mode: "skeleton" });
await run.finished; // the real UI is fully in
```

**Attribute API** (plays each element once it scrolls into view)

```html
<section data-t-generate="skeleton-texts" data-t-generate-delay="200">…</section>
<script type="module">
  import { auto } from "./ui-generation.js";
  auto();
</script>
```

**React / Next.js** (client component)

```jsx
"use client";
import { useLayoutEffect, useRef } from "react";
import { generate } from "@/lib/ui-generation.js";

export function GeneratedCard({ data }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const run = generate(ref.current, { mode: "skeleton" });
    return () => run.cancel();
  }, [data]); // replays when new data arrives
  return <div ref={ref} className="card">{/* … */}</div>;
}
```

**Vue**

```js
import { onMounted, onBeforeUnmount, ref } from "vue";
import { generate } from "@/lib/ui-generation.js";
const el = ref(null); let run;
onMounted(() => { run = generate(el.value, { mode: "skeleton" }); });
onBeforeUnmount(() => run && run.cancel());
```

**Svelte** (action)

```js
import { generate } from "$lib/ui-generation.js";
export function generating(node, mode = "skeleton") { const run = generate(node, { mode }); return { destroy: () => run.cancel() }; }
// <div use:generating={"skeleton-texts"}>…</div>
```

## Timeline (video tools)

For the text and image variants, `timeline(element, options)` builds the same drawing without running it: `seek(ms)` draws the build at that time, backwards too, so a video editor or a frame-by-frame renderer can scrub it. Before 0 the element is hidden; from `end` on it is as it was. Pass `parent` (a positioned element such as a scene) to put the overlay inside it so it shows and hides with it. `destroy()` restores everything.

```js
import { timeline } from "./ui-generation.js";
const tl = timeline(title, { variant: "text", duration: 3000, parent: scene });
tl.seek(1200); // e.g. from the video's render loop
```

## API

`generate(element, options)` returns `{ finished, cancel, element }`. `finished` resolves when the real UI is fully in. `cancel()` stops at once and shows the element as it is. Calling `generate` again on the same element cancels the previous run.

| Option | Default | Notes |
| --- | --- | --- |
| `variant` | `"ui"` | `"ui"`, `"text"`, `"small-text"`, `"image"` or `"auto"`. |
| `mode` | `"skeleton"` | `"skeleton"` or `"skeleton-texts"`. |
| `duration` | `2400` | ms of drawing. The whole run is about `duration × 1.09`. Keep it between `1600` and `3600`. |
| `delay` | `0` | ms before it starts (stagger several elements with it). |
| `steps` | `["Planning layout", "Drawing structure", "Writing styles", "Adding motion"]` | The step line (`skeleton-texts`). |
| `done` | `"Ready"` | The last step, shown as the UI comes in. Use the component's name, for example `"Invite modal ready"`. |
| `code` | derived | Lines for the motion CSS panel. By default the element's own radius, type and colours with transitions.dev motion tokens. |
| `title` | derived | Name in the motion CSS header (else `aria-label` or the first heading). |
| `maxParts` | `60` | Most parts traced; the largest are kept. |
| `keys` | `5` | Key elements that get guides, handles and a size label. |
| `onDone` | `null` | Called with the element when the run ends. |

Mark any child with `data-t-generate-skip` to leave it out of the drawing. Attribute API: `data-t-generate-variant` picks the variant.

**Text, small text, image and auto** take these options too (the defaults are the text demo's tuned settings):

| Option | Default | Notes |
| --- | --- | --- |
| `duration` | `3000` | ms of building. The whole run is about `duration × 1.06`. Keep it between `2000` and `4500`; give long headlines more. |
| `display` | `32` | px, `auto` variant: text at this size or larger is traced glyph by glyph; smaller text gets a dotted line. |
| `maxGlyphs` | `140` | Most glyphs traced; the rest only ink in. |
| `fade` | `90` | ms each character (or word) takes to fade in. |
| `fadeDelay` | `140` | ms between a character's dotted drawing finishing and its fade starting. A long delay runs the build past `duration`. |
| `fadeStagger` | `90` | ms between one character's fade and the next (one word's with `fadeBy: "word"`; with `"gradient"` it sets the sweep's pace). `null` follows the tracing. A character never fades in before its own drawing is done. |
| `sequenceEase` | `[0.37, -0.02, 0.73, 0.88]` | How the starts of the glyphs, smaller lines and images (and so their fades) spread over the build: `"linear"`, `"ease-in"` (sparse first, then crowding in), `"ease-out"` (a burst first, then settling), `"ease-in-out"` or `"smooth-out"` (`--ease-smooth-out`: most of the text in early, the last characters settling slowly), or your own curve as `[x1, y1, x2, y2]` or `"cubic-bezier(x1, y1, x2, y2)"`. Also shapes `fadeStagger`, keeping its total. |
| `fadeBy` | `"character"` | `"character"`, `"word"` (a word fades in once its last character would; a word runs across inline elements and ends at whitespace or a new block) or `"gradient"` (a soft gradient mask sweeps left to right along each line, its edge reaching each character when that character would start to fade, as wide as the front travels in `fade`). |
| `dotScale` | `1` | Scales the dots, their spacing and the moving heads, for type shown smaller or larger than it is set (a scaled scene in a video). |
| `guides` | `false` | Type guides (cap height, x-height, baseline, descender, font spec). |
| `focus` | `false` | The focus bracket on the glyph or image being drawn, with its label. |
| `readout` | `false` | The coordinate readout on the moving dot. |
| `particles` | `true` | Dots flying in to where each glyph starts. |
| `steps` | `["Setting type", "Tracing glyphs", "Sampling images", "Inking"]` | The step line (`trace-texts`). |
| `done` | `"Ready"` | The last step. |

Mark any child with `data-t-trace-skip` to leave it out of those variants.

## Tunable variables

In [`ui-generation.css`](./ui-generation.css). Light values shown; dark values switch with `prefers-color-scheme` or `[data-theme="dark"]`.

| Variable | Default | Notes |
| --- | --- | --- |
| `--gen-line` | `#9a9a9a` | The dotted lines: outline, parts, guides. |
| `--gen-strong` | `#6c6c6c` | Moving dot heads, handles, reticle, lit dots, labels. |
| `--gen-ink` | `rgba(13, 13, 13, 0.32)` | The resting dot field. |
| `--gen-surface` | `#ffffff` | Fill of the corner handles (match the page background). |
| `--gen-text` / `--gen-muted` | `#0d0d0d` / `#8b8b8b` | Panel headings and copy (`skeleton-texts`). |
| `--gen-dot` | `2.1px` | Dot size on the traced lines. |
| `--gen-font` | Roboto Mono, monospace | Labels and panels. |

The text and image variants read theirs from [`text-image-generation.css`](./text-image-generation.css) (on a dark page their halftone flips too: light dots grow with brightness):

| Variable | Default | Notes |
| --- | --- | --- |
| `--tig-line` | `#9a9a9a` | Dotted lines: glyph outlines, text lines, frames, guides. |
| `--tig-strong` | `#6c6c6c` | Dot heads, handles, reticle, labels, halftone dots as they land. |
| `--tig-ink` | `rgba(13, 13, 13, 0.5)` | Halftone dots once they settle. |
| `--tig-surface` | `#ffffff` | Fill of the corner handles. |
| `--tig-text` / `--tig-muted` | `#0d0d0d` / `#8b8b8b` | Log heading and copy (`trace-texts`). |
| `--tig-dot` | `2.1px` | Dot size on the traced lines. |
| `--tig-font` | Roboto Mono, monospace | Labels and texts. |

Keep the drawing monochrome. Grey dots read as "the agent's working layer"; the real UI brings the colour when it arrives.

## How the text and image variants work (for debugging)

- **Glyph outlines:** each character's range gives its box; its baseline comes from the font's ascent and descent. The character is drawn alone on a canvas in the computed `font-style font-weight font-size font-family` (`text-transform` applied), its alpha traced with marching squares and simplified (Ramer-Douglas-Peucker, `0.3px`). Outer shapes are traced before counters.
- **Ink:** each block that holds text gets a `mask-image`: an SVG with one rectangle per glyph (its cell across, its own ink box from `measureText` down, so it never reaches the line above or below) at its own `fill-opacity`, and one per smaller character (from its own range). `mask-clip: no-clip` and a padded mask keep descenders that overflow the block visible.
- **Images:** the image is drawn into a canvas at the size needed (honouring `object-fit` cover, contain and fill and `object-position`), its luminance stretched between its 1st and 99th percentile. The sketch is marching squares at six tone levels on a 3px grid, simplified, smoothed (Chaikin) and cut into strokes of up to 240px. The screen lifts local contrast (the tone minus its blur) before sizing the dots; landed dots are drawn once into a settled canvas, and the colour dot matrix is drawn once up front. A cross-origin image without CORS can't be read: no sketch, an even dot screen.
- **The overlay** is an SVG and a canvas over the element, `aria-hidden`, with no pointer input.

## Accessibility

- `prefers-reduced-motion: reduce` skips the drawing entirely: the element fades in over `200ms` and `finished` resolves as usual. Never remove this.
- The overlay is `aria-hidden` and takes no pointer input. The element stays in the accessibility tree the whole time.
- Don't gate interaction on it: the element is usable as soon as `finished` resolves (about 2.6s). For anything a user waits on repeatedly, use a skeleton loader instead.

## Common mistakes to avoid

- **Running before layout settles.** Measuring before fonts or images load draws text lines and boxes in the wrong place. Await `document.fonts.ready` (and images, if they size the layout) first.
- **Running on `display: none`.** A hidden element has no size; show it first. In tabs and accordions, generate after the panel opens.
- **Animating the element yourself at the same time.** Don't add your own entrance transition to the element; the runtime owns its `opacity`, `clip-path` and `filter` during the run.
- **A parent with `overflow: hidden` and scrolling during the run.** The overlay sits on the page, not inside the scroller; if the element scrolls during the 2.6s the drawing drifts. Play it once the element is in view (the attribute API does).
- **Using it as a loading state.** It plays once, over the real UI. While data is still loading, show a skeleton; play the generation when the data arrives.
- **Forcing the texts into a tight layout.** `skeleton-texts` only draws its panels where the page is empty. In a dense grid it falls back to the step line, or nothing. That is correct; use `skeleton` there.
- **Running before fonts load.** The glyphs are traced in the fallback font and don't match the letters that arrive. Await `document.fonts.ready` first.
- **Running before images decode.** Their sketch and halftone are empty. Await `img.decode()`.
- **Variable fonts with optical sizing.** If the page uses an `opsz` axis automatically, the canvas may draw a different optical size and the outlines differ slightly. Load the font without the `opsz` axis, or set `font-optical-sizing: none` on the headline.
- **Tracing body copy.** Hundreds of glyphs make a busy, slow drawing. Trace the headline; let paragraphs get their dotted lines (they're under `display`).
- **Your own `mask` on the text blocks, or `opacity` / `filter` on the images, or an entrance animation on either.** The runtime owns them during the run and restores them after.
- **Importing on the server.** It needs `window` and the DOM. In Next.js or Nuxt, import it in a client component or inside an effect.

## Reference files

- [01-skeleton.md](./01-skeleton.md): the ui variant, phase by phase.
- [02-skeleton-texts.md](./02-skeleton-texts.md): the ui variant's generation texts and where they go.
- [03-text.md](./03-text.md): the text variant and its defaults.
- [04-small-text.md](./04-small-text.md): the small text variant.
- [05-image.md](./05-image.md): the image variant, phase by phase.
- [06-text-image-texts.md](./06-text-image-texts.md): the agent log and step line of the text and image variants.
- [ui-generation.js](./ui-generation.js): the runtime (ES module; also `window.UIGeneration`), with `generate`, `auto` and `timeline`.
- [text-image-generation.js](./text-image-generation.js): the text and image variants (imported by ui-generation.js; also `window.TextImageGeneration`).
- [ui-generation.css](./ui-generation.css), [text-image-generation.css](./text-image-generation.css): the overlay styles and variables.
- [demo.html](./demo.html), [demo-text.html](./demo-text.html), [demo-editorial.html](./demo-editorial.html), [demo-panel.js](./demo-panel.js): the demos and their settings panel.
