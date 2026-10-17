# First-visit webfont measurement (Issue #485)

Reproduction record for the first-visit webfont / FOUT / CLS
measurement of the shipped Home and About surfaces.

This directory is evidence for one ticket, not a gate. Nothing in
`quality/profile.yaml` was changed by it, and the measurement command
is deliberately **not** wired into `validate:fast` / `validate:integration`
/ `validate:release` — see "Impact on `quality/profile.yaml`" below.

## Contents

| File | What it is |
| --- | --- |
| `font-firstpaint-snapshot.webp` | The committed measurement report: environment block, per-run metrics, layout-shift attribution, before/after tables, and the per-scenario page captures. The Issue names `font-firstpaint-snapshot.png`; the committed file is the WebP conversion of that capture (1280x2173, ~114 KB) so the binary stays small. The intermediate PNG is never committed. |

## What is measured

`scripts/font-first-paint-measure.mjs` (`pnpm run perf:fonts:measure`) drives
the installed Playwright Chromium against a **local** origin and records,
per route and scenario:

- `first-contentful-paint`, `largest-contentful-paint` (+ the LCP element),
- session-windowed cumulative layout shift (`layout-shift`, input-excluded,
  5 s session / 1 s gap — the definition CLS is specified with),
- the **swap instant**: the first moment a webfont `FontFace` reports
  `loaded` (`document.fonts.ready` is deliberately not used — it resolves
  before the stylesheet is parsed, so it reports a swap that never
  happened),
- `fonts.googleapis.com` / `fonts.gstatic.com` resource timing
  (request count, transfer size, slowest response),
- layout-shift **sources** — the element and rect pairs that moved,
- a fallback-readability verdict over real text probes in the blocked
  scenario, which fails both when the page has nothing legible left and
  when the block silently did not apply.

### Scenarios

| Scenario | Condition | Question it answers |
| --- | --- | --- |
| `baseline` | no throttling, font origin reachable (the report records when it is not) | what does a first visit cost when the font arrives |
| `blocked` | `fonts.googleapis.com` + `fonts.gstatic.com` aborted | is there still readable text when the font origin is unreachable — the condition Issue #291's async-CSS pattern must survive |
| `slow-font` | CPU throttled x4, every font-origin response delayed 1500 ms | how long the FOUT window lasts and what it moves |

The script exits `0` on a completed measurement and non-zero only when
the measurement is impossible (no browser, unreachable base URL, a route
that does not answer 2xx). **It never fails on a metric**: thresholds are
Issue #386's obligation, the Lighthouse report harness is Issue #384's,
and the release gate is Issue #385's. Fusing them here is the confusion
Issue #485 asks to avoid.

## How to reproduce

```sh
pnpm run build                                  # production-equivalent local build
node scripts/e2e-local-bootstrap.mjs --port=15907 &   # local D1 + vite preview
pnpm run perf:fonts:measure -- \
  --base-url http://127.0.0.1:15907 \
  --out .tmp/font-first-paint/after
```

Artifacts land in `.tmp/font-first-paint/<out>/` (`report.json`,
`report.html`, one PNG per run). `.tmp/` is gitignored — only the
committed snapshot above is repository state.

To produce a before/after table, keep the first run and pass it back:

```sh
pnpm run perf:fonts:measure -- --base-url http://127.0.0.1:15907 \
  --out .tmp/font-first-paint/after \
  --compare .tmp/font-first-paint/before/report.json
```

## Recorded conditions

Every number in the committed snapshot carries these, because a number
without them is not evidence:

| Condition | Value |
| --- | --- |
| Browser | Chromium 153.0.8010.12 (Playwright 1.63.x), headless |
| Viewport | 1280x800 @1x |
| Network | default Chromium (no throttling); font origin reachable (`HTTP 200`) |
| CPU | throttle x4 in `slow-font`; host Apple M5 x10, darwin arm64 |
| Font delay | 1500 ms per font-origin response in `slow-font` |
| Host | macOS (darwin 27.0.0, arm64), 24 GB |
| Source | branch `485`, tree dirty at capture time (the report records the SHA it measured) |

Desktop viewport only. A mobile matrix is not measured here — it belongs
with the Core Web Vitals budgets in Issue #386, which owns device and
budget definitions.

## Results

Pre-fix and post-fix, same script version, same host, same routes,
captured from the local preview build:

| Route | Scenario | CLS before | CLS after | FCP before / after (ms) | swap before / after (ms) |
| --- | --- | --- | --- | --- | --- |
| `/` | baseline | 0.146 | **0.001** | 268 / 164 | 739 / 797 |
| `/` | blocked | 0 | 0 | 148 / 148 | n/a (no webfont) |
| `/` | slow-font | 0 | **0** | 396 / 400 | 3935 / 3825 |
| `/about` | baseline | 0.975 | **0.001** | 172 / 172 | 596 / 603 |
| `/about` | blocked | 0 | 0 | 180 / 172 | n/a (no webfont) |
| `/about` | slow-font | 0.487 | **0.001** | 544 / 512 | 3910 / 3844 |

Read the CLS column and ignore the paint/swap columns: those are
single-run timings against a third-party origin and move by ±100 ms
between runs of the same build. CLS is deterministic — a row either wraps
or it does not.

The `/` baseline figure is knife-edge on the pre-fix build and was
observed at 0, 0.146 and 0.331 across runs of the same artefact; the
post-fix build measured 0.001 on every run.

**Pass criteria used for this ticket** (informational, not a gate):

| Criterion | Before | After |
| --- | --- | --- |
| `/about` and `/` read with the font origin blocked | readable (8/8 probes) | readable (8/8 probes) |
| CLS <= 0.1 in every scenario on both routes | 2 of 6 runs failed (`/about` 0.975 / 0.487) | 6 of 6 pass |

0.1 is the Web Vitals "good" boundary for CLS and is used here only to
state whether the fix worked; nothing enforces it.

## What the shift actually was

The layout-shift sources (in the snapshot) attribute it, which a bare
CLS number never could:

```
/about  baseline   shift 0.487 at 380ms
    ul   "ホームHome…"  872x29 -> 864x70      <- desktop nav wrapped to a second row
    nav  "About"                            <- everything below moved ~41px
  baseline   shift 0.487 at 788ms
    ul   "ホームHome…"  864x70 -> 872x29      <- and unwrapped again
```

The desktop nav row sits within ~1% of its wrap threshold — the
component already records this ("at `lg`+ gap 3 brings the full roster
onto one measured line (871.5px <= 880.4px)"). A `space-between` header
puts the brand mark in the same flex line, and the brand is set in the
`heading` family, so when the webfont swap changes the brand's width the
row's remaining budget crosses the threshold and wraps — then unwraps
when the webfont settles. `/` behaved the same way through the hero CTA
row.

## The one fix

One element: a **metric-compatible fallback face** for each webfont
family, defined at the top of `src/styles.css` and placed ahead of the
raw platform names in the `sans` / `heading` tokens
(`src/editorial/tokens.ts`). The faces are the same local font the chain
already named, scaled with `size-adjust` plus `ascent-override` /
`descent-override` so the pre-swap fallback occupies the space the
webfont will occupy, and the row stops crossing the threshold.

The values were measured, not guessed — canvas `measureText` at 100 px
over the real nav/label strings, on the reference host above:

| Webfont | Weight | size-adjust | ascent | descent |
| --- | --- | --- | --- | --- |
| Noto Sans JP | 400 | 94.24% | 123% | 30% |
| Noto Sans JP | 700 | 92.43% | 125% | 31% |
| Zen Kaku Gothic New | 400 | 90.45% | 128% | 32% |
| Zen Kaku Gothic New | 700 | 86.17% | 134% | 33% |

Two things this deliberately does **not** touch:

- the async-CSS pattern from Issue #291 (`media="print"` + the inline
  flip script) and `display=swap` — the swap window still exists, it just
  no longer moves boxes;
- any threshold, gate or CI step.

`src: local('Hiragino Kaku Gothic ProN W3')` names the **full** face
name: Chromium resolves `local()` against the full name only, and the
family name leaves the rule `unloaded` — a silent no-op rather than a
failure. Verified on the reference host. Where the local face does not
exist, the rule fails to load and the token chain falls through to
`system-ui` exactly as before, so the override cannot make a platform it
was not measured on worse.

## Impact on `quality/profile.yaml`

Recorded, and **deliberately zero**:

| Profile surface | Effect |
| --- | --- |
| `gates.fast` / `gates.integration` / `gates.release` | unchanged — no measurement step was added to any `validate:*` entry point |
| `ci.jobs` / `ci.required_checks` | unchanged — no workflow change, no new required check |
| `change_risk_mapping` | unchanged — this ticket touches `src/styles.css`, `src/editorial/tokens.ts` and a script: `src_unit` / `config_only`, both already mapped to `fast` |
| `coverage_policy` | unchanged — no coverage data collected |

`perf:fonts:measure` is a manual, artefact-producing command in the same
family as `layout-audit-shoot`. Adding it to a gate would turn a
measurement into a threshold decision before Issue #386 has defined
budgets and device matrices, and would make a flaky third-party origin a
red CI run. That ordering is the point of the split.

## Known limits

- Desktop viewport only; no mobile matrix (Issue #386).
- One run per scenario. The CLS rows are deterministic; the timing rows
  are not, and this ticket deliberately does not average them.
- The metric values are macOS-specific by construction. Other platforms
  keep today's behaviour via the chain fallback; a platform-specific
  override would need its own measurement.
- `fonts.gstatic.com` sends no `Timing-Allow-Origin`, so the font
  transfer total can read 0 while requests are counted — the report
  carries the request count and durations instead of pretending to know
  the byte total.