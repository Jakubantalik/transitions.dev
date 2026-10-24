# Transform variant

## When to use

There is a version of a UI on screen and the agent has made a new version of it: "make it more premium", "add a yearly toggle", a redesign, a regenerated result. Instead of swapping one for the other, the old version regenerates into the new one: it dissolves into its dotted wireframe, every part flows to where it sits in the new version, parts that are gone break up, new parts are traced in, and the new version comes in.

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
| Read | 0 to 0.3 | A scan line sweeps down the old version; above it the UI becomes its dotted wireframe (outline, boxes, text lines, icons). |
| Regenerate | 0.24 to 0.72 | The outline morphs to the new size and corner radius, corner handles riding along. Each part matched in the new version flows there (`--ease-out`), top first; a reticle on the part changing reads `button 256×40 → 166×40`. Parts that are gone shrink to their centre and fade; new parts are traced in dot by dot with a moving head. |
| Reveal | 0.68 to 1 | A second scan line brings the new version in top to bottom, fading and sharpening (`--ease-smooth-out`), wiping the wireframe behind it. |

Above the card: `READING V1`, `REGENERATING V1 → V2`, `V2 READY`, and `MOVED 11  NEW 05  OUT 00  340×404`.

## How parts are matched

Each version is read like the `ui` variant reads a component (boxes, buttons, inputs, images, icons, one line per line of text). Every new part is paired with the old part of the same kind and role (a button with a button, a text line with a text line) that sat most nearly in the same place and size, relative to the card. Unpaired old parts leave; unpaired new parts are new.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `duration` | `2800` | ms for the whole regeneration. Keep it between `2000` and `4000`. |
| `delay` | `0` | ms before it starts. |
| `labels` | `true` | The status line, counts and the reticle's size change. |
| `versions` | `["V1", "V2"]` | Names in the labels (pass `["v2", "v1"]` when going back). |
| `hideFrom` | `true` | Hide the old version at the end. |
| `onDone` | `null` | Called with the new version when it is in. |

## Reduced motion

With `prefers-reduced-motion: reduce` it crossfades the two versions over `200ms`.
