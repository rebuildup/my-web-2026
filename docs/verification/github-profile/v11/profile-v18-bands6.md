You are an independent design critic re-reviewing REFINED GitHub profile README visual prototypes (github.com/rebuildup). Round v14 found critical layout defects; this round (v6) claims all blockers fixed. Verify each fix AND re-check the root requirement.

## Images
- v6-desk.png: desktop mock showing Band1 dark, Band1 light, Band2 dark, Band2 light (800px each), then mobile variants (560w) of both bands in dark+light.
- v6-mob.png: the same page at narrow width.

## Root requirement (unchanged)
Non-text-dominant information design: overview/relationships/importance graspable without reading; status & activity types visually identifiable; focus projects as visual weight map; data-appropriate encodings; text only for names/numbers/supplements; no information deletion.

## v17 blockers — verify EACH is resolved
0. (v17 BLOCKER) Desktop Band2: inline legend ('push PR new del') shared the same top y-band as plotted event stacks — event shapes at -48h/~-38h collided over legend labels.
1. (v17 POLISH) Mobile Band2 dark right-column counts still low contrast.
2. (v17 POLISH) Desktop Band2 commit-dot/PR-square capping read as dishonest vs '● = 50 commits' legend.
3. (v17 POLISH) Desktop Band1 weight-segment legend deleted entirely.
4. (v17 POLISH) TOP LANGUAGE secondary labels lacked color swatches (desktop+mobile); mobile 'of A+ tier' placement; mobile row descender spacing.

## v16 blockers (still verify)

0. (v16 NEW) Desktop Band2: purple PR squares collided over count column on all 10 rows; long commit-dot rows ran into PR-square clusters.
1. (v16 NEW) 72h pulse chart rendered EMPTY on desktop AND mobile despite '29 public events' footer (root cause: shape elements were never appended to the SVG).
2. (v16 NEW) 72h event-type legend showed text only, no shape icons; zero differentiated shapes on timeline.
3. (v16 NEW) Mobile Band2 PR squares clamped at 4 on 572p/352p/540p while +24 more public (211p) showed 8 — magnitude inversion.
4. (v16 NEW) Dark-mode low contrast on Band2 counts/aggregates/axis ticks/legends and mobile muted labels.
5. (v16 NEW) Mobile deleted secondary languages ('C# 40.9 · C++ 7.9 · +3'), 'JST' on feed rows, event-count footer; micro-labels ~6-8px.

## v15 blockers (still verify)

0. (v15 NEW) Band1: '27 repos · 1y' collided over dot row 3; weight bars collided over 'personal web platform'; bottom-right legend collided over 'After Effects' bars.
1. (v15 NEW) Band2: 72h event timestamps clipped right edge; row3 collided with 'N public events' footer; 'new' legend overflowed chart box.
2. (v15 NEW) Band2 mobile: 72h chart rendered empty.
3. (v15 NEW) Mobile variants deleted PR metrics, language %, rank tier context.
4. (v15 NEW) Dark-mode muted text/counts low contrast.
5. (v15 NEW) 72h event-type shapes unreadable desktop / absent mobile.

## v14 blockers (still verify)

1. Band1: 4th project 'After Effects' was missing/clipped; my-web-2026 & Tastile clipped at bottom; labels over glyphs; overlapping rings.
2. Band2: commit dots overran counts & bled into the 72h panel; 'private repos (aggrega' truncated; hollow dots unexplained; header JST vs feed UTC mismatch.
3. Band1 vitals collisions: '27 repos' over dots, 'C / A+ tier' over B+ arc, flame touching '204'.
4. Mobile: illegible ~4-5px text; 42-dot rows that can't survive 350px.
5. Dark-mode contrast on muted labels.
6. 72h pulse: color-only identical diamonds for different event types.

## Also verify (from v14 polish list)
- Band1 vitals boxing vs IN PROGRESS hierarchy; weight-segment grammar clarity; TOP LANGUAGE secondary colors without swatches.
- Band2: leftBottom rule position, recent-events JST labels, 'times JST' footer honesty.

## Output
Per image region: concrete observations with positions. Then per blocker: FIXED / NOT FIXED / PARTIAL with evidence. Then per-band M1–M7 (text-dependence, visual semantics, glance, hierarchy, honesty/legibility, GitHub fitness, improvement-vs-current) MET/PARTIAL/MISSING for dark and light.
Final verdict: APPROVE / APPROVE WITH FIXES / REQUEST CHANGES — and if changes remain, rank them BLOCKER vs POLISH.
