# HOME site-guide field panels — Issue #968 owner directive (2026-11-19)

Owner rejected the frozen `a5df2fcc` candidate because HOME did not use
the design system's accent colours as **flat information-carrying
areas**. This record documents the redesign and its rendered-screen
verification.

## What changed

`src/home/guide/GuideSection.tsx`: every station's content cell is now
a flat field panel instead of a plain block with a coloured node.

| Station | Panel token | Resolved colour (light) | Information it carries |
| --- | --- | --- | --- |
| About | `accent.field.writing` | `#eab308` | classification: writing |
| Portfolio | `accent.field.design` | `#ec4899` | classification: design |
| Dotfiles | `accent.field.code` | `#06b6d4` | classification: code |
| Keyboard | `accent.field.design` | `#ec4899` | classification: design |
| Tools | `mono.surface.sunken` | `#e0e0da` | `tool` has no approved field step (its 500 step cannot carry the 4.5:1 text ratio); the class still shows through the mark |
| Contact | `mono.surface.sunken` | `#e0e0da` | classless facility — neutral panel + capsule node |
| GitHub (external spur) | `mono.surface.inverse` | `#101012` | relationship: "this destination leaves the site" as a large-area statement; the panel inverts with the theme (`#f2f2ef` in dark) |

The route line and station node are unchanged: the node keeps
`accent.category.*` fill + `StateMark` silhouette on the rail OUTSIDE
the panel, so mark and field never merge. Legend still names every
mark. `tool` deliberately has no field: `tool.500` (#6366f1) measures
~4.3:1 against `mono.ink.onColour`, below the 4.5:1 normal-text
minimum — the canonical exclusion is preserved and now documented in
`src/editorial/colors.md` ("Fields as information surfaces").

## Rendered-screen verification

Before: production `https://rebuildup.dev/` (the route-map guide as
shipped in v0.9.0). After: local dev render of this branch.
Screenshots (section element, full height):

- `before-desktop-light.webp` / `before-desktop-dark.webp` (1440×900)
- `before-mobile-light.webp` / `before-mobile-dark.webp` (390×844)
- `after-*.webp` — same four combinations

Measured on the rendered DOM (computed styles, all four combinations):

- Panel fills resolve to the expected tokens: writing `#eab308`,
  design `#ec4899`, code `#06b6d4`, sunken `#e0e0da`/`#050506`,
  inverse `#101012`/`#f2f2ef` (inverts per appearance by design).
- Text-on-field contrast (WCAG ratio, computed colours):
  light — writing 9.91:1, design 5.39:1, code 7.83:1, sunken
  14.34:1 / muted 4.77:1, inverse 17.54:1; dark — 10.31 / 5.61 /
  8.15 / 18.16 / 6.19 / 17.64 :1. Every pair ≥ 4.5:1 (AA normal).
- Panel sizes: desktop ≈299px wide columns (site route) and ≈170px
  (external spur); mobile ≈273px full-width panels. No horizontal
  overflow at either width (`scrollWidth == clientWidth`).
- Keyboard: Tab focuses the first station link with a 2px solid
  `mono.ink.onColour` outline on the field panel (`:focus-visible`
  matches). Child links and the `<summary>` toggle use the same ink
  per skin.
- Reduced motion: `prefers-reduced-motion: reduce` honoured; the guide
  itself has no animation (the route line is a static border).
- Semantics/no-JS: native `<details>`/`<summary>` unchanged; the
  sponsored `<aside aria-label="Sponsored">` remains a sibling of the
  guide section, not a descendant.
- `scripts/check-a11y-contrast.mjs`: PASS (exit 0). The onColour×field
  pairs were already in the matrix; no new token pairs were added.

## Honest limitations

- "Before" is the production render (same guide code as the rejected
  candidate), not a local build of `a5df2fcc`; the guide component was
  unchanged between v0.9.0 and the candidate, so the comparison is
  faithful for this section.
- Pixel-level review was performed via computed styles + preserved
  screenshots; the `.webp` files are the artefact for human review.
- `tool` and classless stations remain monochrome panels by canonical
  design (no approved field step); if the owner requires a coloured
  area for `tool` too, that is a design-system decision (a new field
  step or an onColourInverse pairing), not a local exception.
- `CurrentProjects` is unchanged: project records carry weight, not
  content class, so no classification hue maps onto them without a
  data-model change outside this ticket's scope.

## Status

Design implementation + rendered verification: **done pending owner
review of the screenshots**. Release gates for the new candidate SHA
re-run separately; this record does not assert release readiness.
