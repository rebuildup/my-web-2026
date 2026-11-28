# v19 — split-surface full-page evidence (re-captured 2026-11-28)

Re-captured against `release-0-16-0` @ `91bf0676` (post-#1287:
identity scoping, activity event verbs, unobserved-card 200s)
served by `pnpm dev:production-data` (production D1 read-only)
behind the local preview proxy, reproducing the live public README
composition (rebuildup/rebuildup@main — 5 independent `<picture>`
surfaces: identity / vitals / top-languages / activity-map / stack,
each theme × layout, plus the `showcase.webp` still asset).

Supersedes the 2026-11-27 capture taken on `1240-stats-surface-compact`.

## Files

- `page-{desk,mob}-{dark,light}.png` — full public-README page
  render (all five surfaces composed as GitHub serves them).
- `{identity,vitals,top-languages,activity-map,stack}-{dark,light}-{desktop,mobile}.png`
  — the 20 individual surface assets (4 variants × 5 surfaces).
- `showcase-asset.png` — the animated `showcase.webp` still asset.

## Surface responsibilities (post-#1287)

- `/identity` — person fragment only: avatar, name, bio, Discord
  presence. Statistics and language composition were removed
  (`accountStats: false`); the public README no longer duplicates
  `/vitals` / `/top-languages` content inside identity.
- `/vitals`, `/top-languages` — GitHub statistics (unchanged from
  the v18 compact redesign).
- `/activity-map` — repo output bars + 72h pulse + recent events.
  Feed event types render human verbs (`pushed`, `commented`,
  `issue`, …); raw GitHub API type names (`IssuesEvent`, …) never
  reach the SVG — unknown future types degrade to `activity`.
- `/stack` — technology stack.

## Heights (SVG viewBox, measured from served markup)

| surface | desktop | mobile |
|---|---|---|
| /identity | 168 | 156 |
| /vitals | 196 | 240 |
| /top-languages | 144 | 212 |
| /activity-map | 460 | 544 |
| /stack | 184 | 220 |

v0.15.2 production: vitals 152/144, top-languages 92/112;
pre-compaction (v17): vitals 236/228, top-languages 152/232.
Identity lost its embedded stats block in #1287 — the 168/156px
canvas now carries only the person fragment.

## Animation

`showcase.webp` is an animated WebP (relay of selected works); the
SVG surfaces carry SMIL/CSS-free static markup — animation evidence
for the profile surfaces is the webp asset itself plus the
`/github-profile/works/*.webp` stills referenced by the stack band.

## Known limitations carried forward

- Mobile "Selected Work" legibility has TWO causes, both outside the
  SVG surfaces: (1) the raster `showcase.webp` is a fixed 800×360
  canvas that GitHub scales down, and (2) the public README composes
  the showcase via HTML picture elements in a two-column table/inline
  flow, so the image is rendered at roughly half the README width on
  mobile and text inside the raster wraps awkwardly. Deferred to a
  future asset revision AND a README composition revision (next
  release; recorded here so the cause is not misattributed to the SVG
  surfaces alone).
- The 72h pulse counts public feed events inside the snapshot's
  observation window; the sync caps `feed` at the 30 most recent
  events, so a >30-events-in-72h burst would undercount. Honest
  under the snapshot contract (it reports what was observed).
