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

> Adds a small amount of editorial weight to the hero and a numbered
> section rhythm without breaking the constraints above. Owned by
> Issue #31. **This amendment extends the existing brief; the
> `Avoid`, `Color direction`, `Motion`, and `Avoid` sections above
> remain in force and any future change that contradicts them must
> come back here.**

### What changed

- **Hero h1 step**: `2xl` → `3xl` at `md` and wider. One additional
  step only — `4xl` / `5xl` are not introduced because there is no
  second consumer yet. Raw layer receives a single `3xl` entry
  (`2.5rem`); the semantic layer is unchanged.
- **Hero composition**: the inner `Container` (1024px max) splits
  into an asymmetric 2-column grid at `lg` — `minmax(0, 7fr) minmax(0, 3fr)`
  — with a 12-unit gutter. The lead column caps at 640px to keep the
  measure inside the 60–70 character window; the right rail carries
  a quiet mono metadata card (`edition / my-web-2026 · 2026 Preview /
  v0.2.0 · MIT`). Below `lg` the two columns stack into the original
  single flow.
- **Hero typography tightening**: h1 uses `line-height: 1.15` and
  `letter-spacing: -0.02em` (inline literal, not a token); mixed-
  script spans carry `lang="ja"` on Japanese and `lang="en"` on the
  Latin edition tags so the browser can pick the right rendering
  hints.
- **Section rhythm**: each section heading now carries an editorial
  numbering prefix via the existing `eyebrow` prop
  (`01 — Capabilities`, `02 — System status`). Capability cards each
  add a small mono numeric decoration in the top-left corner; the
  Footer leads with a `04` mono numeric.
- **Capabilities card grid**: gap widens from `6` to `{ base: '6',
  md: '8' }`; card `h3` climbs from `lg` to `xl` to share size
  parity with the section `h2`.
- **Status rows**: `dt` flips to mono for a ledger feel; rows are
  separated by hairlines (`borderBlockStart: 1px solid border.subtle`)
  rather than each carrying its own card border. The first row
  carries no top border so the section heading keeps its spacing.
- **Footer weight**: meta paragraph drops from `sm` to `xs` so the
  footer stays subordinate to the body sections.

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
  (`-0.02em` on the hero h1, `0.04em` on the numeric decorations)
  are scoped to one component each. Promoting them to tokens would
  invite the "Japanese letter-spacing used as decoration" failure
  mode (`typesetting` §5).
- **No raw `4xl` / `5xl` font sizes**. One `3xl` step is the only
  display addition this round. Future tiers require a second
  consumer before they enter the raw layer.
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

- `typesetting` §5: hero display line-height 1.15 for Japanese;
  Latin eyebrow keeps the system default. Inline letter-spacing
  literals scoped to one component, not promoted to tokens.
- `token-audit` §3-4: primitive promotion requires multi-site
  evidence. `3xl` is added because the hero h1 is one consumer and
  the semantic layer is unchanged; any further primitive additions
  wait for evidence.
- `responsive-design` §Macro layout: editorial surfaces hold their
  measure at wide viewports. `Container` stays 1024px; the
  asymmetric grid is built inside it.
- `accessibility-audit` §Reflow: 320 CSS px renders single-column;
  the metadata rail is `display: none` below `lg`. No horizontal
  scroll, no information loss at 200% zoom.
