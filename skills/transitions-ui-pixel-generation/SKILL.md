---
name: transitions-ui-pixel-generation
license: Free for personal and commercial use; see LICENSE.txt (no redistribution of the library itself)
description: Make any UI appear as if an AI agent is rendering it pixel by pixel. Every pixel comes from the real UI (an SVG filter samples the element's own rendering, so colours, images and text are the component's), blocks materialise top down while rows and columns of blocks turn into place like a Rubik's cube, then the resolution steps down 32px to crisp with more turns on each pass, under a HUD (corner brackets, pixel grid, resolution readout). Two modes, pixel and pixel + generation texts (a render log of every pass and a step line), and two motions: blocks sliding into place flat, or turning as 3D cubes like a Rubik's cube layer move. One dependency-free runtime for any framework (vanilla, React, Next.js, Vue, Svelte). Use when the user asks for a "pixel generation animation", "pixelated reveal", "UI rendering in pixels", "depixelate", "resolution build-up", "low-res to high-res reveal", "8-bit materialise", "AI rendering the UI", "futuristic pixel reveal", "3D pixel cubes", "Rubik's cube reveal", or for an AI product that should show its output being rendered. Also the commands transitions pixelate, transitions pixelate texts, transitions pixelate cube and transitions pixelate preview. For the dotted wireframe version, use transitions-ui-generation.
---

# Transitions UI pixel generation

The pixel sibling of [`transitions-ui-generation`](../transitions-ui-generation/SKILL.md). Where that skill draws a dotted wireframe and then reveals the UI, this one **renders** the UI: it starts as a coarse mosaic of the component's own pixels and resolves pass by pass until it is crisp.

Nothing is faked or redrawn. The element is shown through an SVG filter that blurs it to each block's average colour, samples it on a grid and grows every sample back into a block, so the mosaic is literally the component at a lower resolution: its images, text, gradients and shadow.

Works in every agent that reads skills (Claude Code, Cursor, Codex, and others): install with `npx skills add Jakubantalik/transitions.dev`, or copy this folder into the project.

## What it does

Over one build (default `2200ms`):

1. **HUD.** Corner brackets lock onto the element, dotted guides run out along its edges and ruler ticks mark every block, with a readout of the current resolution, the grid size in blocks, the pass and the progress.
2. **Materialise.** 32px blocks of the real UI pop in from the top down, while rows and columns that start turned out of place, like the face of a Rubik's cube, turn home one block at a time. Tiny squares fly in from around the element.
3. **Passes.** The resolution steps down, 32 → 20 → 12 → 8 → 5px, and each pass but the last turns a few more rows or columns home. Brackets and chevrons mark each turning band, `+` marks flicker at block corners and a targeting bracket hops between blocks with a `col:row` label. The pixel grid shrinks with the blocks.

The blocks only ever move as whole blocks of the real UI; nothing is distorted. With `motion: "cube"` every block in a turning row or column is a little cube instead, and turns in 3D to show the real block beside it.
4. **Crisp.** The filter comes off and the real, interactive UI is there, untouched.

## Options

| Mode | What you get | Use for | Reference |
| --- | --- | --- | --- |
| **`pixel`** | The pixel build with its HUD. | Most places: an AI result arriving, a hero component, a card in a grid of results. | [01-pixel.md](./01-pixel.md) |
| **`motion: "cube"`** (with either mode) | Every block in a turning row or column rotates in 3D like a Rubik's cube layer, its next face rolling into view, in step on a shared beat. | Hero moments and launch videos that should feel physical and playful. | [03-cube.md](./03-cube.md) |
| **`pixel-texts`** | The same, plus a `RENDER.LOG` of every pass (block size, block count, status) beside the element and a step line under it ("Sampling pixels" … "Ready"). | Showcase moments that tell the "agent is rendering" story: landing pages, demos, onboarding, launch videos. The texts are only placed where the page is empty. | [02-pixel-texts.md](./02-pixel-texts.md) |

## Decision rules

- **The user wants a pixel / depixelate / low-res-to-high-res / 8-bit look** → this skill.
- **The user wants dots, lines, a wireframe or "blueprint"** → `transitions-ui-generation` instead.
- **An AI feature returns UI** → `pixel`, played when the result arrives.
- **A launch page, demo or video** → `pixel-texts`, played when it scrolls into view.
- **The user wants 3D, cubes or a Rubik's cube turn** → add `motion: "cube"`.
- **Several elements at once** → `pixel` on each with a `delay` of about `260ms` per item.
- **Small inline UI** (under about 120px) **or UI that appears often** → don't. Use the `transitions-dev` skeleton reveal or texts reveal; a generation animation is a moment, not a loading state.

## Commands

### transitions pixelate

**Trigger phrases:** `transitions pixelate`, "add the pixel generation", "make this render in pixels", "depixelate this when it loads".

1. Find the element (named, in the open file, or nearest the cursor). Ask if it's ambiguous.
2. Pick the mode (default `pixel`) and the trigger: on mount, when data arrives, on scroll into view, or on demand.
3. Propose it in one line, for example: "I'd play **pixel** on `<ResultCard>` when the response arrives. Confirm?"
4. On confirmation, follow `## Install` and `## Wiring`.

### transitions pixelate texts

Same, with `mode: "pixel-texts"`.

### transitions pixelate cube

Same, with `motion: "cube"` (either mode).

### transitions pixelate preview

Open [`demo.html`](./demo.html) (serve the folder over http, for example `npx serve` here). It plays both modes on three components published on the transitions.dev Community (Heart Rate Monitor, Chart card, Music Player Likes), each in its own shadow root, with a one-card layout for the texts and a 3D cube toggle for the cube motion.

## Install

1. Copy [`ui-pixel-generation.js`](./ui-pixel-generation.js) and [`ui-pixel-generation.css`](./ui-pixel-generation.css) into the project. No dependencies.
2. Import the CSS once, globally.
3. Import `generate` (and `auto` for the attribute API) where the element lives.

Do not rewrite the filter or the timings; the blur, sample and dilate steps and the pass schedule are tuned together.

## Wiring

Call `generate` after the element has rendered at its final size, with fonts loaded. It hides the element until its first blocks appear, and restores its inline `opacity`, `filter` and mask styles at the end.

**Vanilla**

```js
import { generate } from "./ui-pixel-generation.js";
await document.fonts.ready;
await generate(document.querySelector("#result"), { mode: "pixel" }).finished;
```

**Attribute API** (plays each element once it scrolls into view)

```html
<section data-t-pixel-generate="pixel-texts">…</section>
<script type="module">
  import { auto } from "./ui-pixel-generation.js";
  auto();
</script>
```

**React / Next.js** (client component)

```jsx
"use client";
import { useLayoutEffect, useRef } from "react";
import { generate } from "@/lib/ui-pixel-generation.js";

export function GeneratedCard({ data }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const run = generate(ref.current, { mode: "pixel" });
    return () => run.cancel();
  }, [data]);
  return <div ref={ref} className="card">{/* … */}</div>;
}
```

**Vue**

```js
import { onMounted, onBeforeUnmount, ref } from "vue";
import { generate } from "@/lib/ui-pixel-generation.js";
const el = ref(null); let run;
onMounted(() => { run = generate(el.value, { mode: "pixel" }); });
onBeforeUnmount(() => run && run.cancel());
```

**Svelte** (action)

```js
import { generate } from "$lib/ui-pixel-generation.js";
export function pixelating(node, mode = "pixel") { const run = generate(node, { mode }); return { destroy: () => run.cancel() }; }
// <div use:pixelating={"pixel-texts"}>…</div>
```

## API

`generate(element, options)` returns `{ finished, cancel, element }`. `finished` resolves when the UI is crisp. `cancel()` stops at once and shows the element as it is. Calling `generate` again on the same element cancels the previous run.

| Option | Default | Notes |
| --- | --- | --- |
| `mode` | `"pixel"` | `"pixel"` or `"pixel-texts"`. |
| `duration` | `2200` | ms for the whole build. Keep it between `1400` and `3600`. |
| `delay` | `0` | ms before it starts (stagger several elements with it). |
| `motion` | `"slide"` | `"slide"` (turned rows and columns slide home flat, a block at a time) or `"cube"` (every block turns in 3D, see [03-cube.md](./03-cube.md)). Attribute: `data-t-pixel-generate-motion`. |
| `resolutions` | `[32, 20, 12, 8, 5]` | Block sizes, coarse to fine. After the last one the UI is crisp. Keep 4 to 6 passes and stop at 4px or above: finer passes read as blur, not pixels. |
| `steps` | `["Sampling pixels", "Resolving layout", "Sharpening detail", "Final pass"]` | The step line (`pixel-texts`). |
| `done` | `"Ready"` | The last step, for example `"Pricing card ready"`. |
| `onDone` | `null` | Called with the element when it is crisp. |

## Tunable variables

In [`ui-pixel-generation.css`](./ui-pixel-generation.css). They only style the HUD and texts; the pixels are the element's own. Dark values switch with `prefers-color-scheme` or `[data-theme="dark"]`.

| Variable | Default | Notes |
| --- | --- | --- |
| `--pxg-line` | `#9a9a9a` | The pixel grid. |
| `--pxg-strong` | `#6c6c6c` | Scan line, brackets, readouts. |
| `--pxg-flash` | `rgba(255, 255, 255, 0.75)` | The flash on a turning band at every step. Lower it on light-on-light UI, raise it on dark UI. |
| `--pxg-text` / `--pxg-muted` | `#0d0d0d` / `#8b8b8b` | Log heading and copy (`pixel-texts`). |
| `--pxg-font` | Roboto Mono, monospace | HUD and texts. |

## How it works (for debugging)

- **The filter** (`feGaussianBlur` → two `feDisplacementMap`s for the column and row turns, each fed by merged `feFlood`s → `feFlood` + `feComposite` + `feTile` → `feComposite in` → `feMorphology dilate`) is created in the element's own tree (the document, or its shadow root, so `filter: url(#…)` resolves) and removed at the end.
- **The materialise mask** is a canvas the element's size with one rectangle per revealed block, applied as `mask-image`; it covers the element's shadow too, so the shadow arrives as pixels with the rest.
- **The HUD** is one canvas over the element (40px around it), `aria-hidden`, with no pointer input.

## Accessibility

- `prefers-reduced-motion: reduce` skips the build: the element fades in over `200ms` and `finished` resolves as usual. Never remove this.
- The HUD is decoration only; the element stays in the accessibility tree and is usable as soon as `finished` resolves.

## Common mistakes to avoid

- **Running before layout settles.** Await `document.fonts.ready` (and images that size the layout) first, or the first passes pixelate the wrong layout.
- **Running on `display: none`.** Show the element first; in tabs and accordions, generate after the panel opens.
- **Your own `filter`, `mask` or entrance transition on the element.** The runtime owns `opacity`, `filter` and the mask during the run and restores them after; don't animate them at the same time.
- **Very large elements** (a whole page section, over about 1200 × 900). The filter re-renders the element every frame; keep it to components and cards.
- **Cross-origin images that never load.** The mosaic shows whatever the element renders; a broken image pixelates as a broken image. Make sure images load first.
- **Importing on the server.** It needs `window` and the DOM; import it in a client component or inside an effect.

## Reference files

- [01-pixel.md](./01-pixel.md): the pixel mode, pass by pass.
- [02-pixel-texts.md](./02-pixel-texts.md): the render log and step line.
- [03-cube.md](./03-cube.md): the 3D cube motion.
- [ui-pixel-generation.js](./ui-pixel-generation.js): the runtime (ES module; also `window.UIPixelGeneration`).
- [ui-pixel-generation.css](./ui-pixel-generation.css): HUD and texts styles and variables.
- [demo.html](./demo.html): both modes on three Community components.
