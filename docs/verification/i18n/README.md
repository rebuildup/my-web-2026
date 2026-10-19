# Verification — i18n artifacts

This directory holds the committed screenshots for five verification
tickets:

| Artefact | Issue | What it proves |
| --- | --- | --- |
| `intl-date-number.webp` | #430 | one instant, one count and a set of relative spans rendered per locale by the shipped home format adapter |
| `cjk-line-break.webp` | #431 | 72 measured CJK line-breaking rows (禁則 / `word-break` / wrap mode) from the shipped editorial recipes |
| `missing-keys-report.webp` | #428 | copy locale contract gate: opt-in matrix, fixture findings, legend (see [`copy/README.md`](../../../copy/README.md)) |
| `unicode-slug-validation.webp` | #433 | the 17-row Unicode / URL-slug decision table classified by the shipped `EMOJI_SLUG_GRAMMAR` / `PORTFOLIO_SLUG_GRAMMAR`, plus the counterfactual lossy-slug results |
| `diacritic-cyrillic-font.webp` | #432 | 16 fr / de / pt / ru heading fixtures rendered with the shipped font stack, plus 53 measured code points (missing glyph, webfont vs platform fallback) and a clipboard round trip |

## Intl locale formatting (Issue #430)

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

## CJK line breaking (Issue #431)

`cjk-line-break.webp` is the committed screenshot of the CJK
禁則 / line-break measurement report. It shows the fixture rendered by
the shipped editorial recipes at three viewports (320 / 375 / 768 px),
four locales (`ja` / `zh-Hans` / `zh-Hant` / `ko`) and three opt-in
levels (baseline, `lang`, `lang` + CJK typography), plus the full
72-row measurement matrix and the list of failures (empty on a passing
run).

The rules it checks are the typography contract only: R1 行頭禁則,
R2 行頭空白, R3 行末禁則, R4 Conditional Japanese starters, R5
lossless reconstruction, R6 `word-break`, R7 wrap mode, R8 `lang`
scoping, plus the opt-in declarations themselves — R9 `line-break`
(`auto` for the baseline / `lang` modes, `strict` for the typography
mode) and R10 `text-spacing-trim` (`normal` / `trim-start`). Text
quality (translation, editing, tone) is explicitly out of scope, and no
product copy is measured or changed by this artefact.

### How to reproduce it

```sh
# 1. build the Worker the harness measures through `pnpm preview`
pnpm run build

# 2. measure + regenerate docs/verification/i18n/cjk-line-break.webp
node scripts/cjk-line-break-measure.mjs --write-artefact
```

With no `--base-url`, the harness starts its own `pnpm preview` on
`127.0.0.1:39217` through `scripts/e2e-local-bootstrap.mjs` (local D1
only), refuses to adopt an unrelated listener on that port, and stops
the process group on exit. Pass `--base-url <url>` to measure a preview
you started yourself. The intermediate PNG is deleted after the WebP is
written, and the capture fails if the WebP exceeds 300 KB.

The browser half needs Playwright and a build, so it is not part of
`pnpm test`; the pure rule/table half is
`scripts/cjk-line-break-measure.test.mjs` and is wired into
`package.json#scripts.test`.

## Unicode / URL slug policy (Issue #433)

`unicode-slug-validation.webp` is the committed screenshot of the
Unicode / URL-slug evidence report. It renders the 17 fixture rows from
`src/i18n/fixtures.ts` through the shipped `describeUnicode` /
`classifySlugCandidate` policy and the owner grammars, so the artefact
cannot drift from the code. The report, scope and reproduction commands
are in [`unicode-slug-validation.md`](unicode-slug-validation.md).

```sh
pnpm run capture:i18n-verification
```

The script imports the shipped modules directly, uses no network, and
deletes the intermediate PNG. The conflict audit table in the artefact
is a fixed sample catalog — the shipped reactions/portfolio catalog is
not audited yet (disclosed in the artefact itself).

## Glyph display — diacritics, combining marks, Cyrillic (Issue #432)

`diacritic-cyrillic-font.webp` is the committed screenshot of the
heading-glyph measurement report. It renders the 16 rows of
`src/i18n/glyphs.fixture.ts` (French / German / Portuguese / Russian)
with the **shipped** font stack, then measures every non-ASCII code
point the fixture carries: whether it renders as `.notdef` (a missing
glyph) **in the tier that actually draws it** — a code point that only
appears in body rows is judged against the body stack, because the
heading stack never draws it — whether the shipped webfont supplies it,
and whether a selection plus a system-clipboard round trip preserves
the author's code points. A column whose tier has no row for a code
point reads `no row` rather than a verdict: coverage evidence for a
rendering that does not exist would be worse than no evidence. The report, the measured numbers, the reproduction
commands and the **out-of-scope list** are in
[`diacritic-cyrillic-font.md`](diacritic-cyrillic-font.md).

```sh
# the CI half (no browser, no network)
pnpm exec vitest run src/i18n/glyphs.test.ts

# the browser half: regenerate the artefact
pnpm run capture:glyph-coverage
```

The browser half needs the network (it loads the same webfont the
product loads, read out of `src/routes/__root.tsx`), so it is not part
of `pnpm test`; the contract half — the number, the negation, the
permission, the declared code points and the byte-exact round trips —
is `src/i18n/glyphs.test.ts` and runs in CI. Storybook shows the same
fixture as `editorial/Glyph headings`.

The capture exits non-zero when the webfont did not load, when a code
point renders as `.notdef` in any tier that draws it, when a verdict
cell could not be filled, or when the copy/paste round trip changed a
code point — an artefact that measured nothing must not look complete.

## Why a committed binary

The repository's usual convention is that verification screenshots stay
outside the tree (`scripts/layout-audit-shoot.mjs`). Issues #430, #431
and #432 ask for their evidence to be visible in the PR, so the
artefacts are committed — as WebP rather than the PNG the Issues name,
because the PNG is several times larger for no gain at documentation
scale. Every capture script fails when the WebP exceeds 300 KB, so an
artefact cannot silently bloat the repository.
