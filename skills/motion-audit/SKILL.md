---
name: motion-audit
description: >
  既存 Web / mobile UI を read-only で調査し、motion が不足・過剰・不整合になっている箇所を特定するときに使用する。
  motion を増やすこと自体を目的にせず、frequency / purpose / interference / spatial continuity の gate を通過した高確度の候補だけを報告する。
---

# Motion Audit

既存 UI の motion opportunity と motion debt を探す read-only Skill。
source code を変更しない。実装は `motion-implement`、既存実装の批評は `motion-review` を使う。

## Workflow

1. current project の既存 motion primitives、tokens、libraries、主要 interaction を調査する。
2. rendered UI を操作し、state change、enter / exit、gesture、feedback、navigation を観察する。
3. 候補ごとに Motion Gate を通す。
4. surviving candidates だけを priority 順に報告する。
5. motion を追加しない方が良い箇所も必要なら明示する。

## Motion Gate

候補ごとに次を順番に確認する。

### 1. Frequency

その interaction を user がどの程度繰り返すか。

- high-frequency な direct manipulation / navigation は motion を短くするか省略する
- occasional な state transition は continuity のための motion を検討できる
- rare / expressive な moment は brand expression の余地が大きい

固定 threshold を普遍ルールにしない。product context と実際の reference を優先する。

### 2. Purpose

motion が担う役割を一つ以上明示できること。

- Feedback
- Continuity
- Orientation
- Attention
- Progress
- Expression / Delight

説明できない motion は候補から落とす。

### 3. Interference

motion が操作・読解・比較を遅らせないか確認する。

- text / data を読む最中に decorative movement を加えない
- direct manipulation に追従遅延を作らない
- repeated actions を animation queue で詰まらせない

### 4. Spatial continuity

motion の direction / origin / exit と、source / destination / navigation hierarchy が UI の空間モデルと一致するか確認する。
route / pane transition では6条件を明示的に確認し、source / destination / navigation hierarchy を説明できない movement は候補から落とす。

## Where to inspect

- state が瞬間移動する conditional render
- menu / popover / drawer と trigger の空間関係
- list add / remove / reorder
- accordion / collapse
- route / pane transition
- drag / swipe の開始・中断・復帰
- async completion / success / error acknowledgement
- hover / press / focus feedback
- loading / progress
- expressive hero / scroll motion

## Report format

各 candidate について最低限:

- location
- current behavior
- purpose
- frequency
- observed problem
- suggested motion relationship
- relevant existing token / primitive / reference

候補数を埋めるために弱い提案を追加しない。
何も通過しない場合は「追加すべき motion は見つからない」を正常な結果として返す。

## Avoid

- すべての card に hover transform を足す
- すべての section を fade-up させる
- reference を見ずに generic animation preset を当てる
- source code を変更する
- arbitrary な duration / easing を universal rule として断定する

## Verify

報告前に、surviving candidate が実際の rendered interaction と矛盾していないことを再確認する。
