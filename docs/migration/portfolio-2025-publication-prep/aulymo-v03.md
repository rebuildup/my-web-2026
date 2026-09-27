# aulymo_v03 — publication prep (NOT approval)

> Status: **prep material, awaiting owner approval + fresh local media + review**
> Visibility: public (intent, weakest candidate)
> Grounded: 2026-09-27

This file is a grounded Markdown-section draft for the operator to
review. Every claim has a provenance citation. **No fabrication.**

**Weakest of the 4 candidates.** Recommend deferring to 0.6.0 or
merging into v01/v02 unless operator has additional evidence to
publish separately.

## Identity (grounded)

- legacy_id: `aulymo_v03`
- slug: `aulymo-v03`
- title: `Aeスクリプト Aulymo_v03` (from `contents.title`)
- summary: `Ae版全自動リリックモーション「Aulymo」をアプデしました`
  (from `contents.summary`)
- role: `Tool developer` (from `portfolio-2025-role-overrides.json`,
  grounded in `docs/personal/domain.md` §8)
- period_start: `2025-08-12` (from `contents.published_at`)
- facets: `['develop']`
- technologies: `['After Effects', 'ExtendScript']`

## Links (grounded)

| order | kind | href | label |
|---|---|---|---|
| 0 | other | https://x.com/361do_sleep/status/1955248758243070349 | X status update |

Only **1 link**. The markdown body embeds v02's video iframe
(`EbtybmiN5pM`) but does not list v03's own PV — there may not be one.

## Media (grounded)

- 0 local files in legacy `content_assets` AND `media` table.
- 0 external videos unique to v03.
- 1 X status URL (text-only, no embedded media confirmed without
  external network access to the post itself).

**Gate state**: `localFileCount = 0` → `media_missing` fires.

## Markdown sections (drafted, grounded only)

### 動機 / Motivation

Aulymo シリーズ v3 アップデート。Ae での lyric motion 自動生成
ツールとしての機能改善・修正。具体的な変更内容は
`contents.summary` の「アプデしました」文言からは読み取れない。

Source: `contents.title` + `contents.summary` — 詳細不明。

### 設計 / Architecture

Aulymo 本体設計は v01/v02 と同じ（ExtendScript + AE API）。
v03 の具体的な差分は `contents.summary` / `contents.title` からは
特定できない。

Source: `contents.title` + `contents.summary` (minimal evidence)。
**Architecture 詳細不明** — operator が changelog を持っていれば
追加。

### 制約 / Constraints

ExtendScript ベース（AE 専用）— v01/v02 と同じ。

Source: シリーズ共通の `docs/personal/domain.md` §8 言及。

### 実装 / Implementation

v03 の実装詳細は現環境では primary source から読み取れない。
changelog / release notes があれば operator が追加すべき。

Source: `contents.summary` の minimal 言及のみ。

### 証拠 / Evidence

- X status: https://x.com/361do_sleep/status/1955248758243070349
  (operator-controlled)
- v02 の PV (https://www.youtube.com/watch?v=EbtybmiN5pM) は v03 の
  body で iframe 埋め込みされているが、v03 独自の動画ではない
  （legacy body より）。

### 振り返り / Retrospective

v03 固有の振り返りは現環境からは読み取れない。
シリーズ全体の retrospective は v01/v02 で記述。

Source: 現環境に v03 固有の振り返り evidence なし。

## Owner decision (PENDING)

- [ ] Publish as separate page (requires fresh evidence; weak candidate)
- [ ] Merge with v02 (recommended; v03 lacks unique evidence)
- [ ] Defer to 0.6.0 (recommended unless operator has additional evidence)
- [ ] Drop

## Remaining technical blockers

| Blocker | Resolution |
|---|---|
| `media_missing` (gate) | Operator: provide fresh local media |
| `no_mappable_section` | Body has no heading keywords; content above is inferred, not extracted |
| Single link (only X status) | Operator: provide additional link OR merge |
| No v03-unique PV | Operator: confirm v03 has no unique video OR merge |

## Files referenced (not modified)

- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/migration/portfolio-2025-role-overrides.json`
- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/personal/domain.md` §8
- `.reference/my-web-2025/data/contents/content-aulymo_v03.db`
- `.reference/my-web-2025/data/contents/content-aulymo_v02.db` (v02 PV referenced in v03 body)
