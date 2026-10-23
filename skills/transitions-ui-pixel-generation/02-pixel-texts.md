# Pixel + generation texts

## When to use

Everything the pixel mode does, plus text that tells the story of an agent rendering the UI. Use it for showcase moments: a landing page section, a demo, onboarding, a launch video. Give the element some empty space around it.

## Usage

```js
import { generate } from "./ui-pixel-generation.js";
generate(element, { mode: "pixel-texts", done: "Chart ready" });
```

```html
<section data-t-pixel-generate="pixel-texts">…</section>
```

## The texts

| Text | Where | What it shows |
| --- | --- | --- |
| **Render log** | Left of the element | `RENDER.LOG // 332×345`, then one line per pass as it starts: `PASS 02  20PX    306 BLOCKS  [ .. ]`, turning to `[ ok ]` when the next pass takes over. |
| **Step line** | Under the element | One step at a time with a blinking square: the `steps` option, then `done` as the UI turns crisp. |

## Placement

Each text is only drawn where the page is empty (sampled with `document.elementFromPoint`, counting only the element's own containers, across shadow roots). In a dense layout the log or the step line is skipped on its own; the pixel build always plays.

## Tuning

- `steps` and `done`: write them for your product ("Reading the brief", "Rendering layout", "Sharpening type", "Pricing card ready").
- `--pxg-text`, `--pxg-muted`, `--pxg-font`: text colours and font.

## Reduced motion

With `prefers-reduced-motion: reduce` no texts are drawn; the element fades in over `200ms`.
