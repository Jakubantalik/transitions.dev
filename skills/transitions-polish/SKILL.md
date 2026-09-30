---
name: transitions-polish
license: Free for personal and commercial use; see LICENSE.txt (no redistribution of the library itself)
description: Polish and refine existing motion against the transitions.dev motion-token scale — duration, distance, scale, blur, and easing — plus the rules for WHEN each token applies (open/close asymmetry, hover-in vs hover-out, stagger offsets, and intent delays). An add-on to the transitions-dev skill, focused on tuning what already animates rather than adding new transitions. Use when the user asks to "polish my transitions", "refine the motion", "tune the timing / easing", "make the animation feel better / less janky", "tighten the durations", "fix the stagger", "align to the motion tokens", "audit the motion", "review my animations", "scan for ad-hoc transitions", "tokenize my animations", or runs the commands transitions review or transitions polish. Also drives the Refine panel's Small refinement feature. Triggers on "motion polish", "transition polish", "refine motion", "timing feels off", "too slow / too fast", "stagger", "delay", "open close timing", "hover in out".
---

# Transitions Polish

An **add-on** to the [`transitions-dev`](../transitions-dev/SKILL.md) skill. Where `transitions-dev` installs whole transitions, this skill **polishes motion that already exists**: it scans the five motion-token dimensions — **duration, distance, scale, blur, easing** — and suggests the token each value should reference, plus the higher-order rules for *when* a value is right (open/close asymmetry, hover in/out, stagger, delay).

Install it alongside `transitions-dev`, or on its own — the token values are restated below so this skill can audit a project standalone. When it is installed, the transitions.dev **Refine panel** automatically feeds these rules into every **Small refinement** job.

## Core doctrine: match on usage, never on the nearest number

A value is not "wrong" because it is off by 20ms. It is wrong when it does not fit **what the motion does**. Always infer the usage first — modal close, dropdown open, tooltip, badge appear, page slide, text reveal, shake — then pick the token whose documented usage matches. A `300ms` modal close maps to `--duration-quick` (150ms) because both are "modal close", even though the numbers differ. If a value's usage matches **no** token usage, leave it untouched. Never force a swap just because a number is close.

## The five dimensions

Same scale the [transitions.dev](https://transitions.dev) Motion tokens tab exposes. Copy this skill's [`_root.css`](./_root.css) into your project once; once imported, reference any token as `var(--…)`. The `transitions-dev` transitions ship literal values, so they work without these tokens — install this skill to tune them against the shared scale.

### Durations

| Token | Value | Usage |
| --- | --- | --- |
| `--duration-stagger` | `40ms` | per-item stagger offset |
| `--duration-micro` | `80ms` | tooltip/path delay, shake segment, large stagger |
| `--duration-quick` | `150ms` | modal/dropdown close, text swap, tooltip appear |
| `--duration-fast` | `250ms` | icon swap, dropdown/modal open, tabs sliding, page slide |
| `--duration-medium` | `350ms` | panel close, toast close |
| `--duration-slow` | `400ms` | panel open, skeleton content reveal, input clear |
| `--duration-very-slow` | `500ms` | emphasis moments, badge appear, text reveal, success check |

### Easings

| Token | Value | Usage |
| --- | --- | --- |
| `--ease-smooth-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | modal/dropdown/panel open + close, page slide, resize, position change |
| `--ease-in-out` | `ease-in-out` | icon swap, text swap, text reveal, skeleton reveal |
| `--ease-out` | `ease-out` | tooltip open / close |
| `--ease-linear` | `linear` | shimmer, skeleton pulse, spinner |
| `--ease-bounce` | `cubic-bezier(0.34, 1.36, 0.64, 1)` | badge pop open |
| `--ease-bounce-strong` | `cubic-bezier(0.34, 3.85, 0.64, 1)` | bouncy hover-out (avatar return) |

`--ease-smooth-out` is the default. Nudge generic `ease`, `ease-in`, or any hand-rolled `cubic-bezier(...)` / `linear(...)` toward it **only** for surface motion (open/close, slide, resize, position). Leave the other five token easings alone — they are already on-grid and each carries its own intent.

### Distances

| Token | Value | Usage |
| --- | --- | --- |
| `--distance-micro` | `4px` | text swap |
| `--distance-small` | `6px` | error shake (small segment) |
| `--distance-base` | `8px` | badge diagonal reveal, page slide, error shake (large segment) |
| `--distance-medium` | `12px` | text reveal |
| `--distance-large` | `30px` | check badge appear |

Travel distance scales *down* with frequency and *up* with ceremony: an in-place text swap barely moves (`4px`), a page slide travels a readable `8px`, a one-off celebratory badge can sweep `30px`. If a translate distance is larger than `~40px` for anything but a full panel/drawer, it usually reads as sluggish — pull it toward `--distance-base`.

### Scales

| Token | Value | Usage |
| --- | --- | --- |
| `--scale-large` | `0.96` | modal open / close |
| `--scale-medium` | `0.97` | dropdown open |
| `--scale-small` | `0.98` | tooltip open |
| `--scale-tiny` | `0.99` | dropdown close |

The captured value is the non-resting "pre" scale the surface animates *from*; it always settles to `1`. Bigger surfaces start from further away (`0.96` modal), small hints barely scale (`0.98`–`0.99`). A pre-scale below `~0.9` reads as a "zoom" and rarely fits UI chrome — snap it to the usage token.

### Blur

| Token | Value | Usage |
| --- | --- | --- |
| `--blur-small` | `2px` | panel reveal, icon swap, text swap, skeleton reveal, number pop-in |
| `--blur-medium` | `3px` | page slide, text reveal |
| `--blur-large` | `8px` | success check open |

Blur is the non-resting "pre" blur, settling to `0`. Use it to soften a swap or slide, never on a plain fade or a color/theme change. Blur can be **absent** as well as off-token: when the usage clearly calls for one (a page slide with no blur lane) suggest adding `--blur-medium`.

## Polish rules — when a value is right

### Open/close asymmetry

Opening is an invitation; closing should get out of the way. Closes are faster and quieter than opens.

- **Duration:** dropdown/modal **open 250ms → close 150ms** (`--duration-fast` → `--duration-quick`); panel **open 400ms → close 350ms** (`--duration-slow` → `--duration-medium`); toast **close 350ms** (`--duration-medium`).
- **Symmetric exceptions — same duration + easing both ways, do NOT split:** page side-by-side (250ms), tabs sliding (250ms), accordion (250ms), icon swap (250ms), text swap (150ms). These read as a single reversible motion, not an open/close pair.
- **Distance & blur:** the enter phase carries the distance and blur; the exit can drop or shrink them so a close doesn't fling content across the screen.
- **Easing:** most opens and closes share `--ease-smooth-out`. Overshoot curves belong to *entrances only* (badge pop, number pop-in) — never bounce a close.

### Hover in vs hover out

- **In:** quick and direct — a short `--duration-fast`-or-less lift with `--ease-smooth-out`.
- **Out:** softer and springier — the return can take longer and use `--ease-bounce-strong` (avatar return, `cubic-bezier(0.34, 3.85, 0.64, 1)`) so the row settles instead of snapping. This is the one place the *out* is more elaborate than the *in*.

### Stagger and delay

- **Stagger offset:** `--duration-stagger` (40ms) per item; step up to `--duration-micro` (80ms) for a few large items. Keep the **total** stagger (offset × item count) under ~300ms so the last item doesn't feel late — for long lists, cap the number of staggered items or shrink the offset.
- **Intent delay:** a tooltip waits `--duration-micro` (80ms) before appearing so a passing cursor doesn't trigger it; the success-check path draw uses the same 80ms beat. A delay is right when you want to *filter accidental triggers* or *sequence* two things — not to pad a slow animation.
- **Delay vs duration:** if motion feels late, prefer trimming the **duration** over adding delay. Reserve delay for stagger, intent gating, and deliberate sequencing.
- **Never delay a close** or a hover-out — dismissal must feel instant.

## Commands

The skill exposes two namespaced verbs. Every command starts with `transitions` so the invocation never collides with verbs from other skills installed in the same project. `review` reports; `polish` applies.

### transitions review — audit motion against the tokens

**Trigger phrases:** `transitions review`, "review my animations", "audit the motion", "scan for ad-hoc transitions", "tokenize my animations", "where are my durations off", "align to the motion tokens", "make the timing consistent".

**Behaviour:**

1. **Scan the whole project** — not just stylesheets, but inline `style=` / CSS-in-JS, styled-components, `<style>` blocks, and Tailwind arbitrary values (`duration-[300ms]`, `[transition-timing-function:...]`) — for all five dimensions: durations (`…ms`/`…s`), easings (`cubic-bezier(...)` / keywords), translate distances (`translate*(…px)`), `scale(...)`, and `blur(...)`. Read `@keyframes` via the `animation` that drives them.
2. For each value, infer **what the motion does** from the surrounding selectors / component names (modal close, dropdown open, tooltip, badge appear, page slide, text reveal, shake, hover lift, …). Look the usage up in the token tables above and pick the token whose documented usage matches — **usage first, never nearest number**. Do **not** suggest whole-transition recipe swaps; that is `transitions-dev`'s `transitions apply` domain.
3. Apply the **polish rules**: check open/close asymmetry, hover in/out, stagger totals, and delays — not just whether a single value is on-grid.
4. Output a numbered list grouped by file, showing only values that should change:
   - `path/to/Component.css:L42` — `modal close: 300ms → var(--duration-quick) (150ms)` — close should be quicker than the 250ms open.
   - `path/to/List.css:L20` — `stagger: 120ms → var(--duration-stagger) (40ms)` — 8 items × 120ms = 960ms total, last item feels late.
   - Skip values whose usage matches no token — list them as `no matching token usage` and leave them.
5. **Do not edit anything.** End with: "Run `transitions polish` to apply these changes, or confirm any line to apply individually."

### transitions polish — apply motion-token refinements

**Trigger phrases:** `transitions polish`, "polish my transitions", "refine the motion", "tune the timing / easing", "apply the motion tokens", "fix the stagger", "tokenize my animations".

**Behaviour:**

1. If the user has not run `transitions review` in this session, run the same scan from **transitions review** first (steps 1–4) to build the change list. If they named a specific file, line, or value, scope the scan to that context.
2. Surface a short proposal: how many values would change, grouped by file, with one example line. Ask for confirmation before editing.
3. On confirmation, **apply the token changes** to the source:
   - Replace hardcoded durations/easings/distances/scales/blur with `var(--…)` references where the project's `_root.css` (this skill's [`_root.css`](./_root.css)) is already imported; otherwise write the token's literal value and note that importing `_root.css` would let future tweaks happen in one place.
   - Keep the file's existing unit/format (`0.25s` vs `250ms`) unless switching to `var(--…)`.
   - Touch only the motion values being polished — no reformatting, no unrelated edits.
   - Handle plain CSS, CSS Modules, styled-components/emotion, Tailwind utilities/config, inline `style` objects, and Motion/Framer variants.
4. If `_root.css` is not yet in the project, offer to install it (once) before or alongside the polish pass.
5. Keep the diff small. End with a one-line summary of files touched.

## Relationship to the Refine panel

When this skill is installed in a project, the transitions.dev Refine panel's **Small refinement** tab automatically inlines the compact rules in [`_refine-rules.md`](./_refine-rules.md) into its agent prompt, so per-click suggestions honor these rules with zero extra file reads. `transitions review` mirrors that audit at project scale; `transitions polish` writes the accepted tweaks to source.

## Future expansion

Natural next additions to this skill: performance hygiene (`transition: all`, animating `width`/`top`/`box-shadow` instead of `transform`/`opacity`, `will-change` misuse), missing `prefers-reduced-motion` detection, a cross-project consistency audit (same-purpose transitions using different values), Tailwind/Framer token adapters, and a "motion polish score" report.
