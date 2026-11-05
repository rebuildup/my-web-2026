# 旧サイト移植作品 60 件の本番公開 — 検証記録（Issue #811）

- 日付: 2026-11-05
- 対象: production D1（`my-web-2026`）/ production R2 `MEDIA`
- 手順: [`docs/runbook/portfolio-publication.md`](../../runbook/portfolio-publication.md)
- 決定: [`docs/domain/portfolio-migration-decisions.md`](../../domain/portfolio-migration-decisions.md)
- local 側の実測（先に完了している記録）:
  [`portfolio-publication.md`](portfolio-publication.md) /
  [`legacy-media-migration.md`](legacy-media-migration.md)

## 0. この記録が名乗ること・名乗らないこと

**名乗ること**: 2026-11-05 14:22–14:50 JST に production を**読み取り専用で実測した**
結果。D1 の行数、R2 の key 集合、公開 URL の配信結果、要約ルールの判定。

**名乗らないこと**:

1. **本記録の作成者は移行を実行していない。** 適用は 2026-11-05 14:10 JST に
   workflow tree（`my-web-2026`）で実行され、移行台帳
   `docs/migration/portfolio-2025-to-2026-publication.json` の `generatedAt` が
   `2026-11-05T05:10:18.507Z` に更新されていた。**実行主体は
   `ownerConfirmation: "unconfirmed"`** である（AGENTS.md §6）。本記録は
   適用後の状態を事後検証したものであり、適用の承認を代行しない。
2. **権利レビューの完了ではない。** 60 件は `evidence_status='unreviewed'` の
   まま公開されている（ADR-0019: 権利レビューは公開の前提ではない）。
3. **公開面の未レビュー表示は、まだ満たされていない**（§6）。

## 1. 適用前の状態（13:43 JST の実測）

| 項目 | 値 |
| --- | --- |
| `portfolio_project` | 3 |
| `portfolio_media` | 3 |
| `portfolio_link` | 8 |
| R2 `portfolio/` prefix | 3 object |

runbook が記録していた「production は project 3 / media 3 / link 8 のまま」と一致した。

## 2. 資格情報の疎通（値を出さない検証）

| probe | `CLOUDFLARE_R2_API_TOKEN` |
| --- | --- |
| 13:44（修正前の登録値） | `GET /user/tokens/verify` → **401 `1000: Invalid API Token`** |
| 14:22（再登録後） | `GET /user/tokens/verify` → **200 `success: true`** |
| 14:22 | `GET /accounts/<id>/r2/buckets` → **200** |

13:44 の値は Cloudflare が token として認識していなかった
（`GET /client/v4/user` が `9109: Valid user-level authentication not found` を返し、
対照の `CLOUDFLARE_D1_API_TOKEN` は同じ endpoint で `9109: Unauthorized to access
requested resource`＝認証は通るが権限が無い、を返した）。値そのものの再登録で解消した。

## 3. 適用後の実測（runbook §4 との突き合わせ）

`node scripts/d1.mjs query --target=production` と
`node scripts/verify-portfolio.mjs --target=production` の結果:

| 実測項目 | runbook 期待値 | 実測 | 判定 |
| --- | --- | --- | --- |
| `portfolio_project` の `legacy_%` | 60 | **60** | OK |
| そのうち `public` かつ `published` | 60 | **60** | OK |
| そのうち `evidence_status='unreviewed'` | 60 | **60** | OK |
| `status='archived'`（retire された行） | 0 行でもよい | **0** | OK |
| `portfolio_link` の `legacy_link_%` | 103 | **111** | 下記 |
| `portfolio_media` の `legacy_media_%` | 130 | **133** | 下記 |
| `portfolio_media` の `is_cover=1` | 23 | **25** | 下記 |
| D1 の `r2_key` が R2 に存在するか | 全件 | **133 / 133（欠損 0）** | OK |

差の内訳（実測で分離した）:

- link **111 = 103（移行分）+ 8（既存 seed 行）**。`legacy_link_%` のうち
  旧 seed 由来の id は 8 件。
- media **133 = 130（移行分）+ 3（既存 seed 行）**。既存 seed の 3 件は
  `aulymo-v01` / `aulymo-v02` / `multislicer`。
- cover **25 = 23（移行対象の project）+ 2**（`aulymo-v01` / `aulymo-v02`）。
  この 2 件は移行対象の media を持たず、既存 seed の 1 行だけを持ち、その行が
  cover である（`multislicer` の既存 seed 行は cover ではなく、cover は移行分の
  行が持つ）。
  別表現: **media を持つ project は 25、そのすべてがちょうど 1 件の cover を持つ**
  （`covers > 1` の project は 0 件）。

`verify-portfolio.mjs` は 8 検査のうち 7 が通過し、失敗したのは
「`role` が空」「link が 0 件」の 104 件である。これは旧サイトのデータが
`role=NULL`・リンク無しである事実に由来し、**#78 Path A の 3 候補向けの
厳格さ（全 project に role と link を要求）を 60 件の移行に適用した場合の
期待どおりの不一致**である。runbook §4 はこの 2 項目を完了条件にしていない。

## 4. 配信の実測（production origin）

```
GET /portfolio                        → 200（掲載 60 件）
GET /portfolio/<slug>   × 60          → 200 / 60 件、非 200 0 件
GET /media/<r2_key>     × 133         → 200 / 133 件、非 200 0 件
                                        Content-Type が D1 の記録と不一致 0 件
```

`Content-Type` の突き合わせは、D1 `portfolio_media.content_type` と配信時の
`content-type` を全 133 件で比較した（`image/jpeg` / `image/png` / `image/webp` /
`image/gif`）。

## 5. 要約ルール（owner 決定 D4 / 「加筆してはならない」）

```
$ node scripts/check-portfolio-summary.mjs --target=production
migrated rows: 60
checked: 60 / derivable verbatim: 60
rows with an added clause: 0
rows with a number the source does not carry: 0
rows this script could not decide: 0
```

## 6. R2 key-set 監査（read-only）

```
$ node scripts/check-r2-media-key-set.mjs --target=production
verdict=OK  keys_total=119  keys_inside_allowlist=119  keys_outside_allowlist=0
pages_walked=1  enumeration=complete  diff=none
```

119 = 116（移行分）+ 3（既存 seed 分）。allowlist（`PUBLIC_MEDIA_PREFIXES`）
の外に 1 件も無い。

**この実行は release step 9 の代用ではない。** release step 9 は release 時点の
head に対して実行する operator 手順であり、本節はその時点の状態確認である。

## 7. 未充足: 公開面の未レビュー表示

```
$ curl -s https://rebuildup.dev/api/v1/health
{"status":"ok","service":"my-web-2026","layer":"external-boundary","version":"0.8.0"}
```

本番で動いている Worker は **0.8.0** であり、`GET /portfolio/<slug>` に
`data-evidence-status="unreviewed"` は**出ていない**（実測: 属性 0 件）。

ADR-0019 は「未レビューの資産を公開する場合、公開面が未レビューであることを
表示する」を必須にしている。この表示は 0.8.1 で入った
`PortfolioEvidenceNotice` が担うため、**0.8.1 のデプロイまで、60 件は
未レビューであることが表示されずに公開されている**。

これは未達として記録する。コードの追加作業ではなく、リリース（PR #763 の
マージ → deploy）で解消する。

## 8. rollback（未実行・手順のみ）

runbook §5 の 3 段階がそのまま使える。適用前の 3 行 / 3 行 / 8 行の内容は
`my-web-2026` の workflow tree の `.tmp/prod-portfolio-backup/`（gitignored）に
取得済みである。ただし本記録は rollback を実行していないため、rollback の
検証記録ではない。

## 9. 関連

- [`docs/runbook/portfolio-publication.md`](../../runbook/portfolio-publication.md)
- [`docs/domain/portfolio-migration-decisions.md`](../../domain/portfolio-migration-decisions.md)
- [`docs/runbook/legacy-media-migration.md`](../../runbook/legacy-media-migration.md)
- ADR-0019（公開権限と未レビュー資産）
