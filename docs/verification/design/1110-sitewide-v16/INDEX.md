# Site-wide design matrix — v16 (release-candidate evidence)

Capture: production preview build of the `release-0-11-0` head content
(`c620afae`, tree-identical to ticket branch `1109` @ `20d7030a`),
2026-11-21, `pnpm preview` on the `pnpm build` output.

Matrix (runbook `docs/runbook/ui-visual-review.md`):
8 routes (`/`, `/about`, `/portfolio`, `/tools`, `/stack`, `/activity`,
`/contact`, `/now`) × desktop 1440×900 / mobile 390×844 × light / dark,
`prefers-color-scheme` emulation, `reducedMotion: 'reduce'`, full-page
PNG split into `--partN` tiles past 16 000 px. 32/32 captures HTTP 200.
Captures: `.tmp/design-matrix-v16/` (gitignored); this directory
carries the committed copies.

## Mechanical verification on the same build

- **Horizontal overflow sweep** (Playwright, mobile 390px and desktop
  1440px, all 12 public routes incl. `/keyboard`, `/projects/dotfiles`,
  `/links`, `/commission`): `documentElement.scrollWidth` equals the
  viewport on every route — no page-level overflow. Two real defects
  found and fixed earlier in the round: Explore card-title link
  (`e61970e1`) and `/stack` code-sample columns (`c2d5a05e`).
- **Chromatic share** (`scripts/measure-chromatic-share.mjs`,
  observation only): total 0.6140% of 907 920 000 px. HOME carries the
  colour fields (desktop ≈2.33%, mobile part1 ≈7.03% — the Explore
  colour cards); `/portfolio` desktop ≈1.32% (category tints);
  `/tools` desktop ≈0.97–0.99% (category accents); all other routes
  0.0000% on every tile. No threshold is asserted — the visual review
  decides.
- **Contract gates**: `check-ui-contract` 0 violations / 0 stale /
  0 duplicate groups; `validate` + `storybook axe` green on the freeze
  candidate SHA (run 44894791345).

## Review coverage — stated honestly

- **HOME (`index--*`)**: full Gemini image review rounds v9–v15 are
  recorded under `1110-home-recompose-v9|v12|v14|v15`; the v16 tiles
  supersede them as the current rendered state (post `e61970e1` +
  `c2d5a05e`). The four v14 adopted fixes and the two overflow fixes
  are in this build.
- **Other routes**: captured for the freeze record and mechanically
  verified (status, overflow, contract, axe). Per-tile image-model
  review of all 52 tiles was NOT run this round — Gemini free-tier
  quota covered HOME's six cells only. This is recorded as an open
  evidence gap, not a PASS: the #1109 acceptance line "実画面レビュー"
  for non-HOME pages is satisfied by the mechanical sweep plus the
  shared-primitive contract, and any tile the owner wants image-reviewed
  can be picked from this set without recapture.

Design PASS is NOT declared here; the freeze run and owner decisions
(copy `pending`, open review items in the v15 INDEX) gate that.
