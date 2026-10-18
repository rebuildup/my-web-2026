# Verification — Intl locale formatting (Issue #430)

`intl-date-number.webp` is the committed screenshot of the locale
comparison report for the home format adapter. It shows **one
instant, one count, and one set of relative spans** rendered in
`en` / `ja` / `ko` by the shipped adapter.

## What the image shows

| Row | What it proves |
| --- | --- |
| Instant (UTC) | the same instant reads per locale (`Jan 5, 2026, 9:00 AM UTC` / `2026/01/05 9:00 UTC` / `2026. 1. 5. 오전 9:00 UTC`) |
| Instant (Asia/Tokyo) | the time zone moves the clock reading, not the instant |
| Date only | date order and separators are locale data |
| Count | digit grouping is **identical** in all three locales today (`1,234,567`) — a recorded observation, not an assumption |
| Relative (5 min / 3 h / 12 d) | the unit is worded by the locale; `ja` spaces the number from the unit, `ko` writes it tight (`5분 전`), and a measured span stays measured (no "yesterday") |
| Unit reference | preview-only row: a CLDR `style: 'unit'` value, so the next surface that needs a unit starts from rendered evidence |

The surrounding labels stay English: only the value is localised, and
the wording for a `ja` / `ko` reader is an editorial decision that has
no approved source in this repository yet.

## How to reproduce it

```sh
# 1. render the comparison report from the shipped adapter
node --experimental-strip-types scripts/intl-format-report.mjs

# 2. screenshot it into docs/verification/i18n/intl-date-number.webp
node scripts/intl-format-shoot.mjs
```

Step 1 writes `.tmp/intl-date-number.html` (gitignored). Step 2
renders that document in headless Chromium and writes the WebP. The
intermediate PNG stays in `.tmp/` and is never committed.

`--experimental-strip-types` is what lets plain Node load the
TypeScript adapter; it is a no-op on Node >= 23 and required on the
repository's minimum (Node 22.18).

The same comparison is available as a Storybook preview
(`home/LocaleComparison`) and is asserted in
`src/home/format.test.ts`, `src/home/access/tiles.test.tsx`, and
`src/home/status/tiles.test.tsx`.

## Why a committed binary

The repository's usual convention is that verification screenshots stay
outside the tree (`scripts/layout-audit-shoot.mjs`). Issue #430 asks
for this comparison to be visible in the PR, so the artefact is
committed — as WebP rather than the PNG the Issue names, because the
PNG is several times larger for no gain at documentation scale. The
capture script fails when the WebP exceeds 300 KB, so the artefact
cannot silently bloat the repository.
