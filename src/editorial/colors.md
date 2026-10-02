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
| Primary CTA fill, idle | `bg.accent` (brand.700) |
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

The 0.5.0 palette uses a saturated sky/cyan brand ramp while keeping
text and interactive roles on darker semantic steps. The bright
`brand.500` (`#0ea5e9`) is a visual signature, not a white-text CTA
fill. `bg.accent` / `text.accent` resolve to `brand.700`, hover /
pressed resolves to `brand.800`, and the focus ring resolves to
`brand.600`.

Foreground tokens are checked against `bg.canvas`
(`neutral.0` = `#ffffff` in light) and `bg.inverse`
(`neutral.900` = `#0f172a` in dark). Normal text uses 4.5:1;
non-text focus indicators use 3:1.

| Token | Light value | Contrast vs `#ffffff` | Dark value | Contrast vs `#0f172a` |
| --- | --- | --- | --- | --- |
| `accent.positive` | `#047857` (positive.700) | 5.48 : 1 | `#6ee7b7` (positive.300) | 11.71 : 1 |
| `accent.negative` | `#be123c` (negative.700) | 6.29 : 1 | `#fda4af` (negative.300) | 9.44 : 1 |
| `accent.warning` | `#b45309` (warning.700) | 5.02 : 1 | `#fcd34d` (warning.300) | 12.38 : 1 |
| `accent.category.design` | `#be185d` (design.700) | 6.04 : 1 | `#f9a8d4` (design.300) | 9.84 : 1 |
| `accent.category.code` | `#0e7490` (code.700) | 5.36 : 1 | `#67e8f9` (code.300) | 12.32 : 1 |
| `accent.category.writing` | `#a16207` (writing.700) | 4.92 : 1 | `#fde047` (writing.300) | 13.54 : 1 |
| `accent.category.tool` | `#4338ca` (tool.700) | 7.90 : 1 | `#a5b4fc` (tool.300) | 8.96 : 1 |

The main brand roles also clear their intended thresholds:

| Role | Value | Pair | Contrast |
| --- | --- | --- | --- |
| `bg.accent` | `#0369a1` (brand.700) | `text.inverse` / `#ffffff` | 5.93 : 1 |
| `accent.interactive` (light) | `#075985` (brand.800) | `text.inverse` / `#ffffff` | 7.56 : 1 |
| `text.accent` | `#0369a1` (brand.700) | `bg.canvas` / `#ffffff` | 5.93 : 1 |
| `border.focus` | `#0284c7` (brand.600) | `bg.canvas` / `#ffffff` | 4.10 : 1 |
| `accent.interactive` (dark sample) | `#7dd3fc` (brand.300) | `accent.surface` dark / `#075985` | 4.54 : 1 |
| `text.muted` | `#64748b` (neutral.500) | `bg.canvas` / `#ffffff` | 4.76 : 1 |

### How the contrast was computed

Relative luminance per WCAG 2.1 §1.4.3:

```text
L_channel = c / 12.92                              if c ≤ 0.03928
L_channel = ((c + 0.055) / 1.055) ^ 2.4           otherwise
L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
Contrast = (L_lighter + 0.05) / (L_darker + 0.05)
```

The values above are derived from the raw `#RRGGBB` literals in
`tokens.ts`. Adding or remapping a semantic foreground token requires
updating this table and re-running the same contrast calculation.

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

- **2026-10-03** (Issue #201) — Replaced the muted blue/grey palette with a high-chroma sky/cyan brand ramp, cooler slate neutrals, and more vivid positive/negative status ramps. CTA/link/focus roles were remapped to accessible darker steps; `/design-system` now derives its swatch references from the semantic-token source instead of maintaining a second raw-token map.
- **2026-09-29** (Issue #172) — Introduced the `accent.*`
  semantic layer (surface / interactive / positive / negative /
  warning / category.{design,code,writing,tool}) with light +
  dark variants. WCAG AA verified.
- **2026-09-29** (Issue #181) — Added the `/design-system`
  showcase page that mirrors every token described here as a
  visible, browsable surface. Read the guide for the contract;
  visit the page to see the rendered pair.