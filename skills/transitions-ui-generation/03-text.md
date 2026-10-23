# Text variant

## When to use

Headlines and display type: a hero title, an article header, a pull quote, a slide title. Every glyph is traced along its own outline in small flowing dots, then the real letter fades in.

## Usage

```js
import { generate } from "./ui-generation.js";
generate(headline, { variant: "text" });
```

```html
<h1 data-t-generate="skeleton" data-t-generate-variant="text">Generative skill</h1>
```

## Defaults

Tuned on the text demo; every one can be overridden.

| Option | Default | What it does |
| --- | --- | --- |
| `duration` | `3000` | The whole build. |
| `fadeDelay` | `140` | ms between a glyph's outline finishing and its fade starting. |
| `fade` | `90` | ms each glyph takes to fade in (`ease-out`). |
| `fadeStagger` | `90` | ms between one glyph's fade and the next; a glyph never fades in before its outline is done. `null` follows the tracing. |
| `sequenceEase` | `[0.37, -0.02, 0.73, 0.88]` | How the glyphs' starts spread over the build: a gentle in-out. Presets: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `smooth-out`. |
| `fadeBy` | `"character"` | Or `"word"`, or `"gradient"` (a soft mask sweeping left to right behind the tracing). |
| `particles` | `true` | A dot flies in to where each glyph starts. |
| `focus`, `readout`, `guides` | `false` | The focus bracket, the coordinate readout and the type guides (cap height, x-height, baseline, descender, font spec). Turn them on for a more technical look. |

## Timeline

| Phase | Window (of `duration`) | What happens |
| --- | --- | --- |
| Glyphs | 0.06 to 0.76 | Letters traced in order, about `0.16` each and overlapping, outer shape first then counters (`--ease-out`). |
| Ink | per glyph | `fadeDelay` after its outline is done (and on the `fadeStagger` beat), the glyph fades in over `fade` and its dots fade out. |
| Clean | 0.86 to 1.04 | Leftover dots and guides fade out. |

## Tuning

- **Long headlines:** raise `duration` (`3600` for three lines) or lower `fadeStagger`.
- **Type shown at another size** (a scaled scene in a video): `dotScale` keeps the dots in proportion.
- **Colours:** `--tig-line`, `--tig-strong`. Keep the drawing monochrome: the real type brings the colour.

## Reduced motion

With `prefers-reduced-motion: reduce` the drawing is skipped and the element fades in over `200ms`.
