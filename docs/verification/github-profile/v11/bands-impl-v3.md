# Review: GitHub profile band SVGs — production implementation, round 3

These screenshots render the REAL implementation (`src/http/github-profile/bands.ts`)
served live with real snapshot data. Round 3 addresses the whole-profile review
findings; verify each fix and re-check M1–M7.

## Round 3 changes (verify each)

1. Mobile canvas is now 400px wide (was 560 squeezed to ~5-6px text). All mobile
   type, shapes, and spacing were resized for legibility at 390px viewport.
   Mobile band1 is now 580h, band2 660h.
2. Desktop REPO OUTPUT: commit dots replaced by proportional bars (track +
   fill, full bar = legend-declared max commits). PR squares now follow each
   bar's END (no fixed column, no empty void) and use an adaptive unit —
   legend prints '■ ≈N PRs' where N is computed so the busiest row fills the
   track. Aggregate rows ('+N more public', 'private repos · sum') use the
   same bars at dim opacity — their volume must be visible, not blank.
3. Mobile REPO OUTPUT: same proportional-bar scheme sized for 400px; PR unit
   adapts (legend '■ ≈150 PRs' etc.), max 4 squares.
4. Band1 focus map (desktop): nodes now sit on a horizontal rail anchored by
   an owner 'r'/you hub node at left — hub-and-spoke is the only relationship
   the roster declares; no invented project-to-project edges.
5. New metrics: streak cell shows '· best NNNd' (longest streak); rank cell
   shows 'NN,NNN all-time' (total contributions). Mobile cells carry the same.
6. Mobile band1 vitals are 2×2 cards with larger type (streak 23px, names 13px).

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
