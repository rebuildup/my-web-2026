# Design Brief — Personal Web Platform (home page)

> Source of design direction for `src/home/`. Owned by
> Issue #21. Update this file when a deliberate direction decision
> changes; downstream Skills (color / typography / layout / motion /
> a11y) read it as project evidence, not as binding prescription.

## Product context

- **Category**: Personal Web Platform. Cloudflare Workers + TanStack
  Start + Hono + Panda CSS modular monolith.
- **Primary user**: Visitors landing on the canonical top page (`GET /`).
  Most are not yet familiar with `my-web-2026`; some are the owner
  (`@rebuildup`) checking live system health.
- **Usage context**: a single entry route that must communicate
  *what this site is*, *what's currently live*, and *what's coming*.
  Not an application workspace — no nested routes are reachable from
  the top other than the canonical external boundary.
- **Defining screen / interaction**: the home page itself. Reading the
  hero copy is the dominant interaction. No primary form, no modal,
  no live edit.

## Design intent

- **Emotional register**: calm, technical, restrained. Reads as a
  personal engineering site — not a marketing deck.
- **Density**: low. The page is currently short (one capability per
  section). Whitespace carries hierarchy; type scale carries emphasis.
- **Visual character**: Swiss-Editorial adjacent. Strong baseline
  rhythm, restrained radius vocabulary, repeated alignment axes,
  minimal decoration. No shadows on hero / capability cards. The
  existing `bg.surface` / `bg.canvas` / `text.muted` layer is enough;
  no additional accent colors are introduced.

## References (translated, not cloned)

- **GitHub personal landing (`github.com/<user>`)**: the "this is who
  I am and here are my pinned projects" reading order. We borrow the
  prose-only hero and the project-card grid. We do **not** copy the
  pinned-repository UI patterns or the avatar placement.
- **Cloudflare product surfaces (`cloudflare.com`)**: the calm
  technical register, restrained accent usage, and section rhythm.
  We do not borrow the visual brand, illustration style, or color
  palette.

## Avoid

- Marketing-deck patterns (oversized CTAs, fake testimonials, hero
  illustration). The page is a personal platform, not a product
  launch.
- Per-section accent colors. The page uses one accent (`bg.accent`)
  globally; section differentiation comes from spacing and type, not
  hue.
- Motion on hero copy. Marketing motion is reserved for capability
  card hover; the hero and footer stay static.
- Dark-mode forcing at 0.2.0. Dark mode lands in a separate ticket;
  this page only uses neutral tokens that compose in both modes.

## Color direction

- **Default mode**: light only at 0.2.0. The semantic layer
  (`bg.canvas`, `bg.surface`, `text.default`, `text.muted`) is mode-
  agnostic; dark mode binds the same keys later.
- **Temperature / saturation**: neutral cool. The brand blue stays a
  single accent for links and one CTA per section; never a section
  background.
- **Accent strategy**: one accent (`brand.500`) used only for the
  primary CTA, capability card hover border, and the status pill
  when a service is reachable.
- **Semantic constraints**: do not add per-section background colors.
  Capability cards share `bg.surface`; the hero stays on `bg.canvas`.

## Typography direction

- **Role split**: sans for everything. No serif display face at 0.2.0.
- **Density / scale**: a single type scale (`xs` / `sm` / `md` / `lg`
  / `xl` / `2xl`). Hero title uses `2xl`; section titles use `xl`;
  body uses `md`; metadata uses `sm` / `xs`.
- **Numeric / metadata requirements**: monospace (`fonts.mono`) for
  paths, version strings, and binding names. Otherwise sans.

## Component character

- **Radius**: `md` (8px) for capability cards and the status pill.
  No fully-rounded shapes except the existing Badge primitive.
- **Elevation**: capability cards and status tiles use
  `Card.elevation="flat"` (no shadow). Hover on capability cards
  transitions to a 1px `border.strong` border instead of a shadow.
- **Border strategy**: 1px `border.subtle` on cards; 1px `border.focus`
  on keyboard focus only.
- **Control density**: buttons keep the existing `md` / `sm` recipe.
  No new size is introduced at 0.2.0.

## Motion

- **Level**: minimal. The page is content-led; motion is reserved for
  capability card hover (border / background swap, 120ms).
- **Where motion is useful**: capability card hover, button hover
  (already in the editorial primitive).
- **Where motion should be absent**: hero copy, section titles,
  footer, system status section. No entry transitions, no parallax,
  no scroll-linked effects.

## Decisions made

- **Marketing layout family** (not Dashboard, not Application):
  shared coordinate system + asymmetric hero + section rhythm.
- **4 sections** (hero / capabilities / system status / footer):
  the home page is short enough that adding a section per future
  capability would create visual noise before any capability exists.
- **Container primitive**: a max-width Page wrapper with the
  responsive page-margin token. Used twice or more in the page.
- **SectionHeading primitive**: an `<h2>` + optional eyebrow + optional
  description. Used 3 times. Keeps section rhythm consistent.
- **`src/home/` is the canonical home**: the route file
  (`src/routes/index.tsx`) stays thin (loader + route definition) and
  imports the page component from the module.

## Explicitly unresolved

- Dark mode is deferred to a follow-up ticket. The page only uses
  semantic tokens so a later dark binding does not require changes
  here.
- i18n is deferred. Hero copy is bilingual (Japanese / English) inline
  in this release; full i18n lands when a second capability does.
- Header global navigation is deferred. The home page does not
  expose a top nav at 0.2.0; navigation is the responsibility of a
  separate ticket.

## Typography & grid amendment (Issue #31)

> Adds editorial weight to the hero and a numbered section rhythm
> without breaking the constraints above. Owned by Issue #31. **This
> amendment extends the existing brief; the `Avoid`, `Color
> direction`, `Motion`, and `Avoid` sections above remain in force
> and any future change that contradicts them must come back here.**

### What changed

- **Hero h1 step**: `2xl` → `3xl` at `lg` and wider. One additional
  step only — `4xl` / `5xl` were tried then dropped (see the third
  pass below). Raw layer keeps a single `3xl` entry (`2.5rem`); the
  semantic layer is unchanged.
- **Hero composition**: the inner `Container` (1024px max) splits
  into an asymmetric 2-column grid at `lg` — `minmax(0, 7fr) minmax(0, 3fr)`
  — with a 12-unit gutter. The lead column caps at 640px to keep the
  measure inside the 60–70 character window; the right rail carries
  raw mono metadata (`edition / my-web-2026 · 2026 Preview /
  v0.3.0 · MIT`) — no border, no background, no padding box. Below
  `lg` the two columns stack into the original single flow.
- **Hero typography tightening**: h1 uses `line-height: 1.1` at `lg`
  and `letter-spacing: -0.02em` (inline literal, not a token);
  mixed-script spans carry `lang="ja"` on Japanese and `lang="en"`
  on the Latin edition tags so the browser can pick the right
  rendering hints.
- **Section rhythm**: each section heading carries an editorial
  numbering prefix via the existing `eyebrow` prop
  (`01 — Capabilities`, `02 — System status`). Capability cards
  combine a mono ordinal + English label into a single caption
  (`01 · Portfolio`); the Footer leads with a `3xl` `04` display
  numeral preceded by a `04 — Edition` mono caption.
- **Capabilities card grid**: gap widens from `6` to `{ base: '6',
  md: '8' }`; card `h3` sits at `xl` to share size parity with the
  spread section heading's accent tier. The grid falls from 3
  columns at `md` to 2 because the spread right column carries
  only ~60% of the container width and 3 readable cards at `xl`
  would crowd the column.
- **Status rows**: `dt` stays sans-bold at `lg`; the binding renders
  adjacent in mono `sm`. The section uses proximity alone to group
  each row — no card border, no hairline rule between rows.
- **Footer weight**: the Identity paragraph is `lg` / `fontWeight:
  600` because the column is the page's social identifier and the
  page reads with one display voice (`3xl`) plus one voice-large
  (`lg`). The version / MIT line below drops to mono `sm` so the
  two-line column stays as a single editorial unit.

### What was deliberately not changed

- **No `Container` wide variant**. The shared coordinate system
  stays at 1024px; the asymmetric hero is built inside `Container`.
  (`responsive-design` §Macro layout: editorial surfaces maintain
  measure, they don't stretch.)
- **No `SectionHeading number` prop**. Editorial numbering is a
  caller-side pattern — the `eyebrow` string carries it. A primitive
  prop would be one-purpose and fail the `token-audit` §3-4
  evidence gate.
- **No raw `letterSpacing` tokens**. The two inline literals
  (`-0.02em` on the hero h1, `0.04em` on the mono captions) are
  scoped to one component each. Promoting them to tokens would
  invite the "Japanese letter-spacing used as decoration" failure
  mode (`typesetting` §5).
- **No raw `4xl` / `5xl` font sizes**. See the third pass below for
  why they were dropped after a single round of use. Future tiers
  require a second consumer before they enter the raw layer.
- **No new motion, no per-section accent, no image-based titles**.
  All explicit `Avoid` items above remain in force.
- **No mixed-script font-feature-settings**. The
  `typesetting/references/japanese.md` document is not on disk in
  this release, so we cannot ground the full `palt` / `pkna` /
  `kern` treatment yet. The minimum that does not need reference
  data — `lang` attributes + tightened display `line-height` — is
  in place. The remaining treatment is a follow-up ticket once the
  reference document lands.

### Rationale chain

- `typesetting` §5: hero display line-height 1.1 for Japanese;
  Latin eyebrow keeps the system default. Inline letter-spacing
  literals scoped to one component, not promoted to tokens.
- `token-audit` §3-4: primitive promotion requires multi-site
  evidence. `3xl` is added because three sites now share it (Hero
  h1, SectionHeading spread title, Footer `04`); `4xl` / `5xl`
  were tried then dropped when the proximity-first revision made
  them visually unnecessary (see below).
- `responsive-design` §Macro layout: editorial surfaces hold their
  measure at wide viewports. `Container` stays 1024px; the
  asymmetric grid is built inside it.
- `accessibility-audit` §Reflow: 320 CSS px renders single-column;
  the metadata rail is `display: none` below `lg`. No horizontal
  scroll, no information loss at 200% zoom.

## Editorial proximity-first revision (Issue #31, third pass)

> The first pass added a numbered section rhythm; the second pass
> stacked the body sections as a 2-column magazine spread with
> card / hairline / box-decoration at every block. That read as a
> *shopping-mall editorial* — bordered cards, hairlines between
> status rows, 5xl outlier numerals, sticky left titles — when the
> reference site (`yell-movie2024.com`) reads as pure text flow
> with proximity alone doing the grouping. This third pass throws
> out every enclosure and replaces it with a 7-step type scale plus
> generous whitespace.

### What changed

- **Raw type scale**: drop `4xl` (3rem) and `5xl` (4rem). The
  display tier is just `3xl` (2.5rem / 40px). The scale is now
  `xs` / `sm` / `md` / `lg` / `xl` / `2xl` / `3xl` — seven tiers
  with explicit semantic roles.
- **Section dividers, card borders, hairline rules**: gone. The
  page reads as pure text flow with proximity alone doing the
  grouping.
- **Section padding**: 16/20 — each section sits in its own beat.
- **`SectionHeading`**: drops the spread variant entirely; renders
  as eyebrow → h2 → description → children stacked vertically.

## Editorial proximity — single-column iteration (Issue #31, fourth pass)

> The third pass landed semantic proximity *within* clusters, but
> even with the spread variant dropped, the per-section rhythm was
> flat. Every gap was either 4 or 8; every font-size either body
> (`md`) or h2 (`xl`). The reference site's editorial voice comes
> from *contrast* — small body type next to huge display type,
> tiny cluster gaps next to enormous page-level beats. The fourth
> pass attempted a single-column layout with semantic proximity, but
> the visual contrast was still flat.

## Editorial spread — grid + golden-ratio (Issue #31, fifth pass)

> The fourth pass went single-column and dropped the editorial
> spread entirely. That erased the reference site's editorial
> voice — the reader no longer met a giant headline sitting beside
> a column of dense content. The direction was wrong: the spread
> layout was right; the *contrast* within it was missing.
>
> This pass brings back the editorial spread, the giant display
> type, and the dramatic whitespace jumps — but follows the order
> the design review demanded:
>
> 1. **Grid system first** — define the spatial coordinate system.
> 2. **Layout second** — compose sections inside the grid.
> 3. **Whitespace third** — apply semantic spacing on the layout.
> 4. **Typography fourth** — type scale that complements the
>    whitespace and contrast.
>
> The contrast between the smallest and largest values is the
> editorial voice.

### 1. Grid system

The page sits on a 12-column grid inside a 1024px `Container`:

- **Container**: `max-width: 1024px`, centered, with horizontal
  page-margin at `4/6/8`.
- **Column system**: 12 conceptual columns used to define section
  ratios. The grid is implicit — sections render via `gridTemplateColumns`
  with `fr` units, not via a 12-col CSS grid utility.
- **Section ratios**:
  - Hero: `4fr / 8fr` (rail / lead) — same axis as body sections.
  - Body sections: `4fr / 8fr` (heading cluster / content).
  - Footer: `4fr / 4fr / 4fr` (three columns).
- **Gutter**: 40px (`spacing: 10`) between the spread columns.

### 2. Layout — editorial spread

Each body section uses `SectionHeading` with `variant="spread"`:

- **Left column (4/12)**: eyebrow → h2 → description. The heading
  cluster fills the column with semantic content so it never
  creates wasted white space below the h2.
- **Right column (8/12)**: section content (cards, rows, etc.).

Below `lg` the columns stack vertically with the heading on top.
The Hero uses the same `4fr / 8fr` split so the metadata rail and
the body section headings share the same x-axis.

### 3. Whitespace — golden-ratio scale

The whitespace scale steps at ≈1.618× so the contrast between
small clusters and page-level beats is dramatic. Contrast is the
voice:

| Token | px | Ratio | Role |
| --- | --- | --- | --- |
| `1` | 4 | base | decoration on title, ordinal gap |
| `2` | 8 | ×2 | tight cluster, sibling gap |
| `4` | 16 | ×2 | cluster close, body block end |
| `6` | 24 | ×1.5 | cluster separator, column gap |
| `10` | 40 | ×1.67 | section block end, list gap |
| `16` | 64 | ×1.6 | section padding |
| `24` | 96 | ×1.5 | page-level beat |
| `32` | 128 | ×1.33 | hero entry breath |

Application:

- Hero `paddingBlock`: 16/32 (64/128 px). The hero gets the
  largest top padding — the page-entry breath.
- Body sections `paddingBlock`: 16/24 (64/96 px). Each section is
  a beat; the reader registers it before its content.
- Footer `paddingBlock`: 16/24 (64/96 px). The closing beat.
- Cards gap: 10 (40px). Between cards the reader sees a deliberate
  break, not a hairline.
- Status rows gap: 10 (40px). Same as cards — a uniform list gap.
- Column gap (spread): 10 (40px).

### 4. Typography — golden-ratio scale

The type scale jumps at ≈1.618× between major tiers. The contrast
between body (`md` 16px) and display (`4xl` 64px) is 4× — dramatic
and intentional.

| Tier | px | Ratio to body | Role |
| --- | --- | --- | --- |
| `xs` | 12 | ×0.75 | mono caption, label |
| `sm` | 14 | ×0.875 | body support |
| `md` | 16 | ×1 | body |
| `lg` | 18 | ×1.125 | lead body |
| `xl` | 24 | ×1.5 | subhead, card h3 |
| `2xl` | 32 | ×2 | footer identity, large subhead |
| `3xl` | 40 | ×2.5 | section h2, footer `04` |
| `4xl` | 64 | ×4 | Hero h1, super display |

Application:

- Hero h1: `3xl/4xl` (40/64 px). One display site — the page reads
  with one display voice at the top.
- Body section h2: `2xl/3xl` (32/40 px). Strong but not as huge as
  h1.
- Card h3: `xl` (24 px). One tier above body.
- Footer `04`: `4xl` (64 px). Same display voice as h1; the page
  bookends Hero and Footer in `4xl`.
- Footer identity (samuido): `2xl` (32 px). One tier below display.

### Proximity — per-element `marginBlockStart`

The previous passes used a parent `gap` to space siblings; that
gives every sibling the same relationship. Semantic proximity
needs *different* relationships (cluster, separator, continuous,
footnote). Encoding the relationship on each child keeps the rule
next to the element that uses it:

| Relationship | marginBlockStart | Token | Role |
| --- | --- | --- | --- |
| caption ↔ h1 (Hero) | `2` (8px) | tight | identity cluster |
| h1 ↔ lead body (Hero) | `10` (40px) | separator | cluster break |
| lead body ↔ secondary (Hero) | `0` | continuous | one thought |
| secondary ↔ CTAs (Hero) | `6` (24px) | close | body block end |
| eyebrow ↔ h2 (SectionHeading) | `2` (8px) | tight | heading cluster |
| h2 ↔ description (SectionHeading) | `4` (16px) | close | kicker |
| caption ↔ display (Footer `04`) | `2` (8px) | tight | identity cluster |
| caption ↔ name (Footer identity) | `2` (8px) | tight | identity cluster |
| h3 ↔ ordinal (Capability) | `1` (4px) | decoration | title decorator |
| ordinal ↔ JP summary (Capability) | `4` (16px) | separator | cluster break |
| JP ↔ EN summary (Capability) | `1` (4px) | translation | one thought |

### What was deliberately not changed

- **No `Container` size variants**. The shared coordinate system
  stays at 1024px. The Hero constrains itself with `max-width` only.
- **No promoted `letterSpacing` tokens**. The display headings use
  inline `-0.025em` / `-0.03em` / `-0.04em` literals — scoped to one
  element each. Promotion to tokens would invite the
  "letter-spacing as decoration" failure mode (`typesetting` §5).
- **No new motion, no per-section accent, no image-based titles**.
  All explicit `Avoid` items in the original brief remain in force.
- **No mixed-script font-feature-settings**. The
  `typesetting/references/japanese.md` document is not on disk, so
  the full `palt` / `pkna` / `kern` treatment remains a follow-up
  ticket. The minimum (`lang` attributes + tightened display
  `line-height`) is in place.

### Rationale chain

- **Order**: grid → layout → whitespace → typography. The previous
  passes designed in the wrong order (typography first, layout
  second) which is why the page kept re-arranging. This pass locks
  the grid first, then composes the layout, then applies the
  whitespace, then scales the type.
- **Golden ratio (1:1.618)**: a single ratio applied across type
  and whitespace makes the page feel coherent — every tier is a
  fixed jump from the tier below it. The contrast between body
  (`md` 16) and display (`4xl` 64) is 4×, which is dramatic but
  not absurd. Between sections the whitespace jumps from `6` (24)
  to `16` (64) — a 2.67× jump that the eye reads as "this is a
  new section" without needing a divider line.
- **Editorial spread**: the reference site (`yell-movie2024.com`)
  uses a heading-on-the-left / content-on-the-right layout for
  every body section. The home page inherits that pattern at
  4/12 + 8/12 so the heading and content columns share the page's
  baseline grid.
- `typesetting` §6: at `4xl` (64px) the heading reads as a section
  identifier, not as body copy. Pairing with `line-height: 1.05`
  and `letter-spacing: -0.03em` keeps multi-line titles from
  looking loose.
- `token-audit` §3-4: every primitive must have at least two
  non-trivial consumers. `4xl` now has two (Hero h1 + Footer
  `04`); both sites use the same display voice. `5xl` is not
  introduced because no second consumer exists.
- `responsive-design` §Editorial rhythm: editorial surfaces stay
  readable at 200% zoom and at 320 CSS px. The grid collapses to
  a single column at `lg` and below; the type scale drops one tier
  at narrower widths.
- `accessibility-audit` §Reflow: at 320 CSS px everything stacks
  vertically — no horizontal scroll, no information loss.
