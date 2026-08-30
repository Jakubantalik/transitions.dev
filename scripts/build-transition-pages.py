#!/usr/bin/env python3
"""Generate the crawlable per-transition pages under /transitions/.

The interactive detail view (detail.html?t=slug) builds everything client
side, so search engines only ever saw one URL for the whole library. This
script renders one static page per transition — real <h1>, description and
code — plus a hub page that links them all, and rewrites sitemap.xml.

Input is scripts/transitions-data.json, scraped from the running app (the
snippets there are the exact output of detail.html's own snippet builder).
Pro transitions are paywalled, so their pages carry the demo and the Pro
pitch but no source.

    python3 scripts/build-transition-pages.py
"""

import html
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "scripts", "transitions-data.json")
OUT_DIR = os.path.join(ROOT, "transitions")
SITE = "https://transitions.dev"

# Pages that already exist and should stay in the sitemap.
STATIC_PAGES = [
    ("/", "1.0", "weekly"),
    ("/pro.html", "0.9", "weekly"),
    ("/skill.html", "0.8", "monthly"),
    ("/refine.html", "0.8", "monthly"),
    ("/detail.html", "0.7", "weekly"),
    ("/transitions/", "0.9", "weekly"),
]

SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content="{description}" />
  <link rel="canonical" href="{canonical}" />
  <meta name="robots" content="index, follow" />

  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="Transitions.dev" />
  <meta property="og:title" content="{og_title}" />
  <meta property="og:description" content="{description}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:image" content="{SITE}/assets/og-main.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{og_title}" />
  <meta name="twitter:description" content="{description}" />
  <meta name="twitter:image" content="{SITE}/assets/og-main.jpg" />

  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <script type="application/ld+json">{jsonld}</script>

  <!-- Theme boot: same key the rest of the site uses, applied before
       paint so the page never flashes the wrong theme. -->
  <script>
    (function () {{
      try {{
        var stored = localStorage.getItem("tdev:theme");
        var dark = stored
          ? stored === "dark"
          : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
        if (dark) document.documentElement.setAttribute("data-theme", "dark");
      }} catch (e) {{}}
    }})();
  </script>
  <style>
    :root {{
      color-scheme: light;
      --bg: #fdfdfd;
      --text: #0d0d0d;
      --text-muted: #6c6c6c;
      --card-bg: #ffffff;
      --card-border: rgba(0, 0, 0, 0.06);
      --chip-bg: #f4f4f4;
      --code-bg: #f7f7f7;
      --font-sans: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      --font-mono: "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
    }}
    html[data-theme="dark"] {{
      color-scheme: dark;
      --bg: #121212;
      --text: #ffffff;
      --text-muted: rgba(202, 202, 202, 0.7);
      --card-bg: #181818;
      --card-border: rgba(255, 255, 255, 0.07);
      --chip-bg: rgba(255, 255, 255, 0.06);
      --code-bg: #181818;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
    }}
    .wrap {{ max-width: 720px; margin: 0 auto; padding: 24px 20px 96px; }}
    .topbar {{ display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 56px; }}
    .brand {{ font-size: 15px; font-weight: 500; color: var(--text); text-decoration: none; }}
    .brand span {{ color: var(--text-muted); }}
    .topbar nav {{ display: flex; gap: 16px; }}
    .topbar nav a {{ font-size: 13px; color: var(--text-muted); text-decoration: none; }}
    .topbar nav a:hover {{ color: var(--text); }}
    .crumb {{ font-size: 13px; color: var(--text-muted); margin: 0 0 12px; }}
    .crumb a {{ color: var(--text-muted); text-decoration: none; }}
    .crumb a:hover {{ text-decoration: underline; }}
    h1 {{ font-size: 32px; line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 8px; }}
    .lede {{ font-size: 16px; line-height: 24px; color: var(--text-muted); margin: 0 0 24px; }}
    .pro-pill {{
      display: inline-flex; align-items: center; height: 20px; padding: 0 8px; margin-left: 8px;
      border-radius: 50px; background: rgba(0, 115, 255, 0.06); color: #0073ff;
      font-size: 11px; font-weight: 500; vertical-align: middle;
    }}
    html[data-theme="dark"] .pro-pill {{ background: rgba(85, 207, 255, 0.14); color: #7cd4ff; }}
    .cta-row {{ display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 48px; }}
    .btn {{
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      height: 40px; padding: 0 16px; border-radius: 26px;
      font-size: 13px; font-weight: 500; text-decoration: none; white-space: nowrap;
      transition: background-color 200ms cubic-bezier(0.22, 1, 0.36, 1);
    }}
    .btn--primary {{ background: #17181c; color: #fff; box-shadow: 0 1px 2px 0 rgba(0,0,0,0.2); }}
    .btn--primary:hover {{ background: #2a2a2a; }}
    html[data-theme="dark"] .btn--primary {{ background: #fff; color: #0d0d0d; }}
    .btn--secondary {{ background: var(--chip-bg); color: var(--text); }}
    h2 {{ font-size: 15px; font-weight: 500; margin: 40px 0 12px; }}
    p {{ font-size: 14px; line-height: 22px; color: var(--text-muted); }}
    pre {{
      margin: 0; padding: 20px; border-radius: 16px; overflow-x: auto;
      background: var(--code-bg); border: 1px solid var(--card-border);
    }}
    code {{ font-family: var(--font-mono); font-size: 12.5px; line-height: 1.7; color: var(--text); }}
    .related {{ margin-top: 56px; padding-top: 24px; border-top: 1px solid var(--card-border); }}
    .related ul {{ list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }}
    .related a {{
      display: inline-flex; align-items: center; height: 32px; padding: 0 12px;
      border-radius: 48px; background: var(--chip-bg); color: var(--text);
      font-size: 13px; text-decoration: none;
    }}
    footer {{ margin-top: 56px; font-size: 13px; color: var(--text-muted); }}
    footer a {{ color: var(--text); text-decoration: none; }}
  </style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <a class="brand" href="/">Transitions<span>.dev</span></a>
      <nav>
        <a href="/transitions/">All transitions</a>
        <a href="/skill.html">Skill</a>
        <a href="/pro.html">Pro</a>
      </nav>
    </header>
{body}
  </div>
</body>
</html>
"""


def esc(s):
    return html.escape(s or "", quote=True)


def meta_desc(item):
    """Keep descriptions inside the ~155 char range search engines show."""
    base = f"{item['name']}: {item['sub']}."
    if item["pro"]:
        tail = " A Transitions Pro recipe with CSS, React and TypeScript variants."
    else:
        tail = " Copy-paste CSS and React, with reduced-motion support built in."
    out = base + tail
    return out[:157].rstrip()


def build_page(item, prev_item, next_item, related):
    slug, name, sub, pro = item["slug"], item["name"], item["sub"], item["pro"]
    canonical = f"{SITE}/transitions/{slug}/"
    title = f"{name} — CSS transition | Transitions.dev"
    desc = meta_desc(item)

    jsonld = {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        "headline": f"{name} — CSS transition",
        "description": desc,
        "url": canonical,
        "isPartOf": {"@type": "WebSite", "name": "Transitions.dev", "url": SITE + "/"},
        "author": {"@type": "Person", "name": "Jakub Antalik"},
    }
    if not pro:
        jsonld["hasPart"] = {
            "@type": "SoftwareSourceCode",
            "name": f"{name} CSS",
            "programmingLanguage": "CSS",
            "codeSampleType": "full solution",
        }

    parts = []
    parts.append('    <p class="crumb"><a href="/">Home</a> / <a href="/transitions/">Transitions</a></p>')
    pill = '<span class="pro-pill">Pro</span>' if pro else ""
    parts.append(f"    <h1>{esc(name)}{pill}</h1>")
    parts.append(f'    <p class="lede">{esc(sub)}</p>')

    parts.append('    <div class="cta-row">')
    parts.append(f'      <a class="btn btn--primary" href="/detail.html?t={esc(slug)}">Open the live demo</a>')
    if pro:
        parts.append('      <a class="btn btn--secondary" href="/pro.html">Get Transitions Pro</a>')
    else:
        parts.append('      <a class="btn btn--secondary" href="/skill.html">Install with the Skill</a>')
    parts.append("    </div>")

    if pro:
        parts.append("    <h2>About this transition</h2>")
        parts.append(
            f"    <p>{esc(name)} is part of Transitions Pro. {esc(sub)}. "
            "The full source ships as CSS, React and TypeScript variants, in the Pro skill "
            'and through the npm package. <a href="/pro.html">See what Pro includes</a>.</p>'
        )
    else:
        parts.append("    <h2>CSS</h2>")
        parts.append(
            "    <p>Namespaced classes and motion tokens you can retune. "
            "The reduced-motion guard ships with the snippet.</p>"
        )
        parts.append(f"    <pre><code>{esc(item['css'])}</code></pre>")
        if len(item.get("react") or "") > 50:
            parts.append("    <h2>React</h2>")
            parts.append("    <p>Self-contained component; the styles inject themselves on first import.</p>")
            parts.append(f"    <pre><code>{esc(item['react'])}</code></pre>")

    parts.append('    <div class="related">')
    parts.append("      <h2>More transitions</h2>")
    parts.append("      <ul>")
    for r in related:
        parts.append(f'        <li><a href="/transitions/{esc(r["slug"])}/">{esc(r["name"])}</a></li>')
    parts.append("      </ul>")
    parts.append("    </div>")

    nav_bits = []
    if prev_item:
        nav_bits.append(f'<a href="/transitions/{esc(prev_item["slug"])}/">&larr; {esc(prev_item["name"])}</a>')
    if next_item:
        nav_bits.append(f'<a href="/transitions/{esc(next_item["slug"])}/">{esc(next_item["name"])} &rarr;</a>')
    if nav_bits:
        parts.append(f'    <footer>{" &middot; ".join(nav_bits)}</footer>')

    return SHELL.format(
        title=esc(title),
        og_title=esc(f"{name} — Transitions.dev"),
        description=esc(desc),
        canonical=canonical,
        SITE=SITE,
        jsonld=json.dumps(jsonld),
        body="\n".join(parts),
    )


def build_hub(items):
    free = [i for i in items if not i["pro"]]
    pro = [i for i in items if i["pro"]]
    desc = (
        f"All {len(items)} transitions in the Transitions.dev library — "
        "modals, dropdowns, toasts, loaders and more, each with copy-paste CSS and React."
    )
    jsonld = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "All transitions",
        "description": desc,
        "url": f"{SITE}/transitions/",
    }

    parts = [
        '    <p class="crumb"><a href="/">Home</a> / Transitions</p>',
        "    <h1>All transitions</h1>",
        f'    <p class="lede">{len(items)} production-ready UI transitions. '
        "Every one ships namespaced CSS with motion tokens and a reduced-motion guard.</p>",
        '    <div class="related" style="margin-top:0;border:0;padding-top:0">',
        f"      <h2>Free ({len(free)})</h2>",
        "      <ul>",
    ]
    for i in free:
        parts.append(f'        <li><a href="/transitions/{esc(i["slug"])}/">{esc(i["name"])}</a></li>')
    parts += ["      </ul>", f"      <h2>Pro ({len(pro)})</h2>", "      <ul>"]
    for i in pro:
        parts.append(f'        <li><a href="/transitions/{esc(i["slug"])}/">{esc(i["name"])}</a></li>')
    parts += ["      </ul>", "    </div>"]

    return SHELL.format(
        title=esc("All CSS transitions | Transitions.dev"),
        og_title=esc("All transitions — Transitions.dev"),
        description=esc(desc[:157]),
        canonical=f"{SITE}/transitions/",
        SITE=SITE,
        jsonld=json.dumps(jsonld),
        body="\n".join(parts),
    )


def build_sitemap(items):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for path, prio, freq in STATIC_PAGES:
        lines += ["  <url>", f"    <loc>{SITE}{path}</loc>",
                  f"    <changefreq>{freq}</changefreq>",
                  f"    <priority>{prio}</priority>", "  </url>"]
    for i in items:
        lines += ["  <url>", f"    <loc>{SITE}/transitions/{i['slug']}/</loc>",
                  "    <changefreq>monthly</changefreq>",
                  "    <priority>0.7</priority>", "  </url>"]
    lines.append("</urlset>")
    return "\n".join(lines) + "\n"


def main():
    items = json.load(open(DATA))
    items = [i for i in items if i.get("slug")]
    os.makedirs(OUT_DIR, exist_ok=True)

    for idx, item in enumerate(items):
        prev_item = items[idx - 1] if idx > 0 else None
        next_item = items[idx + 1] if idx + 1 < len(items) else None
        # Six neighbours, wrapping, so every page passes link equity on.
        related = [items[(idx + n) % len(items)] for n in range(1, 7)]
        d = os.path.join(OUT_DIR, item["slug"])
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w") as f:
            f.write(build_page(item, prev_item, next_item, related))

    with open(os.path.join(OUT_DIR, "index.html"), "w") as f:
        f.write(build_hub(items))
    with open(os.path.join(ROOT, "sitemap.xml"), "w") as f:
        f.write(build_sitemap(items))

    print(f"{len(items)} transition pages + hub + sitemap written")


if __name__ == "__main__":
    main()
