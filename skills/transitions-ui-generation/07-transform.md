# Transform variant

## When to use

There is a version of a UI on screen and the agent has made a new version of it: "make it more premium", "add a yearly toggle", a redesign, a regenerated result. Nothing fades away: the real UI morphs into the new one. Every part matched in the new version (buttons, text, icons, the card itself) moves and resizes into its new place, its content changing over in place, while the generation effect works over it: dot field, probe, guides, corner handles, size label, a reticle reading each part, dotted outlines riding with the parts, new parts traced in dot by dot with dots flying in, gone parts dissolving.

## Usage

```js
import { transform } from "./ui-generation.js";
await transform(oldCard, newCard).finished;          // or generate(oldCard, { variant: "transform", to: newCard })
```

Both versions must be **laid out where they will be seen** when it starts, so each can be measured. Stack them in one place, for example one grid cell:

```css
.slot { display: grid; }
.slot > * { grid-area: 1 / 1; }
```

The new version is hidden until its reveal; the old one is hidden at the end (`visibility: hidden`; pass `hideFrom: false` to keep it, or remove it yourself once `finished` resolves). Run it back the other way with `transform(newCard, oldCard)`.

**React** (render both while it runs, then keep the new one):

```jsx
const [phase, setPhase] = useState("old"); // "old" | "both" | "new"
useLayoutEffect(() => {
  if (phase !== "both") return;
  const run = transform(oldRef.current, newRef.current);
  run.finished.then(() => setPhase("new"));
  return () => run.cancel();
}, [phase]);
// <div className="slot">{phase !== "new" && <Card ref={oldRef} v={1} />}{phase !== "old" && <Card ref={newRef} v={2} />}</div>
```

## Timeline

Phases as fractions of `duration` (default `2800ms`).

| Phase | Window | What happens |
| --- | --- | --- |
| Read | 0 to 0.24 | The old version stays as it is. A dot field ripples out around it, a probe line sweeps across, guides draw out along the card's edges, corner handles and a size label appear, dotted outlines trace over its parts and the reticle hops from part to part with its size (`READING V1`). |
| Morph | 0.24 to 0.84 | The real UI morphs (`cubic-bezier(.45, 0, .15, 1)`), top first: the card grows or shrinks to its new size, each matched part moves and resizes into its new place with its content changing over (text keeps its size, boxes stretch). The outline, guides, handles and size label follow the card; dotted outlines ride with each part; the reticle reads the part changing (`button 256×40 → 166×40`). Gone parts dissolve; new parts get dots flying in, are traced dot by dot (`+ frame 292×36`), and fade up inside their outline (`MORPHING V1 → V2`). |
| Clean | 0.86 to 1 | The drawing fades out (`V2 READY`). |

The morph runs on the browser's view transitions (`document.startViewTransition`). Where they aren't available (or with `morph: false`) it falls back to a dotted regeneration: the old version goes into its wireframe behind a scan line, the wireframe morphs, and the new version comes in behind a second scan line.

## How parts are matched

Each version is read like the `ui` variant reads a component (boxes, buttons, inputs, images, icons, text). Every new part is paired with the old part of the same kind and role (a button with a button, text with text) that sat most nearly in the same place and size, relative to the card; a button's own label moves with the button. Unpaired old parts leave; unpaired new parts are new.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `duration` | `2800` | ms for the whole regeneration. Keep it between `2000` and `4000`. |
| `delay` | `0` | ms before it starts. |
| `labels` | `true` | The status line, counts and the reticle's size change. |
| `versions` | `["V1", "V2"]` | Names in the labels (pass `["v2", "v1"]` when going back). |
| `hideFrom` | `true` | Hide the old version at the end. |
| `morph` | `true` | The real-UI morph where view transitions exist; `false` always uses the dotted regeneration. |
| `onDone` | `null` | Called with the new version when it is in. |

## Reduced motion

With `prefers-reduced-motion: reduce` it crossfades the two versions over `200ms`.
