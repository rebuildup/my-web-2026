# HOME visual review — v12 (post-fix recapture)

Capture: production preview build of PR #1115 head, 2026-11-21.
Matrix: `/` × desktop 1440×900 / mobile 390×844 × light / dark,
`prefers-color-scheme` emulation, `reducedMotion: reduce`, full-page PNG
(mobile split into `--part1`/`--part2` tiles). Captures:
`.tmp/design-matrix-v12/` (gitignored); this directory carries the
committed copies plus the reviewer transcripts.

Reviewer: Gemini (`gemini-3-flash-preview`) via
`.tmp/vision/review-image.mjs`, prompt `.tmp/vision/prompt.txt` (slice
number substituted per part). Only files with a non-empty `.md`
transcript were actually reviewed by the image-capable model; the
mobile dark/light `--part2` transcripts are EMPTY because the free-tier
daily quota (20 req/day) was exhausted mid-run — those slices are
**unreviewed**, not passed.

## Finding → fix → commit traceability

| # | Finding (v10/v11 reviews) | Fix | Commit |
|---|---|---|---|
| F1 | Leaderboard creative out-weighed hero + guide (v10 desktop-light #1, mobile-light #2) | `AdTopBanner` moved below the Explore grid | `f883ebb0` |
| F2 | 9 full-width stacked Explore cards on mobile = scroll fatigue (v10 mobile reviews) | `Grid` `columns=3` now pairs cards at `base` (sole consumer is this grid) | `f883ebb0` |
| F3 | Public page printed operator instructions ("run scripts/bootstrap-home-api-key.mjs") in disabled reactions/page-views states (v10 desktop-dark #1) | Neutral visitor-facing unavailable copy | `f883ebb0` |
| F4 | "00 — Now" raw project log preceded "01 — Explore" destination index; reviewers across all four v11 cells asked for the guide first | Section order swapped; eyebrows renumbered (`00 — Explore`, `01 — Now`); `e2e/smoke.spec.ts` order assertion updated | this commit |
| F5 | Copy-editorial gate `no-approval-record` on PR #1115 | `issue-1110-home-recompose` pending record rebound to current change-set fingerprint; `decision: pending`, provenance unchanged | `f883ebb0` |
| F6 | `ToneMatrix.tsx` undeclared under `src/routes/` (CI `publication:check` E005) | Declared in `ROUTE_DIR_INERT_FILES` — explicit inert classification, no weakened inspection | `f0c686c1` |
| F7 | Invalid `PageSection` × `Panel` pairings only hidden in the fixture | `SectionToneContext` + `panelVariantAllowedOnTone`; `Panel` throws on forbidden pairs; 8×7 matrix test proves valid render / invalid throw | `07930746` |
| F8 | "すべて見る" link floated far below the Now list (v12 desktop-dark opportunity #3) | See-all link gets its own tighter `marginBlockStart` instead of the shared row-link spacing | this commit |
| F9 | `publication-surface` load contract still counted eight non-sitemap surfaces after `/now` landed | Count updated to nine; CI `validate` green | `718b2321` |

## v12 review outcome (Gemini, actual image inspection)

Reviewed: desktop-light, desktop-dark, mobile-light--part1.
Unreviewed (quota): mobile-light--part2, mobile-dark--part1,
mobile-dark--part2 — recorded as pending, not PASS. A retry on
2026-11-21 failed before reaching the model: `GEMINI_API_KEY` is no
longer present in the Infisical `dev` env (`HTTP 400: Please pass a
valid API key`), so those slices stay unreviewed until a key is
restored or another image-capable model is used.

PR #1115 merged into `release-0-11-0` as `ac0723e0` on 2026-11-21
after `validate` went green on `718b2321`.

Confirmed improved in v12 transcripts:
- Explore grid leads the content column and reads as the destination
  index (v11 defect "wall of data before navigation" addressed).
- Paired-card mobile grid acknowledged as less fatiguing.
- Dev-key instruction text gone from status widgets.

Still open (recurring across v10–v12 transcripts):
- `text.muted` / `mono.ink.muted` small metadata (timestamps,
  "observed at", repo paths) sits near the AA boundary on tinted
  surfaces — measured borderline, not yet failed by the tone e2e
  (which enforces ≥4.5:1 on tone pairs). Token-level change deferred:
  it is a site-wide palette decision, not a HOME-local tweak.
- Disabled-state widgets ("counter disabled", "unavailable") occupy
  vertical space in the preview build; production has live data, so
  the honest degradation stays — flagged for a collapse-to-one-line
  treatment if the owner wants it.
- "Content — planned" Explore card reads as a dead end next to live
  destinations (badge exists; affordance could be quieter).
- Footer "04 EDITION" block is very sparse on mobile (part2 slices);
  version metadata prominence noted by reviewer.
- PetCompanion / analytics-consent fixed-position widgets appear to
  overlap content in full-page captures — assessed as a
  `position: fixed` screenshot-compositing artifact, not a layout
  defect; verify interactively before treating as a bug.
- Internal tool/ad units still read as display ads to the reviewer;
  further demotion options (quieter surface, fewer units) are an
  owner-facing trade-off against the #925 ad contract.

Design PASS is NOT declared: #1108–#1110 acceptance requires the
unreviewed mobile slices plus owner copy decision (`pending`) and the
open items above.
