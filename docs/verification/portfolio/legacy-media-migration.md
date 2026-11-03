# 旧サイト メディア移行の検証記録 (Issue #850)

> `scripts/migrate-legacy-media.mjs` が旧 SQLite の `media` BLOB を R2 へ
> 移し `portfolio_media` 行を生成する行為の、実測値に基づく検証記録。
> 検証画像: `docs/verification/portfolio/legacy-media-migration.webp`。
> 手順そのもの: [`docs/runbook/legacy-media-migration.md`](../../runbook/legacy-media-migration.md)。

**この記録が扱う範囲は local 環境だけである。** production の D1 / R2 への
書き込みは行っていない（§6）。

---

## 1. 移行対象の実測（`.reference/my-web-2025`）

| 項目 | 実測値 |
| --- | --- |
| 旧 DB | 151 個 |
| `media` 行 | 297 行 |
| 合計 byte | 114,953,553 |
| 異なる sha256 | 124 |
| `content_id` の無い行 | 25 行（DB が単一 content のため 25 行とも帰属できた） |
| MIME 構成 | PNG 258 / JPEG 33 / GIF 3 / WebP 2 / SVG 1 |

`content_id` が `NULL` の行は推測で割り当てず、**その行を含む DB が
`contents` を 1 件だけ持つ**という構造から帰属先を決めた。解決できなかった
行（`project_unattributable`）は 0 行。

## 2. スコープの絞り込み（実測）

| 区分 | media 行 | byte | 扱い |
| --- | --- | --- | --- |
| `eligible` / `rewrite_required` の project | 131 | 110,818,324 | 移行対象 |
| `mechanical_drop` の project（`media-list-*` / `media-rt-*` / `test-otu-*` の test fixture） | 166 | 4,135,229 | `project_not_migrated` として skip |

skip 166 行は**すべて**旧 automatic test fixture である。`portfolio_project`
行が 1 件も作られないので、`portfolio_media` の外部キー制約（local D1 の
`PRAGMA foreign_keys` = 1、欠けた参照は `FOREIGN KEY constraint failed` で
拒否される），データ上も成立しない。

さらに 1 行が **配信不能 MIME**（`image/svg+xml` 1 件）で skip された。
`src/http/media/router.ts` が配信する MIME は png / jpeg / webp / gif / avif /
mp4 / webm だけで、svg は配信対象ではない。行を作ると**永久に壊れた画像**に
なるため、行を作らない。

## 3. 決定性と重複排除（実測）

| 実測項目 | 値 |
| --- | --- |
| アップロードした object 数 | 116 |
| 生成した `portfolio_media` 行数 | 130 |
| 同じ project 内の同一 sha256 | object 1 個 / 行 2 本 |
| project をまたぐ同一 sha256 | project ごとに object 1 個 |

行数（130）が object 数（116）より多いのは、**重複バイトを持つ旧 media 行を
1 本ずつ残した**からである。移行は事実を削除する権利を持たない
（runbook §6）。

project ごとに cover はちょうど 1 件（`is_cover = 1` の行は 23 件、
media を持つ project も 23 件）。

## 4. local D1 / R2 の実測（適用後）

```text
[legacy-media] applied          yes
[legacy-media] objects uploaded 116
[legacy-media] rows written      130
```

| 実測項目 | 値 |
| --- | --- |
| `portfolio_media` 行数 | 130 |
| 異なる `r2_key` | 116 |
| `is_cover = 1` の行 | 23 |
| media を持つ project | 23 |
| R2 object 数 | 116 |
| R2 byte 総計 | 97,132,761 |
| R2 の prefix | `portfolio/` のみ 116 |

**再実行は冪等**である。適用後に同じコマンドを再実行して、行数 130 /
key 116 / cover 23 は変わらない（同じ key に同じ byte、同じ行 id）。

## 5. 表示の確認（preview）

移行直後の project はすべて `visibility='draft'` なので `/portfolio/propose`
は 404 になる（= 公開面に出ていないことが正しい状態）。表示の検証だけ、
local D1 で 1 件 public に倒して行った。

| 実測項目 | 値 |
| --- | --- |
| `GET /portfolio/propose` | 200 |
| `GET /media/portfolio/propose/propose/media_…-vlcsnap-….png` | 200 / `image/png` / 1,640,389 byte |
| ページ内の `<img>` | `naturalWidth=1080` / `naturalHeight=1920`（**デコード済み**） |
| 参照先 | `/media/portfolio/propose/propose/media_…png`（Worker の media route） |
| build 済み出力（`vite preview`）でも同じ media key | 200 / `image/png` / 1,640,389 byte |

`<img>` の `naturalWidth` / `naturalHeight` が 0 でないことは、**配信された
バイトが実際に画像として読めた**ことを示す。壊れた画像や placeholder では
ない。検証画像（WebP）は `docs/verification/portfolio/legacy-media-migration.webp`。

**`visibility` を draft に戻すと、同じ media key は 404 になる。**
`src/http/media/router.ts` は `isApprovedMediaKey`（project の公開状態を
D1 で確認する）を通った object だけを返すためで、**移行したバイトが
draft のまま公開面に出ることはない**。これは「移行が公開を
勝手にしない」ことの実測でもある。

検証の後、public への倒しは `draft` に戻した。

## 6. production への書き込みが無いこと

```text
$ node scripts/migrate-legacy-media.mjs --apply --target=production
[legacy-media] refusing a production apply: --execute is required. …
exit=2
```

production の apply は `--execute` が無ければ**書き込み前に**拒否される
（exit 2、stderr に理由のみ）。`--dry-run --target=production` は credential
無しで計画だけを出力する。**production の D1 / R2 への書き込みは 1 件も行って
いない。**

## 7. 単体テスト

`scripts/migrate-legacy-media.test.mjs`（42 tests / 12 suites, `node --test`）
が次を固定する。

- 既定が dry run であること、`--apply` / `--execute` が別々の明示であること
- target の正規化（`remote` alias → `production`）
- slug / project id / safe filename / row id / key の決定性
- slug 規則が本文移行（`migrate-portfolio-from-2025.mjs`）と一致していること
  （二つの実装は import できないため、ソースの置換列を比較して固定する）
- alt の fallback 順（alt → description → ファイル名）と alt 無し skip
- 配信不能・欠損 MIME の fail closed
- 同一 project 内の sha256 重複が object 1 個而行は行数分であること
- project をまたぐ重複が別 object になること
- cover が project ごとに 1 件であること
- skip の内訳（`project_not_migrated` / `content_type_not_deliverable` /
  `alt_unavailable` / `project_unattributable` / `key_not_publishable`）
- 配信可能 type のリストが Worker の media route と一致していること
  （router のソースを読んで比較する parity テスト。ずれると失敗する）
- 公開 prefix の SoT（`src/cloudflare/media-visibility.ts`）をスクリプトが
  そのまま使い、`portfolio/` が公開 prefix でなくなった時に書かなくなること
- SQL の escape と、cover リセット → upsert の順序
- レポートがバイト・row 本文・key を含まないこと

## 8. production の現状（2026-11-04 時点・未適用）

この節は **local 検証とは別の事実**を記録する。production は移行済みではない。

| 項目 | production の実測 | local（本記録） |
| --- | --- | --- |
| `portfolio_project` 行 | 3 | 60 |
| `portfolio_media` 行 | 3 | 130 |
| `portfolio_link` 行 | 8 | （本文移行分） |
| R2 `portfolio/` object | 未移行 | 116 |
| 本文移行（`migrate-portfolio-from-2025.mjs --apply --target=remote`） | 未適用 | 適用済み |
| メディア移行（`--apply --target=production --execute`） | 未実行 | 適用済み |

読み取りは `cf` の current credential で行った（status-only、書き込み 0 件）。
**production の書き込みは 1 件も行っていない。**

未実行の理由は 3 つあり、どれも agent の権限では解消できない。

1. `CLOUDFLARE_R2_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が Infisical の
   `dev` / `prod` のどちらにも無い。`scripts/_r2.mjs` は production の
   mutation にこの 2 つを必須とし、無ければ書き込み前に throw する。
2. 本文移行が production に適用されていない（project 行 3 件）。メディア移行は
   project 行を FK で要求するため、本文移行が先に必要（runbook §4.2）。
3. R2 custom domain が有効な間、`portfolio/` への upload は**匿名取得可能な
   公開と同じ結果**になる（runbook §11.1）。実行は owner の判断と
   `--execute` の明示が前提。

したがって Issue #850 の受け入れ条件は **local について満たし、production に
ついては未達**である。実行手順は
[`docs/runbook/portfolio-publication.md`](../../runbook/portfolio-publication.md)
に、必要な credential と順序を含めて記載した。
