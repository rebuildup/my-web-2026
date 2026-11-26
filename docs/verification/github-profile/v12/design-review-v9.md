# Independent design review — GitHub profile bands v9

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

## Prior round (v8) findings — verify each is resolved

1. [MAJOR] Band3 all: 0.5-opacity secondary chips read as disabled/muddy (Rust salmon, Go baby-blue, Unity/Python/Android Studio/PowerShell silhouettes).
2. [MAJOR] Band1 desktop: trend-up icon floated ~35-40px from '35,296' digits (over-conservative estimate); wanted both KPIs left-aligned like mobile at clean column starts.
3. [MAJOR] Band1 desktop: Discord status floated ~90px short of right margin; meta stats wrapped asymmetric 4+1 stranding 'repos contributed to'.
4. [MAJOR] Band3 mobile: 30/22px chips too small, ~85-115px dead right margin.
5. [MINOR] Band3 desktop: right-column lanes ended ragged ~15-35px short of Band 1-2 margin; looser gap below substrate label.
6. [MINOR] '28 repos contributed to' vs '38 active repos' still read as paradox.
7. [MINOR] Band2: 100%-looking top bar + divergent legends; Total buried in 11px; repeated 'Nov 24 ·' stamps; mobile count-separator drift + wide mono stamps.
8. [MINOR] Band1 mobile: staggered second meta row ('28 repos contributed to' right of '16,743 commits').

## Changes made for v9

- Band3: SECONDARY_IDS opacity removed entirely — lane-level 40/28 chip ratio is now the only hierarchy (no disabled-looking badges).
- Band3 desktop+mobile: single-row lanes now STRETCH pitch edge-to-edge (pitch = left-edge delta), so every lane's icons span the full lane width — right edges flush at the cell margin, no ragged finish, no dead mobile margin. Mobile chips: craft 42px, substrate 30px.
- Band1 desktop: BOTH hero KPIs now left-anchored like mobile (icon + fixed gap + digits, label under digits) at x=24 and x=212 — no floating icon, no end-anchor estimate at all.
- statusLine desktop: detail run is text-anchor="end" at the right margin — flush-right guaranteed regardless of width-estimate error; head+icon flow left with padded estimates (gap can only widen).
- Band1 meta: 'repos contributed to' replaced by GitHub rank percentile ('top 45% on GitHub', Lucide award glyph) — kills the 28-vs-38 paradox with a real non-conflicting signal. metaRow now balances wraps (a lone last-line item steals one from the previous line → n+1/n instead of n+4/1).
- Band2: event stamps compacted to 'Nov 24 02:46 JST' (middot dropped inside the stamp); mobile repo counts split into the same fixed commits|PRs sub-columns as desktop; legends unified to 'bar = commits · full = X' on both breakpoints; Total line bumped to 10px/9.5px weight 700.
