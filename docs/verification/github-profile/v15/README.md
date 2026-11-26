# v15 — composed `/profile` whole-composition candidate (Issue #1235 round 2)

Owner rejected the v14 per-asset alignment approach: the profile must
be designed as ONE composition, not three stacked SVGs. This round
introduces a single `GET /github-profile/profile` endpoint that
composes Identity + GitHub Activity + Stack sections on one canvas
driven by the shared `design.ts` contract, plus a 2-lane stack
marquee that actually compresses height.

## Files

- `profile-{dark,light}-{desk,mob}.png` — composed `/profile` SVG
  renders (desktop `800×1092`, mobile `400×1368`)
- `profile-*-grid.png` — same renders with the `?grid=1` column /
  baseline / type-role overlay used for layout verification
- `page-{desk,mob}-{dark,light}.png` — full README page renders
  (new chrome: left spine, structured Selected Work list, single
  `<picture>` profile embed)
- `design-review-spec.md` / `design-review-final.md` — the final
  independent agy review round (v19) and its **APPROVE** verdict

## Review history (agy independent design review)

| round | verdict | notes |
|---|---|---|
| v15 | REQUEST CHANGES | 1 blocker + 6 majors (mobile presence collision, missing bio, stack edge-slice, dim rows, VITALS grid, pulse bars) |
| v16 | REQUEST CHANGES | 3 majors + 3 minors (VITALS proximity, repo-count wording, mobile ring↔bio, presence spine, stack fade, casing) |
| v17 | REQUEST CHANGES | 1 blocker regression (label baseline math) + 2 minors |
| v18 | APPROVE WITH FIXES | legend `%`/`+`/`#` width underestimate; trailing-gap + repo paradox fixed |
| v19 | **APPROVE** | legend gaps even (12–16px), zero defects, one optional nit applied |

## Measured heights (SVG viewBox, before → after)

| asset | desktop | mobile |
|---|---|---|
| stack (old static, v14) | 284px | 368px |
| stack (v15, 2-lane marquee) | 184px | 228px |
| identity+activity+stack bands stacked (v14) | 1068px | 1448px |
| `/profile` single canvas (v15) | 1092px | 1368px |

Baseline static stack was 235px desktop / 365px mobile — the marquee
now compresses desktop below the old static height and mobile well
below the failed 4-lane version, while keeping all 48 committed
icons.

## README chrome changes (preview draft)

- Selected Work sub-links: centered middot string → left-aligned
  structured list with one-line descriptors
- `<div align="center">` wrappers removed — headings, links, images
  and the attribution share one left spine
- Profile embed is a single `<picture>` element (theme + mobile
  variants of `/profile`)

## Boundary

Public README switch, release → main, production deploy and GitHub /
Camo live verification remain owner-approval items. The preview
proxy (`/public`) renders the draft README against the dev worker.
