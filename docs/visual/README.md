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
  supersede 記録は `src/editorial/layout-system.md` §3.4 にある
  （同ファイルが `brief.md` §4 の `2xl/3xl` を Issue #300 で上書きした記録）。
- `home-design-brief.md` という名前は移動後の便宜的なもので、原典内の
  自己参照（`src/home/brief.md`）は原文保存のため書き換えていない。

新しい視覚レビューを追加するときは、観測方法・非目標・証拠への参照を
先頭に書く（`flat-vs-depth-review.md` の形式に倣う）。
