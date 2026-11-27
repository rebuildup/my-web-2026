# GitHub 統計スコープ検証 (2026-11-27, v0.16.0 開発)

`sync-github-stats.mjs --dry-run` の実データと本番 surface の実測で、
#1245 の集計範囲契約が実装どおり機能していることを確認した記録。

## 実測値（dry-run snapshot、observedAt 2026-11-27T07:42Z）

| 指標 | 値 | スコープ |
|---|---|---|
| commitsAuthoredAllTime | 25,221 | search API `author:rebuildup is:public` — org/外部貢献先を含む全 authored commits（旧 contributionsCollection 1年値の不整合は解消済み） |
| prsOpenedAllTime / issuesOpenedAllTime | 5,852 / 5,019 | 同上 |
| metrics.contributedTo | 28 | GraphQL affiliation（OWNER/COLLABORATOR/ORGANIZATION_MEMBER） |
| repos | owned 129 / contributedTo 28 / participated 28 (`complete: true`) | discovery 拡張どおり |
| stars | owned **174** / participated **53,144** | 所有と参加を厳密分離 — participated は「貢献した repo の星」であり本人の指標ではないため非表示が正しい |
| languages | owned top: TypeScript 58.1MB / JS 22.0MB / Python 6.6MB；participated top: TypeScript 20.2MB / **Rust 13.7MB** / JS 3.9MB | 分布が実際に異なる（Rust は participated のみ上位）— 同一指標の言い換えではないことを確認 |
| streak | current/longest 207, totalContributions 36,756 | — |
| rank | current **B+ (40.1%)** / legacy **A+ (10.2%)**、inputs は同一（commits 25,221, prs 5,868, issues 5,019, reviews 145, repos 129, stars 174, followers 20） | 新旧式の同一入力比較が snapshot 同梱どおり |

## 本番 surface との対応（2026-11-27 実測）

- `/api/v1/github-profile/vitals`: 25,202 commits（前日 snapshot、整合）、36,668 contributions、PRs/issues 表示を確認
- `/api/v1/github-profile/top-languages`: owned スコープの言語バー（契約どおり participated は出さない）
- `/api/v1/github-profile/activity-map`: 「52 active repos」「Other public (39)」— ae-devtools / ae-a8n 等の org-member・external-public repo を含む本番 activity snapshot（scope 次元付き、当日 15:06 JST push）
- サイト本体 GitHub STATUS（home activity card）: 同一 activity snapshot を読むため org/外部貢献 repo の活動を反映

## Rank 新旧 semantics の明確化

- `rank.current` = vendored `calculateRank`（現行式）
- `rank.legacy` = 旧 anuraghazra/github-readme-stats 式
- 両者とも **owned スコープ入力**（repos 129・stars 174）で計算 — 契約 §3.1「participated を rank に混ぜない」どおり。差分（B+ vs A+）は式の重み付け差であり、集計範囲拡張とは独立

## 観測されたギャップ（対応は #1240 系の検討事項）

`languages.participated` / `stars.participated` / `repos.participated` は
snapshot に保存されるが、現状これを表示する surface は無い
（`contributedTo: 28` が vitals/identity に出るのが実質の参加指標）。
契約は「別指標として公開」とあるため、表示するかはデザイン判断 —
owned 指標との混同を避けるラベル設計が前提。次期 visual pass で検討。
