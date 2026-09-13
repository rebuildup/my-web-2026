---
name: motion-implement
description: >
  既存 project に具体的な motion / animation を実装するときに使用する。
  motion の必要性を gate し、current project と production references を優先して、tool / property / timing / interruption / reduced-motion を順に決定して実装する。
---

# Motion Implement

motion を実装する focused Skill。
domain policy は `motion-system` と同じ思想を持つが、この Skill の成果物は implementation である。

## Build sequence

順番を変えない。

### 1. Decide whether motion is needed

最初に Motion Gate を通す。

- Frequency
- Purpose
- Interference
- Spatial continuity

不要なら animation を書かないことを成功として扱い、instant state change 等の代替を選ぶ。

### 2. Inspect current project

確認する:

- existing motion tokens
- CSS transitions / keyframes
- motion libraries
- component primitives
- reduced-motion handling
- similar interactions

parallel な motion system を増やさない。

### 3. Inspect references

non-trivial motion は relevant な production reference / official platform guidance を観察する。

見るもの:

- trigger
- initial / settled state
- direction / origin
- relative timing
- interruption
- rapid repeated input
- exit behavior
- reduced-motion behavior

specific creator / product の signature effect や exact values をそのまま複製しない。

### 4. Pick the cheapest suitable mechanism

一般に:

- simple state feedback → CSS transition
- deterministic enter / sequence → CSS animation / starting style
- imperative browser control → WAAPI
- gesture / spring / shared layout → existing motion library
- route transition → platform primitive / View Transition API を検討

library の存在を motion の理由にしない。

### 5. Pick properties and relationships

property と direction を選ぶ前に Spatial continuity を確認する。

- direction
- origin
- exit
- source
- destination
- navigation hierarchy

route / pane transition では6条件を明示的に確認し、UI の空間モデルと一致しない movement は再検討する。

isolated magic number より relationship を優先する。

- transform / opacity で表現可能なら優先
- transform origin を trigger / spatial source と整合させる
- enter / exit direction を continuity と一致させる
- repeated actions は interruptible にする
- layout geometry animation は必要性と runtime cost を確認する

### 6. Timing

project tokens と reference hierarchy を優先する。

- frequent feedback は短く
- large scene change は必要なら長く
- exit は user を待たせない
- stagger は hierarchy を示す場合だけ使う

固定 duration や easing を universal default として持ち込まない。

### 7. Interruption

確認する:

- reverse
- cancel
- repeated click / tap
- target switch
- scroll away
- resize

animation 完了を待たないと UI が操作不能になる設計を避ける。

### 8. Reduced motion and input variants

meaningful motion には reduced-motion variant を定義する。

必要に応じて:

- large movement → fade / reduced distance
- parallax → static
- ambient loop → still
- bounce → tighter response

hover は touch primary feedback にしない。

### 9. Verify rendered motion

最低限:

- cause and effect
- direction / origin
- perceived latency
- interruption
- rapid input
- reduced motion
- touch / keyboard
- small viewport
- dropped frames / layout shift

compile success だけで完了しない。

## Output

実装を行い、必要なら簡潔に:

- gate result
- selected mechanism
- extracted relationship
- reduced-motion behavior
- verification result

を示す。
