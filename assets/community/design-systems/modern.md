# Modern (transitions.dev)

The look of the transitions.dev prototypes and the Refine tool: quiet neutral surfaces, soft layered shadows instead of borders, pill-shaped controls, Inter at small sizes, and one blue accent used sparingly. Interfaces feel light, precise and calm; motion does the talking.

## Color

Use the stage variables for every color. They are this palette, in light and dark:

| Role | Variable | Light | Dark |
| --- | --- | --- | --- |
| Page / stage | `--stage-bg` | #f9f9f9 | #131313 |
| Surface (cards, menus, panels) | `--stage-surface` | #ffffff | #1d1d1d |
| Text | `--stage-fg` | #0d0d0d | #f2f2f2 |
| Secondary text, icons | `--stage-muted` | #6c6c6c | rgba(202,202,202,.7) |
| Hairlines | `--stage-border` | rgba(0,0,0,.08) | rgba(255,255,255,.08) |
| Accent (the CTA: primary buttons, selection, focus) | `--stage-accent` | #17181c | #ffffff |
| Text on accent | `--stage-on-accent` | #ffffff | #0d0d0d |

Extra tokens: define these on `:root` and override them under `html[data-theme="dark"]` when used.

- Gray areas: `rgba(0,0,0,.02)`; dark `rgba(255,255,255,.03)`. Always transparent colors for darker or lighter surfaces, never a solid gray hex.
- Chip / quiet button fill: `--chip: rgba(0,0,0,.04)` (hover .06, pressed .08); dark `rgba(255,255,255,.07)` (hover .10, pressed .08).
- Skeleton: `rgba(0,0,0,.06)`; dark `rgba(238,238,239,.1)`.
- Accent soft (badges, selected rows): a blue wash, `rgba(0,115,229,.06)` with `rgba(0,83,227,.8)` text; dark `rgba(0,115,229,.16)` with `rgba(122,168,255,.95)`. Blue is for these soft accents and links, never for the primary button.

The accent is for one primary action, a selection or a focus ring, never for large areas. Most UI is neutral.

## Type

- Family: Inter Variable 4.0 (rsms.me/inter), inherited from the stage with optical sizing on; never set font-family. Body text is 400. Numbers that change use `font-variant-numeric: tabular-nums`.
- Scale (size / line height / weight): extra large 60/70/500 (special cases only: a hero temperature, price or balance), display large 40/48/500, display 28/34/500, title 16/22/500, subtitle and card titles 15/20/500, body (labels, menu items, buttons, paragraphs) 13/20/400, caption (descriptions, meta rows) 12/16/400. Button and badge labels use 500.
- Two weights (400, 500), two text colors (`--stage-fg`, `--stage-muted`), one paragraph style.
- No uppercase, no letter-spacing, no eyebrows, no opacity on text.

## Shape and spacing

- Spacing: 8, 12, 16, 24 and 32px (6px between an icon and its label inside a button, 8px outside one).
- Radii: controls are pills (`border-radius: 40px`); menu items 8px; menus and popovers 12px; cards and panels 24px with 24px padding (smaller cards scale both down); small chips 6px. Nested radii are concentric (outer = inner + padding).
- Control heights: 36px buttons and inputs, 32px menu items and compact buttons, 28px chips.

## Surfaces and depth

Prefer layered shadows to borders.

- Material (menus, popovers, floating cards): `background: var(--stage-surface); box-shadow: 0 4px 42px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.05), 0 0 0 1px rgba(0,0,0,.06);` In dark: `0 1px 3px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.04), inset 0 0 0 1px rgba(196,196,196,.08)`.
- Resting card: `box-shadow: 0 0 0 1px rgba(0,0,0,.04), 0 8px 32px -4px rgba(0,0,0,.06), 0 1px 3px 0 rgba(0,0,0,.04)`. When an edge effect wraps the card (VoiceBeam, BorderBeam), the outer wrapper is the card (surface background, radius, this exact shadow, `display: grid`), the effect sits 1px under the ring (`margin: -1px`, radius +1px) with a transparent element inside, and at rest VoiceBeam keeps its soft default idle glow (never `paused`; after speaking it runs `processing`, then settles back to idle) while BorderBeam is `paused`; no extra ring, never split or change the shadow.
- Hairline dividers: 1px, about half as strong as the border (`color-mix(in srgb, var(--stage-border) 49%, transparent)`), fading out toward both ends.
- Top and bottom bars inside a card: the same padding from their outer edge as from the sides, 16px all round, even when the card body uses 24px.

## Components

- Primary button (the CTA): pill, 36px tall, padding 0 12px (an icon at either end takes 2px off its side: 10px next to a 16px icon, so `0 12px 0 10px` with a leading icon and `0 10px 0 12px` with a trailing one; menu items with an icon go from 8px to 6px on that side), icon and label 6px apart, 13px/20px weight 500, accent fill (ink, white in dark) with `--stage-on-accent` text and the CTA drop shadow `0 1px 2px 0 rgba(0,0,0,.2)` (dark `0 1px 2px 0 rgba(0,0,0,.4)`). Hover a touch lighter, press scales to 97%.
- Secondary button: pill, `--chip` fill, `--stage-fg` text, no border.
- Icon button: 32px circle, transparent, chip fill on hover. Icons are 16px, 1.5px strokes, rounded caps and joins, `currentColor`.
- Raised button (a large round control that sits on a surface: a mic, a play button, the Builder's + button): `--stage-surface` fill, `box-shadow: 0 1px 3px 0 rgba(0,0,0,.04), inset 0 0 0 1px rgba(0,0,0,.08), inset 0 -1px 0 0 rgba(0,0,0,.08)`; dark: `0 1px 1px 0 rgba(0,0,0,.24), inset 0 0 0 1px rgba(255,255,255,.04), inset 0 1px 0 0 rgba(255,255,255,.06)` on `rgba(255,255,255,.04)`. Hover adds 2% ink. A transparent or chip-filled round control keeps this shadow; one drawn by liquid-gooey gets it through Liquid's `shadow` prop (it takes inset layers) with `fill="#fff"`.
- Input: 36px, radius 10px, surface fill, `0 0 0 1px` hairline shadow, accent ring on focus (`0 0 0 3px` accent soft plus 1px accent).
- Menu: material surface, radius 12px, padding 6px, items 32px tall with radius 8px and chip fill on hover.
- Tabs / segmented control: chip track with a surface pill indicator that slides between options.
- Toggle: 32 by 20 track, chip off, accent on, white knob with a soft shadow.
- Press feedback: a press dips the instant it starts (`:active { transform: scale(var(--press-scale)); transition-duration: 0ms }`) and eases back to 100% over 150ms on release, so even a quick click shows the whole press. The depth follows the size, so the travel is always visible (about 1 to 2px): wide buttons and clickable cards (200px and wider) 99%, regular and pill buttons 97%, round and icon buttons up to 64px (mic, play, send, close) 95%.
- Focus: visible ring `0 0 0 2px var(--stage-surface), 0 0 0 4px var(--stage-accent)`.

## Motion

- Durations: 150ms small feedback, 250ms menus and toggles, 350ms to 400ms panels and modals, 500ms large reveals. Exits are faster than enters (about 60%).
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (smooth out) by default; `cubic-bezier(0.34, 1.36, 0.64, 1)` for a light bounce on playful confirmations.
- Enter from small offsets (4px to 8px), scale .96 to .99 and a 2px to 8px blur; never slide whole screens.
- Every state change animates (the transitions.dev patterns); reduced motion keeps opacity only.
