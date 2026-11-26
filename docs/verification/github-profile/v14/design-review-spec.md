# Independent design review — GitHub profile, design-foundation rebuild (v14)

You are a senior product/graphic designer reviewing a REBUILT GitHub
profile README. This is NOT a spec-conformance check and NOT a
micro-adjustment review — the whole composition was re-architected on a
shared design contract (12/6-column grid, 4px baseline, spacing scale,
type roles, icon scale, SMIL motion rules). Judge the DESIGN ITSELF.
Do NOT assume the current layout is correct — critique it.

## Context

Profile of `rebuildup`, a Japanese designer-developer (After Effects
tools, web apps, motion design, video). The README (whole-page images
`pub2-*.png`) contains: intro line, links, an approved animated
Selected Work showcase (static frame shown), then three SVG bands —
Identity (`identity-*`), GitHub Activity (`activity-map-*`), Technology
Stack (`stack-*`) — then a footer credit line.

The `*-grid.png` variants overlay the shared grid (red column guides +
type-size legend) so you can verify the design system is actually
applied: check whether text baselines, column edges and module gaps
really sit on the contract, or whether the grid is decorative.

Reference points for "good": editorial layout systems (baseline grid,
column grid, modular scale), real GitHub profile conventions
(github-readme-stats, contribution graphs, skill-icon strips), Discord
client UI, honest data-viz practice.

## Hard requirements from the owner (violations = BLOCKER)

- No text standing in for icons; no hand-drawn glyphs. All icons must be
  real SVG path data (Simple Icons / Lucide).
- Discord presence must read as Discord UI at a glance (avatar + ringed
  status dot on a card), and must distinguish "data fetched" from
  "online status".
- No fabricated content: no hardcoded "in progress" items unrelated to
  real data; unmeasured must not render as zero; observation time must
  not be labelled "now".
- Stack must compress VERTICALLY via horizontal motion (marquee), not
  via static grids or stacked rows. All 48 committed tech icons must be
  represented; categories must carry meaning (not one flat list).
- GitHub renders these SVGs inside <img> at ~800px (desktop) / ~400px
  (mobile) CSS width — judge legibility at THOSE sizes, not at SVG
  source pixels.

## What to evaluate (all mandatory)

1. **Whole-page composition** (`pub2-*`): reading order, focal point,
   visual weight distribution, whether the three bands feel like ONE
   designed system or three pasted panels. Compare desktop vs mobile
   height budget.
2. **Grid/baseline discipline** (`*-grid`): do edges, baselines and
   gaps actually land on the guides? Flag systematic drift.
3. **Information hierarchy**: does size/weight/position match
   importance? Any element competing equally that shouldn't?
4. **Meaning of visuals**: does every graphic carry information?
   Honest encodings? Decodable without a legend manual?
5. **Identity band**: avatar+Discord presence unity, stat hierarchy
   (no extreme size gaps), language bar vs legend consistency.
6. **Activity band**: repo output bars honest? 72h pulse readable?
   Recent events scannable? Numbers+units repetition acceptable?
7. **Stack band**: do the 4 category lanes read as categories? Is the
   marquee tasteful (speed, edge fades, no jitter)? Does 48-icon
   coverage feel comprehensive without clutter?
8. **Typography & whitespace**: type scale, alignment, density —
   designed or assembled? Any text too small at GitHub display size?
9. **Verdict**: would you put this on a profile you admire? Top 3
   changes ranked.

## Images (in .tmp/review-v14/)

- Whole profile: pub2-desk-dark.png, pub2-desk-light.png,
  pub2-mob-dark.png, pub2-mob-light.png
- Identity: identity-{dark,light}{,-mob}{,-grid}.png (8)
- Activity: activity-map-{dark,light}{,-mob}{,-grid}.png (8)
- Stack: stack-{dark,light}{,-mob}{,-grid}.png (8)

Note: the stack marquee is animated — a still shows one frame; judge
composition, not motion smoothness.

## Output

Verdict: APPROVE / APPROVE WITH FIXES / REQUEST CHANGES.
Findings grouped BLOCKER / MAJOR / MINOR / INFO, each naming the image
and region plus a concrete direction. Be harsh — this is the third
rebuild; a polite pass on a dashboard-looking result is a failure.

---

## Round 2 addendum (2026-11-26)

All images in `.tmp/review-v14/` were RE-RENDERED after round-1 fixes.
Round-1 verdict was REQUEST CHANGES. Verify each claimed fix against the
new images, then re-judge the whole:

- Mobile identity title/subtitle collision → mobile now renders name
  only (no tagline); verify clearance.
- Stack mobile header collision → SVG display titles removed
  (`GITHUB ACTIVITY`, `TECHNOLOGY STACK` gone); README H2 owns names.
- Marquee fade erasing lane labels → fades are scoped per-lane to the
  icon row only; verify `LANGUAGES` etc. are intact on mobile.
- Discord split-brain/double ring → GitHub avatar no longer carries a
  status badge; the Discord card is the single presence surface
  (blurple logo, cutout status dot, one sync stamp footer).
- Type scale → real steps now (display 20 / hero 30·28 / title 12·13 /
  body·strong·data 13·14 / label·caption 12·13); verify the grid legend.
- 72h pulse → JST day-boundary ticks + `peak N/hr` caption + time-only
  right endpoint; verify decodability.
- Stack lanes rebalanced 12/13/12/15 icons (≥11 per lane → no in-frame
  duplication); chips 36px desktop / 30px mobile; height now 288/340.
- Repo table → dim aggregate rows draw muted bars on the same scale;
  per-row PR icons removed; column headers carry units once.
- README `## Now` renamed `## Profile`; intro copy tightened.

Same verdict format and harshness bar.

---

## Round 3 addendum (2026-11-26, second re-render)

Images in `.tmp/review-v14/` were RE-RENDERED again after round-2 fixes.
Round-2 verdict was REQUEST CHANGES. Verify each claimed fix, then
re-judge the whole with the same bar:

- RECENT EVENTS desktop → single column, stamp in its own right-aligned
  column; `+N more` honest remainder.
- 72h axis → day-boundary labels suppressed within 64px of endpoints
  (tick marks remain); `peak N/hr` caption now right-aligned to the
  LEFT module's own edge.
- 'ALL-TIME CONTRIBUTIONS' → 'CONTRIBUTIONS' + 'all-time · 28 repos'
  note; desktop avatar↔name gap now a fixed 16px; redundant domains
  line dropped (README intro owns it).
- Discord card → Clyde logo with bottom-right cutout-ringed status dot
  (the client idiom); still single sync stamp footer.
- Dead header voids → band headers removed entirely; observation meta
  + degraded-source warning moved to a footer line. Stack top/bottom
  padding symmetric.
- Type scale → real steps: title 13·14 / body·strong·data 14·15 /
  label·caption 12·13 (hero 30·28, display 20·18); grid legend now
  resolves through the same mobile table.
- Mobile repo table → 'REPO' sub-label dropped, '30D COMMITS' units
  intact, dim rows get bar breathing room + 0.45 opacity.
- Stack → honest regrouping 9/12/12/15 = 48 (Design & motion is now
  pure creative tools; styling langs moved to 'Web & app'; cloudflare
  to infra); desktop scroll field narrowed to cols 5–11 so the 9-icon
  lane period still fills the frame; mobile pitch 42px keeps every
  lane > viewport; edge fades now have a solid lip (no guillotined
  icons); dark chip stroke strengthened.
- Identity totals use sans numerals (mono reserved for repo names and
  activity columns).

---

## Round 4 addendum (2026-11-26, third re-render)

All images in `.tmp/review-v14-r4/` were RE-RENDERED after round-3 fixes.
Round-3 verdict was REQUEST CHANGES (2 blockers + majors). Verify each
claimed fix against the NEW images, then re-judge the whole:

- Marquee fade slivers → edge dissolution is now an SVG `<mask>`
  (pure black at both clip boundaries) applied to the scrolling group,
  replacing painted fade overlays. Check all four `pub2-*` frames and
  `stack-*` band shots for ANY residual sliver/hairline at lane edges.
- Discord presence → card is now a whisper-tint surface holding a
  34px circular USER avatar (GitHub avatar image) with the Discord-
  idiom cutout ring + status dot at bottom-right; small Clyde mark +
  'Synced via Discord · stamp' footer. No grid-snapped text inside.
- Stack dead canyon → desktop viewport reclaimed to cols 4–11
  (496px), chips 40px + 20px gap (pitch 60, shortest period 540px);
  '48 technologies · 4 activity areas' moved to a bottom-right footer;
  lanes now start at the top margin like peer bands.
- Type hierarchy → `title` role bumped to 14/15px w800 (no longer
  smaller than body); RECENT EVENTS rows now render repo in semibold
  sans + verb as muted caption (no more bold-mono shouting).
- Copy → README intro trimmed to tagline + links only; Band2 window
  meta moved onto the REPO OUTPUT module head ('last 30 days ·
  observed … JST · source warn'); footer line removed; bar-scale
  legend moved to the Total line's right edge.
- Mobile repo bars → whisper track + meter zone ending at the
  '30D COMMITS' column edge (no more 100%-width divider bars).
- Pulse → dashed peak guide at the quoted peak height; wider axis
  label guards; event stamps on other days now 'Nov 24 02:46'.
- Grid overlay → stray right-edge guide removed; activity-map bottom
  padding now matches peers.

Same verdict format and harshness bar. Images live in
`.tmp/review-v14-r4/` (same filenames as before).

---

## Round 5 addendum (2026-11-26, fourth re-render)

All images in `.tmp/review-v14-r5/` were RE-RENDERED after round-4 fixes.
Round-4 verdict was REQUEST CHANGES (2 mobile blockers + majors).
Verify each claimed fix, then re-judge:

- Mobile `Total`/legend collision → legend now gets its OWN caption
  line under `Total` on compact; desktop keeps the right-edge legend.
- Mobile `REPO OUTPUT`/meta collision → mobile head meta shortened to
  `30d · observed … JST` (the '30D COMMITS' column header carries the
  window); verify clearance incl. the degraded-source suffix path.
- Stack mask right-edge guillotine → `stkgR` gradient stops were
  inverted (white held to 80%, black only in last ~9px); now symmetric
  20%-lip + 80% ramp both sides. fadeW: 48px desktop / 32px mobile.
- Clyde mark black-on-dark → now Discord blurple (#7983f5 dark /
  #5865f2 light) via theme token.
- Stack canyon/spine → desktop viewport moved to cols 3–11 (560px,
  pitch 64px → shortest period 576px); label rail cols 0–2.
- Mobile lane proximity → inter-lane gap now 16px (was 4px); footer
  clearance 16px; copy now '48 technologies · 4 categories'.
- Type scale → `title` is now a true eyebrow (12/13px w700, +1.4
  tracking, lh 16) below body — structural, not competing; REPO
  OUTPUT repo names switched mono→semibold sans (mono reserved for
  tabular counts); desktop bars got the same whisper track as mobile;
  mobile aggregate pitch 32px.
- Pulse → peak guide now T.faint @0.5 (was invisible T.line@0.5);
  day-boundary ticks drawn at every JST midnight incl. label-suppressed
  ones; edge guards widened (96/92px) so '72h ago'/'Nov 22' can't crowd.
- Event rows → wider truncation budget (stampW 92, tighter reserves);
  other-day stamps 'Nov 24 02:46'.
- Identity note → 'all-time · 28 public repos' (scope qualifier for
  the 28-vs-38 discrepancy); desktop Discord card narrowed to ~312px
  right-aligned.

Same verdict format and harshness bar. Images in
`.tmp/review-v14-r5/`.

---

## Round 6 addendum (2026-11-26, fifth re-render — APPROVE WITH FIXES follow-up)

Round-5 verdict was **APPROVE WITH FIXES** (zero blockers). All images
in `.tmp/review-v14-r6/` were RE-RENDERED after the fix batch. Verify
each fix, then give a final verdict:

- Mobile `all-time · 28 public re...` truncation → focalStat notes now
  measure with the flowing estimator against the module's real column
  span; `all-time · 28 public repos` should render untruncated.
- Pulse ticks mimicking bars → day-boundary ticks now hang BELOW the
  axis rule into the annotation zone (labels shifted +3px, bottom pad
  +4px).
- Dark-mode avatar silhouette → 1px hairline circle under the status
  dot cutout on all themes.
- Mobile stack self-overlap → mobile pitch 46px (9×46=414 > 388 viewport).
- Mobile degraded-source suffix → on compact the warning renders as its
  own caption line under REPO OUTPUT (healthy state unchanged).
- Event timestamps → monospace (tabular) so colons align.
- README intro orphan `×` → non-breaking spaces around the tagline.
- Grid legend → unused `display` role removed from the type legend.

Same verdict format. Images in `.tmp/review-v14-r6/`.
