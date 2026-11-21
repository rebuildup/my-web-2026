# HOME visual review — v14 (post sponsored-zone rebuild)

Capture: production preview build of `1109` head, 2026-11-21.
Matrix: `/` × desktop 1440×900 / mobile 390×844 × light / dark,
`prefers-color-scheme` emulation, `reducedMotion: reduce`, full-page PNG
(mobile split into `--part1`/`--part2` tiles). Captures:
`.tmp/design-matrix-v14/` (gitignored); this directory carries the
committed copies plus the reviewer transcripts.

Reviewer: Gemini (`gemini-3-flash-preview`) via
`.tmp/vision/review-image.mjs`, prompt `.tmp/vision/prompt.txt` (slice
number substituted per part; desktop files reviewed as full page).
All six cells produced non-empty transcripts on attempt 1 — the whole
matrix was actually reviewed by the image-capable model.

v14 exists because the sponsored-zone `PageSection tone="sunken"`
rebuild (commit `46c4e6f2`) and the ambient-chrome ink-token fix
landed after the v13 captures; v13 transcripts are kept in
`.tmp/vision-v13/` (gitignored) and superseded by this round.

## Finding → fix → commit traceability

| # | Finding (v14 reviews, consensus across cells) | Disposition | Commit |
|---|---|---|---|
| F1 | Hero "About me" / "Portfolio" links read as footer links, not primary CTAs (mobile-light #2) | Promoted to `Button` variants; hero recomposed through `PageSection` | `1bbe8d04` |
| F2 | "planned / Content — …" note floated without grid anchor in all three cells that saw Section 00 (desktop-light #5, desktop-dark #5, mobile-dark #4) | Anchored to the destination grid with a hairline + breathing room in `ExploreSection` | `1bbe8d04` |
| F3 | Now-list project names lacked typographic distinction from metadata; "GitHub →" links tiny/repetitive (desktop-light #2, mobile-dark #5) | Project names now carry heading typography in `CurrentProjects` | `1bbe8d04` |
| F4 | Footer "Source" / "Portfolio" links hand-rolled; reviewers flagged underline/baseline tension and loose grouping (both mobile part2 cells) | Routed through `TextLink` | `1bbe8d04` |

## Findings reviewed and NOT adopted as code changes

Recorded so the reasoning is traceable rather than silently dropped:

- **Site-guide grid imbalance / "visual wall" of colour blocks**
  (desktop-dark #1, desktop-light #1): the grid is the shared `Grid`
  preset; the imbalance comes from the curated card count, which is an
  editorial curation decision, not a layout defect. No change; flagged
  for the owner alongside the Explore card-count question.
- **Sponsor units read as outbrain-style ads mid-page** (desktop-light
  #3, desktop-dark #2, mobile-light #5, mobile-dark #2): the units now
  own a sunken ad zone with disclosure labels and semantic ink chrome
  (the v14 axe fix). Further demotion collides with the #925 ad
  contract — an owner-facing trade-off, kept open.
- **"解析の設定: 無効" floating over hero copy on mobile**
  (mobile-light #1): this is the `AnalyticsConsent` fixed-position
  widget composited into the full-page screenshot, the same artifact
  recorded in the v12 INDEX — not a layout defect. Verified the element
  is `position: fixed` consent chrome; no change.
- **Section 02 status density / disabled-state dead zones**
  (desktop-dark #4, mobile-dark #3): recurring open item from v12 —
  collapse-to-one-line treatment deferred as an owner decision.
- **Footer nitpicks** ("04" scale, right-aligned Contact, divider
  length, `·` vs `/` separators, mono/sans staircasing): taste-level;
  the structural part (link primitive) was adopted as F4. Kept open.
- **Data-viz suggestions** (sparklines for GitHub activity, colour
  coding carried into Ambient Signals): would add new visual language
  beyond ADR-0022 scope; not adopted this round.

## Still open / honest state

- Post-fix re-capture and re-review of the four adopted fixes is
  **pending** — this directory records the pre-fix captures that
  motivated `1bbe8d04`. A v15 matrix should verify the hero CTAs, the
  anchored planned note, Now-list hierarchy and footer links before
  any design PASS is declared.
- `text.muted` small-metadata contrast remains the standing
  borderline item from v12 (measured ≥4.5:1 by the tone e2e; a
  token-level change is a site-wide palette decision).
- Design PASS is NOT declared: #1108–#1110 acceptance still requires
  the post-fix verification round and the owner copy decision
  (`pending`) on the issue-352 activity strings.
