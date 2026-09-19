# access-counter digit images

Pre-rasterised 7-segment LCD digits (0-9), one per file. The
home page's `04 — Access counter` tile imports each digit as a
URL and renders the count as a sequence of `<img>` tags. The
"image swap" effect is what gives the tile its mechanical-counter
feel — see `src/home/access/tiles.tsx`.

Re-generate with:

```
pnpm run generate:digits
```

Visual: pure SVG paths, no font dependency. The `currentColor`
keyword in the SVG lets the React component inherit its parent's
text color, so the same WebP renders as `text.default` (enabled)
or `text.muted` (disabled) without a per-variant bake.

Canvas: 96x144px (1.5x of the largest display size for
retina). Lossless WebP — edges stay sharp at the small display
size.
