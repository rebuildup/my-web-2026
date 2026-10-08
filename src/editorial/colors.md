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
  charcoal.*   — near-neutral dark ladder (dark appearance only)

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

Every semantic token is declared as `{ value: { base, _dark } }`.
`panda.config.ts` redefines Panda's `dark` condition as
`@media (prefers-color-scheme: dark)`, so the `_dark` binding
switches with the visitor's OS preference — no toggle, no runtime
class, no consumer change. `src/styles.css` declares `color-scheme`
on the same media query so scrollbars, form controls and the UA
canvas switch together.

The `value: { … }` wrapper is **required**. A bare `{ base, _dark }`
object is parsed as an extra layer of *token path* rather than as
conditions: Panda still emits the per-condition custom properties, but
the utility resolves to the literal token path
(`color: accent.positive`), which the browser discards as invalid CSS.
That is the shape Issue #172 shipped, and it is why status badges,
category borders and the CTA hover fill never rendered their colour.

### Where the dark palette comes from

The first draft of Issue #290 painted the dark appearance with the
slate ramp's dark tail — `neutral.950` (`#020617`) canvas,
`neutral.900` surface, `neutral.800` separator. Slate is blue-dominant
at that end (`neutral.900` has B−R = 39), so every layer carried the
same navy cast. The owner's review was 「ダークテーマがダサい」, and
the audit confirmed the mechanism: blue surfaces, blue-gray hairlines,
blue-tinted secondary text and a solid saturated feature panel, with no
neutral rest for the eye.

The rework re-anchors the dark appearance on `charcoal`, a
near-neutral ladder derived from `linear.app` sampled under
`prefers-color-scheme: dark`. Values are derived, not copied — every
`charcoal` step keeps a cool whisper (B−R ≈ 3–4) so the dark
appearance still belongs to the same cool-slate product.

| Reference role | linear.app (sampled) | ours (dark) |
| --- | --- | --- |
| page canvas | `#08090a` | `charcoal.950` `#0a0b0e` |
| raised surface | `#0f1011` / `#161718` | `charcoal.900` `#111317` |
| tinted separator / hairline | `#191a1b` / `#18191a` | `charcoal.800` `#191b21` |
| emphasis line | `#37393a` (below our 3 : 1 rule) | `charcoal.600` `#6f747d` |
| secondary text | `#8a8f98` | `charcoal.400` `#8b9099` |
| page text | `#f7f8f8` | `text.default` dark `#f8fafc` |
| accent | `#5e6ad2` / `#7170ff`, chroma 116 | `brand.700` `#0369a1`, unchanged |
| label / status colors | `#f79ce0` `#83dcdc` `#8fa6ff` | `*.300` category and status steps |

Restraint in the reference comes from **how rarely** brand color
appears, not from desaturating it — their own accent is saturated. So
the rework neutralizes the surroundings and leaves one accent standing,
rather than gray-washing the accent itself.

### What changes and what does not

| Group | Tokens | Rule |
| --- | --- | --- |
| Surface ladder | `bg.canvas` / `bg.surface` / `bg.subtle` | light steps *down* (`0 → 50 → 100`), dark steps *up* through `charcoal` `950 → 900 → 800`, one notch per tier, so depth still reads as successive layers |
| Text ladder | `text.default` / `text.muted` / `text.accent` | near-white instead of white, near-neutral gray instead of slate, and the link **brightens** to `brand.500` on dark where it darkens to `brand.700` on light |
| Borders | `border.subtle` / `border.strong` / `border.focus` | hairline `charcoal.800` (1.14 : 1), emphasis `charcoal.600` (4.19 : 1), focus `brand.300` (11.80 : 1) |
| Tinted feature surface | `accent.surface` | `brand.50` in light, `brand.950` `#151b26` in dark — a sky whisper 1.14 : 1 above the canvas, the same "barely a tint" relationship as light's 1.07 : 1 |
| Status / category | `accent.positive` / `negative` / `warning` / `category.*` | unchanged from Issue #172 — the 300 steps match the reference's light label colors and clear AA on the near-black canvas |
| **Static by decision** | `bg.accent`, `bg.inverse`, `text.inverse`, `accent.interactive` | `base` and `_dark` are deliberately identical |

The static group is a decision, not an omission:

- **`text.inverse` + `bg.accent` / `accent.interactive`** — every
  `text.inverse` in the codebase sits on the CTA fill. It is also the
  `Badge tone="accent"` fill that carries the live / active / enabled
  signal, so graying it out for dark would erase a status distinction
  rather than merely restyle it. The fill has to hold white text at
  ≥ 4.5 : 1 *and* sit ≥ 3 : 1 from the page, which confines it to
  L ∈ [0.11, 0.18] — essentially one usable step of our ramp
  (`brand.700` = 5.93 : 1 with white, 3.32 : 1 from the canvas).
  Issue #172 bound `accent.interactive`'s `_dark` to `brand.300`,
  which would have put white text on light cyan at 1.5 : 1.
- **`bg.inverse` + `text.inverse`** — a self-contained
  surface/foreground pair: the panel and the white label that belongs
  on it. Inverting one without the other produces a light panel
  carrying white text. `bg.inverse` has no production consumer
  outside the showcase.

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
fill. `bg.accent` / `text.accent` resolve to `brand.700` in light and
`brand.500` in dark, hover / pressed resolves to `brand.800`, and the
focus ring resolves to `brand.600` in light and `brand.300` in dark.

Foreground tokens are checked against `bg.canvas` — `neutral.0`
(`#ffffff`) in light, `charcoal.950` (`#0a0b0e`) in dark. Normal text
uses 4.5 : 1; non-text indicators and fills use 3 : 1.

### Dark — all 24 pairs pass (Issue #290)

| Token / pair | Dark value | Background | Contrast |
| --- | --- | --- | --- |
| `text.default` | `#f8fafc` (neutral.50) | `#0a0b0e` canvas | 18.81 : 1 |
| `text.muted` | `#8b9099` (charcoal.400) | `#0a0b0e` canvas | 6.14 : 1 |
| `text.accent` | `#0ea5e9` (brand.500) | `#0a0b0e` canvas | 7.10 : 1 |
| `text.default` | `#f8fafc` | `#111317` surface | 17.77 : 1 |
| `text.muted` | `#8b9099` | `#111317` surface | 5.80 : 1 |
| `text.muted` (Badge) | `#8b9099` | `#191b21` subtle | 5.37 : 1 |
| `text.default` on `accent.surface` | `#f8fafc` | `#151b26` (brand.950) | 16.50 : 1 |
| `text.muted` on `accent.surface` | `#8b9099` | `#151b26` (brand.950) | 5.38 : 1 |
| `text.inverse` / CTA label | `#ffffff` | `#0369a1` (brand.700) | 5.93 : 1 |
| `text.inverse` / pressed label | `#ffffff` | `#075985` (brand.800) | 7.56 : 1 |
| `text.inverse` on `bg.inverse` | `#ffffff` | `#0f172a` | 17.85 : 1 |
| `accent.positive` | `#6ee7b7` | `#0a0b0e` canvas | 12.91 : 1 |
| `accent.negative` | `#fda4af` | `#0a0b0e` canvas | 10.41 : 1 |
| `accent.warning` | `#fcd34d` | `#0a0b0e` canvas | 13.65 : 1 |
| `accent.category.design` | `#f9a8d4` | `#0a0b0e` canvas | 10.85 : 1 |
| `accent.category.code` | `#67e8f9` | `#0a0b0e` canvas | 13.58 : 1 |
| `accent.category.writing` | `#fde047` | `#0a0b0e` canvas | 14.93 : 1 |
| `accent.category.tool` | `#a5b4fc` | `#0a0b0e` canvas | 9.87 : 1 |
| `bg.accent` fill (non-text, 3 : 1) | `#0369a1` | `#0a0b0e` canvas | 3.32 : 1 |
| `border.focus` (non-text, 3 : 1) | `#7dd3fc` | `#0a0b0e` canvas | 11.80 : 1 |
| `border.strong` (non-text, 3 : 1) | `#6f747d` | `#0a0b0e` canvas | 4.19 : 1 |

Layering reference (no WCAG minimum, recorded so the depth
relationship is visible): `accent.surface` sits 1.14 : 1 above the dark
canvas and `border.subtle` 1.14 : 1 — light mode's equivalent numbers
are 1.07 : 1 and 1.10 : 1, so the "barely a tint" character of those
two tokens survives the appearance change.

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

**Pair-level versus element-level.** The two bold rows are *pairs*
(token against token). They are **pre-existing at the pair level**: no
light `base` value changed in Issue #290 (`git diff` shows the only
raw additions were dark-only steps). They are, however, different at
the *element* level, and the two cases must not be conflated:

- `text.muted` on `bg.subtle` (4.34 : 1) — the Badge tone was already
  rendering this pair before Issue #290 (both are plain, resolving
  tokens), so these failing elements are pre-existing.
- `text.muted` on `accent.surface` (4.46 : 1) — the pair existed in
  the token values, but the `accent.surface` utility emitted invalid
  CSS before the `{ value: { base, _dark } }` fix, so **the tint never
  rendered and these elements did not fail**. The fix made the tint
  real and thereby revealed them. That is a conscious accept: the
  alternative was leaving a semantic token dead, and repairing the pair
  means darkening secondary text on every light page.

The candidate repair for both is moving `text.muted` to
`neutral.600`, which is a site-wide light appearance change and
therefore belongs to a dedicated accessibility pass rather than to the
dark-theme ticket. Recorded for `accessibility-audit`.

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
implementation.

Two independent checks accompany the table:

1. **Token level** — all 21 semantic tokens × 24 pairs × 2
   appearances. **Dark: 24/24 PASS.** Light: 2 pair failures (the
   known gaps above).
2. **DOM level** — walks visible text on `/`, `/design-system`,
   `/tools` and `/portfolio` in both appearances, composites each
   element's colour against its backdrop *including ancestor opacity*
   (a container at `opacity: 0.85` dims its own text), and reports
   anything below its threshold. Results, element-level:

   | appearance | failing elements | note |
   | --- | --- | --- |
   | dark | **0** on all four routes | — |
   | light | **35** (6 distinct value signatures) | 9 on the two token pairs above; 26 on `/tools` disabled cards |

   The 26 `/tools` elements are "Coming soon" cards drawn at
   `opacity: 0.85`, so `text.muted` lands at 3.56 : 1 — **byte-identical
   on `release-0-6-1` and out of scope here**, but recorded. They are
   arguably exempt as inactive UI components; they are listed anyway
   rather than argued away.

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

- **2026-10-09** (Issue #290, rework round) — Dark palette re-anchored
  on the new near-neutral `charcoal` ladder (`950/900/800/600/400`)
  after the owner's 「ダークテーマがダサい」 review; slate's blue
  dark tail (`neutral.950` `#020617` etc.) was removed from the dark
  bindings and from the raw palette. `accent.surface` dark toned from
  a saturated `#082f49` block to the `brand.950` sky whisper
  `#151b26`; `text.accent` dark moved `brand.300 → brand.500`;
  `border.strong` dark moved from static `neutral.500` to
  `charcoal.600`. Static-by-decision group is now 4 tokens.
  `ColorSwatches` gained the missing `bg.inverse` catalog entry
  (20/21 → 21/21). DOM-level audit made opacity-aware: dark **0**
  failing elements across all four routes, light 35 (9 on the two
  known pairs, 26 pre-existing `/tools` disabled cards at 3.56 : 1).
- **2026-10-08** (Issue #290) — Dark theme enabled. `panda.config.ts`
  redefines the `dark` condition as `@media (prefers-color-scheme:
  dark)`; all 21 semantic tokens moved to the `{ value: { base, _dark } }`
  shape (the previous bare `{ base, _dark }` was read as token path and
  left every `accent.*` utility emitting invalid CSS, so status
  badges / category borders / CTA hover never rendered their colour).
  12 `_dark` bindings added, 1 repaired (`accent.interactive`
  brand.300→800, white text would otherwise land at 1.5 : 1).
  `color-scheme` and the `body` canvas wired in `src/styles.css`;
  counter digit bitmaps inverted under dark; `/design-system` shows the
  real `base` / `_dark` pair instead of an `bg.inverse` simulation.
- **2026-10-03** (Issue #201) — Replaced the muted blue/grey palette with a high-chroma sky/cyan brand ramp, cooler slate neutrals, and more vivid positive/negative status ramps. CTA/link/focus roles were remapped to accessible darker steps; `/design-system` now derives its swatch references from the semantic-token source instead of maintaining a second raw-token map.
- **2026-09-29** (Issue #172) — Introduced the `accent.*`
  semantic layer (surface / interactive / positive / negative /
  warning / category.{design,code,writing,tool}) with light +
  dark variants. WCAG AA verified.
- **2026-09-29** (Issue #181) — Added the `/design-system`
  showcase page that mirrors every token described here as a
  visible, browsable surface. Read the guide for the contract;
  visit the page to see the rendered pair.