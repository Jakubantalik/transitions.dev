# Trace

## When to use

The default mode. Big type is traced along its real outlines; photos are sketched in tone lines and built up as a halftone of their own pixels that turns into their colours. Then the text fades in character by character and the photos resolve. Use it for a hero, an article header, an image card, a pull quote.

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
| Images | from 0.04 to 0.16 (staggered) | Each image: a dotted frame from the top centre in both directions, corner handles, a size label and a live status. |
| Glyphs | 0.06 to 0.76 | Letters traced in order, about `0.16` each and overlapping, their starts spread along `sequenceEase` (`ease-in-out`), outer shape first then counters (`--ease-out`), with a reticle, a readout and a dot flying in to each start. |
| Text lines | 0.12 to 0.78 | Smaller text: one dotted line per line. |
| Sketch | image start + 0.08 to 0.38 | Tone lines at six levels, traced in fine dots, many short strokes at once. |
| Screen | image start + 0.2 to 0.56 | A fine halftone sweeps in from the top left, dots landing slightly large and dark, then settling. |
| Colour | image start + 0.52 to 0.68 | The grey dots cross into a dot matrix in the photo's own colours (`--ease-smooth-out`). |
| Ink | per character (per word with `fadeBy: "word"`, or a left to right gradient sweep per line with `fadeBy: "gradient"`) | Each character fades in over `fade` (`200ms`, `ease-out`): a display glyph `fadeDelay` (`150ms`) after it is traced, with its dots fading out; a smaller character that long after its line's dotted stroke passes it. |
| Photo | image start + 0.64 to 0.88 | Fades in over its colour dots, sharpening from a `6px` blur. |
| Clean | 0.86 to 1.04 | Guides and leftover dots fade out. |

## Tuning

- **Speed:** `duration`. A three-line headline reads well at `3000` to `3600`.
- **What counts as display type:** `display` (px). Lower it to trace subheads too.
- **Colours:** `--tig-line`, `--tig-strong`, `--tig-ink`. Keep the drawing monochrome: the real type and photos bring the colour.

## Reduced motion

With `prefers-reduced-motion: reduce` the drawing is skipped and the element fades in over `200ms`.
