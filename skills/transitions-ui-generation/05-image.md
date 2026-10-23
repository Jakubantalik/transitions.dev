# Image

## When to use

A photo or illustration: a hero image, an image card, a cover. It is drawn from its own pixels: a dotted frame, a sketch of its tones, a fine halftone, a dot matrix in its colours, then the photo itself.

## Usage

```js
generate(photo, { variant: "image" });       // an <img>, <video> or <canvas>, or a block holding them
```

```html
<img data-t-generate="skeleton" data-t-generate-variant="image" src="cover.jpg" alt="…" />
```

## How it builds

All windows are from the image's start (images in one block start `0.04` to `0.16` of `duration` apart).

| Phase | Window | What happens |
| --- | --- | --- |
| Frame | 0 to 0.2 | A dotted frame from the top centre in both directions, corner handles, a size label and a live status (`SKETCH 42/108`, `SCREEN 24935 DOTS`, `COLOUR 64%`, `RESOLVING 80%`). |
| Sketch | 0.08 to 0.38 | Lines of equal tone at six levels through the softened photo, like a topographic drawing, traced in fine dots, many short strokes at once. |
| Screen | 0.2 to 0.56 | A fine halftone (3 to 5px cells) sweeps in from the top left, every dot sized by the tone under it with the local contrast lifted, so texture survives. |
| Colour | 0.52 to 0.68 | The grey dots cross into a dot matrix in the photo's own colours. |
| Photo | 0.64 to 0.88 | The photo fades in over its colour dots, sharpening from a `6px` blur. |

## Notes

- Load and decode the image first (`img.decode()`); an undecoded image has an empty sketch and halftone.
- A cross-origin image without CORS can't be read: it gets the frame and an even dot screen, no sketch.
- On a dark page the halftone flips: light dots grow with brightness.
- `object-fit` cover, contain and fill and `object-position` are honoured.
