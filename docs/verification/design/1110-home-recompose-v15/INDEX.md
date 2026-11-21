# HOME visual review — v15 (post-fix verification round)

Capture: production preview build of `1109` head **before** the
Explore card-link overflow fix (`e61970e1`), 2026-11-21.
Matrix: `/` × desktop 1440×900 / mobile 390×844 × light / dark,
`prefers-color-scheme` emulation, `reducedMotion: reduce`, full-page PNG
(mobile split into `--part1`/`--part2` tiles). Captures:
`.tmp/design-matrix-v15/` (gitignored); this directory carries the
committed copies plus the reviewer transcripts.

Reviewer: Gemini (`gemini-3-flash-preview`) via
`.tmp/vision/review-image.mjs`, prompt `.tmp/vision/prompt.txt`.
All six cells produced non-empty transcripts on attempt 1.

This round verifies the four v14 adopted fixes (hero `Button` CTAs,
anchored planned note, Now-list heading typography, footer `TextLink`)
— commit `1bbe8d04` — plus the sponsored-zone sunken treatment.

## Verified against the DOM, not just the transcripts

| # | Reviewer claim | DOM/measurement result | Disposition |
|---|---|---|---|
| V1 | mobile-dark--part1 #1: section headers "clipped on the left margin" (サ/現/サ cut off) | Section headings measure `x=16`, inside the container padding — **not clipped**. The real defect nearby: `documentElement.scrollWidth` was **489px on a 390px viewport** — the Explore card-title link (`inline-flex`, max-content 258px) overflowed its 167px grid cell and pushed the whole page sideways, which is what produced the clipped look | **Real bug, fixed** in `e61970e1` (link capped at `maxWidth: 100%`, title text wrapped in a shrinkable span). Post-fix measurement: `scrollWidth=390`, link right edge 350px. `/portfolio`, `/about`, `/tools` measured clean at 390px |

## v14 fix verification (transcript-level)

- Hero CTAs: no reviewer flagged the About/Portfolio buttons as
  footer-links anymore — the `Button` promotion reads as actions.
- Planned note: no longer described as floating/orphaned; mobile-light
  part1 now suggests only "a subtle background tint", i.e. it reads as
  intentional but quiet — accepted as designed.
- Now-list names: heading typography acknowledged; the remaining
  complaint is layout monotony (identical rows), a curation/density
  question, not a hierarchy defect.
- Footer links: `TextLink` adopted; remaining notes are taste-level
  (underline weight, divider length, "04" crop at the tile boundary —
  a full-page screenshot artifact, the numeral is intentionally
  oversized editorial type).

## Findings carried over as open (unchanged from v14 INDEX)

- Sponsor/ad units still read as third-party ads to reviewers —
  demotion beyond the sunken zone is an owner trade-off (#925).
- Site-guide bottom row holds only Contact + GitHub — curated card
  count, owner-facing editorial decision.
- Section 02 status density and disabled-state dead zones — collapse
  treatment deferred pending owner.
- `text.muted` small metadata remains the standing borderline-contrast
  item (tone e2e enforces ≥4.5:1; token change is site-wide).
- Analytics-consent fixed widget appears over content in full-page
  captures — `position: fixed` compositing artifact, verified pattern
  from v12.

## Still open / honest state

- The v15 captures themselves contain the pre-fix overflow; the fix is
  verified by DOM measurement (`scrollWidth`, link geometry) rather
  than a v16 image round. A v16 capture is warranted before final
  design PASS if the owner wants image-level confirmation of the
  wrapped card titles.
- Design PASS is NOT declared: #1108–#1110 acceptance still requires
  the owner copy decision (`pending`) on the issue-352 activity
  strings and the open items above.
