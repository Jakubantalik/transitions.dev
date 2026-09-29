# Transitions.dev

Transitions.dev is an interactive collection of reusable CSS transitions. Each card on the index page demonstrates a different interaction pattern and ships a copy-ready, portable CSS snippet for each.

Live site: https://transitions.dev/

## Transitions

| # | Name | What it shows |
|---|------|---------------|
| 1 | **Card resize** | Smooth card resize transition. |
| 2 | **Number pop-in** | Digit flip with blur and stagger. |
| 3 | **Notification badge** | Diagonal slide with spring pop-in. |
| 4 | **Text states swap** | Text swap transition with blur. |
| 5 | **Menu dropdown** | Origin-aware open / close transition. |
| 6 | **Modal open / close** | Modal transition with scale. |
| 7 | **Panel reveal** | Panel open / close transition. |
| 8 | **Page side-by-side** | Forward / back page transition. |
| 9 | **Icon swap** | Scale and blur icon swap. |
| 10 | **Success check** | Confirmation icon with fade, rotate, blur, Y-bob, and SVG path draw. |
| 11 | **Avatar group hover** | Hovered avatar springs up while neighbours follow with a falloff. |
| 12 | **Error state shake** | Input shake on validation error with auto-revert to neutral. |

Each card has a copy button that emits a self-contained CSS snippet: semantic CSS custom properties on `:root`, the transition rules namespaced under `t-*` classes, and a `@media (prefers-reduced-motion: reduce)` guard — so you can paste the snippet into any project and apply it to any component without pulling in demo-specific markup or sizing.

## Install with the CLI (npm)

Pull any transition into your project from the terminal — no manual copy:

```bash
npx transitions-dev add card-resize      # free, no account needed
npx transitions-dev add --free           # every free transition at once
npx transitions-dev list                 # see everything available
```

Pro transitions unlock after a passwordless browser sign-in (device flow — no API key in your terminal):

```bash
npx transitions-dev login                # opens the browser to confirm a code
npx transitions-dev add confetti-burst    # pulls the Pro CSS + React
```

CLI source: [`cli/`](./cli) (published as the public `transitions-dev` package; `transitions-pro` is the old name and forwards to it — it holds no premium source; Pro recipes are fetched from the authenticated API).

## Use as an agent skill

The same transitions are packaged as an installable agent skill so AI coding tools (Cursor, Claude Code, Codex, …) can apply them directly inside your project.

```bash
npx skills add Jakubantalik/transitions.dev
```

Skill source lives in [`skills/transitions-dev/`](./skills/transitions-dev) — `SKILL.md`, eighteen per-transition reference files (`01-card-resize.md` … `18-texts-reveal.md`), and `_root.css` (the universal install block on its own).

The skill is generated from `index.html` so the snippets always match what the showcase site demonstrates. Re-run after editing the source site:

```bash
npm run build
```

`build/extract.mjs` parses `PROTO_TEMPLATES` and the `:root { --pX-* }` block out of `index.html`, then re-renders every file under `skills/transitions-dev/` from the templates in `build/templates/`.

## Refine tool

**Refine** is a live, agent-driven companion to the skill. One command drops a timeline + Refine panel onto your running app — no `npm install`, no source edits of your own — and every "Refine" click asks your coding agent to align the selected CSS/Motion transition to the transitions.dev motion tokens (or replace it with a transition from the library). Suggestions appear in a panel that slides in from the right; you pick which to apply as live, reversible overrides.

```bash
# inject the panel + start the local relay (deterministic suggestions work immediately)
npx transitions-refine live

# same, but also installs/wires the Cursor CLI so the relay answers with the LLM, persistently
npx transitions-refine live --llm

# remove the injected <script> tag again
npx transitions-refine stop
```

Without `--llm`, you can instead run `/refine live` in your editor to back the panel with the in-IDE agent. Source lives in [`refine/`](./refine) and ships as the public npm package `transitions-refine`. See [`refine/README.md`](./refine/README.md) for the full flow and env knobs.

## Files

- `index.html` — main showcase page with all eighteen transitions and per-card "copy CSS" buttons.
- `prototypes.html` — interactive playground for each transition with live tuning controls (durations, distances, easings).
- `skill.html` — landing page for the agent skill (install instructions + side-by-side compare embed).
- `example.html` — modal demo with a side-by-side "generic AI output" vs "with Transitions.dev skill" toggle, embedded inside `skill.html` as an iframe.
- `skills/transitions-dev/` — published skill payload (consumed by `npx skills add`).
- `refine/` — the **Refine** tool: a CLI that injects a live timeline + Refine panel and runs a local relay (published to npm as `transitions-refine`).
- `build/extract.mjs` + `build/templates/` — regenerator that keeps the skill in lockstep with `index.html`.
- `assets/` — icons, favicons, and the social-share OG image.
- `site.webmanifest`, `robots.txt`, `sitemap.xml` — PWA/SEO metadata.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/.
