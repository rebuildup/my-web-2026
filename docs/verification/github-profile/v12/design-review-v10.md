# Independent design review — GitHub profile bands v10

You are a senior product/graphic designer reviewing SVG renders of a GitHub
profile README's dynamic sections. Judge the DESIGN ITSELF, not spec
conformance. Do NOT assume the current layout is correct — critique it.

## Context

This is the profile of `rebuildup`, a Japanese designer-developer
(After Effects tools, web apps, motion design, video). The README already
contains: intro text, an approved animated Selected Work showcase, then
these three bands, then footer links.

Reference points for "good": real GitHub profiles that feel personal
(github-readme-stats cards, contribution graphs, skill-icons strips),
Discord client UI, data-visualization best practice (honest encodings,
clear hierarchy), and editorial whitespace/typography standards.

## Anti-goals (the user's explicit complaints about prior iterations)

- Generic "stats dashboard" feel: boxed cards, equal-weight cells,
  everything shouting.
- Text standing in for icons; hand-drawn glyphs.
- Dishonest data: fake "in progress" items, unmeasured shown as zero,
  observation time labelled "now".
- Excessive mobile height.

## What to evaluate (all mandatory)

1. **First-glance comprehension**: at a glance, what is this person and
   what are they doing? Is there a clear focal point and reading order?
2. **Information hierarchy**: do size/weight/position match importance?
   Is anything competing equally that shouldn't?
3. **Meaning of visuals**: does every graphic carry information (not
   decoration)? Are encodings honest and decodable without a legend
   manual?
4. **GitHub-native language**: do the stats/activity visuals resemble
   what GitHub users already know (stats card, contribution/pulse
   metaphors, repo output)?
5. **Discord presence**: does the presence card read as Discord status
   at a glance (avatar + ringed status dot)? Is the status honest?
6. **Typography & whitespace**: type scale, alignment, density, breathing
   room — does it feel designed or assembled?
7. **Mobile**: is everything legible at 400px? Is vertical length
   justified?
8. **Overall**: would you put this on a personal profile you admire?
   What are the top 3 changes, ranked?

## Images (in order)

Band 1 identity — desktop dark, desktop light, mobile dark, mobile light.
Band 2 activity-map — desktop dark, desktop light, mobile dark, mobile light.
Band 3 stack lanes — desktop dark, desktop light, mobile dark, mobile light.

## Output

Verdict: APPROVE / APPROVE WITH FIXES / REQUEST CHANGES.
Then findings grouped BLOCKER / MAJOR / MINOR / INFO, each with the image
region and a concrete suggested direction. Be harsh — a polite pass on a
dashboard-looking result is a failure of this review.

## Prior round (v9) findings — verify each is resolved

1. [MAJOR] Band1 desktop: ~95px gulf between 'Discord Offline' and
   '· last synced …' — status head and sync detail must read as one
   cohesive right-aligned unit.
2. [MAJOR] Band1 desktop meta stats: justified 5-stat wrap left a ~170px
   void mid-row-2 — wanted fixed-column layout.
3. [MAJOR] Band1 all: 'top 46% on GitHub' with award icon undermined the
   profile (reads as failure) — stat dropped entirely.
4. [MAJOR] Band2 REPO OUTPUT: full-width track rails behind
   max-normalized bars read as misleading progress meters — rails removed.
5. [MINOR] Band1 mobile meta row 2: flow-row misalignment (~15px shift).
6. [MINOR] Band3 desktop INFRA & DEV TOOLS: 28px chips vertically centered
   in the 40px row → loose label gap vs other lanes.
7. [MINOR] Band2 events: 'Nov 24'+'JST' repeated per row, punctuation
   mismatch vs header, '+N more' stranded under column 1.

## Changes made for v10

- Band1 desktop statusLine: ONE text-anchor="end" run — Discord glyph +
  status word + '· last synced …' detail all flow as a single cohesive
  cluster pinned flush-right (xml:space="preserve" tspan). No gulf, no
  orphan middot.
- Band1 meta stats: metaRow (flow/justify) replaced by metaGrid — a
  fixed 2-column grid, text right-aligned to each column edge, icon
  hugging the text's left edge. Desktop x=W/2+16, mobile x=16, same
  geometry both breakpoints → vertical column alignment everywhere.
- META_STATS trimmed to stars / commits / PRs / issues — the rank
  percentile ('top N% on GitHub') and its award glyph removed entirely.
- Band2 REPO OUTPUT: background track rails deleted on both layouts —
  bare accent bars grow from the left baseline; unmeasured commits draw
  no bar at all.
- Band2 events: stamps collapse to 'HH:MM' when the event lands on the
  observed JST day (header already declares it once); other days keep
  'Nov 24 · 02:46'. 'JST' suffix dropped from every row stamp.
  '+N more' moved to a right-aligned footer line under the whole grid.
- Band3: every lane's icon row now top-aligns at the same
  label-to-chip offset (iconsY = label bottom + 2 for all lanes); chip
  y = iconsY + row*pitch with no per-lane vertical centering — the
  28px substrate chips bind to their label exactly like the 40px craft
  chips.
