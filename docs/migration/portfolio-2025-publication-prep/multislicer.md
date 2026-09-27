# MultiSlicer — publication prep (NOT approval)

> Status: **prep material, awaiting owner approval**
> Visibility: public (intent)
> Grounded: 2026-09-27
> Source-of-truth: this file is the operator-facing prep packet.
> Approval: requires owner entry in `docs/migration/portfolio-2025-role-overrides.json#publication_overrides` + `visibility` flip from `draft` to `public`. Neither has been done.

This file is a grounded Markdown-section draft for the operator to
review. Every claim has a provenance citation. **No fabrication.**

The migration script (`scripts/migrate-portfolio-from-2025.mjs`) does
NOT consult this file. To make this content land in the D1
`portfolio_project` row, either:

- (Path A) Operator injects the equivalent heading-prefixed content
  into the legacy `markdown_pages.body` and re-runs the migration, OR
- (Path B) Separate ticket extends the migration script to read
  per-candidate content from this directory.

## Identity (grounded)

- legacy_id: `MultiSlicer`
- slug: `multislicer`
- title: `MultiSlicer` (from `contents.title`)
- summary: `Aeで画像をスライスするエフェクトプラグインです` (from `contents.summary`)
- role: `Plugin developer` (from `portfolio-2025-role-overrides.json`, grounded in `docs/personal/domain.md` §8)
- period_start: `2025-05-02` (from `contents.published_at`)
- facets: `['develop']` (inferred; tool/plugin work)
- technologies: `['After Effects', 'C++', 'Adobe After Effects SDK']` (from `docs/personal/domain.md` §8 — C++ / AE SDK plugin)

## Links (grounded, in `content_links`)

| order | kind | href | label |
|---|---|---|---|
| 0 | video | https://youtu.be/X7XddKpTolw | Ae版MultiSlicer PV |
| 1 | shop  | https://361do.booth.pm/items/6872180 | 【Aeエフェクトプラグイン】Ae版MultiSlicer - 361doのbooth - BOOTH |
| 2 | other | https://x.com/361do_sleep/status/1918615732939575763 | x.com |

The legacy `markdown_pages.body` lists an additional 4th link:
`https://github.com/rebuildup/Ae_MultiSlicer` (kind=`repo`). It is
NOT in `content_links`; would need to be inserted separately (operator
decision).

## Media (grounded)

- 1 local JPEG: `20250503_multi.jpg`, 417357 bytes, MIME `image/jpeg`,
  extracted from legacy `media` table row
  `media_1762437621694_rw8hkaw04`. Extracted to `/tmp/MultiSlicer-20250503_multi.jpg`
  (valid JPEG header). NOT uploaded to R2.
- 1 external video: https://youtu.be/X7XddKpTolw (operator-controlled
  upload at `361do_sleep` X handle / `361do` Booth handle).

**Gate state**: `localFileCount = 0` (only `content_assets` is consulted
by the classifier; the `media` BLOB is invisible). `media_missing`
fires until either:

1. A `content_assets` row of kind `local_file` is inserted into the
   legacy DB pointing to the JPEG (data change to primary source), OR
2. The classifier / `upload-portfolio-media.mjs` is extended to also
   read `media` BLOBs (code change; ADR-required).

## Markdown sections (drafted, grounded only)

The sections below use the keyword headings the migration script
matches (`動機` / `設計` / `制約` / `実装` / `証拠` / `振り返り`).
If this content lands, it can be injected into the legacy
`markdown_pages.body` so the partition function picks it up.

### 動機 / Motivation

Aeで作成したコンポジション内の画像を After Effects 上で矩形・自由形状
にスライス（分割）するエフェクトプラグイン。元画像はそのままに、
スライス結果だけ別のレイヤーで再構築できるようにし、分割後の素材加工
やアニメーション付与を容易にする。

Source: `contents.summary` + `docs/personal/domain.md` §8
("MultiSlicer — C++ / After Effects SDK を使った effect plugin")。

### 設計 / Architecture

After Effects のエフェクトプラグインとして実装。`AEGP` / `PF_Effect`
SDK 経由で AE の合成ツリーに介入し、スライス平面・パラメータを
UI に公開。

Source: `docs/personal/domain.md` §8 (C++ / AE SDK) — explicit only.
The detailed architecture (e.g. specific API calls, GPU vs CPU path,
パラメータ UI 設計) is in the source repository
`https://github.com/rebuildup/Ae_MultiSlicer` which the agent does not
have access to without external network. **Architecture section is
deliberately short and conservative**; operator may extend with
details sourced from the repository.

### 制約 / Constraints

After Effects 専用プラグインのため、Premiere Pro や DaVinci Resolve
等の他の合成環境では動作しない。`C++` ビルド成果物のため、利用者の
OS / AE バージョンが `AE SDK` サポート範囲に収まることが前提。

Source: `docs/personal/domain.md` §8 (AE SDK plugin 実装) +
`media.mime_type`/`size` メタデータ。

### 実装 / Implementation

`C++` で After Effects SDK を使い、エフェクトプラグインとして実装。
ソースコードは `https://github.com/rebuildup/Ae_MultiSlicer` で公開。

Source: `docs/personal/domain.md` §8 + `markdown_pages.body` の
`<Bookmark url="https://github.com/rebuildup/Ae_MultiSlicer">`
(legacy body) — the GitHub link is grounded in the legacy body even
though not in `content_links`.

### 証拠 / Evidence

- デモ動画: https://youtu.be/X7XddKpTolw (operator-controlled)
- 配布 / 販売: https://361do.booth.pm/items/6872180 (operator Booth)
- 告知: https://x.com/361do_sleep/status/1918615732939575763 (operator X)
- スクリーンショット: `20250503_multi.jpg` (legacy `media` row,
  417357 bytes JPEG; extracted to `/tmp`)

### 振り返り / Retrospective

数千 download 規模まで利用された実績がある（`docs/personal/domain.md`
§8 末尾）。C++ でのネイティブプラグイン開発、配布・サポート・
update を一通り経験した最初のプロジェクト。

Source: `docs/personal/domain.md` §8 後段。

## Owner decision (PENDING)

- [ ] Publish (set `publication_overrides[].publication = "approved"`,
      `publication_visibility = "public"`, `pinned = 1`,
      `display_order` value, `is_cover = 1` for the JPEG)
- [ ] Defer (leave at `pending_owner`)
- [ ] Reject (drop from 0.5.0 publication surface)

## Remaining technical blockers

| Blocker | Resolution |
|---|---|
| `media_missing` (gate) | Operator: pick one of the two paths in §Media above |
| 4th link (`github.com/rebuildup/Ae_MultiSlicer`) not in `content_links` | Operator: add as `kind='repo'` row in legacy DB OR approve script extension |
| Architecture section thin | Operator: extend with details from source repo OR keep as-is |

## Files referenced (not modified)

- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/migration/portfolio-2025-role-overrides.json` — `role_overrides` (MultiSlicer entry)
- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/personal/domain.md` §8 — Aulymo/MultiSlicer grounding
- `.reference/my-web-2025/data/contents/content-MultiSlicer.db` — legacy SQLite primary source
- `/tmp/MultiSlicer-20250503_multi.jpg` — extracted JPEG, 417357 bytes
