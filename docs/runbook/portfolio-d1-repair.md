# portfolio D1 修復（条件付き・#1008）

`scripts/repair-portfolio-d1.mjs` は、portfolio の D1 ストレージ契約
（#78 受入契約）に対する**条件付き修復ツール**である。

## 前提: 修復が必要かどうか

2026-11 時点の監査（#1008）では、本番 D1 の public+published 60 行の
ギャップは **Notion 側の authoring 欠落**であり、ストレージ破損ではないと
結論づけられた:

- `role` 空は #813 で合法な状態
- media / links の空は CMS merge（ADR-0018/0019）が補えない content 欠落
- `verify-portfolio.mjs` は STORAGE 契約と PUBLIC 契約を分離して報告する

**現時点で本番修復は不要。** このスクリプトは、将来の
`verify-portfolio --target=production` が STORAGE 契約違反を報告し、
かつ決定的な修正が存在する場合のための contingency である。

## 対象となる違反（安全な修正があるものだけ）

| 違反 | 内容 | 修正 |
|---|---|---|
| `facet-derived-role` | facet 由来ラベルが `role` に混入 | `role = ''`（「role 未記録」の正規 encoding） |
| `facets-not-json` / `facets-unknown-values` | facets が JSON 配列でない/未知値 | 有効部分集合へ書き換え（捏造しない） |
| `duplicate-cover-media` | `is_cover=1` が複数 | `display_order` 最小を残し他を 0 |

以下は **manualFindings** として報告のみ（SQL を生成しない）:
空 title/summary、壊れた link、不正 media key、slug grammar、
および**合法な空状態**（role/media/links の空）。

## 手順

### 1. 検出（dry-run、読み取りのみ）

```sh
node scripts/verify-portfolio.mjs --target=production   # まず契約違反を確認
node scripts/repair-portfolio-d1.mjs --target=production
```

出力: `repair-report.json` / `repair-report.md`（`--out-dir`、既定 `.tmp/portfolio-d1-repair/`）。
違反 0 件なら終了コード 0 で何もする必要はない。

### 2. diff レビュー

レポートの per-row diff を確認する。`manualFindings` が残る場合は
owner 判断が必要（このスクリプトでは直せない）。

### 3. スナップショット + apply（要 operator 権限と明示承認）

本番 D1 への書き込みは **operator credential（`CLOUDFLARE_D1_API_TOKEN`）
と owner の明示承認が必須**。`--apply` は `--execute` なしでは動かない:

```sh
node scripts/repair-portfolio-d1.mjs --target=production --apply --execute
```

- 実行前に触れる全行のスナップショットを JSON で保存
- forward batch を `_d1.mjs#executeBatch`（他の mutation と同じ
  production write ゲート）経由で実行
- 実行後に検出を再実行して post-check

### 4. rollback

```sh
node scripts/repair-portfolio-d1.mjs --rollback=<snapshot.json>          # dry-run
node scripts/repair-portfolio-d1.mjs --rollback=<snapshot.json> --execute
```

補償 UPDATE（スナップショット時点の値へ戻す）を生成・実行する。
DELETE は一切生成しない。

### 5. 事後検証

```sh
node scripts/verify-portfolio.mjs --target=production
```

で STORAGE / PUBLIC 両契約を再確認する。

## ローカル検証（credential 不要）

```sh
node scripts/repair-portfolio-d1.mjs --target=local
node --test scripts/repair-portfolio-d1.test.mjs
```

テストは fixture 行で違反検出・diff 生成・rollback SQL を検証する
（合法な空状態が違反にならないことを含む）。
