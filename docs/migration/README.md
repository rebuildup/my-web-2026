# Migration docs — my-web-2025 → my-web-2026 (Issue #78)

This directory is the home for the 0.5.0 portfolio-content migration
plan, classification, and tooling. It exists because the 0.5.0 surface
must be data-driven from the start — the home capability card is
already `live` and `/portfolio` already renders the seeded rows.

## Files

| File | Purpose |
| --- | --- |
| [`portfolio-2025-to-2026-classification.md`](./portfolio-2025-to-2026-classification.md) | Human-readable two-axis classification report. |
| [`portfolio-2025-to-2026-classification.csv`](./portfolio-2025-to-2026-classification.csv) | Machine-readable 159-row table (151 legacy + 8 NEW). |
| [`portfolio-2025-to-2026-classification.json`](./portfolio-2025-to-2026-classification.json) | Raw classifier output. |
| [`portfolio-2025-role-overrides.json`](./portfolio-2025-role-overrides.json) | Owner-supplied `role` (grounded by `docs/personal/domain.md`) and per-row `publication` override. |
| [`portfolio-2025-owner-review.md`](./portfolio-2025-owner-review.md) | Owner decision surface — every eligible + rewrite_required row, grouped by publication blocker. |

## Two-axis classification

The classification separates two independent decisions:

1. **`migration_class`** — mechanical, agent-deterministic. Derived
   from raw legacy metadata (status / visibility / link count /
   markdown presence):
   - `eligible` — published+public+rich content (title + ≥1 link + ≥1 markdown)
   - `rewrite_required` — published+public but narrative / link surface thin
   - `mechanical_drop` — placeholder / test scaffold / empty rows; NEVER inserted
   - `new_candidate` — NEW proposal without a legacy DB row; NEVER auto-inserted

2. **`publication`** — owner selection authority. Only the owner
   can flip this from the default `pending_owner` to `approved`
   (via `portfolio-2025-role-overrides.json#publication_overrides`).
   - `approved` — owner has signed off; migration writes `visibility = 'public'`
   - `pending_owner` — default; migration writes `visibility = 'draft'`
   - `rejected` — owner has declined; migration never inserts

Crucially, `migration_class = 'eligible'` does NOT imply
`publication = 'approved'`. The 48 mechanically-eligible rows are
all `pending_owner` until the owner signs each one off.

## Publication blockers

For eligible + rewrite_required rows, the classifier lists
`publication_blockers`:

| blocker | meaning | how owner clears it |
| --- | --- | --- |
| `role_missing` | `role` not in `role_overrides` | add a `role_overrides` entry with `domain.md` citation |
| `media_missing` | no `content_assets` rows in legacy source | upload R2 media via `upload-portfolio-media.mjs`, then add `portfolio_media` rows |
| `narrative_missing` | legacy markdown is empty | rewrite motivation/architecture/evidence directly via override / `#79` successor |
| `no_mappable_section` | legacy markdown has no heading matching `動機` / `Architecture` / etc. | write new narrative (legacy body is not a catch-all) |

Until all blockers clear for a given row, the migration writes it
with `visibility = 'draft'` and the public loader never surfaces it.

## Owner workflow

1. Run `scripts/classify-portfolio-from-2025.mjs` to regenerate
   the artifact from the latest legacy source.
2. Open `portfolio-2025-owner-review.md` — every eligible +
   rewrite_required row is listed, grouped by blocker.
3. Edit `portfolio-2025-role-overrides.json` to:
   - add `role_overrides` entries for grounded roles
   - add `publication_overrides` entries to flip `pending_owner → approved`
   - re-run the classifier; the migration reflects the new state
4. Run `scripts/migrate-portfolio-from-2025.mjs --dry-run` to inspect the SQL surface.
5. Run `scripts/migrate-portfolio-from-2025.mjs --apply --target=local` to apply.
6. Run `scripts/verify-portfolio.mjs` to confirm the AC: public rows have `media_count >= 1`, `title / summary / role / period / ≥1 link`.

## Public publication gate

A row only becomes `public + published` when ALL of:

- `title` non-empty
- `summary` non-empty
- `role` non-empty (grounded in `role_overrides`)
- `period_start` non-zero
- `≥1 portfolio_link` row attached
- `≥1 portfolio_media` row attached
- owner `publication` override = `approved`

The verifier enforces all of these. Approved rows that fail the
media check are reported by the verifier with the exact slug and
the rule that broke.

## Preflight collision check

The migration script refuses to write any SQL when the target D1
already has rows the migration did not itself produce
(`portfolio_project.id` / `slug` collisions, or non-`legacy_link_*`
ids in `portfolio_link`). This is a hard exit 3, not a silent
`INSERT OR IGNORE`. Re-running the same migration is idempotent —
the migration's own previously-written rows pass the check because
they were captured in `intendedInsertIds` / `intendedInsertSlugs`
before the D1 query runs.

## Related

- [Issue #78 — feat(portfolio): my-web-2025 の 151 portfolio content を 0.5.0 schema へ移行する](https://github.com/rebuildup/my-web-2026/issues/78)
- [[portfolio-and-tools-audit]] — pre-sprint audit (2026-09-27)
- `docs/personal/domain.md` — narrative source (employment-facing)
- `docs/personal/knowledge-model.md` — date + source for metrics invariant
- `docs/domain/capabilities.md` — "Legacy does not mean planned"
