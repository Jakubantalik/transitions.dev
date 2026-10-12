---
name: transitions-ui-generation
license: Free for personal and commercial use; see LICENSE.txt (no redistribution of the library itself)
description: Make any UI appear as if an AI agent is generating it. A dotted wireframe is drawn from the element's own structure (outline, boxes, text lines, icon paths, with guides, corner handles and size labels), then the real UI is revealed behind a scan line with a fade on a smooth ease-out. Two modes, skeleton and skeleton + generation texts (an agent log, the motion CSS being written, and a step line). One dependency-free runtime that works with any framework (vanilla, React, Next.js, Vue, Svelte). Use when the user asks for a "generation animation", "AI generating the UI", "agent building the component", "build-in animation", "wireframe to UI reveal", "skeleton generation", "dotted wireframe", "matrix dots", "make it look generated", "futuristic reveal", "generative UI loading", or for an AI product that should show its output being built. Also the commands transitions generate, transitions generate texts and transitions generate preview.
---

# Transitions UI generation

Plays an "agent is generating this" animation over any element on the page, then hands over to the real UI. Nothing is faked: the drawing is measured from the element itself, so the dotted outline, text lines and icons land exactly where the real ones appear.

Works in every agent that reads skills (Claude Code, Cursor, Codex, and others): install with `npx skills add Jakubantalik/transitions.dev`, or copy this folder into the project.

## What it draws

In order, over one build (default `2400ms` of drawing, about `2.6s` in all):

1. **Dot field.** A grid of small dots ripples out from the centre, with matrix rain falling down its columns and a probe line sweeping across.
2. **Construction.** Guides run along the element's edges past its corners, corner handles pop in, and a size label counts up to the real size with a build timer.
3. **Outline.** The outline is traced from the top centre in both directions in small flowing dots, while loose dots fly in and land on it.
4. **Parts.** Every box, text line and icon path is traced in document order. Key elements (buttons, inputs, the largest boxes) get their own guides, handles and size label, and a targeting reticle jumps from part to part with a coordinate readout.
5. **Reveal.** The real UI comes in top to bottom behind a scan line, fading and sharpening on `--ease-smooth-out`, while the drawing is wiped away and the dots clear.

## Options

| Mode | What you get | Use for | Reference |
| --- | --- | --- | --- |
| **`skeleton`** | The dotted drawing and the reveal. | Most places: a card or panel an agent produced, an empty state filling in, a hero moment. | [01-skeleton.md](./01-skeleton.md) |
| **`skeleton-texts`** | The same, plus generation texts: an agent log (one line per part with a progress bar), the motion CSS being written (the element's own values on the transitions.dev token scale), and a step line ("Planning layout" … "Ready"). | Showcases and launch moments where the "agent at work" story matters: landing pages, demos, onboarding, product videos. Needs space beside or under the element; it places the texts only where the page is empty. | [02-skeleton-texts.md](./02-skeleton-texts.md) |

## Decision rules

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
2. Pick the mode with the decision rules (default `skeleton`), and the trigger: on mount, when data arrives, on scroll into view, or on demand.
3. Propose it in one line, for example: "I'd play **skeleton** on `<ResultCard>` when the response arrives. Confirm?"
4. On confirmation, follow `## Install` and `## Wiring` below. Keep the diff small.

### transitions generate texts

Same as `transitions generate` with `mode: "skeleton-texts"`. Mention that the texts need empty space beside or under the element and are skipped where there is none.

### transitions generate preview

Open [`demo.html`](./demo.html) (serve the folder over http, for example `npx serve` in this directory) to see both modes on three components published on the transitions.dev Community (Heart Rate Monitor, Chart card, Music Player Likes), with a one-card layout that shows the side panels. Each component is mounted in its own shadow root, so its styles and scripts stay as published.

## Install

1. Copy [`ui-generation.js`](./ui-generation.js) and [`ui-generation.css`](./ui-generation.css) into the project (for example `src/lib/` or `public/vendor/`). Both files are self-contained, with no dependencies.
2. Import the CSS once, globally (a `<link>`, or `import "./ui-generation.css"` in the app entry).
3. Import `generate` (and `auto` for the attribute API) where the element lives.

Do not rewrite the runtime or its timings. They are tuned together: the drawing phases, the dot spacing, the flow speed and the reveal curve.

## Wiring

Call `generate` **after the element has rendered and has its final size**, with fonts loaded. It hides the element itself until the reveal, then restores its inline `opacity`, `clip-path` and `filter`.

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

## API

`generate(element, options)` returns `{ finished, cancel, element }`. `finished` resolves when the real UI is fully in. `cancel()` stops at once and shows the element as it is. Calling `generate` again on the same element cancels the previous run.

| Option | Default | Notes |
| --- | --- | --- |
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

Mark any child with `data-t-generate-skip` to leave it out of the drawing.

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

Keep the drawing monochrome. Grey dots read as "the agent's working layer"; the real UI brings the colour when it arrives.

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
- **Importing on the server.** It needs `window` and the DOM. In Next.js or Nuxt, import it in a client component or inside an effect.

## Reference files

- [01-skeleton.md](./01-skeleton.md): the skeleton mode, phase by phase.
- [02-skeleton-texts.md](./02-skeleton-texts.md): the generation texts and where they go.
- [ui-generation.js](./ui-generation.js): the runtime (ES module; also `window.UIGeneration`).
- [ui-generation.css](./ui-generation.css): the overlay styles and variables.
- [demo.html](./demo.html): both modes on three Community components.
