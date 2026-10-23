# Verification — accessibility

| Artefact | Issue | What it proves |
| --- | --- | --- |
| `axe-route-report.webp` | #393 | the public-route axe-core audit of the rendered DOM — one row per audited route (verdict, known / new violation counts, rule id with its WCAG tags, element count) with one real violating element captured on the page, so a tolerated violation is visible and not only tabulated. `axe-route-report.md` is the write-up |
| `mixed-language-content.webp` | #409 | the shipped language-of-parts gallery in four states (mixed-language body / document-language-only body / refused parts / the same body at 320 px), with the WCAG 2.2 mapping table that separates the machine-checked rows from the human ones. `mixed-language-content.md` is the write-up |
| `table-code-mobile.webp` | #407 | the shipped `DataTable` / `CodeBlock` fixture in its four states at 375 px, with caption / per-cell `scope` / confined scroll / keyboard scrolling measured in Chromium. `table-code.md` is the write-up |
| `contrast.webp` | #399 | the shipped token pair matrix in both appearances (light / dark), every swatch rendered in its own foreground / background with the measured ratio printed beside it. `contrast.md` is the write-up |
| `form-error-story.webp` | #404 | the shipped form gallery in five states, with the failure panel's Chromium accessibility snapshot. `form-error-story.md` is the write-up |
| `icon-button-names.webp` | #396 | the repository's own icon-button fixtures side by side — one named, one not — with the accessible name Chromium resolves for each and the accessibility tree it reports. `icon-button-names.md` is the write-up |
| `category-appearance.webp`, `category-monochrome*.webp`, `status-*.webp` | earlier issues | monochrome / appearance proofs kept alongside the a11y artefacts |
| `reduced-motion-on-off.webp` | #403 | the shipped counter fixture rendered twice in one Chromium — `no-preference` and `reduce` — with the browser-reported `animation-name`, the accessible label, the machine gate's verdict and the WCAG mapping printed above the two panels |
| `image-alt.webp` | #397 | the image alt / decorative-image contract on one screen: the two states a shipped surface may be in (a meaningful image with an alt, a decorative image with an empty alt plus a decorative mark) and the three states the gate rejects (no alt, an empty alt with no decorative mark, a blank alt), with every image's `alt` attribute and decorative mark read from the live DOM. `image-alt.md` is the write-up |
| `focus-visible.webp` | #395 | the focus contract on one screen: the SAME page in two states — without the focus compensation (the focused element is entirely behind the fixed overlay) and with the compensation `src/styles.css` ships (the element is clear of it). The focus ring is the one `src/editorial/nav/PublicNav.tsx` declares, it is painted by the `:focus-visible` state (the pointer control paints no ring), and the covering element is read from `document.elementFromPoint()`. `focus-visible.md` is the write-up |
| `heading-landmarks.webp` | #398 | the heading outline / landmark contract on one screen: a conforming page (one `main`, one `h1`, contiguous levels) next to a violating one (two `h1`, a skipped level, no `main`), with the per-page verdict of the source gate and the declared rule exemptions printed beside it. `heading-landmarks.md` is the write-up |
| `keyboard-navigation.webp` | #394 | the keyboard-only navigation contract on one screen: the home page with the focus ring on the skip link (the first Tab stop), the recorded Tab order, and the measured focus hand-backs (the mobile menu on `Escape`, the picker dialog's focus trap and its `Escape` hand-back) printed beside it. `keyboard-navigation.md` is the write-up |
| `live-region-state.webp` | #405 | the shipped live-region contract driven through idle / pending / success / settled / failure / empty / 320 px in one Chromium: the status region's `role`, `aria-live`, `aria-atomic` and `aria-busy` read at every step, with the mutation count proving one announcement per result and no re-announce. `live-region.md` is the write-up |
| `wcag-review-matrix.webp` | #410 | the manual-review record for the WCAG 2.2 A/AA criteria a machine cannot decide, with the shipped form-state gallery on one screen, the failure panel's Chromium accessibility snapshot, and the gate's own report (machine-checked rows / outstanding rows / excluded criteria / scope decisions) printed above them. `wcag-review-matrix.md` is the write-up |

## WCAG AA manual review matrix (Issue #410)

`wcag-review-matrix.webp` is the committed screenshot of
`docs/verification/a11y/wcag-review-matrix.png` with the `.webp`
extension (Issue #410 names a `.png` path; see "WebP, not PNG" below).

The artefact of this issue is a **record**, not a verdict:

| Layer | What it is | Where it lives |
| --- | --- | --- |
| the table | the machine-readable matrix: every WCAG 2.2 A/AA criterion is covered by an item or excluded with a reason, and every item says whether a machine or a person decides it | `quality/wcag-review-matrix.json` |
| the criterion universe | the WCAG 2.2 Level A/AA criteria (55 of them, transcribed from the specification on 2026-10-23) with their level and name; the table's vocabulary and the scope decisions both read it, so the two can never disagree | `scripts/check-a11y-wcag-review-matrix.mjs` (`WCAG_22_A_AA_UNIVERSE`) |
| the scope decisions | the 25 A/AA criteria the table does not carry, each with a reason; the gate holds the list and the write-up mirrors it, so a drift is red | `scripts/check-a11y-wcag-review-matrix.mjs` (`SCOPE_DECISIONS`) and `docs/verification/a11y/wcag-review-matrix.md` |
| the gate | a pure Node / offline check that the record is intact | `scripts/check-a11y-wcag-review-matrix.mjs` (`pnpm run a11y:wcag-review-matrix:check`) |
| the capture | the shipped state gallery rendered in Chromium, plus that gate's report | `pnpm run capture:a11y-wcag-review-matrix` |

The review states are physically distinct, and the gate refuses to let
them blur into each other: `auto-pass` (a machine gate decided it — no
reviewer, date, environment or result may be attached), `human-verified`,
`human-failed` and `not-reviewed` (an assignee, no evidence). A
document may not turn a machine pass into a site-level conformance
claim; the gate scans the documents for completion wording — in Japanese
and in English, by pattern rather than by a fixed phrase list — and
reports `compliance-claim-unbacked` unless **every** manual item is
`human-verified` and the line names the record exactly
(`quality/wcag-review-matrix.json` or
`docs/verification/a11y/wcag-review-matrix.md`, which has to exist).

The gate also checks the criterion universe: the table's vocabulary and
the scope decisions must together decide all 55 A/AA criteria, so no
criterion can be dropped silently
(`criterion-universe-mismatch`). `4.1.1 Parsing` is recorded as
obsolete in WCAG 2.2 instead of being listed.

A green gate means the **table** is intact. It does not mean the site
conforms to WCAG 2.2 AA. The write-up
(`wcag-review-matrix.md`) carries the criterion-by-criterion split, the
list of A/AA criteria the table does not carry, the required fields, the
rules, and the procedure for releasing a false positive.

## Reduced motion (Issue #403)

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

### Every state is compared, not the first strip on the page

Each row of the fixture is identified by the `data-case` it renders
(`01-normal`, `02-empty`, `03-failure`, `04-compact`) and the capture
reads all four in BOTH contexts. For each state it compares, per mode:

| Field | Compared as |
| --- | --- |
| `animationName` of the first slot, and how many slots still animate | the animation must exist in the no-preference context and must be `none` / `0` of `0` in the reduce context |
| `data-motion-state` | must agree with the context the browser was launched with |
| `aria-label` | the value has to be byte-identical across the two modes |
| slot count | 7 slots in both modes, per state |
| rendered text | the labels around the value have to be identical across the two modes |
| strip presence | the failure state has no strip in either mode |

The expected set of four state ids is asserted in both contexts, so a
fixture that stopped rendering one of them fails the capture instead of
quietly reducing the coverage it claims. Reading only the first strip
(which is what `querySelector` returns) would have let a defect that
only affects the zero-count or the compact state pass.

If the fixture never reaches the mode the context was launched with,
the capture gives up after `MODE_WAIT_ATTEMPTS` bounded waits and fails
with the mode it actually saw. It does not retry indefinitely: a
capture that hangs reports nothing, and CI has to be able to fail.

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
| 2.2.2 Pause, Stop, Hide | A | nothing that moves starts by itself and runs longer than five seconds | **machine**: `check-reduced-motion.mjs` `no-autoplay-motion-media` refuses an autoplaying `<video>` / `<audio>`; the capture reads `animation-name: none` in the reduced context for every state |
| 4.1.2 Name, Role, Value | A | the counter value is carried by an accessible name, not by the animation | **machine**: `src/home/access/tiles.test.tsx` asserts the label is identical in both modes; the capture reads it from both contexts, per state |
| 1.4.13 Content on Hover or Focus | AA | the state a visitor triggers is conveyed by something other than movement | **machine** for the pairing (each motion surface, per component, must have a render-time opt-out and a stylesheet opt-out); **human** for focus order, visible ring and contrast — not checked here |
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
and is wired into `validate:fast` (and registered in
`quality/profile.yaml#gates.fast.components`).

Which layer the evidence belongs to: the browser capture measures the
**rendered result** under `reduce` ("no digit slot moves"), and layer 2
would produce that value even if layer 1 were missing — so the
capture is evidence for the rendered contract, while layer 1 itself is
proven by recomputing the `css()` classes in
`src/home/access/tiles.test.tsx` ("emits the animation utility class
only when motion is allowed").

### What "per motion surface" means in the gate

The pairing is decided per **component**, not per file. A file is a
container, not a protection boundary: if the check were file-level, a
component that already declares `data-motion` and reads the preference
would launder any animation added next to it, and adding an
unguarded animation to an already-protected file would pass. So the
gate splits each source file into regions (one per top-level
declaration) and, for every region that emits an animation declaration
— longhand or the `animation:` shorthand Panda also accepts — requires:

1. a `data-motion` attribute in that region, whose value resolves
   through the contract (`src/editorial/reduced-motion.ts` publishes
   each hook as a `*_MOTION` constant; a literal or a computed value the
   contract cannot resolve is `motion-without-contract-hook`);
2. a **call** to the preference contract in that region — or the
   decision received under the contract's published prop name
   (`REDUCED_MOTION_PROP`) **and branched on** there. Naming the prop
   is not enough either: a component that destructures `reducedMotion`
   and animates regardless of it is exactly the surface the rule
   refuses. Importing the module is not a read: a component can import
   its hook constant and still animate in both modes;
3. a selector inside a reduced-motion block in `src/styles.css` that
   names that hook.

## Forced stories and the stylesheet layer

`home/ReducedMotion` has three stories. `Fixture` is the one the
capture renders, in two browser contexts with the OS preference
emulated — that is the only way to observe the real media query.
`MotionOn` / `MotionOff` pin the answer so a human can look at both
modes on one machine, where the OS setting cannot be changed per
window.

Forcing the React branch alone is not enough for `MotionOn`: on a
machine whose OS asks for reduced motion, `src/styles.css` reduces
every animation duration to `0.01ms !important` and neutralises the
hook's selector with `animation: none !important`, and both beat the
inline style the component emits. The fixture therefore re-arms the
stylesheet layer with a scoped, higher-specificity rule
(`MOTION_EMULATION_CSS`, including the per-digit stagger) and the
banner says which layer is being shown, so a forced fixture that does
not move cannot claim a comparison it never performed.

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