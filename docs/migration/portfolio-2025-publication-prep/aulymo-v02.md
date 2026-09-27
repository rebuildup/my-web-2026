# aulymo_v02 — publication prep (NOT approval)

> Status: **prep material, awaiting owner approval + fresh local media**
> Visibility: public (intent)
> Grounded: 2026-09-27

This file is a grounded Markdown-section draft for the operator to
review. Every claim has a provenance citation. **No fabrication.**

## Identity (grounded)

- legacy_id: `aulymo_v02`
- slug: `aulymo-v02`
- title: `Aeスクリプト Aulymo` (from `contents.title`)
- summary: `Ae全自動リリックモーション「Aulymo」v2の動作説明動画です。PremiereProを初めてまともに使いました。あと、コンピュータ部のMacBookを借りました。`
  (from `contents.summary`)
- role: `Tool developer` (from `portfolio-2025-role-overrides.json`,
  grounded in `docs/personal/domain.md` §8)
- period_start: `2024-12-20` (from `contents.published_at`)
- facets: `['develop']`
- technologies: `['After Effects', 'ExtendScript']`

## Links (grounded)

| order | kind | href | label |
|---|---|---|---|
| 0 | video | https://www.youtube.com/watch?v=EbtybmiN5pM | v2 demo (PV) |
| 1 | shop  | https://361do.booth.pm/items/6403113 | Booth — Aulymo |

## Media (grounded)

- 0 local files in legacy `content_assets` AND `media` table.
- 1 external video: https://www.youtube.com/watch?v=EbtybmiN5pM
  (operator-controlled PV).

**Gate state**: `localFileCount = 0` → `media_missing` fires.

## Markdown sections (drafted, grounded only)

### 動機 / Motivation

Aulymo v1 を公開後、Premiere Pro での動画編集と After Effects の
組み合わせを workflow に取り入れる過程で、v2 として動作説明動画
（PV）を作成・公開した。

Source: `contents.summary` — "PremiereProを初めてまともに使いました。
あと、コンピュータ部のMacBookを借りました。" の文脈から読み取れる
v1→v2 の workflow 拡張動機。

### 設計 / Architecture

Aulymo 本体の設計は v01 と同じ（ExtendScript + AE API）。
v2 では PV 制作のために Premiere Pro を併用し、Ae 書き出し →
Premiere でのカット・テロップ追加 → 書き出し という workflow を
初めて構築した。

Source: `contents.summary` + v01 エントリの "Aeのスクリプト"
言及。**Ae 本体の実装詳細は v01 と同じ前提**。

### 制約 / Constraints

ExtendScript ベース（AE 専用）。v2 では PV 制作に Premiere Pro と
MacBook（コンピュータ部の借用機）が必要だった。

Source: `contents.summary` ("コンピュータ部のMacBookを借りました")。

### 実装 / Implementation

Ae 部分は ExtendScript (v1 と同じ)。v2 の差は PV 制作 pipeline
（Premiere Pro での編集）の追加。

Source: `contents.summary` + `contents.title`。

### 証拠 / Evidence

- デモ動画（v2 PV）: https://www.youtube.com/watch?v=EbtybmiN5pM
  (operator-controlled)
- 配布: https://361do.booth.pm/items/6403113 (operator Booth)
- Aulymo シリーズ累計 500 本以上の販売（`docs/personal/domain.md` §8）

### 振り返り / Retrospective

v2 の PV 制作で初めて Premiere Pro をまともに使った。
コンピュータ部の MacBook を借用して制作環境を構築。

「初めて 1000 円ほど売れたときは驚いた」体験（2024.12、
my-web-2025 `data.ts` historyData 2024.12 エントリ）は v1 公開時の
もので、v2 PV 公開直後の話ではないが、シリーズ全体の文脈として参照。

Source: `contents.summary` + my-web-2025 `data.ts`。

## Owner decision (PENDING)

- [ ] Publish (requires fresh local media; see §Remaining blockers)
- [ ] Defer
- [ ] Merge with v01 (single `aulymo` page)
- [ ] Drop from 0.5.0

## Remaining technical blockers

| Blocker | Resolution |
|---|---|
| `media_missing` (gate) | Operator: provide fresh local image OR approve gate refinement |
| Architecture thin | Operator: provide source repo URL OR keep as-is |

## Files referenced (not modified)

- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/migration/portfolio-2025-role-overrides.json`
- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/personal/domain.md` §8
- `.reference/my-web-2025/data/contents/content-aulymo_v02.db`
- `.reference/my-web-2025/src/app/about/data.ts`
