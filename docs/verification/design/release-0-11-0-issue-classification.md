# v0.11.0 デザイン系 Issue 分類記録（2026-11-20）

> release-0-11-0 の RC 収束にあたり、#764 / #887 / #930 / #928 の
> 実装状態・証拠・未決事項を一箇所に分類した記録。個別 Issue の
> コメントが一次証拠であり、本書はその索引と判定の整理である。
> owner 未承認の項目を承認済みとして扱わない。

## 判定基準

- **direction B**: #887 の semantic-token 再設計（mono.* アンカー、
  status hue 撤去）が承認・実装済みの visual language。
- **v0.10.0 HOME 色面**: #968 で owner 追加受入された「アクセント色の
  平面色面」（`accent.field.*` フィールドパネル、PR #1039）。
- 両者は矛盾しないことが PR #1093 の再測定で実測確認済み
  （最大彩色面積 3.2354% < 5% 上限、`docs/verification/design/887-current-recheck.md`）。

## #887 — デザイントークン再設計

**分類: 実装済み・証拠十分（close 判断は owner レビュー待ち）**

| AC | 判定 | 証拠 |
| --- | --- | --- |
| semantic tokens mono.* 再アンカー | PASS | `src/editorial/semantic-tokens.ts`、`docs/verification/design/` |
| status hue（緑/赤/橙）なし | PASS | src 全体 grep 0 件、StateMark は形状+語+借用色 |
| CTA/focus/選択が墨 | PASS | `bg.accent`/`text.accent`/`border.focus` = ink 系 |
| 彩色面積 5% 以下を実測 | PASS | PR #1093 `887-current/` 16 capture、最大 3.24%（`/` 390px light） |
| `a11y:contrast:check` | PASS | no violations（2026-11-20 実行） |
| light/dark/390px 証跡 | PASS | 現行 SHA の 16 capture |

未解決の環境依存注記: preview harness の `/media/<key>` 描画未検証は
#903 の領域で本 Issue の AC 外。

## #930 — Home guide / アクセシビリティ

**分類: 実装済み・証拠ほぼ十分。残件は owner 判断 2 件**

- 機能・契約テスト: ほぼ充足（`docs/verification/home/930-guide-ac.md`）
- 残件:
  1. **下位展開の深さ** — children が実質自己参照のみ。情報設計の
     owner 判断事項（実装不足ではなく IA 判断）
  2. **スクリーンリーダー実機記録** — デバイス検証の証跡なし

## #764 — IA / 情報設計 direction

**分類: 部分 supersede 済み・残件は owner 判断**

- 最終コメント（2026-11-03「direction 未決定」）は direction B 確定
  （2026-11-04）より前の記述であり、時系列上 stale。
- カラー/トークンスコープは #887 系で実行済み。
- 残件: IA proposal の未消化フェーズと、#764 自体を #887/#968 系に
  supersede するかの owner 判断。エージェント側では close しない。

## #928 — HOME Epic 最終受入

**分類: 実装・個別証拠あり。最終受入は RC QA で実施**

- 全受入 bullet に実装証拠のマッピング済み（Issue コメント参照）。
- 残件: HOME 全体の実機・視覚検証（desktop/mobile × light/dark、
  a11y、reduced-motion、公開データ境界）— `928-home-acceptance`
  ブランチで検証記録を作成中。copy approval / roster 値 / 下位展開は
  owner 判断、本番 ops 接続はデプロイ後工程。

## copy approval pending（owner 未承認のまま）

v0.11.0 関連の pending レコード（`quality/copy-editorial-approvals.json`）:
`issue-382` `issue-383` `issue-390` `510-parity-check` `issue-352`
`352-activity-route` `334-event-links` `issue-518`。
`copy:approval:check --allow-unreviewed` で warning として可視化。
owner 確認前に approved へ変更しない。
