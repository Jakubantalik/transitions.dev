# Cube motion

## When to use

A 3D take on the turns. Instead of rows and columns of blocks sliding home flat, every block is a little cube: a turning row or column rotates like a layer of a Rubik's cube, and each block's next face, the real block beside it, rolls into view. Use it when the build should feel more physical and playful, for a hero moment or a launch video. It works with both modes.

## Usage

```js
import { generate } from "./ui-pixel-generation.js";
generate(element, { mode: "pixel", motion: "cube" });
generate(element, { mode: "pixel-texts", motion: "cube" });
```

```html
<div data-t-pixel-generate="pixel" data-t-pixel-generate-motion="cube">…</div>
```

## What changes from `slide`

| | `slide` (default) | `cube` |
| --- | --- | --- |
| A step | The band jumps one block (about `40ms`). | Every block in the band makes a quarter turn (about `90ms`), the current face shrinking away as the next one turns in. |
| Bands | Each band turns its own way, at its own time. | Bands turn in step on a shared beat, all one way round, one axis at a time: rows, then columns. |
| Later passes | Up to two blocks per band. | One quarter turn per band, all together, like a layer move. |
| HUD | A flash on every step. | A bright edge where each block's two faces meet. |

## How it works

Blocks are flat colour, so a turning cube only needs the width of each face, never a stretched image:

1. A third displacement map shifts every turning band one block along (wrapping round), giving the state one turn on, sampled into a second mosaic.
2. A stripe one block wide, tiled across the element, splits every cell into the outgoing face and the incoming one. Its width follows the angle: `sin θ / (sin θ + cos θ)` of the block.
3. Each face is shaded for its angle with `feComponentTransfer` (down to 80% as it turns away, up from 80% as it turns in).
4. Only the turning bands show the two faces; everywhere else is the plain mosaic.

## Cost

The filter samples the element twice while a band turns. Keep it to cards and components, as with `slide`.
