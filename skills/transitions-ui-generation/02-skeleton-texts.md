# Skeleton + generation texts

## When to use

Everything the skeleton mode draws, plus text that tells the story of an agent at work. Use it for showcase moments: a landing page section, a product demo, onboarding, a launch video. It needs empty space around one element, so don't use it on every item of a grid.

## Usage

```js
import { generate } from "./ui-generation.js";
generate(element, {
  mode: "skeleton-texts",
  done: "Invite modal ready",   // the last step
});
```

```html
<section data-t-generate="skeleton-texts">…</section>
```

## The three texts

| Text | Where | What it shows |
| --- | --- | --- |
| **Agent log** | Left of the element | `AGENT.LOG // PARTS 06/09`, then one line per part as it is reached: an id, the part type, its position and size, and a progress bar that ends in `[  ok  ]`. Scrolls as it grows. |
| **Motion CSS** | Right of the element | `MOTION.CSS // 0249 TOKENS`: the transitions.dev motion tokens, then a rule per part with its real radius, type and colours and the transition it gets, typed out at a steady rate with a caret. The footer shows tokens per second, line count, and `WRITING` / `READY`. |
| **Step line** | Under the element | One step at a time with a pulsing dot: the `steps` option, then `done` as the UI comes in. |

Pass `code: [...]` (an array of lines) to stream your own CSS or code instead of the derived rules. Keep it under about 60 lines.

## Placement

The texts are only drawn where the page is empty: the runtime samples the space with `document.elementFromPoint` and counts only the element's own containers as empty.

1. **Beside:** both side panels, when there are at least 150px free on each side of the element.
2. **Under:** otherwise one strip under the element with the log and the CSS footer, if that space is free.
3. **Steps only:** otherwise just the step line, or nothing if there is no room under the element.

So `skeleton-texts` degrades on its own on narrow screens and in dense layouts. Give the element room (for example centred in a section with `min-height`) to get the full version.

## Tuning

- `steps` and `done`: write them for your product ("Reading the brief", "Picking components", "Adding motion", "Pricing card ready").
- `--gen-text` and `--gen-muted`: panel heading and copy colours. Keep the panels quieter than the UI.
- `--gen-font`: any monospace face.

## Reduced motion

With `prefers-reduced-motion: reduce` no texts are drawn; the element fades in over `200ms`.
