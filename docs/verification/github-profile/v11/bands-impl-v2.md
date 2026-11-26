# Review: GitHub profile band SVGs — production implementation, round 2

These screenshots render the REAL implementation (`src/http/github-profile/bands.ts`)
of the approved two-band design, served by the live endpoints with real snapshot
data (seeded D1 + vendored readme-stats fetchers). Layout/geometry must match the
approved prototype (`docs/verification/github-profile/v11/proto-gen6-approved.mjs`,
agy v19 APPROVE). Data values differ from the prototype by design — judge visual
quality and honesty, not exact numbers.

Round 2 changes vs round 1 (verify each fix):
- LAST 72 HOURS x-axis 'now' is now anchored to the snapshot observation instant
  (header 'observed … JST'), not render wall-clock — the right edge must align
  with the newest listed event, no false empty tail.
- REPO OUTPUT PR squares now encode ceil(prs/100) capped at 4 (legend '■ ≈100 PRs')
  — check the '+N more public' aggregate rows no longer visually outrank repos
  with more PRs.
- Commit dots on dim/aggregate rows use a higher opacity floor — must be clearly
  legible dots, not faint ellipsis specks.
- Mobile IN PROGRESS rows render enlarged tier pips (13×5) matching the footer
  legend '■■■ primary  ■■ active  ■ side'.
- Mobile CONTRIBUTED TO header now carries the total count ('· N'); bottom-right
  shows '+N over' only on overflow, else 'all time'.

## Mandatory criteria (M1–M7)
- M1: information transfer is NOT text-dominant (glanceable shapes/position carry meaning)
- M2: visual elements carry information semantics (not decoration)
- M3: overview + importance graspable at a glance
- M4: hierarchy correct (identity/vitals/focus; repo-output/pulse)
- M5: honesty + legibility (no invented values, '—'/empty states honest, labels match encodings, JST consistent, private data anonymous, no truncation collisions, encodings monotonic)
- M6: GitHub README fitness (SVG-as-image safe, readable at ~45% scale)
- M7: improvement vs the previous text-panel card stack

## Region map (top→bottom in the composite screenshot)
1. identity dark desk (800×360)
2. activity-map dark desk (800×340)
3. identity light desk
4. activity-map light desk
5. identity dark mobile (560w)
6. activity-map dark mobile
7. identity light mobile
8. activity-map light mobile

## Known intentional differences vs prototype
- Focus notes are truncated `statusJa` (authored Japanese one-liners), not English glosses
- Rank caption reads 'top X% / rank' instead of 'of A+ tier'
- Contributed label has no '1y' suffix (count is all-time repositoriesContributedTo)
- Presence may read 'Discord stale' (seeded snapshot is old — honest state, not a bug)
- Language bar may include a grey 'Other' remainder segment

## Verdict format
APPROVE only if zero blockers. Otherwise REQUEST CHANGES with per-region findings
(severity: critical/major/minor) referencing the screenshot regions above.
