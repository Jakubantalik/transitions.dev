# Streaming text

## When to use

Model output arriving word by word — chat responses, AI completions, any streamed paragraph. JS wraps each word in a span; words rest visible, and a replay wipes them all, then resolves them in order through opacity plus a small blur, one every `--stream-gap`.

Reach for this over a typewriter effect when the text should feel like it condenses into place rather than being typed — the cross-blur reads as resolution, not keystrokes.

## HTML usage

```html
<div class="t-stream">Your streamed paragraph…</div>
```

JS wraps each word in a .t-stream-w span; spans rest visible.
To replay the stream: wipe every span with transition: none,
force one reflow, restore the transition, then add .is-in word
by word every --stream-gap — each word resolves through
opacity + a small blur over --stream-fade.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--stream-gap` | `60ms` | sourced from `--p30-word-gap` |
| `--stream-fade` | `350ms` | sourced from `--p30-word-dur` |
| `--stream-blur` | `1px` | sourced from `--p30-blur` |
| `--stream-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p30-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --stream-gap: 60ms;
  --stream-fade: 350ms;
  --stream-blur: 1px;
  --stream-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-stream-w {
  opacity: 0;
  filter: blur(var(--stream-blur));
  transition:
    opacity var(--stream-fade) var(--stream-ease),
    filter var(--stream-fade) var(--stream-ease);
}
.t-stream-w.is-in {
  opacity: 1;
  filter: blur(0);
}

@media (prefers-reduced-motion: reduce) {
  .t-stream-w { transition: none !important; filter: none !important; opacity: 1 !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Wrap each word in a span once; stream() wipes them (no transition)
// and resolves them in order, one every --stream-gap.
const block = document.querySelector(".t-stream");
const words = block.textContent.trim().split(/\s+/);
block.textContent = "";
const spans = words.map((w, i) => {
  const s = document.createElement("span");
  s.className = "t-stream-w is-in";
  s.textContent = w;
  block.appendChild(s);
  if (i < words.length - 1) block.appendChild(document.createTextNode(" "));
  return s;
});

const gap = parseFloat(
  getComputedStyle(document.documentElement).getPropertyValue("--stream-gap")
) || 60;

function stream() {
  // Snap back to nothing without animating the wipe itself.
  spans.forEach((s) => {
    s.style.transition = "none";
    s.classList.remove("is-in");
  });
  void block.offsetWidth; // flush the wipe
  spans.forEach((s) => { s.style.transition = ""; });
  (function next(n) {
    if (n >= spans.length) return;
    spans[n].classList.add("is-in");
    setTimeout(() => next(n + 1), gap);
  })(0);
}
```

