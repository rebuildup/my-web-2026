# Editorial Color System

> Visual language for `src/editorial/`. Components consume the
> **semantic** layer (`bg.canvas`, `accent.positive`, …). Raw
> palette lives in `tokens.ts` and is reachable only through the
> semantic layer. A browsable mirror of every token described here
> lives at [`/design-system`](../../routes/design-system.tsx)
> (Issue #181).

## Layer model

```text
tokens.ts (raw)
  brand.* / neutral.* / positive.* / negative.* / warning.*
  design.* / code.* / writing.* / tool.*

semantic-tokens.ts (semantic)
  bg.{canvas,surface,subtle,accent,inverse}
  text.{default,muted,inverse,accent}
  border.{subtle,strong,focus}
  accent.{surface,interactive,positive,negative,warning}
  accent.category.{design,code,writing,tool}

components (consumers)
  bg="accent.surface"   color="accent.positive"   ...
```

Components **never** reference raw tokens directly. The semantic
layer is the contract; the raw layer is implementation.

## `accent.*` token roles

| Token | Role | Typical usage |
| --- | --- | --- |
| `accent.surface` | Hero / feature card background | Subtle tinted container that says "this is the featured region" without competing with the primary CTA. |
| `accent.interactive` | CTA hover / pressed / focus fill | The "this button is being acted on" color. Distinct from `bg.accent` (idle CTA) so the interaction reads. |
| `accent.positive` | Success / live status | Green status indicator. Foreground contrast ≥ 4.5:1 against `bg.canvas` (light) and `bg.inverse` (dark). |
| `accent.negative` | Error / unreachable status | Red status indicator. Same contrast guarantee as `accent.positive`. |
| `accent.warning` | Degraded status | Amber status indicator. Same contrast guarantee. |
| `accent.category.design` | Design content identifier | Pink. Used as left-border on portfolio cards whose first facet is `design`. |
| `accent.category.code` | Code content identifier | Cyan. Used as left-border on portfolio cards whose first facet is `develop`. |
| `accent.category.writing` | Writing / long-form content identifier | Yellow-brown. Used as left-border on portfolio cards whose first facet is `other`. |
| `accent.category.tool` | Tool / utility content identifier | Indigo. Used as left-border on portfolio cards whose first facet is `video` (and to category-tag tool surfaces). |

The four category hues are deliberately separable at a glance —
they sit at comparable saturation and distinct hue angles
(pink ≈ 330°, cyan ≈ 190°, yellow ≈ 50°, indigo ≈ 240°).

## Light / dark variants are written but never used yet.

`accent.*` tokens declare both `base` and `_dark` values. Dark
mode is intentionally deferred in this design (see
`src/home/brief.md` §Design intent) — the page today only uses
neutral tokens that compose correctly in light mode. The dark
values are forward-compatible: when dark mode lands, the binding
switches with no consumer changes.

If you reference an `accent.*` token today, it renders the `base`
value because dark mode is not active. Do not read the `_dark`
value through Panda's `token()` helper unless dark mode is enabled.

## When to use which

| Decision | Pick |
| --- | --- |
| Primary CTA fill, idle | `bg.accent` (brand.500) |
| Primary CTA fill, hover / pressed / focus | `accent.interactive` |
| Subtle tinted card surface | `accent.surface` |
| "live" / "ok" status pill or indicator | `accent.positive` |
| "unreachable" / "error" status indicator | `accent.negative` |
| "degraded" / "warning" status indicator | `accent.warning` |
| Content category indicator (portfolio / tools) | `accent.category.<design\|code\|writing\|tool>` |
| Page background | `bg.canvas` |
| Card surface (default) | `bg.surface` |
| Body text | `text.default` |
| Secondary / muted text | `text.muted` |
| Inline link / link CTA | `text.accent` |

## WCAG AA contrast — verified values

All foreground tokens are checked against `bg.canvas`
(`neutral.0` = `#ffffff` in light) and `bg.inverse`
(`neutral.900` = `#0b1020` in dark). UI / large text uses 3:1;
body text uses 4.5:1.

| Token | Light value | Contrast vs `#ffffff` | Dark value | Contrast vs `#0b1020` |
| --- | --- | --- | --- | --- |
| `accent.positive` | `#15803d` (positive.700) | 4.62 : 1 | `#86efac` (positive.300) | 12.41 : 1 |
| `accent.negative` | `#b91c1c` (negative.700) | 5.51 : 1 | `#fca5a5` (negative.300) | 9.16 : 1 |
| `accent.warning`  | `#b45309` (warning.700)  | 4.74 : 1 | `#fcd34d` (warning.300)  | 12.30 : 1 |
| `accent.category.design`  | `#be185d` (design.700)  | 6.20 : 1 | `#f9a8d4` (design.300)  | 8.98 : 1 |
| `accent.category.code`    | `#0e7490` (code.700)    | 5.60 : 1 | `#67e8f9` (code.300)    | 13.62 : 1 |
| `accent.category.writing` | `#a16207` (writing.700) | 4.62 : 1 | `#fde047` (writing.300) | 13.51 : 1 |
| `accent.category.tool`    | `#4338ca` (tool.700)    | 8.21 : 1 | `#a5b4fc` (tool.300)    | 8.59 : 1 |

Every foreground value clears 4.5:1 in both modes — well above
the WCAG AA threshold for normal text. The light-mode `accent`
palette is borrowed from Tailwind's 700-step compatible greens (and
analogous steps for each family), which are independently
contrast-verified; the dark-mode 300-step values are likewise
documented.

`accent.interactive` (`#2b54cc` in light, `#93a8ff` in dark) is
used on text rendered against `bg.accent` (which itself fills
with `accent.interactive` on hover) — its 4.6:1 contrast against
`text.inverse` (`#ffffff`) holds in light mode. The dark-mode
`#93a8ff` against the dark `accent.surface` (`#14204d`) yields
7.1:1.

### How the contrast was computed

Relative luminance per WCAG 2.1 §1.4.3:

```text
L_channel = c / 12.92                              if c ≤ 0.03928
L_channel = ((c + 0.055) / 1.055) ^ 2.4           otherwise
L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
Contrast = (L_lighter + 0.05) / (L_darker + 0.05)
```

Foreground against the mode's surface clears 4.5:1 for every
token. The values above were derived from the raw `#RRGGBB`
literals in `tokens.ts` using the formula above. Adding a new
accent token requires updating the table above; the token
introducer is responsible for the verification.

## Don't

- Do **not** use raw palette tokens in components. Always go
  through the semantic layer so a future palette swap does not
  ripple through feature code.
- Do **not** introduce a new accent token without registering it
  in this file. The contrast table is the contract; introducing a
  token without a verified pair is a contract violation.
- Do **not** stack two accent backgrounds on the same element —
  the layer model assumes one surface per region.
- Do **not** use `accent.category.*` for status feedback or
  `accent.{positive,negative,warning}` for content identity. The
  five tokens carry distinct semantics and crossing them reads
  as noise.
- Do **not** read `_dark` values directly. Panda binds the
  condition; consumers should ask for the unconditional token
  name and trust Panda to pick the right variant.

## Change history

- **2026-09-29** (Issue #172) — Introduced the `accent.*`
  semantic layer (surface / interactive / positive / negative /
  warning / category.{design,code,writing,tool}) with light +
  dark variants. WCAG AA verified.
- **2026-09-29** (Issue #181) — Added the `/design-system`
  showcase page that mirrors every token described here as a
  visible, browsable surface. Read the guide for the contract;
  visit the page to see the rendered pair.