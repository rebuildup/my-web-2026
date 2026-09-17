# Design Brief — Personal Web Platform (home page)

> Source of design direction for `src/modules/home/`. Owned by
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
  (already in the design-system recipe).
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
- **`src/modules/home/` is the canonical home**: the route file
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
