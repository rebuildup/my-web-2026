# docs/visual — 視覚デザインの記録

このディレクトリは視覚面のレビューと設計入力の記録を置く。現状の仕様正本は
コード（`src/editorial/**` の tokens / semantic-tokens / primitives と
`src/editorial/layout-system.md`）であり、ここの文書は正本ではない。

## ファイル

- `flat-vs-depth-review.md` — Issue #520 の visual review。
- `home-design-brief.md` — Issue #21 の Home 設計入力（原典）。**履歴資料**。
  Issue #843 / 判断 O-15 により、現状の仕様正本から外した。本文は移動時の
  原典のまま変更していない。現状仕様との差分はコードと `layout-system.md`
  が正本であり、この文書の記述を現状として読まないこと。
  `home-design-brief.md` という名前は移動後の便宜的なもので、原典内の
  自己参照（`src/home/brief.md`）は原文保存のため書き換えていない。

> **Issue #1105 / ADR-0022（2026-11-21）**: `src/editorial/layout-system.md`
> は composition contract として全面改訂された（旧 §3.4 の type-scale
> supersede 記録を含む旧条文番号は失効）。現行の正本は
> `docs/adr/ADR-0022-editorial-composition-contract.md` と改訂版
> `layout-system.md`、および `quality/ui-contract.json` /
> `docs/runbook/ui-visual-review.md`。本ディレクトリの過去記録が参照する
> 旧節番号・旧規則（4/8 spread 唯一グリッド、彩色面積 5% 上限等）は
> すべて履歴として読むこと。

新しい視覚レビューを追加するときは、観測方法・非目標・証拠への参照を
先頭に書く（`flat-vs-depth-review.md` の形式に倣う）。
