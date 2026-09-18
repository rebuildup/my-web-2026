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
  | `xl` | 24 | card h3 |
  | `2xl` | 32 | h2 at base width |
  | `3xl` | 40 | display (Hero h1 / spread h2 / footer `04`) |

  Three sites share `3xl`; the previous wider tiers had no second
  consumer once the proximity revision landed.

- **`SectionHeading` spread variant**: title climbs to `2xl` at
  base, `3xl` at `lg` (one tier below the original `4xl`). The
  sticky-left behavior is dropped — sticky was necessary when the
  title was the visual anchor for a wider screen, but in the
  proximity layout the title sits at the top of its column and the
  reader meets it before any content scrolls past. Eyebrow moves
  from accent `xs` to muted `sm` (14px) so proximity — not
  emphasis — carries the hierarchy.

- **Capability cards**: drop `border`, `borderRadius`, `bg.surface`,
  and `padding` from each card. The card is now a raw flex stack
  with `gap: 4`: title + badge → mono caption (`01 · Portfolio`)
  → JP summary → EN summary. The status badge is the only non-text
  element; everything else is type. Section padding climbs from
  `12` to `16-20` so the section sits in its own visual beat.

- **Status rows**: drop `border-block-start` hairlines between
  rows. Rows are separated by the `gap: 8` on the wrapping `dl`.
  `dt` moves from mono `sm` to sans `lg` / `font-weight: 700` so
  service names read at the body-emphasis tier; the binding still
  renders adjacent in mono `sm` and the badge still anchors the
  right edge. The row itself becomes a 3-column grid that reads
  top-to-bottom at `base` and side-by-side at `md`.

- **Hero aside**: drop the bordered metadata card. The rail is now
  three raw `<span>`s — mono `sm` / muted — in a flex column with
  `gap: 1`. Proximity alone groups the three lines.

- **Hero secondary button**: drop the bordered-button look. The
  GitHub link becomes a plain accent text link with an arrow
  marker (`GitHub でソースを見る →`). The primary 2025 edition
  button stays filled; the secondary follows the reference site's
  "one solid CTA per section, the rest is text" rule.

- **Section dividers**: drop entirely. Every `border-block-start`
  rule on the body sections and the footer is gone. Whitespace
  alone separates Hero → Capabilities → Status → Footer.

- **Footer**: drop the `2fr / 3fr / 3fr` boxed grid. The footer
  keeps the 3-column composition but loses every border, including
  the top divider. The `04` decoration sits at `3xl`, the same
  tier as the spread section heading and the hero display, so the
  page reads with a single display voice.

### What was deliberately not changed

- **No proximity-as-a-primitive**. The proximity rule is a
  caller-side decision: each section picks its own `gap-*` values
  to set the rhythm between sibling rows. A `<ProximityStack>`
  primitive would hide the rhythm choice from the design system
  and create a one-purpose abstraction (`token-audit` §4).
- **No `motion-system` entry transition**. The proximity revision
  doesn't add motion to compensate for the visual simplicity; it
  relies on whitespace carrying the hierarchy.
- **No removed `gap-*` tokens**. The proximity revision only *uses*
  larger gaps (`8`, `12`, `16`, `20`) more deliberately; it does
  not change the gap scale itself. If a future ticket needs a gap
  larger than `20`, that's a separate token promotion.
- **No relaxed `lineHeight`**. Display `lineHeight: 1.1` stays.
  Proximity is not a substitute for tight display rhythm — the two
  work together.

### Rationale chain

- **Gestalt proximity (the underlying design principle)**: when
  elements share a region or are placed close together, the reader
  perceives them as a group — without borders or backgrounds. The
  reference site leans on this exclusively; the bordered
  editorial-spread second pass was overdesigned.
- `typesetting` §6: at `3xl` (40px) the headline reads as a
  section identifier. The original `4xl` (48px) added visual
  weight without adding information; dropping it makes the section
  rhythm quieter but still legible.
- `token-audit` §3-4: every primitive must have at least two
  non-trivial consumers. `4xl` had two consumers (spread heading +
  capability h3), but the proximity revision moved h3 back to `xl`
  so `4xl` lost its second consumer and got dropped. The same
  logic drops `5xl`.
- `responsive-design` §Editorial rhythm: editorial surfaces stay
  readable at 200% zoom and at 320 CSS px. Proximity scales
  naturally — `gap-*` increases proportionally with the type
  scale; borders would have to be re-drawn.
- `accessibility-audit` §Reflow: proximity doesn't break reflow.
  Borders did — at 200% zoom the 1px borders became 2px and the
  card grid became busy with thick black underlines.
- `accessibility-audit` §Cognitive load: the bordered editorial-
  spread layout asked the reader to parse two channels (text +
  box) at once. The proximity revision asks for one channel. The
  reader spends less cognitive effort identifying what belongs
  together.
