# Layout System — Composition Contract

> Layout rules for `src/editorial/` and every public surface built on it.
> Style is produced by Panda CSS (`@pandacss/dev`); the **token contract**
> lives in `src/editorial/tokens.ts` (raw) and
> `src/editorial/semantic-tokens.ts` (semantic). Components never reach
> past the semantic layer.
>
> **This file is the operative specification of ADR-0022**
> (`docs/adr/ADR-0022-editorial-composition-contract.md`). The ADR records
> the decision; this file is what reviewers, the `ui:contract:check` gate
> (`scripts/check-ui-contract.mjs`, data in `quality/ui-contract.json`)
> and page authors enforce. Where they disagree, the ADR wins and this
> file is corrected.
>
> The design system is a **constraint system**, not a component catalogue:
> its job is to make low-quality screens hard to assemble. Every rule
> below names what a layer owns and what a call site may not decide.

## 1. Layer model and ownership

```text
L0 tokens        tokens.ts / semantic-tokens.ts — color, type, spacing,
                 radii. Change reason: a visual-language decision only.
L1 layout        PageSection / Container / Grid / Stack / Cluster / Split
                 (src/editorial/primitives/). Owns section rhythm,
                 surface tone, page grid, flow gaps.
L2 components    Button / TextLink / Panel / Badge / StateMark /
                 RecordList / Disclosure / MediaFrame / SectionHeading /
                 ToggleChip.
                 Owns the look of one interactive or display element
                 through variant × size props.
L3 pages         obligation dirs (src/home/**, src/portfolio/**, …) and
                 src/routes/**. Compose L1/L2 only. May choose WHICH
                 content appears, its order, its wording and its data
                 projection — never section-level padding, page
                 background, grid tracks or component chrome.
```

The dependency direction is unchanged: obligations import `editorial`
primitives; `editorial` imports no obligation. See AGENTS.md §3.

## 2. The clauses (C-1 … C-8)

Each clause is enforced by `scripts/check-ui-contract.mjs` against
`quality/ui-contract.json`. Violation codes are `C-1` … `C-8`.

### C-1 — Section surface is owned by `PageSection`

`<section>` level decisions — vertical rhythm (`paddingBlock`), page
background, section separator (`borderTop`) — belong to `PageSection`
alone. Feature code must not set block-direction padding on a section or
page-level container, and must not paint a section background or draw a
section-separating rule by hand.

Allowed exceptions, all inside L2 primitives or the primitives'
allowlist: inline cluster padding inside a control (`Button`, `Panel`,
`Badge`), and the page chrome owned by `editorial` itself (masthead,
footer, skip link).

### C-2 — Color is owned by the semantic layer

Every color-valued property (`backgroundColor`, `background`,
`color`, `borderColor`, `outlineColor`, `fill`, `stroke`,
`textDecorationColor`, `caretColor`, `accentColor`) resolves to a
semantic token (`bg.*`, `text.*`, `border.*`, `accent.*`, `mono.*`).
Raw palette references (`{colors.brand.*}`, `{colors.neutral.*}`,
`{colors.design.*}`, …), hex / `rgb()` / `hsl()` / `oklch()` literals
and named CSS colors are forbidden outside `src/editorial/**` and the
explicit allowlist in `quality/ui-contract.json` (brand marks, icon
assets, ad creatives — each entry states its reason).

### C-3 — Section tone is a `PageSection` prop

A colored or shaded **section band** is expressed only through
`PageSection`'s `tone` prop (§4.2). Feature code may not create a
section-scale surface with an arbitrary `backgroundColor`; smaller
classified surfaces go through `Panel variant="field.*"`. Decorative
color — a field that carries no classification or emphasis meaning —
is a review failure even when the gate cannot see intent.

### C-4 — Grids are presets

`gridTemplateColumns` / `gridTemplateRows` / `gridAutoFlow` may be
declared only inside `src/editorial/**` and the page-composition
allowlist. Feature content uses `Grid` presets (§5) or `Split`. A
bespoke grid is a composition-contract change: it lands in `editorial`
or is recorded as an allowlist entry with its reason.

### C-5 — Lists and rows use the list primitives

Repeated content uses `RecordList`/`RecordRow` (label/value),
`Grid`+`Panel` (card-like repetition) or `Stack`+reset list (plain
lists). A `<li>` must not carry its own border / background /
borderRadius — that draws a box the section already frames. A
`.map()`-rendered list on a public page must be bounded (§C-8) or live
on a dedicated index route.

### C-6 — Controls are primitives

Button-like and link-like affordances use `Button` / `TextLink`
variants. Hand-styling a raw `<a>` or `<button>` with padding, radius,
background or border to look like a control is forbidden. Intentional
non-controls (semantic rows, tabs, resize handles, swatches, editor
surfaces) are allowlisted per file with a reason — the same exemption
philosophy as T3 Code's `no-restyle` contracts.

### C-7 — No duplicated styling

The same normalized `css({...})` object literal appearing in three or
more files is a missing primitive: extract it into `editorial` (L2) or
a page-owned shared module, not a third copy. The gate reports the
literal's hash and the file list.

### C-8 — Public pages curate, index routes enumerate

A public page is a curated entrance: it shows representative items and
links to the full set. A section that maps a data collection must
bound the render (`.slice()`, a `limit`, a `Disclosure`, or a link to
a dedicated index route) unless the page's obligation IS the index
(`/portfolio`, `/tools`, `/activity`, `/now`, …). "A stopped item must
not be hidden" survives as a rule — on the index route, not on every
page that mentions the collection.

## 3. Section anatomy

```text
PageSection (tone, rhythm, optional borderTop)
  └─ Container (max-width 1024, responsive paddingInline)
       ├─ SectionHeading (default | spread)
       └─ content — Grid / Stack / Cluster / Split / Panel / lists
```

`PageSection` owns: `<section>` element, `aria-labelledby` wiring
(`labelledBy` prop pairs with the heading's `id`), the rhythm
`paddingBlock`, the `tone` surface, and the optional full-width
`borderTop` hairline. It renders `Container` internally; the content
column is therefore always the canonical 1024 px measure unless a
future `width` variant is added through the contract, not per page.

Rhythm roles (the beat comes from the section's role, never its
density):

| Role | `paddingBlock` (base / lg) | Use |
| --- | --- | --- |
| `hero` | `16 / 32` | page entry only — one per page |
| `body` | `16 / 24` | every content section |
| `feature` | `24 / 32` | deliberate rhythm change — a section whose role earns a larger beat (ADR-0023 §3). Consecutive `feature` sections are a review finding, not a defect per se |
| `closing` | `16 / 24` | footer-adjacent / final CTA band |

## 4. Surface and tone

### 4.1 The monochrome ground stays

`mono.*` remains the structural layer: page ground, sunken / raised /
control surfaces, hairline / rule, ink ladder, inverse ground. The
operation fill stays ink (`bg.accent` / `bg.inverse` = inverse ground,
label `text.inverse`). Links stay ink + underline. Status stays
silhouette + word + ink — no status hue (Issue #887 rule unchanged).

### 4.2 Section tones

`PageSection tone` names a surface **and** the ink that belongs on it.
The vocabulary is closed — seven values:

| tone | surface | ink | meaning |
| --- | --- | --- | --- |
| `ground` | `mono.surface.ground` | normal ink | default page (implicit) |
| `sunken` | `mono.surface.sunken` | normal ink | recessed band — supporting material |
| `raised` | `mono.surface.raised` | normal ink | lifted band — emphasis without hue |
| `inverse` | `mono.surface.inverse` | `mono.ink.inverse` | ink plate — a turning point (CTA, colophon) |
| `field.design` | `accent.field.design` | `mono.ink.onColour` | design-classified content |
| `field.code` | `accent.field.code` | `mono.ink.onColour` | code-classified content |
| `field.writing` | `accent.field.writing` | `mono.ink.onColour` | writing-classified content |
| `field.tool` | `mono.surface.sunken` + tool mark treatment | normal ink | tool-classified content (no approved field step — see colors.md) |

Tone assignment rules (ADR-0022 §3.4):

- A `field.*` tone matches the section's content classification. A
  decorative field is a defect.
- The same tone never repeats on two adjacent sections — the contrast
  between bands is what makes tone mean something.
- `inverse` appears at most one or two times per page, where the page
  genuinely turns (contact CTA, closing band).
- `sunken` / `raised` may repeat but not adjacently.

**Mechanism**: `PageSection` binds the tone by re-binding the
`--colors-*` custom properties Panda emits for semantic tokens inside
the section's subtree. Every existing component then renders correct
ink and surfaces on the tone without knowing it exists. The contrast
gate (`scripts/check-a11y-contrast.mjs`) measures every tone × ink
pairing; a tone that cannot carry its ink at the required ratio does
not ship.

### 4.3 What is NOT a tone

- A card, panel or tile inside a section is `Panel`, not a tone.
- A status, category mark or badge is `accent.category.*` /
  `StateMark`, not a tone.
- An ad unit's own palette is the ad contract's business (Issue #925);
  it sits inside a named ad slot and does not set the section tone.

#### Panel × tone pairing

Not every `Panel` variant is meaningful on every `PageSection` tone.
The tone rebind replaces the page surface/ink ladder for its whole
subtree, so a panel is only valid where its own ink rule still
resolves at 4.5:1 in BOTH appearances:

- `plain` is valid everywhere — it paints no surface and inherits the
  section's ink by definition.
- `field.*` is valid everywhere — the variant carries its own measured
  `mono.ink.onColour` rebind, independent of the section tone.
- `inverse` is valid on every tone **except `inverse`** — inside an
  inverse band `bg.inverse` is retargeted to the operation fill, so
  the panel would paint plate-on-plate.
- `surface` / `subtle` are valid only on `ground`, `sunken`,
  `raised` and `field.tool` — the tones that keep the page surface
  ladder and normal ink. On `inverse` the ladder is retired and the
  only ink (`mono.ink.inverse`) reaches 4.5:1 on no surviving
  surface step; on `field.*` the section ink is `mono.ink.onColour`,
  which is dark in both appearances and fails against the dark-mode
  card steps. There is no token for "one step off the plate/field",
  and ADR-0022 §3.3 forbids adding one — the pairings are invalid by
  contract, not by accident.
  `e2e/design-system-tones.spec.ts` measures exactly this matrix.

## 5. Grid and flow

### 5.1 `Container`

`max-width: 1024px`, centered, `paddingInline` `4 / 6 / 8` (16 / 24 /
32 px) → content width ≤ 960 px. Unchanged. Every page section's
content sits inside it (via `PageSection`).

### 5.2 `Grid` presets

| preset | base | md | lg | use |
| --- | --- | --- | --- | --- |
| `columns=1` | 1fr | 1fr | 1fr | single flow |
| `columns=2` | 1fr | repeat(2, minmax(0,1fr)) | same | pairs, 2-up lists |
| `columns=3` | 1fr | repeat(2, …) | repeat(3, …) | card triads |
| `columns=4` | 1fr | repeat(2, …) | repeat(4, …) | dense indexes |
| `split` | 1fr | 1fr | `minmax(0,4fr) minmax(0,8fr)` | heading/content editorial split |

`gap` accepts spacing tokens only (`1 2 4 6 10 16 24 32`), named by
the rhythm table below. `minmax(0, …)` is mandatory so content can
shrink.

### 5.3 `Stack` / `Cluster`

- `Stack`: vertical flow, `gap` from the same token set. Replaces
  ad-hoc `flexDirection: 'column'` + `gap` compositions.
- `Cluster`: inline flow with wrap, `gap` from the same set, plus
  `align`/`justify` presets. Replaces ad-hoc `flex` + `gap` + `wrap`.

### 5.4 `Split`

The 4/12 + 8/12 editorial split for content that is not a
`SectionHeading`. Same track rule as the `split` Grid preset; use it
when the left column carries a label cluster and the right carries
content (contact channel rows, detail pages).

### 5.4a Editorial composition primitives (ADR-0023 §3)

The preset grids above cover uniform and split compositions. When a
section's meaning calls for asymmetry, intentional grid departure,
media-led structure or layered figure/ground, use the composition
primitives — never a hand-written `gridTemplateColumns` (C-4 still
applies) and never an arbitrary negative margin.

- **`Grid template="12"`** — a 12-track coordinate grid
  (`repeat(12, minmax(0, 1fr))`). Children are `GridItem`s carrying
  `span` / `start` / `end` (1–12, responsive `{base, md, lg}`
  objects allowed). `span` defaults to full width on `base`, so a
  composition designed for desktop recomposes to a single column on
  mobile by contract, not by accident. Asymmetric spans, deliberate
  empty tracks and offset placements are the point; uniform
  `span=4`-style repetition is what CL-5 warns about.
- **`Breakout`** — lets ONE block inside a `PageSection` exceed the
  canonical 1024 px measure (full viewport width or a declared wider
  measure). Intended for media, figures and large display type only.
  It is a declaration, not a margin hack: the escape is owned by the
  primitive and the block still sits inside the section's tone.
- **`Overlap`** — places children into the same grid cell
  (`grid-area` sharing) with declarative `align`/`justify` per layer.
  For figure/ground inversion (text over image, caption over media).
  Arbitrary `z-index`/`position` is not exposed.
- **`PageSection` observability** — every `PageSection` emits
  `data-tone` / `data-rhythm` / `data-section` so the composition
  lint collector can classify sections without guessing from styles.

"When to use" rules: reach for `template="12"` when the content has a
real asymmetric relationship (lead story + supporting index, media +
caption rail); `Breakout` when the media IS the section's subject;
`Overlap` when figure and ground are meant to fuse. If none of these
apply, the preset grids are the right answer — the primitives exist
to make intentional composition possible, not to make every section
different.

### 5.5 SectionHeading

`default` (single column) and `spread` (4/8 split via the same rule)
are unchanged in behavior. `spread` is how a `body` section pairs its
heading cluster with its content column; `default` is for sections
with no content column. New sections should prefer `spread` when they
have body content — the shared left axis is what makes a page read as
one grid.

## 6. Spacing rhythm

Unchanged token scale (golden-ratio steps): `1=4 2=8 4=16 6=24
10=40 16=64 24=96 32=128`.

| Relationship | token | px | role |
| --- | --- | --- | --- |
| decoration on title | `1` | 4 | ordinal gap |
| tight cluster | `2` | 8 | sibling inside one thought |
| cluster close | `4` | 16 | intra-cluster separation |
| cluster separator | `6` | 24 | between related clusters |
| list / card gap | `10` | 40 | between peer items |
| section padding | `16`/`24` | 64/96 | page-level beat (see §3) |
| hero entry breath | `32` | 128 | top of page only |

The beat between sections is **always** the `PageSection` rhythm —
never a hand-set margin. Within a section, proximity encodes
relationship: caption↔title tight, title↔body close, peer items at
`10`.

## 7. Typography inside the grid

Unchanged from the measured contract (was §3.4):

| Role | Size | line-height / tracking | Note |
| --- | --- | --- | --- |
| Page `h1` | `3xl` / mark | — | one display voice per page |
| Section `h2` | `2xl` (32) | `1.15`, `-0.025em` | fits the 306.67 px title span |
| Card / row title | `xl` (24) | — | one tier under section title |
| Description | `md` (16), `1.6` | — | measure-capped |

Japanese line breaking (`word-break: auto-phrase` + `text-wrap:
balance/pretty`) is unchanged.

## 8. Interaction states

Unchanged in principle, now owned by primitives:

- `Button`: `primary` fill swaps to `accent.interactive`-equivalent
  ink step on hover; `secondary`/`ghost` swap surface step;
  focus-visible gets the `border.focus` outline.
- `TextLink` / inline links: underline at rest; `text.muted →
  text.default` or weight step on hover; focus outline.
- `Panel`/`Disclosure`: state changes use `bg.*` step swaps and
  `aria-*`/`data-*` hooks, never a hover shadow or a color that
  isn't a semantic token.

Do not communicate state by toggling a background that looks like a
card; communicate it through the control's own surface.

## 9. Information density and disclosure

- A public page shows representative content; the full set lives on
  the index route (C-8). "See everything" is a `Button variant="link"`
  or `TextLink` to that route.
- Progressive disclosure uses `Disclosure` (native `<details>`) or a
  dedicated route — never an unbounded in-page expansion.
- Density is a section-role decision recorded in the page's design
  note, not a per-component accident: a `body` section's content
  column is 613 px at 1280; filling it is expected, leaving it
  half-empty is a composition defect unless the section is `hero`.

## 10. Ads

Ad units keep their independent creative contract (Issue #925):
their palette, formats and behavior are not governed by this file.
What IS governed: placement. Ads occupy named slots declared by the
page composer (`AdSlot` positions: masthead leaderboard, in-feed
unit, sponsored rail), never injected between a section's heading
and its content, and never set a `PageSection` tone. An ad must not
break the reading column's alignment or the section rhythm.

## 11. Audit checklist for new code

Before a public surface PR merges:

1. `pnpm run ui:contract:check` is clean for the changed files (C-1…C-8).
2. No section-level `paddingBlock` / page background / separator
   outside `PageSection` (C-1).
3. No raw color values or palette references outside the allowlist
   (C-2); every colored band uses a `tone` prop (C-3).
4. Grids use `Grid`/`Split` presets; no bespoke
   `gridTemplateColumns` outside the allowlist (C-4).
5. Lists/rows use the list primitives; no `<li>` boxes (C-5).
6. Controls use `Button`/`TextLink`; no hand-styled button/link
   lookalikes (C-6).
7. No third copy of a styling literal (C-7).
8. Public pages curate; enumerations live on index routes (C-8).
9. The rendered page passes the visual review in
   `docs/runbook/ui-visual-review.md` — whitespace, alignment,
   proximity, contrast, repetition, eye flow, density and color-field
   composition judged on desktop/mobile × light/dark captures, not
   on code or axe output alone.
10. `pnpm run composition:lint` (ADR-0023, Issue #1133) reports no
    Blocking Error for the changed routes, and every Warning it
    raises is either resolved or carried into the visual review as
    a required input (`docs/visual/composition-principles.md`).
