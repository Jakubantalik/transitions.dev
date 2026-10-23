# Generation texts (mode: "trace-texts")

## When to use

Any variant, plus text that tells the story of an agent setting the type and sampling the images. Use it for one showcase element at a time: a landing page hero, a launch video, a demo.

## Usage

```js
import { generate } from "./text-image-generation.js";
generate(element, { mode: "trace-texts", done: "Issue 07 ready" });
```

```html
<section data-t-trace="trace-texts">…</section>
```

## The texts

| Text | Where | What it shows |
| --- | --- | --- |
| **Agent log** | Left of the element, else right, else under it | `AGENT.LOG // 12/31`, then one line per item as it starts: an id, `glyph "L"` with its size and path count, `image` with its size, dot count and sketch line count, or `line`, and a progress bar ending in `[  ok  ]`. The last 11 lines show. |
| **Step line** | Under the element | One step at a time with a pulsing dot: the `steps` option, then `done`. |

## Placement

Each text is only drawn where the page is empty (sampled with `document.elementFromPoint`, counting only the element's own containers). A full-width hero usually gets the step line only; give it room underneath, or use `trace` there.

## Tuning

- `steps` and `done`: write them for your content ("Setting the headline", "Sampling the cover", "Inking", "Cover story ready").
- `--tig-text`, `--tig-muted`, `--tig-font`.

## Reduced motion

With `prefers-reduced-motion: reduce` no texts are drawn; the element fades in over `200ms`.
