# Small text (just a line)

## When to use

Text that is too small to trace letter by letter: an eyebrow, a subtitle, a caption, a short paragraph, a label next to a headline. Each line of text gets one dotted line drawn through it, like the wireframe skill, then the characters fade in as the line passes them.

## Usage

```js
generate(subtitle, { variant: "small-text" });
```

```html
<p data-t-generate="skeleton" data-t-generate-variant="small-text">Field notes · Issue 07</p>
```

## How it looks

| Phase | Window (of `duration`) | What happens |
| --- | --- | --- |
| Lines | 0.12 to 0.78 | One dotted line per line of text, drawn left to right with a moving head and end caps, the lines one after another along `sequenceEase`. |
| Ink | per character | Each character fades in `fadeDelay` after the line's stroke reaches it, over `fade` (or per word with `fadeBy: "word"`, or a gradient sweep with `fadeBy: "gradient"`). |

## Notes

- In the `auto` variant, text under `display` (`32px`) gets this treatment automatically, next to traced headlines.
- Keep it to short copy. For long body text, generate the headline and let the paragraph simply appear.
