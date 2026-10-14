# Trace

## When to use

The default mode. Big type is traced along its real outlines and photos are drawn as halftones of their own pixels, then the ink and the photos come in. Use it for a hero, an article header, an image card, a pull quote.

## Usage

```js
import { generate } from "./text-image-generation.js";
generate(element, { mode: "trace" });
```

```html
<section data-t-trace="trace">…</section>
```

## Timeline

Phases as fractions of `duration` (default `3000ms`).

| Phase | Window | What happens |
| --- | --- | --- |
| Type guides | 0 to 0.26 | Cap height, x-height, baseline and descender guides draw out for each display line, a little after the one above. The first line of each block shows the labels and the font spec. |
| Images | from 0.04 to 0.2 (staggered) | Each image: a dotted frame from the top centre in both directions, a placeholder cross, corner handles and a size label. |
| Glyphs | 0.06 to 0.76 | Letters traced in order, about `0.16` each and overlapping, outer shape first then counters (`--ease-out`), with a reticle, a readout and a dot flying in to each start. |
| Text lines | 0.12 to 0.78 | Smaller text: one dotted line per line. |
| Halftone | about `0.36` per image | Dots arrive top down with some scatter, popping in large and dark, then settling. |
| Ink | just after each glyph | The glyph fills from its descender up over `0.14` (`--ease-smooth-out`) and its dots fade. Smaller lines wipe in left to right. |
| Photo | `0.28` per image, after its halftone | Wipes in top down under a dotted scan line, sharpening from a `5px` blur. |
| Clean | 0.86 to 1.04 | Guides and leftover dots fade out. |

## Tuning

- **Speed:** `duration`. A three-line headline reads well at `3000` to `3600`.
- **What counts as display type:** `display` (px). Lower it to trace subheads too.
- **Colours:** `--tig-line`, `--tig-strong`, `--tig-ink`. Keep the drawing monochrome: the real type and photos bring the colour.

## Reduced motion

With `prefers-reduced-motion: reduce` the drawing is skipped and the element fades in over `200ms`.
