---
name: transitions-dev
description: Production-ready CSS transitions for web apps. Use when implementing notification badges, dropdowns, modals, panel reveals, page transitions, card resizes, number pop-ins, text swaps, icon swaps, success checks, avatar group hovers, error state shakes, search/input clear, skeleton loaders, shimmer text, sliding tabs, tooltips, staggered text reveals, card hover tilt, plus-to-menu morph, accordions, toasts, like buttons, learn-more hovers, checkbox checks, spinning counters, or toggles. Triggers on "add a transition", "animate the dropdown", "make the modal open smoothly", "swap icon", "page slide", "stagger animation", "open / close transition", "make it animate", "fade between", "success animation", "form error", "shake on invalid", "hover lift", "avatar stack hover", "clear the search", "skeleton loader", "loading shimmer", "shimmer text", "sliding tabs", "segmented control", "tooltip", "reveal text", "tilt card", "3D hover tilt", "cursor glare", "plus to menu", "FAB morph", "accordion", "collapsible", "expand / collapse", "disclosure", "toast", "snackbar", "like button", "heart animation", "learn more arrow", "checkbox", "check animation", "spinning counter", "odometer", "slot machine digits", "toggle", "switch". Also "motion tokens", "scan for ad-hoc transitions", "replace hardcoded durations with motion tokens", "tokenize my animations", and the commands transitions reveal, transitions review, transitions apply, transitions refine.
---

# Transitions.dev

Twenty-seven portable CSS transitions, each namespaced under `t-*` selectors with semantic CSS custom properties. Drop-in: paste the snippet, wire the documented HTML hooks, done. No framework dependencies, no demo-specific markup, and every snippet ships a `prefers-reduced-motion` guard.

## Quick reference

| Transition | When to use | Reference |
| --- | --- | --- |
| **Card resize** | Tween a container's width or height when its layout state changes. | [01-card-resize.md](./01-card-resize.md) |
| **Number pop-in** | Re-enter each digit with a blurred slide when a number updates. | [02-number-pop-in.md](./02-number-pop-in.md) |
| **Notification badge** | Slide a small badge onto a trigger and pop the dot. | [03-notification-badge.md](./03-notification-badge.md) |
| **Text states swap** | Swap text in place with a blurred up-and-down transition. | [04-text-states-swap.md](./04-text-states-swap.md) |
| **Menu dropdown** | Open an origin-aware dropdown that grows from its trigger. | [05-menu-dropdown.md](./05-menu-dropdown.md) |
| **Modal open / close** | Scale-up modal dialog with a softer scale-down on close. | [06-modal.md](./06-modal.md) |
| **Panel reveal** | Slide a panel into a region with a cross-blur. | [07-panel-reveal.md](./07-panel-reveal.md) |
| **Page side-by-side** | Slide between two side-by-side pages (list ↔ detail, step 1 ↔ step 2). | [08-page-side-by-side.md](./08-page-side-by-side.md) |
| **Icon swap** | Cross-fade two icons in the same slot with blur and scale. | [09-icon-swap.md](./09-icon-swap.md) |
| **Success check** | Compose fade + rotate + Y-bob + path stroke-draw to celebrate a completed action. | [10-success-check.md](./10-success-check.md) |
| **Avatar group hover** | Distance-falloff lift on a row of items with a bouncy spring on return. | [11-avatar-group-hover.md](./11-avatar-group-hover.md) |
| **Error state shake** | Per-segment cubic-bezier shake with auto-reverting border + message. | [12-error-state-shake.md](./12-error-state-shake.md) |
| **Input clear with dissolve** | Fly-out + per-word streak when a text field is cleared. | [13-input-clear-dissolve.md](./13-input-clear-dissolve.md) |
| **Skeleton loader and reveal** | Pulse a placeholder, then cross-fade + cross-blur to the loaded content. | [14-skeleton-reveal.md](./14-skeleton-reveal.md) |
| **Shimmer text** | Sweep a highlight band across muted text on a loop (pure CSS). | [15-shimmer-text.md](./15-shimmer-text.md) |
| **Tabs sliding** | Slide the active pill between tabs in a segmented control. | [16-tabs-sliding.md](./16-tabs-sliding.md) |
| **Tooltip open/close** | Delayed fade+scale in, instant out (pure CSS). | [17-tooltip.md](./17-tooltip.md) |
| **Texts reveal** | Staggered blurred rise for stacked text lines, quiet fade out. | [18-texts-reveal.md](./18-texts-reveal.md) |
| **Card hover tilt** | Tilt a card in 3D toward the pointer with a cursor-tracked glare. | [19-card-tilt.md](./19-card-tilt.md) |
| **Plus to menu morph** | Morph a circular trigger into the menu / panel it opens. | [20-plus-menu-morph.md](./20-plus-menu-morph.md) |
| **Accordion expand** | Grow / shrink a panel via grid-rows with a chevron flip. | [21-accordion.md](./21-accordion.md) |
| **Toast open / close** | Rise a toast from below with fade + cross-blur, slower in than out. | [22-toast.md](./22-toast.md) |
| **Like button** | Fill a heart with a pop + particle burst on like. | [23-like-button.md](./23-like-button.md) |
| **Learn more hover** | Slide the chevron and spread its arms into an arrow on hover. | [24-learn-more-hover.md](./24-learn-more-hover.md) |
| **Checkbox check** | Fill the box, then stroke-draw the checkmark. | [25-checkbox-check.md](./25-checkbox-check.md) |
| **Spinning counter** | Spin slot-machine digit reels with vertical motion blur. | [26-spinning-counter.md](./26-spinning-counter.md) |
| **Toggle** | Travel the switch thumb with a double-bounce overshoot. | [27-toggle.md](./27-toggle.md) |

## Decision rules

When the user asks for a transition, match against the visible UI element first, then the verb:

- **Trigger + small dot floating on top** → notification badge.
- **Trigger + surface that grows from it** → dropdown (anchored, origin-aware) or modal (centered, no anchor).
- **Surface that slides into a region of the page** → panel reveal.
- **Two screens, list ↔ detail or step 1 ↔ step 2** → page side-by-side.
- **Element changes width or height** → card resize.
- **Element's text content changes in place** → text states swap.
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
- **Transient message that slides in over the page and leaves on its own** (saved / undo / error notice) → toast open / close.
- **Affordance that celebrates being activated** (heart, star, upvote, bookmark) → like button.
- **Inline link or button whose arrow should lean into the direction it goes** (read more, next step, see all) → learn more hover.
- **Box that fills and draws a mark when selected** (checkbox, terms opt-in, multi-select row) → checkbox check.
- **Number that rolls between values like a counter** (view count, score, live total) → spinning counter. For a number that simply updates in place, use number pop-in.
- **Binary on / off control with a travelling thumb** (settings switch, feature flag, notification preference) → toggle.
- **No clear match** → fall back to `transitions reveal` and let the user pick. Don't guess.

If two transitions could fit, prefer the lower-overhead one (card resize over panel reveal, dropdown over modal, success check over a full modal celebration) unless the design clearly calls for the heavier surface. The success check is animation-only — if you also need to swap from a spinner to the check, pair it with **icon swap**.

## Commands

The skill exposes four namespaced verbs the agent should recognise in addition to direct transition requests. Every command starts with `transitions` so the invocation never collides with verbs from other skills installed in the same project.

### transitions reveal — list every transition

**Trigger phrases:** `transitions reveal`, "reveal the transitions", "list all transitions", "what transitions are in this skill", "show the transitions catalog".

**Behaviour:** print the twenty-seven transitions as a numbered plain-text list — name, one-line summary, and the matching reference filename. Reuse the rows in `## Quick reference` above; do not invent new copy. No project access.

### transitions review — audit the project for fit

**Trigger phrases:** `transitions review`, "review my project", "audit my animations", "where would transitions.dev help", "find places to use this skill".

**Behaviour:**

1. Search the workspace for indicators: `transition:` declarations, `@keyframes`, hardcoded `ms` / `s` durations in style files, components matching the decision-rule patterns (modals, dropdowns, badges, search inputs, skeletons, tabs, tooltips, …).
2. For each hit, match against the decision rules and pick the single best-fit transition.
3. Output a numbered list grouped by file:
   - `path/to/Component.tsx:L42` — looks like a dropdown opening, suggest **menu-dropdown** (`05-menu-dropdown.md`).
   - Skip ad-hoc transitions that already use a `t-*` class.
4. Do not edit anything. End with: "Run `transitions apply` on any line to install the suggested transition."

### transitions apply — install the best-fit transition

**Trigger phrases:** `transitions apply`, "apply a transition here", "add the right transition", "install transitions-dev here", "fix the animation on this element".

**Behaviour:**

1. Read context: the currently-open file, the element nearest the cursor, surrounding CSS / JSX. If the user named a transition explicitly (e.g. `transitions apply menu-dropdown`), use it.
2. Run the decision rules from `## Decision rules` on that context and pick **one** transition. If two could fit, prefer the lower-overhead one (same tie-breaker the existing rules use).
3. Surface a one-line proposal: "I'd apply **menu-dropdown** here because the element opens from a trigger and is anchored. Confirm to install?".
4. On confirmation, follow the existing five-step procedure in `## Output format` verbatim (root block, snippet, hooks, reduced-motion guard, JS orchestration if needed).
5. If the agent can't pick a single transition with confidence, fall back to `transitions reveal` and ask the user to choose.

### transitions refine — replace ad-hoc motion with the motion tokens

**Trigger phrases:** `transitions refine`, "refine my transitions", "scan for ad-hoc transitions", "replace hardcoded durations with motion tokens", "tokenize my animations", "tune the durations / easing", "audit my custom keyframes", "make the timing consistent", "align to the motion tokens".

**Behaviour:**

1. **Scan the whole project** (not just dedicated stylesheets — also inline `style=` / CSS-in-JS, styled-components, `<style>` blocks, Tailwind arbitrary values like `duration-[300ms]`) for ad-hoc motion: `transition` / `animation` shorthands and longhands, custom `@keyframes` blocks, hardcoded durations (`…ms` / `…s`), easing (`cubic-bezier(...)` or keywords), translate distances (`px`), `scale(...)`, and `blur(...)`.
2. For each value, infer **what the motion does** (modal close, dropdown open, tooltip, badge appear, text reveal, page slide, shake, …) from the surrounding selectors / component plus the `## Decision rules`. For a `@keyframes` block, read the `animation` that drives it and judge the keyframes' own duration/easing.
3. **The key decision point is usage, not the raw number.** Look the inferred usage up in `## Motion tokens` and suggest the token whose documented usage matches — only when the usages line up. A 300ms modal close maps to `--duration-quick` because both are "modal close", even though the numbers differ. If a value's usage matches **no** token's usage, list it as `no matching token usage` and leave it untouched — never force a swap just because a number is close.
4. Output a numbered list grouped by file, showing only values that should change, each as `path/to/Component.css:L42` — `modal close: 300ms → var(--duration-quick) (150ms)`, `ease → var(--ease-smooth-out)`. For keyframe-driven motion, suggest the token for the driving `animation`'s duration/easing.
5. Do not edit anything. End with: "Confirm any line to apply the change, or run `transitions apply` to install a full transition instead."

## Motion tokens

The shared motion scale behind the twenty-seven transitions — the same tokens the [transitions.dev](https://transitions.dev) Motion tokens tab exposes. They ship at the top of [`_root.css`](./_root.css), so once it's imported you can reference any of them as `var(--…)` (e.g. `transition: transform var(--duration-fast) var(--ease-smooth-out)`).

`transitions refine` maps each existing value to a usage below, then suggests the token to reference. Match on **usage**, not on the raw number — a 300ms modal close still maps to `--duration-quick` (150ms).

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

## Universal install

Copy [`_root.css`](./_root.css) into your project **once** and import it (or paste its `:root` block into your global stylesheet). It leads with the shared **motion-token scale** (`--duration-*`, `--ease-*`, `--distance-*`, `--scale-*`, `--blur-*` — see `## Motion tokens`), followed by the semantic tunable variables for **all twenty-seven** transitions. Every snippet reads from these names — `--resize-*`, `--badge-*`, `--dropdown-*`, `--clear-*`, `--shimmer-*`, `--tabs-*`, `--tt-*`, `--stagger-*`, `--tilt-*`, `--morph-*`, `--acc-*`, and the rest.

Each reference file also restates just the variables that snippet needs, so you can install a single transition without pulling the whole block. Don't duplicate the block — if `_root.css` is already imported, skip re-pasting any per-snippet `:root`.

The `--pX-*` source tokens used by the live demo at [transitions.dev](https://transitions.dev) are intentionally **not** exported. Tunable values are renamed to semantic names so the user owns the design vocabulary. A few transitions (input clear, shimmer text, tabs, tooltip) carry **color** tokens that differ by theme — each reference file documents the `html[data-theme="dark"]` overrides.

## Output format

When inserting a transition into the user's project:

1. **Install the variables from `_root.css`** into the user's global stylesheet, but only if they aren't already there — or just the per-snippet `:root` block from the reference file if installing a single transition. If the universal block is already imported, do **not** duplicate it.
2. **Paste the chosen transition's CSS verbatim** from the relevant reference file. Do not rewrite selectors, do not collapse the transition into shorthand, do not strip `will-change`. The snippets are tuned and tested.
3. **Wire the documented HTML hooks** — class names (`.t-dropdown`, `.t-modal`, `.t-success-check`, `.t-avatar`, `.t-clear`, `.t-skel`, `.t-shimmer`, `.t-tabs`, `.t-tt`, `.t-stagger`, `.t-tilt`, `.t-morph`, `.t-acc`, …) and state attributes (`data-open`, `data-state`, `data-page`, `data-origin`, `aria-selected`, `aria-expanded`, `.is-open`, `.is-closing`, `.is-error`, `.is-shaking`, `.has-value`, `.is-clearing`, `.is-pulsing`, `.is-revealed`, `.is-shown`, `.is-hiding`, `.is-hover`, `.is-tilting`).
4. **Preserve the `@media (prefers-reduced-motion: reduce)` block.** Every snippet ships one. Removing it makes the component fail accessibility audits.
5. **For transitions that need JS** (dropdown, modal, text swap, number pop-in, page slide, success check, avatar group hover, error state shake, input clear, skeleton reveal, tabs sliding, texts reveal, card hover tilt, plus → menu morph, accordion expand), copy the small orchestration snippet from the reference file and adapt the selectors to the user's DOM. Keep the timing reads (`getComputedStyle(...)getPropertyValue("--…")`) so durations stay in sync with the `:root` values. Shimmer text and tooltip are **pure CSS** — no JS needed.

Keep the diff small: only edit the files needed to introduce the transition. Don't rename the user's existing variables, don't reformat unrelated CSS, don't pull in a motion library.

## Common mistakes to avoid

- **Stripping the close-state class cleanup** on dropdown/modal — without the `setTimeout` that removes `.is-closing`, the next open jumps from the closing scale instead of the resting pre-open scale.
- **Forgetting the reflow** in the text swap, number pop-in, success check replay, and error state shake — `void el.offsetWidth` (or `offsetHeight`) between class/attribute removal and re-addition is what guarantees the animation replays.
- **Animating a single container** instead of the inner pieces — for the badge, animate the dot, not the trigger; for page slide, animate the page sections, not the container.
- **Replacing `transition: …` with `transition: all`** — every snippet enumerates exact properties on purpose so unrelated style changes don't ride in for free.
- **Hardcoding the success check's `stroke-dasharray`** — the snippet ships `20` as a placeholder. Replace it with `path.getTotalLength()` rounded up by 1 for *your* path, otherwise the stroke pre-reveals or over-draws.
- **Setting `transition-timing-function` in CSS** for the avatar group hover — it has to be set inline in JS *before* the `--shift` / `--scale-active` writes so the bouncy ease-out only applies on `mouseleave`.
- **Mixing `.is-error` and `.is-shaking` into one class** for the error state shake — keeping them orthogonal is what allows the shake to replay (remove → reflow → re-add) without flickering the whole error treatment.
- **Leaving the input clear glow on `mix-blend-mode: multiply` in dark mode** — flip to `screen`, bump `--glow-opacity` to ~0.85, and paint white gradients in JS.
- **Forgetting to write the tabs pill's first position without a transition** — on first paint and resize, set `transform` + `width` with `transition: none` (then reflow + restore) or the pill animates in from `translateX(0)` / `width: 0`.
- **Tracking the pointer on the tilting element itself** for card hover tilt — bind `pointermove` to the flat outer `.t-tilt` wrapper, not `.t-tilt-card`, or the rotating edges slip under the cursor and the hover flickers.
- **Padding on the accordion grid track** — put padding on `.t-acc-panel-inner`, never on `.t-acc-panel`; padding on the `0fr` track leaves a residual height strip so the panel never fully closes.
- **Morphing the accordion chevron's `d` path** — CSS `d:` path interpolation is Chromium-only, so it never animates on mobile Safari / Firefox. Flip the chevron vertically (`transform: scaleY(-1)`) instead — it passes through a flat line at the midpoint just like the path morph and works everywhere. Keep the path symmetric about its viewBox centre and add `vector-effect: non-scaling-stroke` so the stroke stays constant through the flip. This is what the snippet ships.

## Reference files

- [01-card-resize.md](./01-card-resize.md) — Card resize
- [02-number-pop-in.md](./02-number-pop-in.md) — Number pop-in
- [03-notification-badge.md](./03-notification-badge.md) — Notification badge
- [04-text-states-swap.md](./04-text-states-swap.md) — Text states swap
- [05-menu-dropdown.md](./05-menu-dropdown.md) — Menu dropdown
- [06-modal.md](./06-modal.md) — Modal open / close
- [07-panel-reveal.md](./07-panel-reveal.md) — Panel reveal
- [08-page-side-by-side.md](./08-page-side-by-side.md) — Page side-by-side
- [09-icon-swap.md](./09-icon-swap.md) — Icon swap
- [10-success-check.md](./10-success-check.md) — Success check
- [11-avatar-group-hover.md](./11-avatar-group-hover.md) — Avatar group hover
- [12-error-state-shake.md](./12-error-state-shake.md) — Error state shake
- [13-input-clear-dissolve.md](./13-input-clear-dissolve.md) — Input clear with dissolve
- [14-skeleton-reveal.md](./14-skeleton-reveal.md) — Skeleton loader and reveal
- [15-shimmer-text.md](./15-shimmer-text.md) — Shimmer text
- [16-tabs-sliding.md](./16-tabs-sliding.md) — Tabs sliding
- [17-tooltip.md](./17-tooltip.md) — Tooltip open/close
- [18-texts-reveal.md](./18-texts-reveal.md) — Texts reveal
- [19-card-tilt.md](./19-card-tilt.md) — Card hover tilt
- [20-plus-menu-morph.md](./20-plus-menu-morph.md) — Plus to menu morph
- [21-accordion.md](./21-accordion.md) — Accordion expand
- [22-toast.md](./22-toast.md) — Toast open / close
- [23-like-button.md](./23-like-button.md) — Like button
- [24-learn-more-hover.md](./24-learn-more-hover.md) — Learn more hover
- [25-checkbox-check.md](./25-checkbox-check.md) — Checkbox check
- [26-spinning-counter.md](./26-spinning-counter.md) — Spinning counter
- [27-toggle.md](./27-toggle.md) — Toggle
- [_root.css](./_root.css) — the universal install block on its own, ready to import directly.
