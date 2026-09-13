---
name: touch-interface
description: >
  Design touch and coarse-pointer interaction for reliable targets, gestures, direct manipulation,
  and mixed-input use without reducing touch support to mobile spacing.
---

# Touch Interface

Touch を単なる mobile styling として扱わない。

**Inspect → Extract → Translate → Implement → Verify** の順で、target acquisition、gesture、direct manipulation、cancellation、mixed input を設計する。

## When to use

- mobile / tablet / touch-enabled desktop の操作面を設計する
- compact control の effective hit target を見直す
- swipe / drag / pinch / long-press 等を導入する
- reorder / canvas / slider 等の direct manipulation を設計する
- touch と mouse / pen / keyboard が混在する product を扱う

責務境界:

- state semantics → `interaction-states`
- keyboard traversal → `keyboard-interface`
- layout reflow → `responsive-design`
- broad conformance audit → `accessibility-audit`
- motion timing → `motion-system`

## Workflow

1. current artifact と想定 input methods を確認する。
2. standard と target platform の reference を実際に開く。
3. target、gesture、feedback、cancellation、input coexistence を比較する。
4. reference 固有値をコピーせず current platform / task risk へ翻訳する。
5. platform-native behavior と既存 design system を優先して実装する。
6. rendered artifact を実際の touch / pointer task flow で検証する。

## Observe

- visible bounds と effective hit target
- adjacent target の spacing と誤選択 risk
- operation frequency と error consequence
- standard gesture と custom gesture の役割
- gesture が唯一の実行経路になっていないか
- drag / direct manipulation 中の連続 feedback
- commit / cancellation / undo の境界
- system-reserved interaction との conflict
- touch / mouse / pen / keyboard 間の state continuity
- software keyboard や finger occlusion による active content の隠れ

## Decision rules

### Visual size と hit target を分離する

小さい icon をそのまま小さい target にしない。
visual density を維持できるなら hit area を広げる。
ただし隣接 hit area を曖昧に重ねない。

### 一つの universal target size を作らない

standard の minimum と platform の comfort guidance は別物として扱う。

- WCAG 2.2 は Web の minimum / spacing / exception model を与える
- Android / Apple / Windows は各 platform の input scale に応じた guidance を持つ

数値を平均したり、一つを repository-wide magic number にしたりしない。
current platform guidance、頻度、密度、error consequence を合わせて決める。

### Gesture-only を避ける

multipoint / path-based gesture や drag が essential でない場合、simple pointer で同じ task result に到達できる代替を用意する。

例:

- pinch zoom + zoom controls
- swipe action + visible action
- drag reorder + move action

### Standard gesture の意味を保つ

既知の tap / swipe / drag / hold 等を意外な意味へ再定義しない。
custom gesture は必要性があり、discoverable で、perform しやすく、important action の唯一の経路でない場合だけ採用する。

### Direct manipulation は途中経過を見せる

drag / resize / scrub 等では input movement と object response の関係を操作中から理解できるようにする。
valid zone や predicted result も必要に応じて操作中に示す。

### Accidental input を取り消せるようにする

single-pointer action を press 開始だけで不可逆に確定しない。
可能なら release 時の commit、target 外への離脱、undo など誤入力から回復できる構造を選ぶ。

### System interaction と競合しない

edge navigation や OS gesture 等と custom gesture を競合させない。
platform-specific gesture を追加する前に current guidance を確認する。

### Input modality を排他的に決めない

2-in-1 device や tablet + keyboard / trackpad を前提にする。
入力方法を切り替えても selection、focus、expanded state、scroll position 等が破綻しないようにする。

### Software keyboard でも task context を維持する

keyboard 表示後も active field、validation、必要な action が見えることを確認する。
単なる viewport breakpoint ではなく現在の task の継続性として扱う。

## Avoid

- visible icon size = hit target size と決めつける
- WCAG minimum を ideal comfort size として扱う
- platform values を一つの universal value に平準化する
- swipe / drag / pinch / long-press だけで重要操作を成立させる
- hidden custom gesture を必須にする
- direct manipulation の途中 feedback を省く
- device category から input method を一つに決め打ちする
- touch 対応のためだけに information density を無条件に下げる
- framework event API を design rule にする

## References

[`references/touch.md`](./references/touch.md) を読む。

少なくとも standard と target platform guidance を比較し、一つの reference の数値だけから決めない。

## Verify

### Targeting

- compact / adjacent controls を実際に押し分けられる
- expanded hit area が隣接 target と競合しない
- frequent / consequential action の誤操作 risk が許容できる

### Gesture

- non-essential multipoint / path / drag action に alternative がある
- custom gesture の存在と結果を理解できる
- platform / system interaction と衝突しない
- cancel または undo が可能である

### Direct manipulation

- manipulation 中に対象と input の因果関係が見える
- valid / invalid outcome が必要な時点で分かる
- repeated / fast operation で stale state が残らない

### Mixed input / environment

- touch → keyboard / pointer、pointer → touch を切り替えて task が継続する
- software keyboard 表示中も active content が操作可能である
- orientation / posture change 後も interaction meaning が維持される
- zoom / text enlargement 後も adjacent targets が衝突しない

build success や static screenshot だけで完了扱いにしない。
