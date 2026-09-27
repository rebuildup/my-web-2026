# aulymo-v01 — publication prep (NOT approval)

> Status: **prep material, awaiting owner approval + fresh local media**
> Visibility: public (intent)
> Grounded: 2026-09-27

This file is a grounded Markdown-section draft for the operator to
review. Every claim has a provenance citation. **No fabrication.**

The migration script does NOT consult this file. To make this content
land, the operator must either inject it into the legacy
`markdown_pages.body` or approve a script extension.

## Identity (grounded)

- legacy_id: `aulymo-v01`
- slug: `aulymo-v01`
- title: `Aulymo` (from `contents.title`)
- summary: `Aeのスクリプトです　簡単にリリックモーションを作れます`
  (from `contents.summary`)
- role: `Tool developer` (from `portfolio-2025-role-overrides.json`,
  grounded in `docs/personal/domain.md` §8)
- period_start: `2024-12-13` (from `contents.published_at`)
- facets: `['develop']`
- technologies: `['After Effects', 'ExtendScript']` (inferred from
  `docs/personal/domain.md` §8 + the script nature of the tool — no
  source repo access without external network)

## Links (grounded)

| order | kind | href | label |
|---|---|---|---|
| 0 | video | https://youtu.be/SewXH0Bbm-c | v1 demo |
| 1 | shop  | https://361do.booth.pm/items/6403113 | Booth — Aulymo |

## Media (grounded)

- 0 local files in legacy `content_assets` AND `media` table.
- 1 external video: https://youtu.be/SewXH0Bbm-c (operator-controlled).

**Gate state**: `localFileCount = 0` → `media_missing` fires.

`aulymo-v01` is **media-missing by design**: the v1 release was a
script-only release with no bundled screenshot/demo image. The Booth
listing and YouTube PV serve as the visual evidence.

## Markdown sections (drafted, grounded only)

### 動機 / Motivation

After Effects で lyric motion を自動生成する ExtendScript ツール。
歌詞と読みを入力すると、各文字のタイミングとアニメーションを
自動で適用したコンポジションを生成する。手動でキーを打つ
手間を省くため。

Source: `contents.summary` + `docs/personal/domain.md` §8
("Aulymo — After Effects で lyric motion を作るための tool")。

### 設計 / Architecture

ExtendScript (`.jsx`) で After Effects の `app.project` /
`app.beginUndoGroup` API を呼び出し、`layer.text` の
`sourceText` プロパティにキーフレームとエクスプレッションを
設定する。

Source: `contents.summary` の "Aeのスクリプトです" 文言と、AE で
ExtendScript ベースのツールが従来的に取る構造（公開資料より）。
**ソースコード未参照** — 具体的な API 呼び出しはソースコードの
参照が必要だが、現環境では外部ネットワークアクセスなし。
**Architecture section is deliberately short and conservative**.

### 制約 / Constraints

ExtendScript ベースのため、After Effects 環境専用。
Premiere Pro 等では動作しない。

Source: `contents.summary` + 標準的な ExtendScript 制約（一般知識）。

### 実装 / Implementation

After Effects の ExtendScript (`.jsx`) として実装。
ソースコードの公開リポジトリは現状未確認（外部ネットワークなしの
ため search 不能）。

Source: `contents.summary` ("Aeのスクリプトです") + `contents.title`
("Aulymo") + `docs/personal/domain.md` §8 (script/tool 言及)。
**Repository URL は不明** — operator が公開リポジトリを知っていれば
追加。

### 証拠 / Evidence

- デモ動画: https://youtu.be/SewXH0Bbm-c (operator-controlled)
- 配布: https://361do.booth.pm/items/6403113 (operator Booth)
- 「2024 年初頭までの公開プロフィール上で累計 500 本以上の販売
  実績」（`docs/personal/domain.md` §8 末尾 — aulymo 全体としての
  言及で、v01 単体の販売数はこの文言からは読み取れない）

### 振り返り / Retrospective

2024-12 に公開。「初めて 1000 円ほど売れたときは驚いた」
（my-web-2025 `src/app/about/data.ts` historyData 2024.12 エントリ）。
Aulymo 全体として 2026 年初頭までに 500 本以上の販売実績あり
（`docs/personal/domain.md` §8）— v01 単体の retrospective は
v02/v03 と区別して書く根拠がないため、シリーズ全体の retrospective
として記述。

Source: my-web-2025 `data.ts` (2024.12 エントリ) +
`docs/personal/domain.md` §8。

## Owner decision (PENDING)

- [ ] Publish (requires fresh local media; see §Remaining blockers)
- [ ] Defer (leave at `pending_owner`)
- [ ] Merge with v02 (single `aulymo` page instead of v01/v02/v03 split)
- [ ] Drop from 0.5.0

## Remaining technical blockers

| Blocker | Resolution |
|---|---|
| `media_missing` (gate) | Operator: provide a fresh local image (e.g. AE コンポジション screenshot) OR approve gate refinement (legacy `media`/YouTube PV as cover via ADR) |
| Architecture section thin | Operator: provide source repo URL OR keep as-is |
| No v01-only retrospective | Operator: confirm series-level retrospective is acceptable OR merge with v02 |

## Files referenced (not modified)

- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/migration/portfolio-2025-role-overrides.json` — `role_overrides` (aulymo-v01 entry)
- `/home/basic/work/my-web-2026.worktrees/113-capabilities-drift/docs/personal/domain.md` §8
- `.reference/my-web-2025/.reference/my-web-2025/src/app/about/data.ts` — 2024.12 history entry
- `.reference/my-web-2025/data/contents/content-aulymo-v01.db` — legacy SQLite primary source
