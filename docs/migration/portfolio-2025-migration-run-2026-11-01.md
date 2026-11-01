# 旧 portfolio → Notion 移行の実行記録（2026-11-01）

Issue #766。台帳 (`portfolio-2025-inventory.json`) に対する**実行の記録**であり、
台帳そのものは `scripts/audit-legacy-portfolio.mjs` が生成する。
Notion の page id・token・secret はここに書かない（台帳も `recorded` / `null` の状態だけを持つ）。

本移行は `docs/adr/ADR-0018-notion-as-portfolio-cms-source-of-truth.md` に従う。

## 1. 対象と前提

| 項目 | 値 |
| --- | --- |
| 旧サイト | `my-web-2025` @ `ed1b9df`（`.reference/` の clone、gitignore） |
| 台帳 | 151 件。`published/public` 69 / `draft/draft` 80 / 空 2 |
| 移行先 | Notion `Portfolio Projects`（`NOTION_PORTFOLIO_DB_ID` が指す 1 データソース） |
| 公開判定 | 移行は公開を決めない。**68 件すべて Status=Draft / Visibility=Draft で書いた** |

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

## 3. `Role` の作り方（owner 決定 2026-11-01）

旧サイトの `frontmatter` は title / slug / updated / draft の 4 キーしか持たず、
`role` に相当するデータは**どこにも存在しない**（69/69）。そこで owner は
「facet から機械生成する」を選んだ。事実の捏造にしないための条件は次の 4 つ。

1. **固定表**。`scripts/audit-legacy-portfolio.mjs#LEGACY_FACET_ROLES` が唯一の定義箇所。
2. **優先順位も固定**。`LEGACY_FACET_ROLE_PRIORITY`。
3. **生成したことを記録**。台帳の `role_source` が `facet-derived` / `owner-recorded` を分ける。
4. **表とテストを同じ commit に**。`scripts/audit-legacy-portfolio.test.mjs` が値を固定する。

| facet | `Role` に入る文字列 |
| --- | --- |
| `develop` | `Development` |
| `video` | `Video production` |
| `design` | `Design` |
| `other` | `Production` |

優先順位は `develop` > `video` > `design` > `other`。複数 facet を持つ 8 件はこの順で 1 つ選ぶ。

値は「作品の種類」を表す名詞にした（`Developer` ではなく `Development`）。
facet は**作品が何であるか**しか言っておらず、「この人がそれを担った」は言っていないためである。

### 表示ラベルの確認結果（未解決・owner 判断へ）

`Role` を表示する 2 か所は、どちらも `<dt>` が文字列 **`Role`** である。

| ファイル | 行 | ラベル |
| --- | --- | --- |
| `src/portfolio/components/ProjectCard.tsx` | 225 | `Role` |
| `src/portfolio/components/PortfolioDetail.tsx` | 216 | `Role` |

そのため `Role` = `Video production` は **「担当: 映像制作」** と読める。
生成規則は「種類」しか主張していないのに、ラベルが「担当」を主張してしまう。
**公開コピーなので、この PR ではラベルを変えていない。** 選択肢は 2 つ。

- (a) ラベルを `Role` → `Type` / `種類` に変える（公開コピーの変更。owner 決裁）
- (b) 生成規則の値を「担当」と読める語に寄せる（過剰な主張になるため推奨しない）

68 件はすべて Draft なので、どちらを選んでも公開面は現時点で変化していない。

この未決事項は台帳 `portfolio-2025-inventory.json#open_decisions` にも 1 行で残している
（生成器 `scripts/audit-legacy-portfolio.mjs#OPEN_DECISIONS`）。**agent が答える項目ではない。**

## 4. 書き込み結果

| 区分 | 件数 | 理由 |
| --- | --- | --- |
| 作成 | **68** | 必須項目がすべて記録から揃っている |
| 既存（前回作成） | 4 | 上の 68 に含まれる（再実行しても重複しない） |
| 未作成 | **1** | `facets+role`（下記） |

内訳: 前回 4 件 → 今回 64 件を追加し、合計 **68 / 69**。
68 件すべて **Status=Draft / Visibility=Draft**。`role_source` は
`facet-derived` 64 件 / `owner-recorded` 4 件。

### 未作成 1 件

`FlashBeat-BGM`。旧 `content_tags` には `Cubase` / `DTM` の 2 つがあるが、分類成果物
（Issue #78）はどちらも facet 語彙に写像しておらず、facet は 0 件である。そのため
`Facets`（必須、`develop`/`video`/`design`/`other` のいずれか 1 つ以上）が埋まらず、
`role` も表から導けない。`other` を機械的に当てると「分類済み」に見えてしまうので当てていない。
facet の写像は分類側（Issue #78）の権限なので、ここでは決めない。
**未移行 + 理由**として台帳に残す。

旧 body の画像ブロックによる拒否（`image_block_unsupported`）は **0 件**。
69 件の `markdown_pages.body` に画像記法（`![…](…)` / `<img>`）は 1 件も無く、
画像は `media` テーブル側にある。

## 5. 公開面への影響

- 68 件は `Draft` / `Draft`。`src/portfolio/notion/publish.ts` は
  `published` + `public` の同時成立だけを公開するため、**公開面は変化していない**。
- `sync-portfolio-notion.mjs --dry-run` の refusal は 0。語彙は mapper と一致した。
- rights は 151/151 `unrecorded` のまま。権利記録なしに公開できるものは 1 件も無い。

## 6. まだ公開できない理由

| 停止条件 | 件数 | 解く主体 |
| --- | --- | --- |
| rights `unrecorded` | **151 / 151**（公開対象 69 を含む） | owner |
| 旧メディアの移行（`media_missing`） | **60** | #766 後段（R2 アップロード + `src/legal/**`） |
| 公開承認（`pending_owner`） | **60** | owner（権利記録が埋まってからまとめて確認する方針） |
| facet が無い | **1**（`FlashBeat-BGM`） | owner または分類側 |

## 7. 台帳の更新差分

`docs/migration/portfolio-notion-pages.json` に移行状態を記録し、
`scripts/audit-legacy-portfolio.mjs --notion-pages=<path>` が
`portfolio-2025-inventory.json#items[].notion_page` に `recorded` を刻む
（既定のパスなので追加引数は不要）。**id は載せない。**

現状 `by_notion_page: { recorded: 68, null: 83 }`、`by_role_source: { facet-derived: 64, owner-recorded: 4, null: 83 }`。
`new_url` は 151 件すべて `null`（公開 URL は移行ではなく公開が決める）。
