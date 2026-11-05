# Notion Portfolio の全件公開と実データ ingest — 2026-11-05

ADR-0018 §2.11 / Issue #765。2026-11-04 に本文とメディアを投入した 69 ページは
すべて `Status=Draft` / `Visibility=Draft` のまま残され、ingest は
`skipped_draft=69` を数えて 0 件を書いていた。本記録は、owner がその公開範囲を
決めた後に行った **公開操作と、その結果としての実データ ingest** の記録である。

**この記録は操作の記録であり、記事本文の編集上の承認ではない。**
各ページの文章が正しいかどうかは、この操作では判定していない。

## 1. owner の決定

2026-11-05、owner は「Notion の全ページを公開する」と決定した。ページ単位の
選別は行っていない。この決定が無い限り、エージェントは `Status` を
`Published` に変えない（公開範囲は owner の判断であり、Issue #765 の
完了条件そのものでもある）。

## 2. 実行前の preflight（読み取りのみ）

`Status` を `Published` にすると、mapper は Draft 用の早期 skip を通らず
**公開レコードの全検証**を受ける。1 ページでも落ちれば ingest は全体を中止する
（`sync-portfolio-notion.mjs` の失敗意味論）。そこで書き込み前に、
同じ transport / mapper を使って「公開した場合の検証」だけを先に回した。

| 段 | 結果 |
| --- | --- |
| ページ数 | 69 |
| 公開レコードとして妥当 | 68 |
| 妥当でない | 1（`Status` / `Visibility` の書き換え前の値で判定） |
| slug の重複 | 0 |

妥当でなかった 1 ページは `FlashBeatテーマ曲(BGM)`（page `40ed54e3…`）で、
`Role` / `PeriodStart` / `Facets` が空だった。値は作成せず、リポジトリ内の
旧サイト台帳から読んだ:

| property | 設定値 | 根拠 |
| --- | --- | --- |
| `PeriodStart` | `2025` | `docs/migration/portfolio-2025-to-2026-classification.json` の legacy id `FlashBeat-BGM` の `published_at` = 2025-07-28 |
| `Facets` | `other` | 同レコードに facet が無く、作曲した BGM は `develop` / `video` / `design` のいずれでもない |
| `Role` | `Composition` | 同レコードの `summary` が「自作音ゲーFlashBeatのテーマ曲 作曲しました」 |

`Facets` の `other` は、この 69 ページの中で唯一の使用例である。

## 3. 実行した書き込み

| 対象 | 操作 | 件数 |
| --- | --- | --- |
| `Status` | `Draft` → `Published` | 69 |
| `Visibility` | `Draft` → `Public` | 69 |
| `Role` / `PeriodStart` / `Facets` | 空 → §2 の値 | 1 |

書き込みは `PATCH /v1/pages/{id}` を 1 ページずつ、350 ms 間隔で行った。
実行結果は `pages=69 changed=69`。失敗 0。

## 4. ingest の結果

`node scripts/sync-portfolio-notion.mjs --r2-target=production`（書き込みあり）。

```
synced records=69 findings=0 skipped_draft=0 media=145
       media_bytes=116515573 media_skipped=1 would_upload=14
       upload_bytes=5129579 reused=131 digest=sha256:0d5e1ccd2eb7… written=true
```

| 項目 | 値 | 意味 |
| --- | --- | --- |
| `records=69` | 69 | 公開面に出るレコード数 |
| `findings=0` | 0 | 内容の拒否 0 件 |
| `media=145` | 145 | 解決した画像参照 |
| `reused=131` | 131 | 同じ SHA-256 の object が既に対象 bucket にあった（旧サイト移行 #850 と共通の content-addressed key） |
| `would_upload=14` / `upload_bytes=5129579` | 14 / 5,129,579 B | 新規に R2 へ置いた object |
| `media_skipped=1` | 1 | `media_content_type_refused`（allowlist 外の種類。バイトは取得していない） |

## 5. 結果としての snapshot

`src/portfolio/notion/generated/snapshot.json` が書き換わった。

| 項目 | 値 |
| --- | --- |
| `availability` | `public` |
| `records` | 69（全件 `status=published` / `visibility=public`） |
| `source.databaseId` | `6a148863-d397-417e-af26-83b628dcd982`（data source id） |
| `contentDigest` | `sha256:0d5e1ccd2eb7694a8b7cc8a…` |
| facet 分布 | `video` 38 / `develop` 23 / `design` 17 / `other` 1 |
| ファイルサイズ | 163,784 B |

**これまで committed snapshot は空の `unavailable` プレースホルダだった。**
その前提で書かれていたテスト（`src/portfolio/load.test.ts` /
`load.query-budget.test.ts` の D1 単独ケース、`notion/contract.test.ts` の
「database 未接続なら 0 件」）は、D1 だけを見る意図を明示する
（`cmsProjects: []`）か、公開境界の検証に置き換えた。**公開境界は変えていない**:
`published` + `public` 以外の record は今も公開面に出ない。

## 6. この記録が主張しないこと

- **個々のページの文章が正しいこと**は主張しない。公開の可否は owner が決めた。
- **本番で画像が配られること**は、この時点では主張しない。R2 への投入と
  本番 deploy は別の事象で、deploy 後に `/media/portfolio/notion/<key>` を
  実測する必要がある。
- **skip した 1 件の画像が不要であること**は主張しない。content-type の
  allowlist による refuse であり、内容の判断ではない。

## 7. 再現手順

```sh
# 1. 公開状態の確認（値は出さない）
infisical run --env=dev --path=/ -- node .tmp/notion-preflight.mjs

# 2. ingest（NOTION_TOKEN は dev、R2 の credential は prod）
infisical run --env=dev --path=/ -- node .tmp/run-notion-ingest.mjs

# 3. snapshot の検証
npx vitest run src/portfolio
```

`.tmp/` の 3 スクリプトは一時 artefact（gitignore 対象）で、運用手順は
`docs/runbook/notion-portfolio-sync.md` が正本である。
