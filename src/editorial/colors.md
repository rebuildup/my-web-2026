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

semantic-tokens.ts (semantic) — every token is `{ value: { base, _dark } }`
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
| `accent.positive` | Success / live status | Green status indicator. Foreground contrast ≥ 4.5:1 against `bg.canvas` in **both** appearances (`#ffffff` light / `#020617` dark). |
| `accent.negative` | Error / unreachable status | Red status indicator. Same contrast guarantee as `accent.positive`. |
| `accent.warning` | Degraded status | Amber status indicator. Same contrast guarantee. |
| `accent.category.design` | Design content identifier | Pink. Used as left-border on portfolio cards whose first facet is `design`. |
| `accent.category.code` | Code content identifier | Cyan. Used as left-border on portfolio cards whose first facet is `develop`. |
| `accent.category.writing` | Writing / long-form content identifier | Yellow-brown. Used as left-border on portfolio cards whose first facet is `other`. |
| `accent.category.tool` | Tool / utility content identifier | Indigo. Used as left-border on portfolio cards whose first facet is `video` (and to category-tag tool surfaces). |

The four category hues are deliberately separable at a glance —
they sit at comparable saturation and distinct hue angles
(pink ≈ 330°, cyan ≈ 190°, yellow ≈ 50°, indigo ≈ 240°).

## Dark appearance

Every semantic token is declared as
`{ value: { base, _dark } }`. `panda.config.ts` redefines Panda's
`dark` condition as `@media (prefers-color-scheme: dark)`, so the
`_dark` binding switches with the visitor's OS preference — no
toggle, no runtime class, no consumer change. `src/styles.css`
declares `color-scheme` on the same media query so scrollbars,
form controls and the UA canvas switch together.

The `value: { … }` wrapper is **required**. A bare
`{ base, _dark }` object is parsed as an extra layer of *token
path* rather than as conditions: Panda still emits the per-condition
custom properties, but the utility resolves to the literal token
path (`color: accent.positive`), which the browser discards as
invalid CSS. That is the shape Issue #172 shipped, and it is why
status badges, category borders and the CTA hover fill never
rendered their colour.

### What changes and what does not

| Group | Tokens | Rule |
| --- | --- | --- |
| Surface ladder | `bg.canvas` / `bg.surface` / `bg.subtle` | light steps down (`0 → 50 → 100`), dark steps *up* (`950 → 900 → 800`), one notch per tier, so depth still reads as successive layers |
| Text ladder | `text.default` / `text.muted` / `text.accent` | near-white instead of white, gray instead of mid-gray, and the link **brightens** on dark where it darkens on light |
| Borders | `border.subtle` / `border.focus` | follow their surface; `border.strong` is static |
| Status / category | `accent.positive` / `negative` / `warning` / `category.*` | unchanged from Issue #172 — the 300 steps already cleared AA on a dark canvas |
| **Static by decision** | `bg.accent`, `bg.inverse`, `text.inverse`, `border.strong`, `accent.interactive` | `base` and `_dark` are deliberately identical |

The static group is a decision, not an omission:

- **`text.inverse` + `bg.accent` / `accent.interactive`** — every
  `text.inverse` in the codebase sits on the CTA fill. The fill stays
  on the dark brand steps (Issue #201's contract: accessible text /
  CTA roles use 700–800), so the label stays white. Issue #172 bound
  `accent.interactive`'s `_dark` to `brand.300`, which would have put
  white text on light cyan at 1.5 : 1.
- **`bg.inverse` + `text.inverse`** — a self-contained
  surface/foreground pair: the panel and the white label that
  belongs on it. Inverting one without the other produces a light
  panel carrying white text.
- **`border.strong`** — an emphasis rule has to read at the same
  weight in both appearances, and `neutral.500` clears 3 : 1 on
  either canvas.

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

The current palette uses a saturated sky/cyan brand ramp while keeping
text and interactive roles on darker semantic steps. The bright
`brand.500` (`#0ea5e9`) is a visual signature, not a white-text CTA
fill. `bg.accent` / `text.accent` resolve to `brand.700`, hover /
pressed resolves to `brand.800`, the focus ring resolves to
`brand.600` in light and `brand.300` in dark.

Foreground tokens are checked against `bg.canvas` — `neutral.0`
(`#ffffff`) in light, `neutral.950` (`#020617`) in dark. Normal text
uses 4.5 : 1; non-text indicators and fills use 3 : 1.

### Dark — all pairs pass (Issue #290)

| Token / pair | Dark value | Background | Contrast |
| --- | --- | --- | --- |
| `text.default` | `#f8fafc` (neutral.50) | `#020617` canvas | 19.28 : 1 |
| `text.muted` | `#94a3b8` (neutral.400) | `#020617` canvas | 7.87 : 1 |
| `text.accent` | `#7dd3fc` (brand.300) | `#020617` canvas | 12.10 : 1 |
| `text.default` | `#f8fafc` | `#0f172a` surface | 17.06 : 1 |
| `text.muted` | `#94a3b8` | `#0f172a` surface | 6.96 : 1 |
| `text.muted` (Badge) | `#94a3b8` | `#1e293b` subtle | 5.71 : 1 |
| `text.default` on `accent.surface` | `#f8fafc` | `#082f49` (brand.950) | 13.26 : 1 |
| `text.muted` on `accent.surface` | `#94a3b8` | `#082f49` (brand.950) | 5.41 : 1 |
| `text.inverse` / CTA label | `#ffffff` | `#0369a1` (brand.700) | 5.93 : 1 |
| `text.inverse` / pressed label | `#ffffff` | `#075985` (brand.800) | 7.56 : 1 |
| `text.inverse` on `bg.inverse` | `#ffffff` | `#0f172a` | 17.85 : 1 |
| `accent.positive` | `#6ee7b7` | `#020617` canvas | 13.23 : 1 |
| `accent.negative` | `#fda4af` | `#020617` canvas | 10.67 : 1 |
| `accent.warning` | `#fcd34d` | `#020617` canvas | 13.99 : 1 |
| `accent.category.design` | `#f9a8d4` | `#020617` canvas | 11.12 : 1 |
| `accent.category.code` | `#67e8f9` | `#020617` canvas | 13.92 : 1 |
| `accent.category.writing` | `#fde047` | `#020617` canvas | 15.30 : 1 |
| `accent.category.tool` | `#a5b4fc` | `#020617` canvas | 10.12 : 1 |
| `bg.accent` fill (non-text, 3 : 1) | `#0369a1` | `#020617` canvas | 3.40 : 1 |
| `border.focus` (non-text, 3 : 1) | `#7dd3fc` | `#020617` canvas | 12.10 : 1 |
| `border.strong` (non-text, 3 : 1) | `#64748b` | `#020617` canvas | 4.24 : 1 |

Layering reference (no WCAG minimum, recorded so the depth
relationship is visible): `accent.surface` sits 1.45 : 1 above the
dark canvas and `border.subtle` 1.38 : 1 — light mode's equivalent
numbers are 1.07 : 1 and 1.10 : 1, so the "barely a tint" character
of those two tokens survives the appearance change.

### Light

| Token / pair | Light value | Background | Contrast |
| --- | --- | --- | --- |
| `text.default` | `#0f172a` (neutral.900) | `#ffffff` canvas | 17.85 : 1 |
| `text.muted` | `#64748b` (neutral.500) | `#ffffff` canvas | 4.76 : 1 |
| `text.muted` | `#64748b` | `#f8fafc` surface | 4.55 : 1 |
| `text.accent` | `#0369a1` (brand.700) | `#ffffff` canvas | 5.93 : 1 |
| `text.inverse` / CTA label | `#ffffff` | `#0369a1` (brand.700) | 5.93 : 1 |
| `text.inverse` / pressed label | `#ffffff` | `#075985` (brand.800) | 7.56 : 1 |
| `accent.positive` | `#047857` | `#ffffff` canvas | 5.48 : 1 |
| `accent.negative` | `#be123c` | `#ffffff` canvas | 6.29 : 1 |
| `accent.warning` | `#b45309` | `#ffffff` canvas | 5.02 : 1 |
| `accent.category.design` | `#be185d` | `#ffffff` canvas | 6.04 : 1 |
| `accent.category.code` | `#0e7490` | `#ffffff` canvas | 5.36 : 1 |
| `accent.category.writing` | `#a16207` | `#ffffff` canvas | 4.92 : 1 |
| `accent.category.tool` | `#4338ca` | `#ffffff` canvas | 7.90 : 1 |
| `bg.accent` fill (non-text, 3 : 1) | `#0369a1` | `#ffffff` canvas | 5.93 : 1 |
| `border.focus` (non-text, 3 : 1) | `#0284c7` | `#ffffff` canvas | 4.10 : 1 |
| `border.strong` (non-text, 3 : 1) | `#64748b` | `#ffffff` canvas | 4.76 : 1 |
| **`text.muted` on `bg.subtle`** | `#64748b` | `#f1f5f9` | **4.34 : 1 — known gap** |
| **`text.muted` on `accent.surface`** | `#64748b` | `#f0f9ff` | **4.46 : 1 — known gap** |

The two bold rows are **pre-existing** and are *not* introduced by
Issue #290: no `base` value changed in that ticket. `text.muted`
(`neutral.500`) clears 4.5 : 1 on white by a thin margin, and any
tint pushed underneath it drops below the threshold — which is why
the Badge (`bg.subtle` + `text.muted`) and the `accent.surface`
eyebrow read 4.34 / 4.46. The dark counterparts of both pairs pass
(5.71 / 5.41). The candidate repair is moving `text.muted` to
`neutral.600`, which darkens secondary text on **every** light page
and therefore belongs to a dedicated accessibility pass rather than
to the dark-theme ticket. Recorded for `accessibility-audit`.

### How the contrast was computed

Relative luminance per WCAG 2.1 §1.4.3:

```text
L_channel = c / 12.92                              if c ≤ 0.03928
L_channel = ((c + 0.055) / 1.055) ^ 2.4           otherwise
L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
Contrast = (L_lighter + 0.05) / (L_darker + 0.05)
```

The values above are derived from the raw `#RRGGBB` literals in
`tokens.ts` by reading `semantic-tokens.ts` and dereferencing each
`{ base, _dark }` binding, so the table cannot drift from the
implementation. Adding or remapping a semantic token requires
re-running that calculation and updating this section.

Two independent checks accompany the table:

1. A token-level script over all 21 semantic tokens × 22 pairs ×
   2 appearances (the source of the numbers above).
2. A DOM-level audit that walks visible text on `/`,
   `/design-system`, `/tools` and `/portfolio` in both appearances,
   composites each element's colour against its effective background
   and reports anything below its threshold. **Dark returns 0
   failures on all four routes**; light returns exactly the 4
   elements listed in the known-gap rows above.

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

- **2026-10-08** (Issue #290) — Dark theme enabled. `panda.config.ts`
  redefines the `dark` condition as `@media (prefers-color-scheme:
  dark)`; all 21 semantic tokens moved to the `{ value: { base, _dark } }`
  shape (the previous bare `{ base, _dark }` was read as token path and
  left every `accent.*` utility emitting invalid CSS, so status
  badges / category borders / CTA hover never rendered their colour).
  12 `_dark` bindings added, 2 repaired (`accent.interactive`
  brand.300→800, `accent.surface` brand.800→950), 5 declared static by
  decision. Added raw steps `neutral.400/800/950` and `brand.950`.
  `color-scheme` and the `body` canvas wired in `src/styles.css`;
  counter digit bitmaps inverted under dark; `/design-system` shows the
  real `base` / `_dark` pair instead of an `bg.inverse` simulation.
  Dark contrast verified at 0 failures across `/`, `/design-system`,
  `/tools`, `/portfolio`; two pre-existing light gaps recorded above.
- **2026-10-03** (Issue #201) — Replaced the muted blue/grey palette with a high-chroma sky/cyan brand ramp, cooler slate neutrals, and more vivid positive/negative status ramps. CTA/link/focus roles were remapped to accessible darker steps; `/design-system` now derives its swatch references from the semantic-token source instead of maintaining a second raw-token map.
- **2026-09-29** (Issue #172) — Introduced the `accent.*`
  semantic layer (surface / interactive / positive / negative /
  warning / category.{design,code,writing,tool}) with light +
  dark variants. WCAG AA verified.
- **2026-09-29** (Issue #181) — Added the `/design-system`
  showcase page that mirrors every token described here as a
  visible, browsable surface. Read the guide for the contract;
  visit the page to see the rendered pair.