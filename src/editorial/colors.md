# Editorial Color System

> Visual language for `src/editorial/`. Components consume the
> **semantic** layer (`surface.canvas`, `signal.positive`, …). Raw
> palette lives in `tokens.ts` and is reachable only through the
> semantic layer. A browsable mirror of every role described here
> lives at [`/design-system`](../../routes/design-system.tsx)
> (Issue #181).

## Direction B — monochrome surfaces, colour as signal (Issue #764)

The owner selected **direction B** on 2026-11-02, with one correction:
the result must not be a system where only one colour can be used.
The layer therefore answers two different questions instead of
pretending they are one.

- **Where is the content?** `surface.*`, `text.*`, `border.*` — a
  neutral ladder. Depth is the fill of a surface, never a decorative
  rule.
- **What is being signalled?** `signal.*` — the single operation hue,
  three status hues, and three content hues assigned deterministically
  from the content itself. A Tool is not a content class: it has no
  colour face and is painted with the operation ink (`text.default`).

Colour is a marker, not a surface. A screen spends colour on **one
line / one word / one pill**, never a large saturated fill, and its
measured colour area stays **≤ 5 %**. Every signal is accompanied by a
non-colour cue (a word, a `StateMark` silhouette, an icon), so a
monochrome reader still gets the message. See
[`docs/verification/design/764-direction-b.md`](../../../docs/verification/design/764-direction-b.md)
for the measured colour area of the shipped surfaces.

## Layer model

```text
tokens.ts (raw)
  brand.* / neutral.* / charcoal.*
  positive.* / negative.* / warning.*
  rose.* / cyan.* / amber.*

semantic-tokens.ts (semantic) — every token is `{ value: { base, _dark } }`
  surface.{canvas,sunken,raised,control,inverse,feature}
  text.{default,muted,disabled,inverse,accent}
  border.{divider,strong,focus}
  signal.{action,actionActive,positive,negative,warning}
  signal.content.{rose,cyan,amber}

components (consumers)
  bg="surface.raised"   color="signal.positive"   ...
```

The raw ramps are named for **hue**, not for a category: adding a
category never renames a ramp, and re-pointing a category never edits
the palette. The assignment from a seed to a hue lives in
[`content-signal.ts`](content-signal.ts).

## Role map

### Monochrome — `surface.*` / `text.*` / `border.*`

| Role | Light | Dark | Purpose |
| --- | --- | --- | --- |
| `surface.canvas` | `neutral.50` `#f8fafc` | `charcoal.950` `#0a0b0e` | Page ground. Every contrast pair is measured against it. |
| `surface.sunken` | `neutral.100` `#f1f5f9` | `charcoal.1000` `#050609` | Recessed region: table header, inset band. A step INTO the ground. |
| `surface.raised` | `neutral.25` `#fcfcfd` | `charcoal.900` `#111317` | Card / panel above the ground. A step OUT of it. |
| `surface.control` | `neutral.200` `#e2e8f0` | `charcoal.800` `#191b21` | Pressable fill. Gains contrast against the ground in both appearances — a control identified by fill, not by a border. |
| `surface.inverse` | `neutral.900` `#0f172a` | `neutral.900` `#0f172a` | Static inverse plate. Travels with `text.inverse`. |
| `surface.feature` | `brand.50` `#f0f9ff` | `brand.950` `#151b26` | Barely-tinted featured region. Not a signal; never a large saturated fill. |
| `text.default` | `neutral.900` `#0f172a` | `neutral.50` `#f8fafc` | Body copy. |
| `text.muted` | `neutral.600` `#475569` | `charcoal.400` `#8b9099` | Secondary and supplementary text — one tier, because the shipped system does not need two. |
| `text.disabled` | `neutral.500` `#64748b` | `charcoal.600` `#6f747d` | Inactive text. Exempt from SC 1.4.3; chosen to read as inactive. |
| `text.inverse` | `neutral.0` `#ffffff` | `neutral.0` `#ffffff` | Static label on the inverse plate / operation fill. |
| `text.accent` | `brand.700` `#0369a1` | `brand.500` `#0ea5e9` | Inline-link ink. Lightens in dark; the action FILL cannot, because it carries a white label. |
| `border.divider` | `neutral.200` `#e2e8f0` | `charcoal.800` `#191b21` | **Structural** rule only: table row, data boundary, definition list. Never a section decoration. |
| `border.strong` | `neutral.500` `#64748b` | `charcoal.600` `#6f747d` | Emphasis boundary that must reach the 3 : 1 non-text minimum. |
| `border.focus` | `brand.600` `#0284c7` | `brand.300` `#7dd3fc` | Keyboard focus indicator. A focus ring, not a surface divider. |

The eleven roles the direction harness studied collapse to fourteen
tokens here for two honest reasons: `text.muted` covers secondary and
supplementary text (the shipped system has never needed two tiers), and
`border.divider` exists **only** for a structural boundary. Collapsing
a role is recorded, not hidden.

### Signal — `signal.*`

| Role | Light | Dark | Meaning |
| --- | --- | --- | --- |
| `signal.action` | `brand.700` `#0369a1` | `brand.700` `#0369a1` | The single operation hue. A fill beneath `text.inverse`; never body text. |
| `signal.actionActive` | `brand.800` `#075985` | `brand.800` `#075985` | Pressed / hovered operation fill. |
| `signal.positive` | `positive.700` `#047857` | `positive.300` `#6ee7b7` | "ok" / live. Paired with a word and/or `StateMark`. |
| `signal.negative` | `negative.700` `#be123c` | `negative.300` `#fda4af` | "error" / unreachable. Same pairing. |
| `signal.warning` | `warning.700` `#b45309` | `warning.300` `#fcd34d` | "degraded" / attention. Same pairing. |
| `signal.content.rose` | `rose.700` `#be185d` | `rose.300` `#f9a8d4` | Content hue — design, and any seed the assignment rule maps here. |
| `signal.content.cyan` | `cyan.700` `#0e7490` | `cyan.300` `#67e8f9` | Content hue — code. |
| `signal.content.amber` | `amber.700` `#a16207` | `amber.300` `#fde047` | Content hue — writing. |

(A Tool is not a content class — colour system III, Issue #812. Its
`StateMark` is painted with `text.default`, so there is no fourth
content role.)

The three content hues are deliberately separable at a glance: pink ≈
330°, cyan ≈ 190°, amber ≈ 50°. They are identifiers, never a
text-bearing background — a 700/300 solid cannot carry normal-size text
at 4.5 : 1.

### These signals are reinforcement, never the message (Issue #411)

WCAG 2.2 SC 1.4.1 Use of Color (Level A) forbids conveying information
by colour alone, and that is a rule of this layer rather than a
property of individual components: **no consumer may ship a status or a
content identity whose only cue is a hue.** A status / content surface
composes [`StateMark`](primitives/StateMark.tsx) — a silhouette unique
per state — next to a text label, and the `signal.*` token paints the
reinforcement. The mark paints in `currentColor`, so it inherits the
label's contrast instead of adding an obligation of its own
(SC 1.4.11).

The proof (greyscale captures in both appearances, the machine checks
and the human review that are explicitly separated) lives in
[`docs/verification/a11y/status-monochrome.md`](../../../docs/verification/a11y/status-monochrome.md).

**Scope of the rule, and the one surface that does not satisfy it yet.**
The rule binds any consumer that paints a status or content hue as a
state cue. Issue #411 wired two of them: the home status badges and the
portfolio card category rules; Issue #794 then removed the rule from the
portfolio card entirely (the category is shape + word there, with no hue
at all). One consumer is **not** wired: the external-read card badges
(`src/external-api/ExternalReadCard.tsx` — fresh / stale / failed /
blocked / loading) still render `Badge tone={accent | neutral}` with no
`StateMark`. That surface is **not** a violation today — every badge
carries a text label, so 1.4.1 is met by text and no hue is its only
cue — but it does not yet follow the shape vocabulary. Whether it
should is an owner decision (open); the rule is stated here so the gap
is visible rather than implied.

### Content hue assignment is deterministic, not decorative

`src/editorial/content-signal.ts` owns the rule:

- a known category keeps its mapping (`design → rose`, `code → cyan`,
  `writing → amber`); a Tool has no mapping because it is not a
  content class;
- any other seed is hashed with FNV-1a and reduced modulo the declared
  family list, so the same slug always gets the same family;
- the assigned value is always one of the three declared roles, so a new
  category can never invent a colour.

This is the correction the owner asked for: colour is not collapsed to
one fixed hue, and it is not re-assigned by hand per surface.

## Old → new role mapping (migration)

| Pre-#764 | Direction B |
| --- | --- |
| `bg.canvas` | `surface.canvas` |
| `bg.subtle` | `surface.sunken` |
| `bg.surface` | `surface.raised` |
| `bg.inverse` | `surface.inverse` |
| `accent.surface` | `surface.feature` |
| `bg.accent` | `signal.action` |
| `accent.interactive` | `signal.actionActive` |
| `accent.positive` | `signal.positive` |
| `accent.negative` | `signal.negative` |
| `accent.warning` | `signal.warning` |
| `accent.category.{design,code,writing}` | `signal.content.{rose,cyan,amber}` |
| `accent.category.tool` | `text.default` (a Tool has no colour face) |
| `border.subtle` | `border.divider` (structural use only) |
| `border.strong` | `border.strong` |
| `border.focus` | `border.focus` |
| `text.{default,muted,inverse,accent}` | unchanged |
| — | `surface.control` (new role: a pressable fill) |
| — | `text.disabled` (new role: inactive text) |

`border.divider` is **not** a rename of a decorative hairline. The
old `border.subtle` was used as a section separator in places; those
uses were removed (Issue #764), because direction B separates surfaces
by fill and spacing, not by a rule. A divider that remains must mark a
real data boundary.

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
(`color: signal.positive`), which the browser discards as invalid CSS.
That is the shape Issue #172 shipped, and it is why status badges and
the CTA hover fill never rendered their colour.

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
| control fill + divider | `#191a1b` / `#18191a` | `charcoal.800` `#191b21` |
| emphasis line | `#37393a` (below our 3 : 1 rule) | `charcoal.600` `#6f747d` |
| secondary text | `#8a8f98` | `charcoal.400` `#8b9099` |
| page text | `#f7f8f8` | `text.default` dark `#f8fafc` |
| action | `#5e6ad2` / `#7170ff`, chroma 116 | `signal.action` `brand.700` `#0369a1`, unchanged |
| label / status colors | `#f79ce0` `#83dcdc` `#8fa6ff` | `*.300` content and status steps |

Restraint in the reference comes from **how rarely** brand color
appears, not from desaturating it — their own accent is saturated. So
the rework neutralizes the surroundings and leaves the signals
standing, rather than gray-washing the signal itself.

### What changes and what does not

| Group | Tokens | Rule |
| --- | --- | --- |
| Surface ladder | `surface.canvas` / `sunken` / `raised` / `control` | light steps *down* (`50 → 100`) for depth and *up* (`25`) for a card, with `control` at `200`; dark steps through `charcoal` `950 → 1000 → 900 → 800`, one notch per role |
| Text ladder | `text.default` / `muted` / `disabled` / `accent` | near-white instead of white, near-neutral gray instead of slate, and the link **brightens** to `brand.500` on dark where it darkens to `brand.700` on light |
| Borders | `border.divider` / `strong` / `focus` | structural `neutral.200` (1.18 : 1 light), emphasis `neutral.500` (4.54 : 1), focus `brand.600` (3.91 : 1); dark equivalents 1.14 : 1, 4.18 : 1 and 11.80 : 1 |
| Tinted feature surface | `surface.feature` | `brand.50` in light, `brand.950` `#151b26` in dark — a sky whisper 1.02 : 1 above the light canvas and 1.14 : 1 above the dark one |
| Status / content signals | `signal.*` | 700 steps in light, 300 steps in dark; each clears its threshold on the canvas (see the table below) |
| **Static by decision** | `surface.inverse`, `signal.action`, `signal.actionActive`, `text.inverse` | `base` and `_dark` are deliberately identical |

The static group is a decision, not an omission:

- **`signal.action` / `signal.actionActive` + `text.inverse`** — every
  `text.inverse` in the codebase sits on the operation fill. The fill
  has to hold white text at ≥ 4.5 : 1 *and* sit ≥ 3 : 1 from the page,
  which confines it to L ∈ [0.11, 0.18] — essentially one usable step
  of the ramp (`brand.700` = 5.93 : 1 with white, 5.67 : 1 light /
  3.31 : 1 dark from the canvas). Issue #172 bound the hover fill's
  `_dark` to `brand.300`, which would have put white text on light
  cyan at 1.5 : 1.
- **`surface.inverse` + `text.inverse`** — a self-contained
  surface/foreground pair: the plate and the white label that belongs
  on it. Inverting one without the other produces a light plate
  carrying white text.

## When to use which

| Decision | Pick |
| --- | --- |
| Page background | `surface.canvas` |
| Card / panel surface | `surface.raised` |
| Recessed band / table head | `surface.sunken` |
| Pressable control fill | `surface.control` |
| Featured region (barely tinted) | `surface.feature` |
| Body text | `text.default` |
| Secondary / supplementary text | `text.muted` |
| Inactive text | `text.disabled` |
| Inline link | `text.accent` |
| Primary action fill, idle | `signal.action` |
| Primary action fill, hover / pressed | `signal.actionActive` |
| "ok" / live status | `signal.positive` |
| "error" / unreachable status | `signal.negative` |
| "degraded" / warning status | `signal.warning` |
| Content identity (category, slug) | `signal.content.<family>` via `contentSignalToken(seed)` |
| Structural data boundary | `border.divider` |
| Emphasis boundary | `border.strong` |
| Keyboard focus | `border.focus` |

## WCAG AA contrast — verified values

The pair matrix is enforced by `scripts/check-a11y-contrast.mjs`
(`pnpm run a11y:contrast:check`, part of `validate:fast`). It imports
`tokens.ts` and `semantic-tokens.ts`, resolves every reference itself
and measures 26 pairs × 2 appearances against WCAG 2.2 SC 1.4.3
(4.5 : 1 normal text, 3 : 1 large text and non-text indicators). The
numbers below are the gate's output for Issue #764, not a manual
transcription.

### Monochrome roles

| Pair | Light | Dark |
| --- | --- | --- |
| `text.default` on `surface.canvas` | 17.06 : 1 | 18.80 : 1 |
| `text.default` on `surface.raised` | 17.41 : 1 | 17.77 : 1 |
| `text.default` on `surface.sunken` | 16.29 : 1 | 19.36 : 1 |
| `text.default` on `surface.control` | 14.48 : 1 | 16.45 : 1 |
| `text.muted` on `surface.canvas` | 7.24 : 1 | 6.13 : 1 |
| `text.muted` on `surface.raised` | 7.39 : 1 | 5.79 : 1 |
| `text.muted` on `surface.sunken` | 6.91 : 1 | 6.31 : 1 |
| `text.muted` on `surface.control` | 6.14 : 1 | 5.36 : 1 |
| `text.muted` on `surface.feature` | 7.10 : 1 | 5.38 : 1 |
| `text.accent` on `surface.canvas` | 5.67 : 1 | 7.10 : 1 |
| `text.accent` on `surface.feature` (large) | 5.56 : 1 | 6.22 : 1 |
| `text.inverse` on `signal.action` | 5.93 : 1 | 5.93 : 1 |
| `text.inverse` on `signal.actionActive` | 7.56 : 1 | 7.56 : 1 |
| `text.inverse` on `surface.inverse` | 17.85 : 1 | 17.85 : 1 |
| `border.focus` on `surface.canvas` (non-text) | 3.91 : 1 | 11.80 : 1 |
| `border.strong` on `surface.canvas` (non-text) | 4.54 : 1 | 4.18 : 1 |

### Signal roles

| Pair | Light | Dark |
| --- | --- | --- |
| `signal.positive` on `surface.canvas` | 5.24 : 1 | 12.91 : 1 |
| `signal.negative` on `surface.canvas` | 6.00 : 1 | 10.40 : 1 |
| `signal.warning` on `surface.canvas` | 4.79 : 1 | 13.64 : 1 |
| `signal.content.rose` (non-text) | 5.77 : 1 | 10.85 : 1 |
| `signal.content.cyan` (non-text) | 5.12 : 1 | 13.57 : 1 |
| `signal.content.amber` (non-text) | 4.70 : 1 | 14.92 : 1 |
| `signal.action` vs `surface.canvas` (non-text) | 5.67 : 1 | 3.31 : 1 |
| `border.divider` vs `surface.canvas` (excluded) | 1.18 : 1 | 1.14 : 1 |

**Every intended pair passes.** The single tight number is
`signal.action` vs the dark canvas at **3.31 : 1** — above the 3 : 1
non-text minimum, but with little headroom. The action fill cannot be
lightened on dark without dropping white `text.inverse` below 4.5 : 1,
so the pair is a constrained optimum, not an oversight. If the brand
ramp moves, this is the first pair to re-measure.

### Excluded from the matrix, with reasons

| Token | Why it is not a contrast pair |
| --- | --- |
| `border.divider` | A structural separator. It marks a data boundary but identifies no component state, and SC 1.4.3 asks for 3 : 1 only of a boundary that identifies a component. Measured anyway (1.18 / 1.14) and printed with the report. |
| `text.disabled` | SC 1.4.3 exempts inactive controls. Direction B also signals disabled state by word and shape, not by colour alone. Measured: 4.55 : 1 light, 4.19 : 1 dark. |
| `signal.actionActive` vs `surface.canvas` | The pressed state is not the resting boundary of a control. Its label pair (`text.inverse` on `signal.actionActive`, 7.56 : 1) **is** in the matrix. Measured against the dark canvas: 2.60 : 1 — recorded, not demanded. |

### How the contrast was computed

Relative luminance per WCAG 2.1 §1.4.3:

```text
L_channel = c / 12.92                              if c ≤ 0.03928
L_channel = ((c + 0.055) / 1.055) ^ 2.4           otherwise
L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin
Contrast = (L_lighter + 0.05) / (L_darker + 0.05)
```

The gate reads the raw `#RRGGBB` literals from `tokens.ts`, dereferences
each `{ base, _dark }` binding in `semantic-tokens.ts`, and fails on an
unresolvable reference rather than guessing. The full per-row output is
printed on every run; the split between what the machine decides (the
ratio) and what a person decides (whether a colour is semantically
adequate) is in
[`docs/verification/a11y/contrast.md`](../../../docs/verification/a11y/contrast.md).

### Colour area is measured, not asserted

The token gate proves contrast; it cannot prove restraint. The measured
colour area of `/` and `/design-system` at 390 and 1440, light and dark,
is captured as WebP under
`docs/verification/design/764-direction-b/` and summarised in
`docs/verification/design/764-direction-b.md`. The measurement counts
pixels whose `max(r,g,b) − min(r,g,b)` reaches a declared saturation
threshold, excluding `svg` / `img` / `canvas` rectangles. A screen over
5 % fails the direction's own rule even when every pair passes WCAG.

## Don't

- Do **not** use raw palette tokens in components. Always go through the
  semantic layer so a future palette swap does not ripple through
  feature code.
- Do **not** add a `surface.*` fill to make a region look distinct. Use
  spacing, type, and the existing ladder. Decorative borders are
  forbidden; `border.divider` is for structural boundaries only.
- Do **not** introduce a new colour token without registering it in this
  file and in the contrast matrix. The table is the contract; a token
  without a verified pair is a contract violation.
- Do **not** use `signal.content.*` for status feedback or
  `signal.{positive,negative,warning}` for content identity. The two
  families carry distinct semantics and crossing them reads as noise.
- Do **not** convey a state by colour alone. Pair every signal with a
  word and/or a `StateMark` silhouette.
- Do **not** add a third operation hue. `signal.action` is the single
  operation accent; a second saturated action colour breaks the
  1-line / 1-word / 1-pill budget.
- Do **not** read `_dark` values directly. Panda binds the condition;
  consumers ask for the unconditional token name and trust Panda to pick
  the right variant.

## Change history

> Entries before 2026-11-03 use the pre-#764 role names. They are kept
> verbatim because they record what was true at the time; use the
> old → new mapping above to read them against the current layer.

- **2026-11-04** (Issue #812, colour system III) — The content layer
  narrowed to **exactly three families** (`rose` / `cyan` / `amber`).
  `indigo`, `violet` and `teal` were removed from `tokens.ts`,
  `semantic-tokens.ts` and `CONTENT_SIGNAL_FAMILIES`, and a Tool lost
  its colour face: its `StateMark` is painted with `text.default`, so
  there is no fourth content role. The contrast matrix follows the
  layer (23 pairs × 2 appearances, down from 26 by the three removed
  roles — no remaining pair was weakened or dropped).

- **2026-11-03** (Issue #764) — Direction B implemented. The semantic
  layer split into monochrome `surface.*` / `text.*` / `border.*` and
  `signal.*`. Old `bg.*` / `accent.*` / `border.subtle` names were
  replaced across 79 source files. New roles: `surface.control`,
  `surface.feature`, `text.disabled`, `border.divider` (structural
  only), `signal.content.{rose,cyan,amber,indigo,violet,teal}`.
  Content hues are assigned deterministically by
  `src/editorial/content-signal.ts` (FNV-1a over the seed) instead of a
  hand-maintained category map, so colour is not collapsed to one hue.
  `/design-system` now renders the role map, the measured light/dark
  hex pairs and the colour-area rule. The contrast gate was re-pointed
  to the new matrix (26 pairs × 2 appearances) and now excludes
  `border.divider`, `text.disabled` and `signal.actionActive` vs the
  page with stated reasons. Measured colour area and the full
  verification record live in
  `docs/verification/design/764-direction-b.md`.

- **2026-10-23** (Issue #399) — The token layer became a **measured**
  contract. `scripts/check-a11y-contrast.mjs` imports `tokens.ts` and
  `semantic-tokens.ts`, resolves the `{colors.…}` references itself and
  measures the declared pair matrix in both appearances against WCAG 2.2
  SC 1.4.3 (4.5 : 1 normal text, 3 : 1 large text and non-text). An
  unresolvable reference is a violation, never a guess. The gate runs in
  `validate:fast`; the browser artefact is
  `docs/verification/a11y/contrast.webp`. One repair shipped with it:
  the light `text.muted` step moved `neutral.500` → the new raw step
  `neutral.600` (`#475569`), which closes the two known light gaps
  (`text.muted` on the subtle inset 4.34 : 1 → 6.91 : 1, on the tinted
  feature region 4.46 : 1 → 7.10 : 1). Hue and saturation are
  unchanged; only the lightness moves. The dark step
  (`charcoal.400`) is untouched.
- **2026-10-19** (Issue #411) — Added the rule that status and content
  hues may never be the ONLY cue: surfaces now compose `StateMark` (a
  silhouette unique per state) beside the text label, and the hue is
  reinforcement. `StateMark` paints in `currentColor`, so it inherits
  the label's contrast instead of adding a non-text contrast obligation
  of its own. Home status badges and portfolio category rules are the
  two surfaces this ticket wired. The `src/external-api` badge states
  are a named exception, documented in the rule section above: they
  carry a text label but do not compose `StateMark` yet, and that
  assignment is an open owner decision.
- **2026-10-09** (Issue #290, rework round) — Dark palette re-anchored
  on the new near-neutral `charcoal` ladder (`950/900/800/600/400`)
  after the owner's 「ダークテーマがダサい」 review; slate's blue
  dark tail (`neutral.950` `#020617` etc.) was removed from the dark
  bindings and from the raw palette. The feature surface dark was toned
  from a saturated `#082f49` block to the `brand.950` sky whisper
  `#151b26`; link ink dark moved `brand.300 → brand.500`; the emphasis
  border dark moved from static `neutral.500` to `charcoal.600`.
  Static-by-decision group is now 4 tokens. `ColorSwatches` gained the
  missing inverse-panel catalog entry (20/21 → 21/21). DOM-level audit
  made opacity-aware: dark **0** failing elements across all four
  routes, light 35 (9 on the two known pairs, 26 pre-existing `/tools`
  disabled cards at 3.56 : 1).
- **2026-10-08** (Issue #290) — Dark theme enabled. `panda.config.ts`
  redefines the `dark` condition as `@media (prefers-color-scheme:
  dark)`; all 21 semantic tokens moved to the `{ value: { base, _dark } }`
  shape (the previous bare `{ base, _dark }` was read as token path and
  left every accent utility emitting invalid CSS, so status badges /
  category borders / CTA hover never rendered their colour).
  12 `_dark` bindings added, 1 repaired (the hover fill
  brand.300→800, white text would otherwise land at 1.5 : 1).
  `color-scheme` and the `body` canvas wired in `src/styles.css`;
  counter digit bitmaps inverted under dark; `/design-system` shows the
  real `base` / `_dark` pair instead of an inverse-panel simulation.
- **2026-10-03** (Issue #201) — Replaced the muted blue/grey palette with a high-chroma sky/cyan brand ramp, cooler slate neutrals, and more vivid positive/negative status ramps. CTA/link/focus roles were remapped to accessible darker steps; `/design-system` now derives its swatch references from the semantic-token source instead of maintaining a second raw-token map.
- **2026-09-29** (Issue #172) — Introduced the `accent.*`
  semantic layer (surface / interactive / positive / negative /
  warning / category.{design,code,writing,tool}) with light +
  dark variants. WCAG AA verified.
- **2026-09-29** (Issue #181) — Added the `/design-system`
  showcase page that mirrors every token described here as a
  visible, browsable surface. Read the guide for the contract;
  visit the page to see the rendered pair.
