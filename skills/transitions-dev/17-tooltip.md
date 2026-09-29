# Tooltip open/close

## When to use

A hover/focus tooltip shared by a group of triggers (toolbar buttons, icon rows, avatar stacks). It fades + scales in with a short appear-delay, disappears immediately on leave, and when the pointer moves to a neighbouring trigger while it is showing, the one bubble tweens its x-position and width to the new target instead of popping a second one. A small JS snippet measures the target and writes the geometry; CSS owns every tween.

## HTML usage

```html
<span class="t-tt-group">
  <button class="t-tt-trigger" data-tooltip="Copy link" aria-describedby="tt-1">…</button>
  <button class="t-tt-trigger" data-tooltip="Share" aria-describedby="tt-1">…</button>
  <span class="t-tt" id="tt-1" role="tooltip" aria-hidden="true" data-show="false">
    <span class="t-tt-text"></span>
  </span>
</span>
```

One tooltip per group, shared by every trigger. The JS snippet
writes the bubble's x + width for the hovered trigger: when it is
already showing, the move tweens on --tt-move-dur so the bubble
travels between triggers; when hidden, the geometry snaps and only
the appear plays. The appear delay belongs to the show rule alone,
so leaving the group hides it immediately. Trigger styling is
yours; only the tooltip and its motion live here.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--tt-in-dur` | `150ms` | sourced from `--p17-in-dur` |
| `--tt-out-dur` | `50ms` | sourced from `--p17-out-dur` |
| `--tt-scale` | `0.98` | sourced from `--p17-scale-from` |
| `--tt-delay` | `80ms` | sourced from `--p17-delay` |
| `--tt-in-ease` | `ease-out` | sourced from `--p17-in-ease` |
| `--tt-out-ease` | `ease-out` | sourced from `--p17-out-ease` |
| `--tt-move-dur` | `160ms` | sourced from `--p17-move-dur` |
| `--tt-move-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p17-move-ease` |
| `--tt-bg` | `#ffffff` | sourced from `--p17-bg` |
| `--tt-fg` | `#2f2f2f` | sourced from `--p17-fg` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --tt-in-dur: 150ms;
  --tt-out-dur: 50ms;
  --tt-scale: 0.98;
  --tt-delay: 80ms;
  --tt-in-ease: ease-out;
  --tt-out-ease: ease-out;
  --tt-move-dur: 160ms;
  --tt-move-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --tt-bg: #ffffff;
  --tt-fg: #2f2f2f;
}
```

## CSS

```css
.t-tt-group {
  position: relative;
  display: inline-flex;
}
.t-tt {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 0;                 /* the JS writes the measured width */
  overflow: hidden;
  /* Individual transform properties: the travel (translate) and the
     appear (scale) run on their own clocks. */
  translate: var(--tt-x, 0px) 0;
  scale: var(--tt-scale);
  transform-origin: 50% 100%;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--tt-bg);
  color: var(--tt-fg);
  white-space: nowrap;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.06),
    0 2px 6px 0 rgba(0, 0, 0, 0.05),
    0 4px 42px 0 rgba(0, 0, 0, 0.06);
  opacity: 0;
  pointer-events: none;
  /* Default rule controls the LEAVE state: no delay, so hiding plays
     immediately. The move lanes are always live. */
  transition:
    opacity   var(--tt-out-dur) var(--tt-out-ease),
    scale     var(--tt-out-dur) var(--tt-out-ease),
    translate var(--tt-move-dur) var(--tt-move-ease),
    width     var(--tt-move-dur) var(--tt-move-ease);
}
/* The appear delay belongs ONLY to the show rule, so hiding snaps it
   back to 0. A retarget while showing carries no delay at all. */
.t-tt[data-show="true"] {
  opacity: 1;
  scale: 1;
  transition:
    opacity   var(--tt-in-dur) var(--tt-in-ease) var(--tt-delay),
    scale     var(--tt-in-dur) var(--tt-in-ease) var(--tt-delay),
    translate var(--tt-move-dur) var(--tt-move-ease),
    width     var(--tt-move-dur) var(--tt-move-ease);
}
.t-tt-text { white-space: nowrap; }

@media (prefers-reduced-motion: reduce) {
  .t-tt { transition: none !important; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// One tooltip per group, shared by every trigger. Hovering a trigger
// writes the bubble's x + width for that trigger: when it is already
// showing the move tweens (it travels), when hidden the geometry snaps
// under it and only the appear plays. Leaving the group hides it.
const group = document.querySelector(".t-tt-group");
const tip = group.querySelector(".t-tt");
const text = tip.querySelector(".t-tt-text");
const triggers = [...group.querySelectorAll(".t-tt-trigger")];

function hide() {
  tip.setAttribute("data-show", "false");
  tip.setAttribute("aria-hidden", "true");
}

function place(trigger) {
  const showing = tip.getAttribute("data-show") === "true";
  text.textContent = trigger.getAttribute("data-tooltip") || "";
  const cs = getComputedStyle(tip);
  const width = Math.ceil(
    text.scrollWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
  );
  const g = group.getBoundingClientRect();
  const r = trigger.getBoundingClientRect();
  const x = r.left - g.left + r.width / 2 - width / 2;
  if (!showing) {
    // Snap the geometry while hidden so only the appear plays.
    tip.style.transition = "none";
    tip.style.width = `${width}px`;
    tip.style.setProperty("--tt-x", `${x}px`);
    void tip.offsetWidth;
    tip.style.transition = "";
  } else {
    tip.style.width = `${width}px`;
    tip.style.setProperty("--tt-x", `${x}px`);
  }
  tip.setAttribute("data-show", "true");
  tip.setAttribute("aria-hidden", "false");
}

triggers.forEach((t) => {
  t.addEventListener("pointerenter", () => place(t));
  t.addEventListener("focus", () => place(t));
  t.addEventListener("blur", hide);
});
group.addEventListener("pointerleave", hide);
```

