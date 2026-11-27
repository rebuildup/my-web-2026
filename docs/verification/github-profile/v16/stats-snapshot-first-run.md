# GitHub stats snapshot — 初回ドライラン実測（v0.15.0 / Issue #1245）

`docs/runbook/github-stats-sync.md` §Rank comparison の初回記録。
`sync-github-stats.mjs --dry-run`（push なし）を production 相当の
`GITHUB_TOKEN` で実行した結果。**実 GitHub API の応答**であり、
モックではない。

- 実行: 2026-11-27 09:17 JST（`observedAt` 2026-11-27T00:17:04Z）
- `sources`: graphql / streak / search / avatar **すべて ok**

## Rank 新旧比較（contract §3.1）

同一入力（`rank.inputs`）に対する 2 式の出力:

| 式 | level | percentile |
| --- | --- | --- |
| `rank.current`（vendored calculateRank） | **B+** | 40.1 |
| `rank.legacy`（旧 anuraghazra 式） | **A+** | 10.2 |

旧式は同一入力で percentile を約 30 ポイント過大評価していた
（stars=174・repos=129 の実入力に対し A+ を出していた）。
現行式の B+ が実態に近い。表示側は `rank.current` を採用する。

## 集計範囲の実測（scope 分離）

| 指標 | owned | participated（contributedTo + 外部発見） |
| --- | --- | --- |
| repos | 129 | 28（contributedTo=28、重複除去後 participated=28） |
| stars | **174** | **53,086** |
| languages | TS / JS / Python / Rust / C# / HTML | TS / Rust / JS / Kotlin / Python / C# |

- `stars.participated` が owned の約 305 倍 — org・参加 repo の
  star が支配的であり、owned-only 表記は実態を大きく過小表示
  していたことが数値で確認できた。
- `languages.participated` では Rust が 4 位→2 位、Kotlin が
  新規出現 — 参加 repo の言語構成が owned と実際に異なる。

## 指標の意味論（snapshot 実値）

- `commitsAuthoredAllTime` 系は GraphQL `contributionsCollection`
  + search API の実測値（`metrics` ブロック）。
- `streak`: current=longest=**207 日**、totalContributions=36,588、
  firstContribution=2024-07-21。
- `followers`: 20。
- `avatarDataUri`: 15,478 bytes（data URI として同梱）。

## 運用上の観測

- 初回 dry-run で `owner{login type}` が GraphQL schema エラー
  （`RepositoryOwner` に `type` は存在しない）を起こし、
  contributedTo / 外部 repo 取得が全滅する不具合を検出・修正
  （`7a201d56`）。未使用フィールドだったため除去。
- GitHub GraphQL の一時的 504 / 空 body が観測されたため、
  `graphql()` に transient retry（5xx・timeout・JSON parse、
  最大 3 attempt）を追加。決定的エラー（schema / GraphQL errors
  payload / 4xx）は即座に失敗する。
