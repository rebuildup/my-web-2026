# Notion → portfolio snapshot の取り込み（operator runbook）

Issue #765 / ADR-0018 / Issue #814。Notion の database を portfolio の
**authoring SoT** として扱い、operator が **1 回だけ** 実行して snapshot を
作る手順。

> **これは「同期」ではない（Issue #814、owner 言い直し 2026-11-02）。**
> 「厳密には同期ではない。書き換えは単発で行うし、サイト側は読み込みを行う
> だけでいい。」この手順は 2 つの store の一致を保たない。人が 1 回実行し、
> サイトはできあがった snapshot を読むだけである。ファイル名
> `sync-portfolio-notion.md` / `scripts/sync-portfolio-notion.mjs` は既存の
> 参照が指す識別子なので変えないが、指している責務は単発の取り込みである。

> **この runbook は「token を持っていない状態」の検証から始まる。**
> owner が Infisical `dev` に `NOTION_TOKEN` / `NOTION_PORTFOLIO_DB_ID` を投入済みで、
> 2026-11-01 に dry-run で real path の疎通を確認した（§5.2）。

## 1. これは何か / 何ではないか

| はい | いいえ |
| --- | --- |
| operator が 1 回実行する単発の取り込み | 定期実行（cron / schedule / workflow） |
| commit された snapshot を build が読む | Worker がリクエスト時に Notion を読む |
| 「Notion で編集 → 人が取り込み → 次の build で反映」 | 「Notion で Publish した瞬間に公開」 |
| サイトは snapshot と D1 を読む | Notion と D1 の一致を自動で保つ |

**定期実行は明示的に禁止**されている（owner 指示 2026-11-01 項目 4）。
`.github/workflows/` に portfolio の取り込みを実行する workflow を足しては
いけない。禁止しているのは「2 つの store の一致を自動で保つ仕組み」であり、
この runbook はその仕組みを作らない。

## 2. Notion 側の前提（owner が行う）

1. **integration を作る。** Notion の Settings → Connections → Develop or manage
   integrations → New integration。type は **Internal**。
   （Public / OAuth ではない。internal connection token は静的で、refresh 経路を
   持たない — ADR-0018 §2.9）
2. **capability を絞る。** 付与してよいのは:

   | capability | 付与 | 理由 |
   | --- | --- | --- |
   | Read content | **必須** | `read_content`。portfolio の本文・property を読む唯一の権限 |
   | Update content | **禁止** | `insert_content`。この platform は Notion に書かない |
   | Insert content | **禁止** | 同上 |
   | Read user information | 任意（現状は不要） | 誰が書いたかを表示しないため |

   `quality/integration-scope.json` の notion 行が
   `required: [read_content]` / `denied: [insert_content]` を宣言している。
3. **対象 database を接続に共有する。** database ページ右上 `⋯` → Connections →
   作成した integration を追加。**共有を忘れると API は 404 を返す**
   （integration 自体は有効なのに見えない、が最初のつまずきどころ）。
4. **database の property を定義する**（§3）。

### 3. database の形

`Title` は Notion の title property、それ以外は rich text / number /
multi_select / select / checkbox。**名前は完全一致**で読まれる。

| property | 型 | 必須 | 備考 |
| --- | --- | --- | --- |
| `Title` | title | ✔ | 公開タイトル |
| `Slug` | rich_text | ✔ | `[a-z0-9][a-z0-9-]{0,127}`。Notion で編集できる識別子 |
| `Summary` | rich_text | ✔ | 一覧に出る 1〜2 文 |
| `Role` | rich_text | ✔ | 仕事の種類。表示ラベルは `Kind`（Issue #813 の語彙決定）。property 名 `Role` の改名は Issue #813 の未解決項目 |
| `PeriodStart` | number | ✔ | 西暦（例 `2024`） |
| `PeriodEnd` | number | | 未完了なら空 |
| `Period` | rich_text | | 表示用の期間文字列（例 `2024`） |
| `Facets` | multi_select | ✔ | `develop` / `video` / `design` / `other` |
| `Technologies` | multi_select | | 自由記述 |
| `Status` | select | ✔ | `Published` / `Draft` / `Archived`。**`Published` だけが公開対象** |
| `Visibility` | select | ✔ | `Public` / `Unlisted` / `Draft`。**`Public` だけが公開対象** |
| `Pinned` | checkbox | | 一覧の先頭に固定 |
| `Order` | number | | 小さいほど先 |
| `Links` | rich_text | | 1 行 1 リンク: `<kind> <url> [label]`。kind は `repo` / `demo` / `release` / `article` / `shop` / `video` / `other`。URL は https のみ |

### 本文（page body）の形

本文は **level-2 見出しで節を切る**。見出し名は次の 6 語彙のいずれか
（英語 / 日本語のどちらでもよい）:

| 見出し | section |
| --- | --- |
| `Motivation` / `動機` | motivation（**必須**。本文が空なら取り込みは `missing_motivation` で拒否する） |
| `Architecture` / `設計` | architecture |
| `Constraints` / `制約` | constraints |
| `Implementation` / `実装` | implementation |
| `Evidence` / `根拠` | evidence |
| `Retrospective` / `振り返り` | retrospective |

使える block: paragraph / heading_3 / bulleted list / numbered list / quote /
code / divider。**それ以外と `image` は error**（黙って落とさない）。
理由と交換形式の判断は ADR-0018 §2.3。

## 4. secret の置き場所

| 項目 | 値 |
| --- | --- |
| **名前** | `NOTION_TOKEN` / `NOTION_PORTFOLIO_DB_ID` |
| 値 | **この文書にも repo にも Issue にも書かない**。operator が Infisical に直接入れる |
| Infisical 環境 | **`dev`**（理由は下記） |
| Infisical path | `/`（`scripts/infisical-seed.mjs` の既定と同じ） |
| `wrangler.jsonc#secrets.required` | **入れない** |
| `wrangler.production.jsonc#secrets.required` | **入れない** |
| `scripts/run-deploy-inner.mjs#REQUIRED_RUNTIME_SECRETS` | **入れない** |
| `NOTION_PORTFOLIO_DB_ID` | secret ではない。`--database-id` で渡すか、env に置く（**`--database-id` が env より優先**） |

**なぜ `dev` か。** これは本番 runtime secret ではなく **運用者ローカルの
credential** である。根拠:

| 事実 | 帰結 |
| --- | --- |
| `pnpm build` は Notion の取り込みを呼ばない（実測: `vite build` → `build-tools` → `check-client-bundle`） | build のたびに token を要さない |
| Worker は Notion を読まない（snapshot を bundle しているだけ） | runtime secret ではない |
| ADR-0018 §2.2 で定期実行を却下しており、CI / Workers Builds に取り込み step は無い | CI も token を要さない |
| `wrangler*.jsonc#secrets.required` に名前を足さない | `prod` に置くと「宣言されていない prod secret」になり、`cf:config:drift:check` の観点で乖離する |

つまり `prod` に置くのは **本番 runtime が読む secret だけ**にする。

**なぜ `secrets.required` に入れないか**: それは *Worker が runtime で読む* secret の
宣言である。`NOTION_TOKEN` は offline tooling の credential で、Worker の
import graph に入らない。加えて `quality/integration-scope.json#allowlist.entries`
が空のうちは、integration 名を `secrets.required` に足すと
`pnpm run integration:scope:check` が error を出す（allowlist は owner だけが
書ける — ADR-0018 §5）。

値を入れる操作（operator が自分の shell で実行する。agent は実行しない）:

```sh
infisical secrets set NOTION_TOKEN --env=dev --path=/
infisical secrets set NOTION_PORTFOLIO_DB_ID --env=dev --path=/
# プロンプトに値が現れる。stdout に値は出ない。
```

`infisical secrets --env=dev --path=/` / `infisical secrets get ... --plain` の
ような **値を列挙するコマンドは禁止**（AGENTS.md §4、Issue #139）。

## 5. 実行手順と期待結果

### 5.1 token 無しで全経路を検証する（今すぐできる）

```sh
node scripts/sync-portfolio-notion.mjs \
  --fixture scripts/fixtures/notion-portfolio/portfolio.json \
  --dry-run
```

期待:

```
synced records=3 digest=sha256:148e88ed1be3… written=false
exit=0
```

`records=3` は fixture の 3 ページ。うち 1 ページは `Draft` + `Unlisted` で、
公開面には出ない（`publish.ts` が落とす）。**この実行はネットワークを使わない。**

### 5.2 token を入れた後の最初の実行（2026-11-01 に実施済み）

```sh
# DATABASE_ID は env（NOTION_PORTFOLIO_DB_ID）から来るので、指定は任意
infisical run --env=dev --path=/ -- node scripts/sync-portfolio-notion.mjs --dry-run
```

期待（dry-run なので何も書かない）:

```
synced records=<N> digest=sha256:<16桁>… written=false
exit=0
```

`<N>` は data source のページ数。**ここで `records=0` なら共有忘れ**（§2 手順 3）、
`refused page=… ` 行が出たら本文の形が §3 の語彙から外れている。

**configured id は database id でも data source id でもよい**（2026-11-01 追加）。
Notion の data-source model では 1 つの表に 2 つの id があり、UI からコピーできるのは
たいてい data source id である。CLI はまず `/v1/databases/{id}` を読み、404 のとき
同じ値を data source id として query する。どちらでも解決しなければ 404 で止まる
（別の表を黙って選ぶことはない）。

**property 名は §3 の表と完全一致している必要がある。** 違う名前の
database を指していると、1 ページについて property の数だけ
`missing_property` が出る。まず `data source` の property 名を確認する
（値を出す必要はない。名前と種別だけで足りる）。

#### 2026-11-01 の実行結果（owner が `dev` に secret を投入した後）

| 段 | 結果 |
| --- | --- |
| token / id の存在 | どちらも注入された（`infisical run` は 7 secret を注入） |
| `GET /v1/databases/{id}` | **404** — configured id は database id ではなかった |
| `GET /v1/data_sources/{id}` | **200** — data source id として解決。property は 3 件（`名前: title` / `タグ: multi_select` / `作成日時: created_time`） |
| `POST /v1/data_sources/{id}/query` | **200** — 1 ページ |
| mapping | `missing_property` 7 件 + `unknown_status` / `unknown_visibility` / `missing_motivation` = **1 ページ / 9 件**で refuse。何も書いていない（exit 1） |
| 判定 | 読めるが、**§3 の property schema を持たない data source を指している**。§2 の database を作り、property を §3 の名前で用意するか、正しい id に差し替える |

これは code の欠陥ではなく、owner 側の database 準備待ちである。
`--dry-run` は何も書いていないので、この状態で repo は無変更。

問題がなければ本実行:

```sh
infisical run --env=dev --path=/ -- \
  node scripts/sync-portfolio-notion.mjs --database-id <DATABASE_ID>
```

期待:

```
synced records=<N> digest=sha256:… written=true
exit=0
```

すると `src/portfolio/notion/generated/snapshot.json` が書き換わる。差分を確認し、
commit する。

2 回目以降、内容が変わっていなければ:

```
unchanged records=<N> digest=sha256:… written=false
```

### 5.3 database id の探し方

Notion で database を開いたときの URL の `?v=` より前の 32 桁 hex
（`https://www.notion.so/<workspace>/<32桁>?v=<view>`）。API はこれを
`database_id` として受け付ける。**workspace id ではない。**

### 5.4 exit code

| code | 意味 | 次にすること |
| --- | --- | --- |
| 0 | 書いた / 変わらない / `unavailable` を記録した | `git diff` を見る |
| 1 | 本文が語彙から外れている / 生成物が契約を通らない | 表示された `refused page=… <code> at=… expected=…` を直す |
| 2 | 引数が誤り | `--help` |
| 3 | credential 不在 / 401・403・404 / ネットワーク | §2 の共有と token を確認 |

## 6. 反映の流れ（編集 → 公開）

```
Notion で本文を編集
  → operator が取り込みを実行
  → snapshot.json の差分を review して commit
  → PR → release branch → main
  → Cloudflare Workers Builds が deploy
  → 公開面が変わる
```

遅延は「次の build まで」であり、意図された仕様である。

## 7. 失敗時の読み方

| メッセージ | 意味 |
| --- | --- |
| `missing credential: NOTION_TOKEN is not set` | env が無い。exit 3。何も書いていない |
| `missing target: pass --database-id or set NOTION_PORTFOLIO_DB_ID` | id が無い。exit 3 |
| `credential rejected or integration not shared with the database` | 401/403。token 不正 or 共有忘れ |
| `not found while reading the database (...)` | 404。configured id が database id でも data source id でもない、または共有忘れ |
| `not found while reading the data source (...)` | 404。data source としても解決しない。id の誤り or 共有忘れ |
| `database has N data sources; the portfolio must be exactly one` | 複数 data source。**owner の判断が要る**（どの source が portfolio か） |
| `database has no data source (...)` | 2025-09-03 未満の形。共有を確認 |
| `sync failed: request timed out` / `network request failed` | 一次障害。exit 3、何も書かない |
| `refused page=… <code> at=… expected=…` | 本文の形。ADR-0018 §2.3 の語彙に直す |
| `refused … missing_property at=property <Name>` | data source に §3 の property が無い。**property 名が違う**のが典型（下記） |
| `sync aborted: N page(s) could not be mapped (M finding(s))` | 1 ページが複数の property で落ちうるので、ページ数と指摘数を分けて出す |
| `unavailable records=N reason=source_error` | 429 / 5xx。**最後の既知内容を保持したまま** `availability: unavailable` を記録した |
| `refusing to write the snapshot: it contains a token value` | 防御機構。**commit しないで**、何が起きたか報告する |

## 8. やってはいけないこと

- token の値を echo / printenv / log / Issue / PR / commit のどこにも出さない。
- `wrangler*.jsonc#secrets.required` に `NOTION_TOKEN` を足さない。
- `.github/workflows/` に portfolio の取り込みを実行する workflow を作らない。
- `quality/integration-scope.json#allowlist.entries` を agent が書かない
  （owner の記録である）。
- `snapshot.json` を手で編集しない。気づかないうちに契約から外れ、reader が
  `null` を返して**CMS 分が丸ごと非公開になる**（fail-closed なので静かに起きる）。

## 9. 未決事項（owner）

1. `quality/integration-scope.json#allowlist.entries` へのエントリ追加
   （形式案: `docs/migration/notion-cms-integration-scope-draft.md` §4）。
2. ledger の notion 行 `grant` は `public_integration_oauth_token` だが、本実装は
   **internal connection token** を使う。`token_retention.refresh` の
   「Notion issues no refresh token」も vendor 文書（2026-11-01 確認）と食い違う
   （OAuth は `refresh_token` を返す）。ledger は owner 専管のため agent は編集
   していない。→ `docs/migration/notion-cms-integration-scope-draft.md` §5。
3. integration token の実体（database id、発行日）。値は Issue に書かない。
