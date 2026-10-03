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
| Accent | `--stage-accent` | #0073e5 | #55cfff |
| Text on accent | `--stage-on-accent` | #ffffff | #04131a |

Extra tokens: define these on `:root` and override them under `html[data-theme="dark"]` when used.

- Chip / quiet button fill: `--chip: #f4f4f4` (hover #f1f1f1, pressed #eae9e9); dark `rgba(255,255,255,.07)` (hover .10, pressed .08).
- Skeleton: `#eeeeef`; dark `rgba(238,238,239,.1)`.
- Accent soft (selected rows, focus wash): `rgba(0,115,229,.09)`; dark `rgba(85,207,255,.12)`.

The accent is for one primary action, a selection or a focus ring, never for large areas. Most UI is neutral.

## Type

- Family: inherited from the stage (Inter). Numbers that change use `font-variant-numeric: tabular-nums`.
- Scale: 11px/14px caption, 12px/16px small, 13px/16px UI default (buttons, menu items, inputs), 14px/20px body, 15px/20px emphasized label, 18px/24px title, 24px/30px display.
- Weights: 400 for text, 500 for labels, buttons and titles. Never bold (700) in UI.
- Letter spacing: 0 for UI text, -0.01em on 18px and up.
- Secondary text uses `--stage-muted`, not a lighter weight.

## Shape and spacing

- Spacing on a 4px grid: 4, 6, 8, 12, 16, 20, 24, 32.
- Radii: controls are pills (`border-radius: 40px`); menu items 8px; menus and popovers 12px; cards and panels 16px to 20px; small chips 6px. Nested radii are concentric (outer = inner + padding).
- Control heights: 36px buttons and inputs, 32px menu items and compact buttons, 28px chips.

## Surfaces and depth

Prefer layered shadows to borders.

- Material (menus, popovers, floating cards): `background: var(--stage-surface); box-shadow: 0 4px 42px rgba(0,0,0,.06), 0 2px 6px rgba(0,0,0,.05), 0 0 0 1px rgba(0,0,0,.06);` In dark: `0 1px 3px rgba(0,0,0,.04), inset 0 1px 0 rgba(255,255,255,.04), inset 0 0 0 1px rgba(196,196,196,.08)`.
- Resting card: `box-shadow: 0 1px 3px rgba(0,0,0,.04), 0 0 0 1px rgba(0,0,0,.06)`.
- Hairline dividers: 1px `--stage-border`.

## Components

- Primary button: pill, 36px tall, padding 0 14px, 13px/16px weight 500, accent fill with `--stage-on-accent` text.
- Secondary button: pill, `--chip` fill, `--stage-fg` text, no border.
- Icon button: 32px circle, transparent, chip fill on hover. Icons are 16px, 1.5px strokes, rounded caps and joins, `currentColor`.
- Input: 36px, radius 10px, surface fill, `0 0 0 1px` hairline shadow, accent ring on focus (`0 0 0 3px` accent soft plus 1px accent).
- Menu: material surface, radius 12px, padding 6px, items 32px tall with radius 8px and chip fill on hover.
- Tabs / segmented control: chip track with a surface pill indicator that slides between options.
- Toggle: 32 by 20 track, chip off, accent on, white knob with a soft shadow.
- Press feedback: `scale(.97)` on `:active` for buttons and cards.
- Focus: visible ring `0 0 0 2px var(--stage-surface), 0 0 0 4px var(--stage-accent)`.

## Motion

- Durations: 150ms small feedback, 250ms menus and toggles, 350ms to 400ms panels and modals, 500ms large reveals. Exits are faster than enters (about 60%).
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (smooth out) by default; `cubic-bezier(0.34, 1.36, 0.64, 1)` for a light bounce on playful confirmations.
- Enter from small offsets (4px to 8px), scale .96 to .99 and a 2px to 8px blur; never slide whole screens.
- Every state change animates (the transitions.dev patterns); reduced motion keeps opacity only.
