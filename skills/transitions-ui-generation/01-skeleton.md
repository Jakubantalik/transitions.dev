# Skeleton

## When to use

The default mode. The element is drawn as a dotted wireframe from its own structure, then revealed. Use it when an AI feature hands back UI (a generated card, chart, draft or panel), for an empty state filling in, or on each item of a small grid of results.

## Usage

```js
import { generate } from "./ui-generation.js";
generate(element, { mode: "skeleton" });
```

```html
<div data-t-generate="skeleton">…</div>
```

## What it reads from the element

- **Outline:** the element's box and corner radius (or that of a child that fills it, so a wrapper around a rounded card still draws the rounded card).
- **Boxes:** every descendant with a background, a border or a background image, and every `img`, `canvas`, `video`, `input`, `button`, `textarea` and `select`. Boxes larger than 60% of the element (backgrounds) and blurred layers are skipped.
- **Text lines:** each line of text, from its own text nodes, measured with `Range.getClientRects()`.
- **Icons:** every inline `<svg>` up to 120px, path by path, with its real transform.
- **Key elements:** interactive boxes first (buttons, inputs, links, tabs, switches), then the largest boxes, up to `keys` (default 5).

Mark a child `data-t-generate-skip` to leave it out (a decorative layer, a live chart, a video).

## Timeline

Phases as fractions of `duration` (default `2400ms`). The reveal ends a little past the drawing.

| Phase | Window | What happens |
| --- | --- | --- |
| Dot field | 0 to 0.30 | Dots ripple out from the centre; matrix rain runs until about 0.86. |
| Probe | 0.02 to 0.24 | A dotted vertical line sweeps left to right, lighting the dots it passes. |
| Guides | 0.04 to 0.30 | Lines along the four edges, running past the corners. |
| Outline | 0.10 to 0.42 | Both halves from the top centre, with particles landing on it and corner handles popping in. A size label counts up with a build timer. |
| Parts | 0.28 to 0.74 | Each part traced in document order, icons stroke by stroke. Key elements get guides, handles and a size label. The reticle and coordinate readout follow the part being drawn. |
| Reveal | 0.74 to 1.055 | The real UI comes in behind the scan line, fading and sharpening (`cubic-bezier(0.22, 1, 0.36, 1)`), while the drawing is wiped away. |
| Clean | 0.84 to 1.04 | The dot field and guides fade out. |

Every easing in the drawing is a smooth ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`). Lines are drawn as small round dots that keep flowing along the line in its drawing direction.

## Tuning

- **Faster or slower:** change `duration` only. All phases scale together. Below `1600ms` the parts phase gets too short to read; above `3600ms` it starts to feel like waiting.
- **Colour:** `--gen-line`, `--gen-strong` and `--gen-ink` in `ui-generation.css`. Keep them neutral greys close to your text colours.
- **Busy components:** lower `maxParts` (for example to `30`) so the parts phase reads as a sequence rather than noise.
- **Stagger several elements:** `delay: index * 260`.

## Reduced motion

With `prefers-reduced-motion: reduce` the drawing is skipped and the element fades in over `200ms`.
