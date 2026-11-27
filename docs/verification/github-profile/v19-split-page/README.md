# v19 — split-surface full-page evidence (2026-11-27)

Captured against the `1240-stats-surface-compact` branch served by
`pnpm dev:production-data` (production D1 read-only) behind the local
preview proxy, reproducing the live public README composition
(rebuildup/rebuildup@main — 5 independent `<picture>` surfaces:
identity / vitals / top-languages / activity-map / stack, each
theme × layout).

## Files

- `page-{desk,mob}-{dark,light}.png` — full public-README page
  render (all five surfaces composed as GitHub serves them).
- `{identity,vitals,top-languages,activity-map,stack}-{dark,light}-{desktop,mobile}.png`
  — the 20 individual surface assets (4 variants × 5 surfaces).
- `showcase-asset.png` — the animated `showcase.webp` still asset.

## Heights (SVG viewBox, measured from served markup)

| surface | desktop | mobile |
|---|---|---|
| /vitals | 196 | 188 |
| /top-languages | 144 | 204 |

v0.15.2 production: vitals 152/144, top-languages 92/112;
v17 (pre-compaction): vitals 236/228, top-languages 152/232.
The compact redesign trades ~40px of vitals height and ~8–28px of
top-languages height for meaning-grouped metrics and a single
muted participated line, while keeping every aggregated figure.

## Animation

`showcase.webp` is an animated WebP (relay of selected works); the
SVG surfaces carry SMIL/CSS-free static markup — animation evidence
for the profile surfaces is the webp asset itself plus the
`/github-profile/works/*.webp` stills referenced by the stack band.
