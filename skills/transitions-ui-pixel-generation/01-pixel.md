# Pixel

## When to use

The default mode. The element is rendered from a coarse mosaic of its own pixels up to the crisp UI. Use it when an AI feature hands back UI, for a hero component, or on each card of a small grid of results.

## Usage

```js
import { generate } from "./ui-pixel-generation.js";
generate(element, { mode: "pixel" });
```

```html
<div data-t-pixel-generate="pixel">…</div>
```

## Timeline

Phases as fractions of `duration` (default `2200ms`).

| Phase | Window | What happens |
| --- | --- | --- |
| HUD | 0 to 0.14 | Corner brackets, dotted edge guides, ruler ticks (one per block), the pixel grid and the readout (`RES 32PX   11×11   PASS 1/5   23%`) fade in. |
| Materialise | 0.04 to 0.46 | 32px blocks of the real UI appear from the top down with blocks scattered ahead (`--ease-smooth-out`), while rows and then columns that start turned out of place turn home block by block. Tiny squares fly in from around the element. The element's shadow arrives as blocks too. |
| Passes | 0.42 to 0.90 | One pass per entry in `resolutions` (32, 20, 12, 8, 5). Each pass swaps to the smaller block size and turns a few columns or rows home again (the second to last pass only a few, the last none). `+` marks flicker at block corners and a targeting bracket jumps between blocks with its `col:row` label. |
| Crisp | 0.90 to 1 | The filter comes off, the HUD fades out, the real UI is there. |

## Moving pixels

The blocks move like the face of a Rubik's cube. On each pass some rows and columns of blocks start turned by one to three blocks, wrapping round inside the element, and turn home one block at a time (about `40ms` a step). While a band turns, brackets mark its ends, it flashes on every step, and chevrons with its label (`R07`, `C03`) sit outside the edge it turns towards.

The blocks are never redrawn: two displacement maps (one for columns, one for rows) move whole blocks of the real UI before they are sampled, so every block in a new place is a real block of the component. Only whole cells inside the element turn, so nothing lands on the shadow outside it.

## Where the pixels come from

Each frame the element is drawn through an SVG filter:

1. `feGaussianBlur` (about a third of the block size) brings every area to its average colour.
2. Two `feDisplacementMap`s, each driven by a neutral `feFlood` with one flood per turned stretch merged on top, move whole blocks for the turning columns and rows.
3. `feFlood`, `feComposite` and `feTile` make a grid with one point at the middle of each block.
4. `feComposite in` samples the blurred element at those points.
5. `feMorphology dilate` grows every sample back into a full block.

So the mosaic is the component itself at a lower resolution: its photos, gradients, text and shadow.

## Tuning

- **Speed:** `duration` only; everything scales together.
- **Look:** `resolutions`. Coarser first steps (`[40, 24, …]`) feel more dramatic; stop at 4px or above, since finer passes read as blur.
- **HUD colours:** `--pxg-line`, `--pxg-strong`, `--pxg-flash`.

## Reduced motion

With `prefers-reduced-motion: reduce` the build is skipped and the element fades in over `200ms`.
