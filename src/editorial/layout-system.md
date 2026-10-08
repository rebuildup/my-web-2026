# Layout System

> Layout rules for `src/editorial/`. Style is produced by Panda CSS
> (`@pandacss/dev`); the **token contract** that every surface
> consumes lives in `src/editorial/tokens.ts` (raw) and
> `src/editorial/semantic-tokens.ts` (semantic). Components never
> reach past the semantic layer.

## 1. Core rule — no box-style containment on public surfaces

**Public surfaces use grid + whitespace, not bordered boxes.**

The canonical layout vocabulary of every public surface is:

```text
section          →  paddingBlock (responsive vertical rhythm)
  Container      →  max-width + responsive paddingInline
    SectionHeading →  grid: 4/12 heading column  +  8/12 body column
      body        →  grid / flex + gap (no border / no background)
```

A bordered "box" (1px `border.subtle` + padding + `borderRadius`)
drawn around ordinary prose / list items is **forbidden** on public
surfaces. It narrows the readable body, it duplicates the visual frame
the surrounding section already provides (the §3.3 padding rhythm,
optionally topped by a `borderTop` hairline), and it shifts the page's
voice from "editorial whitespace" to "card grid" — which is not the
design language.

### Reserve bordered / contained surfaces for state-specific UI

The exceptions that are allowed (state-specific UI):

- **Buttons and toggle chips** — interactive controls whose primary
  job is to read as "this can be pressed". Pill / square / rounded
  backgrounds with a faint border are the affordance.
- **Modal / dialog surfaces** — the picker skeleton, the emoji
  picker dialog, any future modal.
- **Empty / error / loading states** — `border.dashed` + a faint
  background to mark "nothing to show right now, the data is in
  flight / absent / broken".
- **Code blocks** — `<pre>` / `<code>` blocks in the Markdown
  renderer, where the box communicates "this is code, not prose".
- **Form fields** — `<input>` / `<textarea>` / `<select>` (only when
  ever introduced).
- **Image placeholder / broken-image frame** — `bg.subtle` + a thin
  border around the placeholder, so the layout does not collapse
  while the real image is missing.

Anything that is **not** one of the above should rely on grid
placement + spacing tokens + the shared section separator (§3.3
padding rhythm, with a `borderTop` hairline where the page uses one)
to be readable.

### Viewport observations (where the box anti-pattern was loudest)

| Viewport | Why the box is jarring |
| --- | --- |
| 375 px (iPhone SE / narrow phones) | Each box eats ~32 px of internal width (4 + 4 padding + border); the prose column narrows visibly. |
| 768 px (md breakpoint) | The boxes align horizontally and read as a card grid, not as editorial prose. |
| 1024 px (lg, content max-width) | The boxes feel "added"; the prose without the box is the cleaner read. |
| 1440 px (wide desktop) | The max-width container (1024 px) already constrains the eye; an inner border becomes redundant. |

## 2. Stack — what primitive owns what

| Primitive | Lives in | Job |
| --- | --- | --- |
| `Container` | `src/editorial/primitives/Container.tsx` | Page-width wrapper (`max-width: 1024px` + responsive `paddingInline`). |
| `SectionHeading` | `src/editorial/primitives/SectionHeading.tsx` | Section header (eyebrow / h2 / description) — `default` (single-column) or `spread` (4/12 + 8/12 grid). |
| `Badge` | `src/editorial/primitives/Badge.tsx` | Inline status pill (`bg.subtle` / `bg.accent`). Status only — never a primary interactive element. |
| `PublicNav` | `src/editorial/nav/PublicNav.tsx` | Site-wide chrome. Mounted in `__root.tsx`, gated to non-`/admin/*` paths. |

## 3. Canonical grid — the one grid every public page sits on

> Formalised by Issue #300 from a site-wide audit (all public pages
> screenshotted at 1280 px and 375 px, element boxes measured with
> Playwright `boundingBox()`). Every number below is measured, not
> guessed. Do not introduce a competing grid.

### 3.1 Geometry

| Coordinate | Value |
| --- | --- |
| `Container` | `max-width: 1024px`, centred, `paddingInline` `4 / 6 / 8` (16 / 24 / 32 px) → content width ≤ **960 px**, content-left edge at **160 px** on a 1280 px viewport, **16 px** at 375 px |
| Column system | 12 conceptual columns; the canonical split is **4/12 title span + 8/12 content span** |
| Section grid rule | `gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' }`, `columnGap: { base: '0', lg: '10' }` (40 px), `rowGap: { base: '10', lg: '0' }` (40 px) |
| Title span (left) | **306.67 px** @1280 — left edge = Container content edge |
| Content span (right) | **613.33 px** @1280 — left edge = `x = 506.67` |
| Below `lg` | one column (`1fr`); the heading cluster and the content are separated by `rowGap` 10 (40 px) |

The three renderings of this one rule:

- `SectionHeading variant="spread"` — heading cluster (eyebrow → h2 →
  description) in the title span, section content in the content span.
- The home hero (Issue #295) — the same grid, verbatim: the eyebrow
  line and the h1 sit in the **title span**, the right span starts
  with the lead description.
- Label/value rows inside a content span — contact channel rows use
  the same 4/8 split *inside* their column so the inner label axis
  lines up with the page grid; wider tables (home status rows) size
  the label column to its content and give the rest to the detail
  column (`minmax(0, auto) minmax(0, 1fr) auto`), keeping all three
  cells on one line at the Container width.

**Key lines to verify with `boundingBox()`** (they are the grid, made
visible):

1. Every section title and every hero title span shares the same
   left `x` (the Container content edge).
2. Every content column shares the same left `x`
   (`content edge + 4/12 + gutter`).
3. Below `lg`, everything starts at the Container content edge.

A `default` (single-column) `SectionHeading` remains legitimate **only
when a section genuinely has no content column** — its heading cluster
still starts on the same left edge, and its description keeps the
640 px measure cap. The section *content* itself may be full-width
below the heading (contact's channel list, portfolio's list) as long
as its rows keep the 4/8 label/value axes above.

### 3.2 Section anatomy

```text
section        →  paddingBlock (rhythm, §3.3) + optional full-bleed
                  borderTop hairline (page-voice decision, §3.5)
  Container    →  max-width 1024 + responsive paddingInline
    SectionHeading (spread)  →  4/12 title span  |  8/12 content span
      content   →  grid / flex / list + gap tokens (no box, §1)
```

### 3.3 Spacing rhythm

One rhythm for every page (`src/home/brief.md` golden-ratio scale;
tokens are the authority, not pixel literals):

| Beat | `paddingBlock` (base / lg) | px @375 / @1280 |
| --- | --- | --- |
| Page hero (top of page → first section) | `16 / 32` | 64 / 128 |
| Body section | `16 / 24` | 64 / 96 |
| Footer / closing section | `16 / 24` | 64 / 96 |
| List row (bordered row inside a list) | `6` | 24 |
| Gap between list rows / cards | `10` (status, cards) or `0` + hairline (contact, tools) | 40 or 0 |

The beat comes from the **section role**, never from how dense its
content is: a sparse section (home 05 Contact — one button) and a
dense section (home 01 Capabilities) carry the same padding, so the
step between them is always readable as structure.

### 3.4 Type inside the grid

| Role | Size | line-height / tracking | Note |
| --- | --- | --- | --- |
| Page `h1` (hero) | `3xl / 4xl` (40 / 64) | `1.15 / 1.05`, `-0.03em` | one display voice per page |
| Section `h2` (both `SectionHeading` variants) | `2xl` (32) | `1.15`, `-0.025em` | Issue #300: the title span is 306.67 px wide, and a 10-character Japanese phrase at 40 px needs 312 px — it cannot resolve at any phrase boundary. 2xl fits every current JP title with margin, and unifies the `default`/`spread` variants which previously rendered 24/32 vs 32/40 for the same heading level. Supersedes `brief.md` §4's `2xl/3xl` for the title-span h2. |
| Card / row `h3`-tier title | `xl` (24) | — | one tier under the section title |
| Description | `md` (16), line-height `1.6` | — | capped at 640 px in the `default` variant; constrained by the title span in `spread` |

**Japanese line breaking (Issue #300).** The site sets
`word-break: normal` then `word-break: auto-phrase` once in
`src/styles.css` (`@layer base`), so every Japanese text node offers
phrase-boundary break opportunities in browsers that implement
`auto-phrase` (Chromium 119+; verified in this repo's Playwright
Chromium) and falls back to `normal` where the value is unknown —
the declaration is dropped and rendering is unchanged from before.
On top of that base:

- titles (`h1`/`h2`) add `text-wrap: balance`,
- descriptions add `text-wrap: pretty`.

Components that legitimately need freer breaking (mono token names,
long identifiers) keep their local `word-break: break-all` — the
utilities layer wins over the base layer.

### 3.5 Hero contract

The hero is a section like any other: same `Container`, same 4/8
coordinate system (§3.1), same `16 / 32` beat (§3.3). What differs
between pages is *which span carries the title*, and that composition
is owned by the page:

- **Home** — Issue #295 / #287: title span = eyebrow line + mark `h1`,
  content span = lead description → secondary → CTAs.
- **About / Design system** — metadata rail in the title span,
  caption → `h1` → lead in the content span.
- **Contact / Portfolio / Tools** — single-column title block
  (eyebrow → `h1` → lead, measure-capped) starting on the Container
  content edge.

All three sit on the same key lines; only the composition inside the
spans differs. Restructuring a page hero's composition is a
page-owner decision (`src/home/hero.tsx` is Issue #295's).

**Section separators.** The rhythm beat is always whitespace
(§3.3). A page may additionally mark section boundaries with a
full-bleed `borderTop` hairline (`about`, `design-system`) or mark
*list rows* with an inset hairline (contact, tools) — never both
around the same surface, and never instead of the padding beat.

## 4. Proximity rule

Within a `spread` SectionHeading, the body column carries content
that has internal `gap` tokens. Within `Container`-centric edges
(`PortfolioList` and `PortfolioDetail`), the section-to-section
separation is the **shared `borderTop: 1px solid {colors.border.subtle}`**
plus a `paddingBlock` (16 / 24). Do not invent per-card borders on
top.

Within a single list:

- Use `gap` to separate items, not per-item borders.
- Use the section's existing `borderTop` to anchor the first item if
  you must visually start a list (only when the list is preceded by
  the previous section's separator).
- A row inside a list (`<li>`) must NOT carry its own `border` /
  `backgroundColor` / `borderRadius`; that draws a redundant box.

## 5. Interaction states (hover / focus / active)

The reserved space for interaction visual feedback is the
`_hover` / `_focusVisible` / `_active` states of the actual
control:

- Buttons: `border.subtle → border.strong` on hover; `outline` on
  focus-visible.
- Toggles (chips / facet filters): `bg.surface → bg.accent` and
  `text.default → text.inverse` plus `aria-pressed` for AT users.
- Inline links: `text.muted → text.default` plus underline on hover;
  outline on focus-visible.

Do not communicate state by toggling a background that looks like a
card; communicate it by toggling the existing interactive surface.

## 7. Audit checklist for new code

Before a public surface PR merges, the author must verify:

1. No `borderWidth` / `borderStyle` / `borderColor` is used on a
   list item, column, or prose block (exceptions: §1, §4 controls).
2. No `backgroundColor: 'bg.surface'` / `'bg.subtle'` / `'bg.muted'`
   is used on a non-state surface (exceptions: §1).
3. New surfaces participate in the spread / default
   `SectionHeading` grid documented in §3 — not a competing grid:
   same Container edges, same 4/8 split, same left key lines.
4. Section / hero `paddingBlock` matches the §3.3 rhythm table —
   the beat comes from the section role, not its density.
5. Japanese titles and descriptions render at phrase boundaries
   (§3.4): no mid-phrase title wrap, no 1–2 character orphan line.
   Verify at 1280 px **and** 375 px with `boundingBox()` / line
   inspection, not only by eye.
6. At 375 px the readable column inside the body section is
   **not** narrowed by an internal box that the section did not
   already carry, and the page has no horizontal overflow
   (`scrollWidth <= clientWidth`).
7. The visual language still reads as "editorial whitespace" at
   1024 px (the max-width viewport) — not as "card grid".