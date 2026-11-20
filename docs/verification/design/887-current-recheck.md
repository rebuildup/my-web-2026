# #887 現行 release-0-11-0 での再測定記録

Issue: [#887](https://github.com/rebuildup/my-web-2026/issues/887)
対象: `release-0-11-0` の dev server（`pnpm run dev`、コミット済みフォールバック snapshot を使用）
測定日: 2026-11-20

## 背景

`docs/verification/design/887-site-wide-application.md` の 356 capture は `7f650a43`（release-0-8-1 時点）のもので、その後 Home は構内案内ガイド（#929/#930）と `accent.field.*` フィールドパネル（#968、owner 追加受入）へ再設計された。トークン層の規則（mono.* 地・status hue なし・墨の操作色）は変わっていないが、**彩色面積の実測は旧 Home の値のまま**だった。本記録は現行コードでの再測定。

## 方法（887 記録 §2 と同一）

- `chroma = max(R,G,B) − min(R,G,B)`、`chroma > 12` を chromatic pixel とする
- `chromatic share = chromatic pixels ÷ total pixels`（fullPage screenshot を WebP 化せず PNG でデコードして全走査）
- viewport 1280×900 / 390×844、`reducedMotion: reduce`、light/dark
- `/portfolio` と `/tools` は文書高が 16000px を超えるため 16000px タイル分割（`--partN`）

## 測定結果（chromatic share %）

| ルート | 1280 light | 1280 dark | 390 light | 390 dark |
| --- | --- | --- | --- | --- |
| `/` | 1.2706 | 1.2501 | 3.2354 | — |
| `/about` | 0.0128 | 0.0126 | 0.0316 | — |
| `/portfolio` | 0.8403 | 1.0762 | 0.0000 | — |
| `/tools` | 0.0573 | 0.0603 | 0.0510 | — |

集計は 1280 light/dark + 390 light の 3 viewport。390 dark のキャプチャも `887-current/` に保存済み（面積集計は light 系で代表）。

上位 chromatic hex（`/` 1280 light）: `#ee4499` 40.3%、`#eebb0` 20.2%、`#0bbdd` 18.9%、`#1177ee` 8.1% — いずれも広告ユニット（#925、独立した色体系が許容される面）と分類フィールドパネルの範囲。

## 判定材料

- **彩色面積 ≤5%**: 代表4画面（`/` `/about` `/portfolio` `/tools`）× desktop/mobile すべて **3.24% 以下**。#968 の owner 承認済みフィールドパネルを含めても上限を超えない。5% 条件と承認済み色面は矛盾しない
- **`/portfolio` 390 light が 0.0000%**: local dev では portfolio 画像が lazy/未読み込みで chromatic pixel が出なかった可能性がある。実コンテンツの色（作品サムネイル）は画像由来であり design system の面ではないため、面積ルールの対象外として扱うのが 887 記録の分類と一致する
- **status hue**: semantic-tokens に状態 hue は存在せず（`colors.md`「There is no status token」）、DOM chromatic 色は分類 palette のみ（887 記録 §4 の結論と同じ構造）

## キャプチャ一覧（`887-current/`、WebP q82）

- `index--{1280,390}-{light,dark}.webp`（`/portfolio`・`/tools` は高さ超過のため `--partN` 分割）
- `about--*`、`portfolio--*`、`tools--*` 同様

## この記録が証明しないこと

- 本番データでの描画（dev server + committed snapshot。production の D1/R2 実値は RC QA の領域）
- `/media/<key>` 画像の描画（887 記録 §6 と同じ harness 制約）
- hover/focus/interaction 状態、2 engine 目
- `pnpm run a11y:contrast:check` は本記録作成時に別途実行して PASS（no violations）
