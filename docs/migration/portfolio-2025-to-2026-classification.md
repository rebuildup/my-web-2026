# Portfolio 2025 → 2026 classification (Issue #78, cycle 3)

Two-axis classification. `migration_class` is technical eligibility
(mechanical, agent-deterministic); `publication` is owner selection
authority (only owner-approves rows become `public` on the loader).

| bucket | count |
| --- | --- |
| eligible / pending_owner  | 48 |
| eligible / approved (owner-signed-off) | 0 |
| rewrite_required / pending_owner | 12 |
| mechanical_drop (never inserted) | 91 |
| new_candidate (never auto-inserted) | 8 |
| **total** | **159** |
| **insertable** (eligible + rewrite_required) | **60** |

## Publication blockers (eligible + rewrite_required only)

| blocker | meaning | count |
| --- | --- | --- |
| role_missing | `role` not in `role_overrides`; owner must add | 56 |
| media_missing | no `content_assets` rows; needs R2 upload before publication | 60 |
| narrative_missing | legacy markdown is empty | 0 |
| no_mappable_section | legacy markdown has no heading matching motivation/architecture/etc. | 60 |

## Why no semantic fabrication

- `role` is set ONLY when `docs/personal/domain.md` (or comparable
  repository-grounded source) explicitly names the legacy `id` and
  the contribution context. Heuristic inference from facet or title
  is forbidden (AGENTS.md §3 + Issue #78 blocker #2).
- `motivation_md` / `architecture_md` / etc. are populated only
  when a legacy markdown heading explicitly matches one of the
  `HEADING_TO_SECTION` keywords. The schema sections are not a
  catch-all (Issue #78 blocker #3).
- `media` requires an actual `portfolio_media` row; YouTube URLs
  are `portfolio_link` with `kind = 'video'`. `media_count >= 1`
  for `public+published` rows is a hard verifier check
  (Issue #78 blocker #5).
- `60` insertable rows are
  `pending_owner` by default; the migration writes them with
  `visibility = 'draft'` so the public loader never sees them
  until the owner signs off (Issue #78 blocker #1 + #4). The
  `0` owner-signed-off rows become
  `visibility = 'public'`, but still must satisfy `media_count >= 1`
  per the verifier.

## Files

- [`portfolio-2025-to-2026-classification.json`](./portfolio-2025-to-2026-classification.json) — machine-readable
- [`portfolio-2025-to-2026-classification.csv`](./portfolio-2025-to-2026-classification.csv) — 159-row table
- [`portfolio-2025-role-overrides.json`](./portfolio-2025-role-overrides.json) — role / publication owner-overrides
- [`portfolio-2025-owner-review.md`](./portfolio-2025-owner-review.md) — owner decision surface
