You are an independent design critic reviewing VISUAL PROTOTYPES for a GitHub profile README redesign (github.com/rebuildup). This is NOT a polish review of an existing implementation — it is a comparison of three candidate information designs, and your verdict decides which direction the real implementation takes.

## What you are looking at

Screenshots of a local mock that reproduces GitHub README rendering constraints (no custom CSS; content arrives as pre-rendered SVG/WebP <img> assets plus minimal Markdown). All data shown is REAL: live GitHub activity snapshot (38 repos, 30-day window), Discord presence, contribution streak (204 days), GitHub rank B+, top languages (TS 45.8% / C# 40.9% / C++ 7.9%), and a declared-focus roster of 4 projects.

- shot-desk-light.png / shot-desk-dark.png: desktop-width full page. Three prototype sections top→bottom:
  - **PROTO A "Vitals board"** (800×400 SVG): header with presence orb; 4 vitals cells (streak flame+number, top-language stacked bar, contributed-to dot cluster, rank ring); "DECLARED FOCUS" node field (4 project nodes sized/colored by weight, dashed links from primary); bottom strip "ACTIVITY · LAST 72H" event-pulse timeline + repo-output isotype (commit dots / PR squares).
  - **PROTO B "Landscape"** (800×360 SVG): left = repo output isotype (9 repos, dot rows scaled by commits, purple squares = PRs, counts at right); right = 72h event pulse panel + 3 most recent events as glyph+text lines.
  - **PROTO C "Poster"** (800×560 SVG): identity block (monogram, name, tagline, presence dot) + vitals strip + IN PROGRESS node field + thin 72h pulse + SELECTED WORK cover thumbnails.
- shot-mob-light.png: same page at mobile width — note that real implementation would serve stacked variants; judge whether the visual language survives narrowing.

## The owner's root requirement (this is the standard you enforce)

The profile must STOP being text-dominant. A viewer must grasp the overview, relationships and importance of the information WITHOUT reading text sequentially. Concretely:

1. **Information is not carried by text**: status/activity type must be visually identifiable (shape/color/position), in-progress projects must read as a visual relationship map rather than a list, GitHub activity/streak/metrics must use forms appropriate to their meaning (flame for streak, proportion for languages, timeline/density for activity), and icons/shapes/colors/layout must DO information work. Text is allowed only for proper nouns, numbers and short supplements.
2. **Glance comprehension**: at first look the viewer should get "who this is, what they're doing now, how active they are" before reading anything.
3. **Meaning preserved**: this is NOT solved by deleting information — every existing feature (activity by repo, feed, streak, stats, top langs, presence, focus projects, work showcase) must remain represented.
4. **Main/sub/decor semantics** for Selected Work remain a separate concern (the animated showcase asset is already approved); judge only whether these status/activity compositions are coherent with it.
5. **Functionality + personality**: it must still work as a GitHub profile (recognizable conventions help) while looking like a designed object, not a dashboard template.

## Mandatory evaluation (answer EACH, per prototype A/B/C)

- M1 Text-dependence: what fraction of the information is ONLY available by reading text? Flag any block that is effectively a text card with decoration.
- M2 Visual semantics: does each visual element encode real data (not decoration)? Call out elements that are purely ornamental.
- M3 Glance test: describe what a viewer understands in the first 2 seconds, without reading.
- M4 Hierarchy: is the most important thing (current work / status) visually dominant? What competes with it?
- M5 Honesty/legibility: are encodings truthful (e.g. isotype dot counts, pulse timeline) and legible at ~350px render width?
- M6 GitHub fitness: does it read as a GitHub profile asset (Camo <img>, fixed themes, no interactivity)?
- M7 Improvement vs current: the current implementation is text-panel SVG cards (labels + rows + numbers). Is each prototype ACTUALLY less text-dominant, or just restyled text?

## Output format

For each prototype A/B/C: per-metric observations (concrete, cite positions), then MET/PARTIAL/MISSING per M1–M7.
Then: **comparison verdict** — which prototype(s) should advance to implementation, which should be rejected and why, and the single most important structural change needed regardless of winner.
Final verdict: ADVANCE A / ADVANCE B / ADVANCE C / ADVANCE A+B hybrid / REJECT ALL — with reasoning tied to the owner's root requirement, not to polish-level preferences.
