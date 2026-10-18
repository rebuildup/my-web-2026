# Compatibility / layout verification

> Browser-level compatibility records for this directory. They answer the same
> question at different layers: does an adopted Web API / CSS exist in every engine
> (#415), does the shipped layout survive a narrow viewport, long content and a
> visible scrollbar (#416), and is an adoption Baseline-compatible at all (#414,
> recorded under `standards/`).

| Document | Issue | Committed screenshot |
| --- | --- | --- |
| Web feature adoption gate (Baseline) | #414 | `../standards/browser-baseline.webp` |
| Multi-engine public UI matrix | #415 | `browsers-matrix.webp` |
| Layout stress fixture (320px / long content / visible scrollbar) | #416 | `stress-story.webp` |

## Layout stress fixture (Issue #416)

[`stress-story.md`](stress-story.md) records the fixture, its ten stress
stories, the fail-closed rules, the two controls that prove the detector can
fail, and the environment the numbers were recorded in. Regenerate with
`pnpm run verify:compat-stress-screenshot`; the gate itself is
`pnpm run compat:stress:check`.
