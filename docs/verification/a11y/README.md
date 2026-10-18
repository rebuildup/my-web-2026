# Verification — reduced motion (Issue #403)

| Artefact | Issue | What it proves |
| --- | --- | --- |
| `reduced-motion-on-off.webp` | #403 | the shipped counter fixture rendered twice in one Chromium — `no-preference` and `reduce` — with the browser-reported `animation-name`, the accessible label, the machine gate's verdict and the WCAG mapping printed above the two panels |

`reduced-motion-on-off.webp` is the committed screenshot of
`docs/verification/a11y/reduced-motion-on-off.png` with the `.webp`
extension (Issue #403 names a `.png` path; see "WebP, not PNG" below).

## What the image shows

Two panels of the SAME fixture
(`src/home/access/reduced-motion.stories.tsx` → the `Fixture` story),
captured from the same Chromium with only the emulated OS preference
different:

| | left panel | right panel |
| --- | --- | --- |
| context | `reducedMotion: 'no-preference'` | `reducedMotion: 'reduce'` |
| `getComputedStyle(img).animationName` | `counterDigitRoll` | `none` |
| `data-motion-state` on the digit strip | `animated` | `reduced` |
| `aria-label` on the digit strip | `1,234 page views` | `1,234 page views` |
| digit slots | 7 | 7 |

The completion condition of the Issue is the last two rows: turning
motion off removes movement and **nothing else**. The capture script
fails (exit 1, no artefact written) if any of those pairs disagree, so
the image cannot be "regenerated until it looks right".

The states reproduced in each panel:

| Row | State | What it shows under reduced motion |
| --- | --- | --- |
| 01 | normal — 1,234 views, delta, period, last hit | the digit roll-up is gone, the value and every label remain |
| 02 | empty — count 0, no first hit, no last hit | seven zero slots, `aria-label="0 page views"`, and the absent labels are still absent rather than animated into existence |
| 03 | failure — consumer API key not configured | the `—` placeholder and the reason it is unavailable; this state is text, so there is nothing to animate in the first place |
| 04 | compact — the same tile in a 320 px column | the narrow layout keeps the full value; motion is not what makes it fit |

## Machine-checked vs. human evaluation

The distinction is the point of this document: a green gate is not a
conformance claim, and a screenshot is not an accessibility audit.

| SC (WCAG 2.2) | Level | Claim | How it is checked |
| --- | --- | --- | --- |
| 2.2.2 Pause, Stop, Hide | A | nothing that moves starts by itself and runs longer than five seconds | **machine**: `check-reduced-motion.mjs` `no-autoplay-motion-media` refuses an autoplaying `<video>` / `<audio>`; the capture reads `animation-name: none` in the reduced context |
| 4.1.2 Name, Role, Value | A | the counter value is carried by an accessible name, not by the animation | **machine**: `src/home/access/tiles.test.tsx` asserts the label is identical in both modes; the capture reads it from both contexts |
| 1.4.13 Content on Hover or Focus | AA | the state a visitor triggers is conveyed by something other than movement | **machine** for the pairing (a motion surface must have a render-time opt-out and a stylesheet opt-out); **human** for focus order, visible ring and contrast — not checked here |
| 2.3.3 Animation from Interactions | AAA | interaction-triggered motion can be turned off | **machine**: the preference contract + the universal floor. Recorded as AAA so the A/AA claim above is not inflated by citing the most-quoted criterion |

Still human, and NOT claimed by this artefact:

- a screen-reader pass (VoiceOver / NVDA) reading the digit strip and
  the reactions chips end to end;
- reading comfort with the roll-up disabled (contrast of the digit
  WebPs against the canvas in both colour schemes — Issue #290 owns the
  glyph bake, not this issue);
- focus order and focus visibility across the home page with motion
  reduced.

## How to reproduce it

```sh
# 1. the machine gate (also part of pnpm run validate:fast)
pnpm run a11y:reduced-motion:check

# 2. build the harness, render both contexts, assert, write the WebP
pnpm run capture:a11y-reduced-motion
```

The capture writes `.tmp/a11y-reduced-motion/report.json` (observations,
gate verdict, WCAG mapping, viewport, encode settings). The harness is
generated into `.tmp/a11y-reduced-motion/harness`, built with Vite using
the repository's own `postcss.config.mjs`, and served over a loopback
port for the duration of the run.

### WebP, not PNG

Chromium only writes PNG and Issue #403 names a `.png` path, but a
verification artefact does not justify a permanently large binary in the
tree. The capture is taken into `.tmp/`, encoded with the existing
`sharp` devDependency at width <= 1600 / quality 80 with a 300 kB
budget, and the committed file is the `.webp` sibling. The script
**refuses** any non-`.webp` output path and deletes the intermediate
PNGs. Chromium screenshots are not byte-reproducible across processes,
so the report records conditions instead of claiming a deterministic
artefact.

## The two layers, and why both exist

1. **Render-time opt-out** — `usePrefersReducedMotion()`
   (`src/editorial/reduced-motion.ts`) makes `CounterTile` emit no
   `animation-name` at all. The reduced document is the resting
   markup, which is the only version a unit test can assert.
2. **Stylesheet floor** — `@media (prefers-reduced-motion: reduce)` in
   `src/styles.css` reduces animation / transition duration for every
   element and forces `scroll-behavior: auto`, so motion nobody has
   classified is still reduced. `0.01ms` rather than `none`, because a
   `none` animation never fires `animationend` and a future JS state
   machine waiting on that event would hang for exactly the visitors who
   asked for less motion.

`scripts/check-reduced-motion.mjs` requires both, per motion surface,
and is wired into `validate:fast`.

## Two implementation traps this capture caught

Recorded because both fail *silently* — the page renders, the class is
present, and nothing animates.

1. **Panda extracts utility classes from the literal object inside the
   `css()` call.** Moving the animation declarations into an exported
   helper (`counterRollStyle(index, reduced)`) left the component
   emitting class names that no stylesheet rule matched:
   `getComputedStyle(img).animationName` was `none` in BOTH contexts.
   The declarations therefore stay literal inside `css({ … })`, and the
   unit test recomputes the expected classes with `css()` instead of
   importing a helper.
2. **A template-literal `animationDelay` is evaluated statically.** The
   per-digit stagger class (`… + 80ms`, `… + 480ms`) is generated at
   runtime but only the `index = 0` rule exists in the stylesheet, so
   every digit animates with `animation-delay: 0s`. This is pre-existing
   behaviour, unchanged by this issue: it is a motion-design question
   (whether the stagger should ship at all, and how to express it — a
   per-index custom property rather than a per-index class), so it is
   left as an open decision rather than silently "fixed" inside an
   accessibility change.

## Out of scope for this issue

- The reactions widget and the portfolio surfaces ship **no** animation
  today; they are states the fixture's rows 01–04 contrast against, not
  motion surfaces of their own.
- The repository has **no video asset at all** (no `<video>`, no
  autoplaying iframe), which is why the video half of the Issue reduces
  to the `no-autoplay-motion-media` rule keeping that true.
- Fixing the per-digit stagger (above).