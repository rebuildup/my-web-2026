# Migration docs — my-web-2025 → my-web-2026 (Issue #78)

This directory is the home for the 0.5.0 portfolio-content migration
plan, classification, and tooling. It exists because the 0.5.0 surface
must be data-driven from the start — the home capability card is
already `live` and `/portfolio` already renders the seeded rows.

## Files

| File | Purpose |
| --- | --- |
| [`portfolio-2025-to-2026-classification.md`](./portfolio-2025-to-2026-classification.md) | Human-readable classification report — owner review surface for the KEEP / REWRITE / DROP / NEW buckets. |
| [`portfolio-2025-to-2026-classification.csv`](./portfolio-2025-to-2026-classification.csv) | Machine-readable 151-row table. One row per legacy `content-*.db`, with classification + reason + counts. |
| [`portfolio-2025-to-2026-classification.json`](./portfolio-2025-to-2026-classification.json) | Raw classifier output (including the `new_proposals` list). |

## Decision surface

Two buckets require owner judgement before any DB INSERT:

1. **KEEP+REWRITE (17 rows)** — for each, the owner supplies:
   - current availability (still active? sunset?)
   - updated metrics (sales / DL numbers with `as_of` date + source)
   - one-paragraph narrative rewrite (motivation / implementation / evidence)

2. **NEW proposals (8 rows)** — confirm / amend / reject each id + scope.

`KEEP (43)` and `DROP (91)` are agent-automatic. The migration
script will apply them without further owner intervention but
reports its dry-run classification counts before any INSERT so the
owner can override at that checkpoint.

## Related

- [Issue #78 — feat(portfolio): my-web-2025 の 151 portfolio content を 0.5.0 schema へ移行する](https://github.com/rebuildup/my-web-2026/issues/78)
- [[portfolio-and-tools-audit]] — pre-sprint audit (2026-09-27)
- `docs/personal/domain.md` — narrative source (employment-facing)
- `docs/personal/knowledge-model.md` — date + source for metrics invariant
- `docs/domain/capabilities.md` — "Legacy does not mean planned"
