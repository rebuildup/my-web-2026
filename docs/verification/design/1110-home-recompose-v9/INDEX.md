# HOME 再構成 v9 ビジュアルレビュー証跡（Issue #1110）

Epic #1104 / PR #1115 の視覚レビュー記録。`.tmp/` は PR から参照
できないため、レビュー対象の実画面と Gemini 指摘の原文をここに
固定する。追跡の単位は「指摘 → スクリーンショット → 実装修正 →
コミット」。

## 成果物

- `index--{desktop,mobile}-{light,dark}*.png` —
  `scripts/capture-design-matrix.mjs` による v9 撮影
  （desktop は 1 枚、mobile は縦長のため 2 分割）。
- `index--*.md` — 各画像に対する画像対応モデルのレビュー原文。
  `.err` は空（レビュー失敗なし）。

## 指摘 → 対応の対応表

| 指摘（出典） | 内容 | 対応 | コミット |
| --- | --- | --- | --- |
| desktop-light #1 / mobile-light #4 | 広告（Sponsor Ad / QR プロモ）がコンテンツを押し下げ、広告らしい面が一次情報と競合 | 広告を named inline slot に限定し sticky rail を廃止。セクションを 6→5 に再構成 | `03fc2ca7` |
| desktop-light #4 / mobile-light #5 | 補助メタデータの低コントラスト | tone の ink 再束縛をコンテンツ wrapper へ移し、inverse/field 面での ink-on-ink を修正。恒久ゲート化は `tone-contract.test.tsx` + `e2e/design-system-tones.spec.ts` | `03fc2ca7`, `328e1c6a` |
| mobile-light #5 | 「Development data source」等の技術的失敗状態・デバッグ要素の露出 | Discord presence / GitHub activity を disclosure に集約（狭幅）。実行時失敗状態の editorial 提示は継続課題 | `03fc2ca7` |
| 両レビュー共通 | 「stacking syndrome」— 全幅バンドの縦積みでスクロール過多 | NOW/Status の disclosure 化、Explore のサイトガイド+capabilities 統合で縦リズムを再設計。**未収束**: owner の現行レイアウト承認ではない | `03fc2ca7` |
| desktop-light #2 | Explore カードの proportun 不揃い・分類色とリンク先の非対応 | field.* tone を内容分類に一致させる契約を layout-system.md §4.3 に明文化。カード構造の統一は #1109 継続 | `328e1c6a` |
| mobile-light #3 | field 色面の高彩度が editorial トーンと不協和 | field は「分類の面」として契約化済み。彩度・面積の妥当性は再レビュー対象 | — |

## 未検証・残課題（正直な記録）

- 上記修正後の**再撮影・再レビューは未実施**。v9 画像は修正前の
  状態を記録したものであり、修正後の画面品質は未検証。
- Gemini 指摘のうち「広告の存在感」「垂直積み重ね」は構造的に
  改善したが、実画面での最終判断は画像対応モデルによる再レビュー
  が必要。
- `inverse` tone × `surface/subtle/inverse` Panel、`field.*` tone
  × `surface/subtle` Panel は ink が成立しないため契約上無効
  （layout-system.md §4.3）。トークン追加は ADR-0022 §3.3 で禁止。

## 再現方法

```sh
node scripts/capture-design-matrix.mjs   # preview build 起動後
```
