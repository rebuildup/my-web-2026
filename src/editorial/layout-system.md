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
the surrounding section already provides via its `borderTop`
separator, and it shifts the page's voice from "editorial whitespace"
to "card grid" — which is not the design language.

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
placement + spacing tokens + the shared `borderTop` section
separator to be readable.

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

## 3. Existing grid coordinate system (do not invent a new one)

The editorial grid coordinate system is **12 columns at the
`Container` width**, and the `spread` `SectionHeading` collapses it
into the canonical `4/12` heading column + `8/12` body column
pairing. Below `lg` the columns stack.

Every public body section uses this pairing:

```text
Home:   Hero (own 4/8 rail)  +  01 Capabilities / 02 Status / 03 Reactions / 04 Counter / 05 Contact (all spread)
About:  Hero (own 4/8 rail)  +  01 Identity / 02 Interests / 03 Experience / 04 Current / 05 Future (all spread)  +  06 Footer
Contact: Hero  +  01 Channels (default variant)
Portfolio List:   Hero (within Container)  +  list of ProjectCards (each ProjectCard is a `grid` of 4/8 inside the card)
Portfolio Detail: Hero  +  per-section borderTop  +  Markdown body (`max-width: 640px`)
Tools:   Hero + list of Tool items
```

Adopt this. Do not introduce a competing grid.

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
3. No `backgroundColor: 'bg.surface'` / `'bg.subtle'` / `'bg.muted'`
   is used on a non-state surface (exceptions: §1).
2. New surfaces participate in the spread / default
   `SectionHeading` grid documented in §3 — not a competing grid.
4. At 375 px the readable column inside the body section is
   **not** narrowed by an internal box that the section did not
   already carry.
5. The visual language still reads as "editorial whitespace" at
   1024 px (the max-width viewport) — not as "card grid".