# Compatibility / layout verification

> Baseline feature adoption and layout stress records for this directory.
> Both answer "will this break for a real visitor", at different layers:
> the first asks whether an adopted Web API / CSS exists, the second asks
> whether the layout survives a narrow viewport, long content and a visible
> scrollbar.

| Document | Issue | Committed screenshot |
| --- | --- | --- |
| Web feature adoption gate (Baseline) | #414 | `../../standards/browser-baseline.webp` |
| Layout stress fixture (320px / long content / visible scrollbar) | #416 | `stress-story.webp` |

## Layout stress fixture (Issue #416)

[`stress-story.md`](stress-story.md) records the fixture, its ten stress
stories, the fail-closed rules, the two controls that prove the detector can
fail, and the environment the numbers were recorded in. Regenerate with
`pnpm run verify:compat-stress-screenshot`; the gate itself is
`pnpm run compat:stress:check`.
