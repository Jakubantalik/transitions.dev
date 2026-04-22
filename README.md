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

Each card has a copy button that emits a self-contained CSS snippet: semantic CSS custom properties on `:root`, the transition rules namespaced under `t-*` classes, and a `@media (prefers-reduced-motion: reduce)` guard — so you can paste the snippet into any project and apply it to any component without pulling in demo-specific markup or sizing.

## Files

- `index.html` — main showcase page with all nine transitions and per-card "copy CSS" buttons.
- `assets/` — icons, favicons, and the social-share OG image.
- `site.webmanifest`, `robots.txt`, `sitemap.xml` — PWA/SEO metadata.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/.
