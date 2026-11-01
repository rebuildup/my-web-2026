# 旧 portfolio → Notion 移行の実行記録（2026-11-01）

Issue #766。台帳 (`portfolio-2025-inventory.json`) に対する**実行の記録**であり、
台帳そのものは `scripts/audit-legacy-portfolio.mjs` が生成する。
Notion の page id・token・secret はここに書かない（台帳も `recorded` / `null` の状態だけを持つ）。

## 1. 対象と前提

| 項目 | 値 |
| --- | --- |
| 旧サイト | `my-web-2025` @ `ed1b9df`（`.reference/` の clone、gitignore） |
| 台帳 | 151 件。`published/public` 69 / `draft/draft` 80 / 空 2 |
| 移行先 | Notion `Portfolio Projects`（`NOTION_PORTFOLIO_DB_ID` が指す 1 データソース） |
| 公開判定 | 移行は公開を決めない。すべて **Status=Draft / Visibility=Draft** で書いた |

## 2. database の整備

`scripts/_notion-mapper.mjs` が読む任意 property のうち欠けていた 5 件を追加した
（`PATCH /v1/data_sources/{id}`、追加のみ・削除も型変更もしない）。

| property | 型 |
| --- | --- |
| `PeriodEnd` | number |
| `Period` | rich_text |
| `Technologies` | multi_select |
| `Pinned` | checkbox |
| `Order` | number |

結果 9 → 14 property。語彙は `src/portfolio/notion/contract.ts` に合わせており、
新しい語彙は発明していない。

## 3. 書き込み結果

| 区分 | 件数 | 理由 |
| --- | --- | --- |
| 作成 | **4** | 必須項目がすべて**記録から**揃っている |
| 未作成: `role_missing` | **64** | 根拠のある role が無い（`portfolio-2025-role-overrides.json` に該当行なし） |
| 未作成: `facets+role` | **1** | facet も role も無い |

作成した 4 件（slug）: `aulymo-v01` / `aulymo-v02` / `aulymo-v03` / `multislicer`。
いずれも `role_source=role_overrides` で、`docs/personal/domain.md` に根拠が引かれている。

**role を推測で埋めなかった。** role は「その人が何をしたか」という主張であり、
台帳側の指針（`portfolio-2025-role-overrides.json` の
「Rows not in this map leave `role` NULL; owner must add an entry before publication is approved」）
に従った。結果として 65 件は未移行である。**これは失敗ではなく、判断待ちの記録**である。

## 4. 公開面への影響

- 作成した 4 件は `Draft` / `Draft`。`src/portfolio/notion/publish.ts` は
  `published` + `public` の同時成立だけを公開するため、**公開面は変化していない**。
- `sync-portfolio-notion.mjs --dry-run` → `records=4`、refusal 0。
- rights は 151/151 `unrecorded` のまま。権利記録なしに公開できるものは 1 件も無い。

## 5. 残り 65 件を止めているもの

| 停止条件 | 件数 | 解く主体 |
| --- | --- | --- |
| `role` の根拠が無い | 65（うち facet 欠落 1 を含む） | owner（または role を任意にする契約判断） |
| 旧メディアの移行（`media_missing`） | 60 | #766 後段（R2 アップロード + `src/legal/**`） |
| 公開承認（`pending_owner`） | 60 | owner |

## 6. 台帳の更新

`docs/migration/portfolio-notion-pages.json` に移行状態を記録し、
`scripts/audit-legacy-portfolio.mjs --notion-pages=<path>` が
`portfolio-2025-inventory.json#items[].notion_page` に `recorded` を刻む
（既定のパスなので追加引数は不要）。**id は載せない。**
現状 `by_notion_page: { recorded: 4, null: 147 }`。
