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

## Image-model review — v16 tiles (completed 2026-11-22)

Gemini credentials were unavailable (`GEMINI_API_KEY` absent), so the
review ran through the OpenRouter free tier: model
`nvidia/nemotron-3.5-super-vl:free`, `review-batch.mjs` sending up to 4
adjacent ~2000 px slices per call, `prompt-batch.txt` requiring
`DEFECTS:` / `OPPORTUNITIES:` / one-line verdict sections. 308 slices
across all 58 tiles (8 routes × desktop/mobile × light/dark, incl.
HOME's six cells) were reviewed in 90 batched jobs, 0 failures.
Transcripts: `reviews/` (one `.md` per batch, slice-labelled).

Coverage is complete: every capture cell has at least one transcript.
Findings, dispositioned:

- **Structural defects: none adopted.** Repeated model flags resolved
  as artifacts or known states, verified against source:
  - "解析の設定: 無効" pill overlapping body text (activity/now/stack
    mobile) — the `position: fixed` `AnalyticsConsentControl` overlay
    composited into full-page captures; same known artifact recorded
    since v12, not a layout defect.
  - "Reactions/Page views are unavailable in this environment." —
    honest degraded state of the dev data-source build (no consumer
    API key), rendered by `src/home/access/tiles.tsx`; preview-only
    copy, not a leak.
  - Portfolio "missing thumbnail" grey wells and image-less cards —
    the designed `MediaPlaceholder` empty state, not broken assets.
  - "no footer / abrupt end" slice endings — slice-boundary artifacts;
    site chrome is unchanged.
  - Stack `index.tsx.` trailing periods — list punctuation in source
    copy, not a rendering bug.
- **Accepted opportunities (recorded, not defects):** repetitive
  list/card rhythm on `/about` skills, `/now` private-project blocks,
  `/portfolio` tag-pill cluster variance, `/stack` status-pill
  contrast on `not applicable`, dense bilingual consent copy, muted
  metadata greys, and HOME's mobile sponsor-ad weight — the last is
  the standing owner trade-off tracked under #925, unchanged here.
- **HOME v16**: reviewed on the current tiles (not inherited from
  v9–v15). Verdicts consistent with the adopted v14 fixes; no new
  structural defects. The v15 open items (ad weight, muted greys,
  disabled-state dead space, footer "04" sparsity) persist as
  opportunities, not regressions.

Design review evidence for #1108/#1109/#1110 is therefore complete for
this matrix. Design PASS for the release still gates on the owner
copy decision (`pending`) and the #925 ad trade-off; this document
records evidence, not acceptance.
