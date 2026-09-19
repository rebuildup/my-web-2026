# access-counter digit images

Pre-rasterised mono digits (0–9), one file per digit. The home page's
`04 — Access counter` tile imports each digit as a URL and renders
the count as a fixed-width sequence of `<img>` tags — 7 slots wide
with leading zeros (`0001234`), like an odometer. Re-generate with:

```
pnpm run generate:digits
```

Visual: `<text>` rendered through sharp's SVG → WebP pipeline using
`ui-monospace` (fontconfig resolves to the system mono on each
machine; the exact glyph differs slightly between dev / CI, but the
silhouette — and therefore the swap effect — is identical). Bake
colour is `currentColor` resolved at rasterise time, which librsvg
renders as `#000` (matches `text.default` = `#0b1020` visually).
