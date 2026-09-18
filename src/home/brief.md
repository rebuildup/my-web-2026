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
  v0.2.0 · MIT`) — no border, no background, no padding box. Below
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
  with explicit semantic roles:

  | Tier | px | Role |
  | --- | --- | --- |
  | `xs` | 12 | label-cap, decoration |
  | `sm` | 14 | mono caption, body-supporting copy |
  | `md` | 16 | body |
  | `lg` | 18 | subhead, footer identity |
  | `xl` | 24 | card h3, body h2 |
  | `2xl` | 32 | (reserved) |
  | `3xl` | 40 | display (Hero h1, footer `04`) |

  One site carries `3xl` after the spread-removal revision;
  promoting it to two non-trivial consumers is a future ticket.

- **`SectionHeading` drops the `spread` variant entirely**. The
  spread layout — left column heading + right column content —
  created wasted left-column space whenever the content column
  was taller than the heading. The page now uses a single
  column inside `Container`: header cluster (eyebrow / h2 /
  description) followed by section content.

- **Hero drops the asymmetric 2-column grid**. The Hero is a
  single column inside `Container` with `maxWidth: 720px` so the
  measure stays in the 60–70 character window. The metadata rail
  (edition / my-web-2026 · 2026 Preview / v0.2.0 · MIT) sits
  below the CTAs as a tight inline footer (3 mono lines,
  `gap: 1`). It is no longer a parallel column.

- **Per-element `marginBlockStart` encodes semantic proximity**.
  No parent uses `gap` to space its children. Each child carries
  its own top margin so the proximity rule lives next to the
  element that uses it:

  | Relationship | marginBlockStart | Role |
  | --- | --- | --- |
  | caption ↔ h1 (Hero) | `2` (8px) | identity cluster |
  | h1 ↔ lead body (Hero) | `5` (20px) | cluster separator |
  | lead body ↔ secondary (Hero) | `0` | continuous prose |
  | secondary ↔ CTAs (Hero) | `4` (16px) | body block close |
  | CTAs ↔ metadata rail (Hero) | `8` (32px) | footnote separator |
  | eyebrow ↔ h2 (SectionHeading) | `2` (8px) | heading cluster |
  | h2 ↔ description (SectionHeading) | `3` (12px) | kicker |
  | description ↔ children (SectionHeading) | `6` (24px) | body block start |
  | h3 ↔ ordinal (Capability) | `1` (4px) | decoration on title |
  | ordinal ↔ JP summary (Capability) | `4` (16px) | cluster separator |
  | JP summary ↔ EN summary (Capability) | `1` (4px) | translation pair |

- **Capability cards**: drop `border`, `borderRadius`, `bg.surface`,
  and `padding` from each card. The card is a raw flex column with
  per-element `marginBlockStart`. The status badge is the only
  non-text element.

- **Status rows**: drop `border-block-start` hairlines between
  rows. Rows are separated by `gap: 8` on the wrapping `dl`.
  `dt` is sans `lg` / `font-weight: 700`; the binding renders
  adjacent in mono `sm` and the badge anchors the right edge.

- **Hero aside** and **secondary button**: the bordered metadata
  card and the bordered secondary button are gone. The metadata
  rail is raw mono text; the secondary CTA is a plain accent link
  with an arrow marker.

- **Section dividers**: drop entirely. Every `border-block-start`
  rule on the body sections and the footer is gone. Whitespace
  alone separates Hero → Capabilities → Status → Footer.

- **Footer**: drop the top divider and any column borders. The
  3-column composition (`2fr / 3fr / 3fr`) is kept; the `04`
  decoration sits at `3xl`; columns stack to single column at
  `base`.

### What was deliberately not changed

- **No proximity-as-a-primitive**. The proximity rule is a
  caller-side decision: each section picks its own
  `marginBlockStart` values to set the rhythm between sibling
  rows. A `<ProximityStack>` primitive would hide the rhythm
  choice from the design system and create a one-purpose
  abstraction (`token-audit` §4).
- **No `motion-system` entry transition**. The proximity revision
  doesn't add motion to compensate for the visual simplicity; it
  relies on whitespace carrying the hierarchy.
- **No `Container` size variants**. The shared coordinate system
  stays at 1024px (`md`); the Hero constrains itself with
  `maxWidth: 720px` instead of requesting a wider container.
- **No relaxed `lineHeight`**. Display `lineHeight: 1.1` stays.
  Proximity is not a substitute for tight display rhythm — the two
  work together.

### Rationale chain

- **Gestalt proximity (the underlying design principle)**: when
  elements share a region or are placed close together, the reader
  perceives them as a group — without borders or backgrounds. The
  reference site leans on this exclusively; the bordered
  editorial-spread second pass was overdesigned.
- **Per-element `marginBlockStart` (the implementation)**: a parent
  `gap` gives every sibling the same relationship. Semantic
  proximity needs *different* relationships — identity cluster
  (tight), cluster separator (loose), continuous prose (zero),
  footnote (separated). Encoding the relationship on each child
  keeps the rule next to the element that uses it, so editing the
  Hero's rhythm does not accidentally retune the Status section's
  rhythm.
- `typesetting` §6: at `3xl` (40px) the headline reads as a
  section identifier. The original `4xl` (48px) added visual
  weight without adding information; dropping it makes the section
  rhythm quieter but still legible.
- `token-audit` §3-4: every primitive must have at least two
  non-trivial consumers. `4xl` had two consumers (spread heading +
  capability h3), but the proximity revision moved h3 back to `xl`
  and dropped the spread heading to `xl` too, so `4xl` lost its
  second consumer and was dropped. The same logic drops `5xl`.
- `responsive-design` §Editorial rhythm: editorial surfaces stay
  readable at 200% zoom and at 320 CSS px. Proximity scales
  naturally — `marginBlockStart` values increase proportionally
  with the type scale; borders would have to be re-drawn.
- `accessibility-audit` §Reflow: proximity doesn't break reflow.
  Borders did — at 200% zoom the 1px borders became 2px and the
  card grid became busy with thick black underlines.
- `accessibility-audit` §Cognitive load: the bordered editorial-
  spread layout asked the reader to parse two channels (text +
  box) at once. The proximity revision asks for one channel. The
  reader spends less cognitive effort identifying what belongs
  together.

## Editorial proximity — second iteration (Issue #31, fourth pass)

> The third pass landed semantic proximity *within* clusters but
> the spread layout was still pulling the section headings into a
> separate left column while content piled up in the right column.
> The left column sat empty below each h2, producing the "vertically
> over-stretched" feeling the section-review feedback called out.
> Even though the per-element gaps were semantic, the spread's
> wasted white space dominated the read.

### What changed

- **`SectionHeading` becomes single-column again**. The `spread`
  variant is removed; the primitive renders as
  eyebrow → h2 → description → children stacked vertically. The
  previous `default` layout was already this — the third pass
  added `spread` on top, the fourth pass removes it.
- **Hero becomes single-column**. The asymmetric 7fr/3fr grid (and
  later the flipped 2fr/5fr grid) is dropped; the Hero is a single
  flex column with `maxWidth: 720px`. The metadata rail moves
  below the CTAs as a tight inline footer instead of a parallel
  column.
- **Section padding lands at 12/16**. Hero at 10/14, body sections
  at 12/16, footer at 10/14. The Hero gets slightly less padding
  because it leads the page and the breathing room above it is the
  viewport edge; body sections need a more deliberate top/bottom
  margin so the reader registers each section as its own beat.

### What was deliberately not changed

- **Semantic per-element `marginBlockStart` stays**. The proximity
  values (2/3/4/5/6/8) encode the same cluster relationships as
  the third pass; only the parent layouts (spread grid → single
  column) change.
- **The 7-step type scale stays**. `3xl` is the only display tier;
  three sites would share it before promotion but only one exists
  today. The scale is honest about its evidence base.
