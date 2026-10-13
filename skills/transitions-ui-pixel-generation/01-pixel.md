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
| HUD | 0 to 0.14 | Corner brackets, the pixel grid and the readout (`RES 32PX   11×11   PASS 1/5   23%`) fade in. |
| Materialise | 0.04 to 0.46 | 32px blocks of the real UI appear, led by a scan front from the top with blocks scattered ahead of it (`--ease-smooth-out`). The element's shadow arrives as blocks too. |
| Passes | 0.42 to 0.90 | One pass per entry in `resolutions` (32, 20, 12, 8, 5). Each pass swaps to the smaller block size and sweeps a scan line down with cells flickering behind it. |
| Crisp | 0.90 to 1 | The filter comes off, the HUD fades out, the real UI is there. |

## Where the pixels come from

Each frame the element is drawn through an SVG filter:

1. `feGaussianBlur` (about a third of the block size) brings every area to its average colour.
2. `feFlood`, `feComposite` and `feTile` make a grid with one point at the middle of each block.
3. `feComposite in` samples the blurred element at those points.
4. `feMorphology dilate` grows every sample back into a full block.

So the mosaic is the component itself at a lower resolution: its photos, gradients, text and shadow.

## Tuning

- **Speed:** `duration` only; everything scales together.
- **Look:** `resolutions`. Coarser first steps (`[40, 24, …]`) feel more dramatic; stop at 4px or above, since finer passes read as blur.
- **HUD colours:** `--pxg-line`, `--pxg-strong`, `--pxg-flash`.

## Reduced motion

With `prefers-reduced-motion: reduce` the build is skipped and the element fades in over `200ms`.
