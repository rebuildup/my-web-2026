# Review: GitHub profile band SVGs — production implementation, round 4

These screenshots render the REAL implementation (`src/http/github-profile/bands.ts`)
served live with real snapshot data. Round 3 addresses the whole-profile review
findings; verify each fix and re-check M1–M7.

## Round 4 changes vs round 3 (verify each round-3 fix landed, then these)

Round 3 fixes now in place: 400px mobile canvas; proportional commit bars with
legend-declared max; adaptive PR-square unit printed in legend; dim aggregate
rows on the same bars; desktop focus rail + 'you' hub; 'best NNNd' streak
benchmark and 'NN,NNN all-time' rank metrics.

Round 4 deltas:
- CONTRIBUTED TO dot grids now render every shown dot at uniform opacity —
  the unexplained bright/dim split is gone; overflow is '+N over' text only.
- Mobile TOP LANG sub-legend measures the full 'name pct' label before
  advancing — no swatch/text collisions.
- REPO OUTPUT PR squares moved to a FIXED column immediately right of the
  commit-track guide line (desktop: after barX+barMaxW+8; mobile: after the
  190px track) — they can no longer sit on the grey track or cross the guide.
  Desktop cap 12 squares, mobile cap 4; unit still adaptive + legend-declared.
- LAST 72 HOURS recent-event bullets now use the same per-type shapes as the
  chart (circle=push, diamond=PR, triangle=new, cross=del).
- Mobile REPO OUTPUT → LAST 72 HOURS spacing increased (~46px gap).
- Event shapes are clamped above the time-axis baseline (no descenders below).
- Desktop focus rail now terminates AT the last node, not past it.

## Mandatory criteria (M1–M7)
- M1: information transfer is NOT text-dominant (glanceable shapes/position carry meaning)
- M2: visual elements carry information semantics (not decoration)
- M3: overview + importance graspable at a glance
- M4: hierarchy correct (identity/vitals/focus; repo-output/pulse)
- M5: honesty + legibility (no invented values, '—'/empty states honest, labels match encodings, encodings monotonic, no truncation collisions, private data anonymous)
- M6: GitHub README fitness (SVG-as-image safe, readable at ~45% scale; mobile 400px wide)
- M7: improvement vs the previous text-panel card stack

## Image order
1. identity-dark-desk.svg.png (800×360)
2. activity-map-dark-desk.svg.png (800×340)
3. identity-light-desk.svg.png
4. activity-map-light-desk.svg.png
5. identity-dark-mob.svg.png (400×580)
6. activity-map-dark-mob.svg.png (400×660)
7. identity-light-mob.svg.png
8. activity-map-light-mob.svg.png

## Known intentional differences
- Focus notes are truncated authored `statusJa` lines
- Presence may read 'Discord stale' (honest stale state)
- Language bar may include a grey 'Other' remainder segment
- Mobile legend/footer text is intentionally small but must stay legible

## Verdict format
APPROVE only if zero blockers. Otherwise REQUEST CHANGES with per-image findings
(severity: critical/major/minor) referencing the image order above.
