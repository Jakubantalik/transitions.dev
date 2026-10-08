# Transitions.dev

Motion tokens and the 32 library transitions from transitions.dev. Reuse these tokens and patterns so components move like the library.

## Quick reference

| Transition | When to use |
| --- | --- |
| **Card resize** | Tween a container's width or height when its layout state changes. |
| **Number pop-in** | Re-enter each digit with a blurred slide when a number updates. |
| **Notification badge** | Slide a small badge onto a trigger and pop the dot. |
| **Text states swap** | Swap text in place with a blurred up-and-down transition. |
| **Menu dropdown** | Open an origin-aware dropdown that grows from its trigger. |
| **Modal open / close** | Scale-up modal dialog with a softer scale-down on close. |
| **Panel reveal** | Slide a panel into a region with a cross-blur. |
| **Page side-by-side** | Slide between two side-by-side pages (list ↔ detail, step 1 ↔ step 2). |
| **Icon swap** | Cross-fade two icons in the same slot with blur and scale. |
| **Success check** | Compose fade + rotate + Y-bob + path stroke-draw to celebrate a completed action. |
| **Avatar group hover** | Distance-falloff lift on a row of items with a bouncy spring on return. |
| **Error state shake** | Per-segment cubic-bezier shake with auto-reverting border + message. |
| **Input clear with dissolve** | Fly-out + per-word streak when a text field is cleared. |
| **Skeleton loader and reveal** | Pulse a placeholder, then cross-fade + cross-blur to the loaded content. |
| **Shimmer text** | Sweep a highlight band across muted text on a loop (pure CSS). |
| **Tabs sliding** | Slide the active pill between tabs in a segmented control. |
| **Tooltip open/close** | Delayed fade+scale in, instant out, travels between triggers. |
| **Texts reveal** | Staggered blurred rise for stacked text lines, quiet fade out. |
| **Card hover tilt** | Tilt a card in 3D toward the pointer with a cursor-tracked glare. |
| **Plus to menu morph** | Morph a circular trigger into the menu / panel it opens. |
| **Accordion expand** | Grow / shrink a panel via grid-rows with a chevron flip. |
| **Toast open / close** | Rise a toast from below with fade + cross-blur, slower in than out. |
| **Like button** | Fill a heart with a pop + particle burst on like. |
| **Learn more hover** | Slide the chevron and spread its arms into an arrow on hover. |
| **Checkbox check** | Fill the box, then stroke-draw the checkmark. |
| **Spinning counter** | Spin slot-machine digit reels with vertical motion blur. |
| **Toggle** | Travel the switch thumb with a double-bounce overshoot. |
| **Thinking states** | Shimmer a status line while it holds, then swap it to the next state. |
| **Reasoning stream** | Step an agent-reasoning transcript up two lines at a time on a loop. |
| **Streaming text** | Resolve streamed words one by one through a soft cross-blur. |
| **Matrix dot loader** | Pulse a 4×4 dot matrix in scan / twinkle / orbit / pulse patterns. |
| **Banner stacking** | Stack banners like toasts, new ones rise in, older ones push back. |
| **Text morph** | Keep the letters two labels share and cross-blur only the part that changes, easing its width. |
| **Text swap soft** | Cross-blur a value into the new one in place, both at once, with no movement. |
| **Donut chart** | Ring segments with even gaps and rounded corners that morph to new values. |

## Decision rules

When the user asks for a transition, match against the visible UI element first, then the verb:

- **Trigger + small dot floating on top** → notification badge.
- **Trigger + surface that grows from it** → dropdown (anchored, origin-aware) or modal (centered, no anchor).
- **Surface that slides into a region of the page** → panel reveal.
- **Two screens, list ↔ detail or step 1 ↔ step 2** → page side-by-side.
- **Element changes width or height** → card resize.
- **A label changes in place and the old and new text share letters at the start or end** (Copy code to Copied, Follow to Following) → text morph.
- **Element's text content changes in place and the texts share nothing** (Processing to Done) → text states swap.
- **Values update in place because the data behind a view changed** (a chart's period, a currency, a unit) → text swap soft for every value that changed.
- **A donut or ring chart** → donut chart (even gaps, the smallest corner radius, morphs when its data changes).
- **Two icons in the same slot** → icon swap.
- **A number updates** → number pop-in.
- **Confirmation / success / "done" moment** (checkmark, payment processed, file uploaded) → success check.
- **Hovering an item in a horizontal stack** (avatars, chips, segmented buttons, tag pills) → avatar group hover.
- **Form validation error / "this is wrong" feedback** (invalid field, wrong PIN, duplicate name) → error state shake.
- **Clearing a text field** (search box × button, filter reset) → input clear with dissolve.
- **Placeholder that loads then swaps to real content** (list row, card, profile header) → skeleton loader and reveal.
- **In-progress / "thinking" text that should feel alive** (loading label, streaming status) → shimmer text.
- **Small horizontal set of mutually-exclusive options with a moving highlight** (view switcher, segmented control, filter tabs) → tabs sliding.
- **Hover/focus hint that appears over a trigger** (icon tooltip, info bubble) → tooltip open / close.
- **Stacked headline + supporting line entering with rhythm** (hero copy, empty state, onboarding step) → texts reveal.
- **Card / tile that should react in 3D to the pointer on hover** (product card, cover art, membership card, with or without a light glare) → card hover tilt.
- **Circular trigger that becomes the surface it opens** (+ FAB grows into a menu / panel, compose button expands) → plus → menu morph. If the surface is a *separate* popover that merely grows from the trigger, use menu dropdown instead.
- **Header with a collapsible body that grows / shrinks in height** (settings group, FAQ, filter section, "show more", disclosure) → accordion expand.
- **No clear match** → fall back to `transitions reveal` and let the user pick. Don't guess.

If two transitions could fit, prefer the lower-overhead one (card resize over panel reveal, dropdown over modal, success check over a full modal celebration) unless the design clearly calls for the heavier surface. The success check is animation-only, if you also need to swap from a spinner to the check, pair it with **icon swap**.

## Motion tokens

The shared motion scale behind the thirty-two transitions, the same tokens the [transitions.dev](https://transitions.dev) Motion tokens tab exposes. They ship at the top of [`_root.css`](./_root.css), so once it's imported you can reference any of them as `var(--…)` (e.g. `transition: transform var(--duration-fast) var(--ease-smooth-out)`).

`transitions refine` maps each existing value to a usage below, then suggests the token to reference. Match on **usage**, not on the raw number, a 300ms modal close still maps to `--duration-quick` (150ms).

**Durations**

| Token | Value | Usage |
| --- | --- | --- |
| `--duration-stagger` | `40ms` | per-item stagger offset |
| `--duration-micro` | `80ms` | tooltip/path delay, shake segment, large stagger |
| `--duration-quick` | `150ms` | modal/dropdown close, text swap, tooltip appear |
| `--duration-fast` | `250ms` | icon swap, dropdown/modal open, tabs sliding, page slide |
| `--duration-medium` | `350ms` | panel close, toast close |
| `--duration-slow` | `400ms` | panel open, skeleton content reveal, input clear |
| `--duration-very-slow` | `500ms` | emphasis moments, badge appear, text reveal, success check |

**Easings**

| Token | Value | Usage |
| --- | --- | --- |
| `--ease-smooth-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | modal/dropdown/panel open + close, page slide, resize, position change |
| `--ease-in-out` | `ease-in-out` | icon swap, text swap, text reveal, skeleton reveal |
| `--ease-out` | `ease-out` | tooltip open / close |
| `--ease-linear` | `linear` | shimmer, skeleton pulse, spinner |
| `--ease-bounce` | `cubic-bezier(0.34, 1.36, 0.64, 1)` | badge pop open |
| `--ease-bounce-strong` | `cubic-bezier(0.34, 3.85, 0.64, 1)` | bouncy hover-out (avatar return) |

**Distances**

| Token | Value | Usage |
| --- | --- | --- |
| `--distance-micro` | `4px` | text swap |
| `--distance-small` | `6px` | error shake (small segment) |
| `--distance-base` | `8px` | badge diagonal reveal, page slide, error shake (large segment) |
| `--distance-medium` | `12px` | text reveal |
| `--distance-large` | `30px` | check badge appear |

**Scales**

| Token | Value | Usage |
| --- | --- | --- |
| `--scale-large` | `0.96` | modal open / close |
| `--scale-medium` | `0.97` | dropdown open |
| `--scale-small` | `0.98` | tooltip open |
| `--scale-tiny` | `0.99` | dropdown close |

**Blur**

| Token | Value | Usage |
| --- | --- | --- |
| `--blur-small` | `2px` | panel reveal, icon swap, text swap, skeleton reveal, number pop-in |
| `--blur-medium` | `3px` | page slide, text reveal |
| `--blur-large` | `8px` | success check open |

## Token values

```css
/* transitions-dev, copy this :root block into your project once.
   Every transition snippet reads from these semantic names. */
:root {
  /* ── Motion tokens, shared scale ──────────────────────────────
     Reference these with var(--…) anywhere in your project. The
     transitions below ship literal values so each snippet works on
     its own; `transitions refine` maps hardcoded values back to
     these tokens. */
  /* Durations */
  --duration-stagger: 40ms;  /* per-item stagger offset */
  --duration-micro: 80ms;  /* tooltip/path delay, shake segment, large stagger */
  --duration-quick: 150ms;  /* modal/dropdown close, text swap, tooltip appear */
  --duration-fast: 250ms;  /* icon swap, dropdown/modal open, tabs sliding, page slide */
  --duration-medium: 350ms;  /* panel close, toast close */
  --duration-slow: 400ms;  /* panel open, skeleton content reveal, input clear */
  --duration-very-slow: 500ms;  /* emphasis moments, badge appear, text reveal, success check */
  /* Easings */
  --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1);  /* modal/dropdown/panel open + close, page slide, resize, position change */
  --ease-in-out: ease-in-out;  /* icon swap, text swap, text reveal, skeleton reveal */
  --ease-out: ease-out;  /* tooltip open / close */
  --ease-linear: linear;  /* shimmer, skeleton pulse, spinner */
  --ease-bounce: cubic-bezier(0.34, 1.36, 0.64, 1);  /* badge pop open */
  --ease-bounce-strong: cubic-bezier(0.34, 3.85, 0.64, 1);  /* bouncy hover-out (avatar return) */
  /* Distances */
  --distance-micro: 4px;  /* text swap */
  --distance-small: 6px;  /* error shake (small segment) */
  --distance-base: 8px;  /* badge diagonal reveal, page slide, error shake (large segment) */
  --distance-medium: 12px;  /* text reveal */
  --distance-large: 30px;  /* check badge appear */
  /* Scales */
  --scale-large: 0.96;  /* modal open / close */
  --scale-medium: 0.97;  /* dropdown open */
  --scale-small: 0.98;  /* tooltip open */
  --scale-tiny: 0.99;  /* dropdown close */
  /* Blur */
  --blur-small: 2px;  /* panel reveal, icon swap, text swap, skeleton reveal, number pop-in */
  --blur-medium: 3px;  /* page slide, text reveal */
  --blur-large: 8px;  /* success check open */
}
```

## Common mistakes to avoid

- **Stripping the close-state class cleanup** on dropdown/modal, without the `setTimeout` that removes `.is-closing`, the next open jumps from the closing scale instead of the resting pre-open scale.
- **Forgetting the reflow** in the text swap, number pop-in, success check replay, and error state shake, `void el.offsetWidth` (or `offsetHeight`) between class/attribute removal and re-addition is what guarantees the animation replays.
- **Animating a single container** instead of the inner pieces, for the badge, animate the dot, not the trigger; for page slide, animate the page sections, not the container.
- **Replacing `transition: …` with `transition: all`**, every snippet enumerates exact properties on purpose so unrelated style changes don't ride in for free.
- **Hardcoding the success check's `stroke-dasharray`**, the snippet ships `20` as a placeholder. Replace it with `path.getTotalLength()` rounded up by 1 for *your* path, otherwise the stroke pre-reveals or over-draws.
- **Setting `transition-timing-function` in CSS** for the avatar group hover, it has to be set inline in JS *before* the `--shift` / `--scale-active` writes so the bouncy ease-out only applies on `mouseleave`.
- **Mixing `.is-error` and `.is-shaking` into one class** for the error state shake, keeping them orthogonal is what allows the shake to replay (remove → reflow → re-add) without flickering the whole error treatment.
- **Leaving the input clear glow on `mix-blend-mode: multiply` in dark mode**, flip to `screen`, bump `--glow-opacity` to ~0.85, and paint white gradients in JS.
- **Forgetting to write the tabs pill's first position without a transition**, on first paint and resize, set `transform` + `width` with `transition: none` (then reflow + restore) or the pill animates in from `translateX(0)` / `width: 0`.
- **Tracking the pointer on the tilting element itself** for card hover tilt, bind `pointermove` to the flat outer `.t-tilt` wrapper, not `.t-tilt-card`, or the rotating edges slip under the cursor and the hover flickers.
- **Padding on the accordion grid track**, put padding on `.t-acc-panel-inner`, never on `.t-acc-panel`; padding on the `0fr` track leaves a residual height strip so the panel never fully closes.
- **Morphing the accordion chevron's `d` path**, CSS `d:` path interpolation is Chromium-only, so it never animates on mobile Safari / Firefox. Flip the chevron vertically (`transform: scaleY(-1)`) instead, it passes through a flat line at the midpoint just like the path morph and works everywhere. Keep the path symmetric about its viewBox centre and add `vector-effect: non-scaling-stroke` so the stroke stays constant through the flip. This is what the snippet ships.
