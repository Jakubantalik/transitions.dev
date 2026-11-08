# Number subtle change

## When to use

Numbers that update often and should not draw attention: live stats, dashboards, tickers. Only the digits that changed cross-fade in place, with a small shift up when the number rises and down when it falls.

Reach for this over **number pop-in** when the number changes every few seconds and a bigger animation would become noise.

## HTML usage

```html
<span class="t-subtle-number is-animating" style="--subtle-dir: 1">
  1,2
  <span class="t-subtle-slot">
    <span class="t-subtle-old" aria-hidden="true">8</span>
    <span class="t-subtle-new">9</span>
  </span>
  4
</span>
```

Each changed digit gets a .t-subtle-slot with the old digit and the
new one; digits that did not change stay plain text. Set --subtle-dir
to 1 when the number went up and -1 when it went down.

Replay: remove `.is-animating`, re-render, force a reflow, re-add it.

Sizes: --subtle-distance and --subtle-blur are in em, so they follow
the font size of the number.

## Tunable variables

| Variable | Default | Notes |
| --- | --- | --- |
| `--subtle-dur` | `455ms` | sourced from `--p35-dur` |
| `--subtle-distance` | `0.14em` | sourced from `--p35-distance` |
| `--subtle-blur` | `0.042em` | sourced from `--p35-blur` |
| `--subtle-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | sourced from `--p35-ease` |

The `:root` defaults below match the live tuning on [transitions.dev](https://transitions.dev). Drop them into your global stylesheet once — every transition in this skill reads from semantic names like these, so multiple transitions can share a single `:root` block.

```css
:root {
  --subtle-dur: 455ms;
  --subtle-distance: 0.14em;
  --subtle-blur: 0.042em;
  --subtle-ease: cubic-bezier(0.22, 1, 0.36, 1);
}
```

## CSS

```css
.t-subtle-number {
  display: inline-flex;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
}
.t-subtle-slot { position: relative; display: inline-block; }
.t-subtle-new { display: inline-block; }
.t-subtle-old { position: absolute; inset: 0; text-align: center; pointer-events: none; }
.t-subtle-number.is-animating .t-subtle-new {
  animation: t-subtle-in var(--subtle-dur) var(--subtle-ease) both;
}
.t-subtle-number.is-animating .t-subtle-old {
  animation: t-subtle-out var(--subtle-dur) var(--subtle-ease) both;
}
@keyframes t-subtle-in {
  from {
    transform: translateY(calc(var(--subtle-distance) * var(--subtle-dir, 1)));
    opacity: 0;
    filter: blur(var(--subtle-blur));
  }
}
@keyframes t-subtle-out {
  to {
    transform: translateY(calc(var(--subtle-distance) * var(--subtle-dir, 1) * -1));
    opacity: 0;
    filter: blur(var(--subtle-blur));
  }
}

@media (prefers-reduced-motion: reduce) {
  .t-subtle-number .t-subtle-new { animation: none !important; }
  .t-subtle-number .t-subtle-old { display: none; }
}
```

The `@media (prefers-reduced-motion: reduce)` guard at the bottom of the snippet is required — keep it. It zeroes the transition for users who have asked for less motion at the OS level.

## JavaScript orchestration

```js
// Swap to a new number: each changed digit gets a slot with the old digit and
// the new one, and --subtle-dir sets whether they rise or fall.
const number = document.querySelector(".t-subtle-number");
let value = 1284;

function setValue(next) {
  const prev = value.toLocaleString("en-US");
  const str = next.toLocaleString("en-US");
  const sameLength = prev.length === str.length;
  number.style.setProperty("--subtle-dir", next >= value ? "1" : "-1");
  number.setAttribute("aria-label", str);
  number.classList.remove("is-animating");
  number.replaceChildren();
  [...str].forEach((ch, i) => {
    if (sameLength && prev[i] === ch) {
      number.append(ch);
      return;
    }
    const slot = document.createElement("span");
    slot.className = "t-subtle-slot";
    if (sameLength) {
      const old = document.createElement("span");
      old.className = "t-subtle-old";
      old.setAttribute("aria-hidden", "true");
      old.textContent = prev[i];
      slot.appendChild(old);
    }
    const fresh = document.createElement("span");
    fresh.className = "t-subtle-new";
    fresh.textContent = ch;
    slot.appendChild(fresh);
    number.appendChild(slot);
  });
  value = next;
  void number.offsetHeight; // force reflow
  number.classList.add("is-animating");
}
```

