# Portfolio publication prep directory

> Status: **prep material, awaiting owner approval**
> Visibility: internal-only docs (NOT public)
> Grounded: 2026-09-27

This directory holds per-candidate Markdown-section drafts prepared
for Issue #78 publication. Each file is grounded in primary source
only — no fabrication, no inflated claims.

The migration script (`scripts/migrate-portfolio-from-2025.mjs`) does
NOT consult this directory. To make this content land in D1, the
operator must either:

- (Path A) Inject equivalent heading-prefixed content into the legacy
  `markdown_pages.body` and re-run the migration, OR
- (Path B) Approve a script extension to read per-candidate content
  from this directory (separate ticket, ADR-required for gate changes).

## Per-candidate status (approval直前)

| Candidate | Markdown prep | Links | Local media | Gate state | Owner decision |
|---|---|---|---|---|---|
| `MultiSlicer` | ✅ drafted | ✅ 3+1 (YouTube + Booth + X + GitHub) | ✅ 1 (JPEG 417KB in legacy `media` BLOB, invisible to classifier) | `media_missing` (gate sees 0 local files) | `publish / defer` |
| `aulymo-v01` | ✅ drafted | ✅ 2 (YouTube + Booth) | ❌ 0 | `media_missing` | `publish / defer` (+ fresh local media needed) |
| `aulymo_v02` | ✅ drafted | ✅ 2 (YouTube + Booth) | ❌ 0 | `media_missing` | `publish / defer` (+ fresh local media needed) |
| `aulymo_v03` | ⚠️ drafted (minimal) | ⚠️ 1 (X status only) | ❌ 0 | `media_missing` + thin evidence | `merge with v02 / defer 0.6.0 / drop` |

## What agent has resolved

For each candidate, the per-candidate file in this directory contains:

- Identity section (slug, title, summary, role, period, facets,
  technologies) — all grounded in legacy `contents` table +
  `role_overrides`.
- Links section — every URL traced back to `content_links` or
  `markdown_pages.body` `<Bookmark>` tags in primary source.
- Media section — exhaustive survey of `content_assets` AND
  legacy `media` BLOB. MultiSlicer's JPEG (417357 bytes) is the only
  local media found in primary source.
- 6 Markdown sections (`動機 / 設計 / 制約 / 実装 / 証拠 / 振り返り`)
  using the heading keywords the migration script partitions on.
  Every claim cited.
- Remaining technical blockers — explicit per candidate.
- Owner decision checklist — explicit per candidate.

## What agent has NOT resolved (operator-gated)

For each candidate:

- **Fresh local media** for the 3 aulymo candidates (operator must
  source). The primary source has no local media for these.
- **Gate refinement** for MultiSlicer's JPEG — either:
  - Insert a `content_assets` row pointing to the JPEG (data change
    to legacy primary source)
  - Approve classifier / `upload-portfolio-media.mjs` extension to
    read `media` BLOBs (separate ticket; ADR needed for gate change)
- **publication_overrides** entries (operator-only; never agent).
- **`visibility` flip** from `draft` to `public` (operator-only).

## Files

- `multislicer.md` — MultiSlicer prep (richest; 1 grounded local JPEG)
- `aulymo-v01.md` — aulymo-v01 prep (no local media; needs fresh)
- `aulymo-v02.md` — aulymo_v02 prep (no local media; needs fresh)
- `aulymo-v03.md` — aulymo_v03 prep (weakest; recommend defer/merge)

## Files referenced (not modified)

- `../portfolio-2025-publication-prep-2026-09-27.md` — original dossier
  (superseded by this directory + per-candidate files)
- `../portfolio-2025-role-overrides.json` — role grounding (4 entries)
- `../portfolio-2025-to-2026-classification.json` — classification state
- `../../personal/domain.md` §8 — Aulymo/MultiSlicer grounding
- `.reference/my-web-2025/data/contents/content-*.db` — legacy primary source
- `.reference/my-web-2025/src/app/about/data.ts` — 2024.12 retrospective entry

## Next step (operator decision)

After reviewing per-candidate files, operator returns one decision per
candidate: `publish` / `defer` / `merge` / `drop`.
For `publish` decisions, operator provides `publication_overrides`
entries (with timestamps) + visibility flip to `public`.
