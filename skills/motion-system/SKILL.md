---
name: motion-system
description: >
  Web / mobile UI の motion / animation を設計・実装・改善するときに使用する。
  Marketing / Expressive、Product UI / Feedback、Navigation / Gesture を分類し、
  実在する production reference と platform guidance を browser で観察して motion rules を抽出し、
  current project に翻訳して performance / accessibility を含む visual verification まで行う。
---

# Motion System

非自明な animation を記憶上の「気持ちいい easing」や generic preset だけから追加しない。

**Inspect → Extract → Translate → Implement → Verify** を順に実行する。

この Skill は motion domain の canonical policy。focused operation が必要な場合は以下を使う。

- `motion-audit` — read-only で opportunity / debt を探す
- `motion-implement` — concrete motion を実装する
- `motion-review` — read-only で既存 motion を批評する

共通語彙は `references/vocabulary.md` を参照する。

目的は animation を増やすことではない。
状態変化、因果関係、空間的 continuity、feedback、attention、brand expression のうち何を motion が担うべきかを判断し、必要な箇所だけを coherent な system として実装する。

## 1. Existing project first

外部 reference を見る前に current project の既存 motion system を短く調査する。

確認対象:

- existing transitions / keyframes
- animation utilities / libraries
- design tokens
- component state transitions
- route / page transitions
- loading states
- gesture handling
- scroll effects
- `prefers-reduced-motion` handling
- platform-specific motion conventions

最初に見つけた animation を project convention と断定しない。
同じ責務を持つ複数箇所を確認する。

既存 implementation が inconsistent な場合は、その不整合自体を evidence として扱い、無条件に踏襲しない。

## 2. Decide whether motion is needed

animation を実装する前に Motion Gate を通す。
motion を追加しないことも正常な成功結果として扱う。

### Motion Gate

#### Frequency

interaction frequency と perceived latency の関係を見る。

- high-frequency な direct manipulation / navigation は短くするか省略する
- occasional な state transition は continuity のための motion を検討できる
- rare / expressive な moment は brand expression の余地が大きい

固定 threshold を universal rule としない。current product と production reference を優先する。

#### Purpose

その motion の役割を一つ以上特定する。

### Feedback

user action に対する即時反応を示す。

例:

- pressed / selected
- toggle
- save acknowledgement
- drag response
- success / error

### Continuity

状態変化の前後が同じ object / region であることを理解させる。

例:

- accordion expansion
- list reorder
- card → detail
- pane resize
- layout change

### Orientation

user が UI 内でどこからどこへ移動したかを理解させる。

例:

- page transition
- push / pop
- modal / drawer enter-exit
- shared element transition

### Attention

重要な変化へ視線を誘導する。

例:

- new item
- updated metric
- validation failure
- onboarding cue

### Progress

処理中・進行中・完了を伝える。

例:

- loading
- progress
- upload
- optimistic transition

### Delight / Expression

product personality や visual narrative を強化する。

例:

- hero motion
- ambient background
- kinetic typography
- cursor interaction
- illustrative transition

役割を説明できない motion は原則追加しない。
Decoration-only motion は Marketing / Expressive surface でも page hierarchy を阻害しないことを確認する。

#### Interference

motion が操作・読解・比較を遅らせないか確認する。

- direct manipulation に追従遅延を作らない
- repeated action を animation queue で詰まらせない
- data / text を読む場面で decorative movement を優先しない

#### Spatial continuity

direction / origin / exit が UI の空間モデルと一致するか確認する。
source / destination / navigation hierarchy を説明できない movement は再検討する。

## 3. Classify the surface

最も近い family を選ぶ。

### Marketing / Expressive

対象:

- landing page
- portfolio
- product introduction
- campaign / editorial site
- hero / showcase
- scroll storytelling

読む:
`references/marketing.md`

### Product UI / Feedback

対象:

- application UI
- dashboard
- editor
- form
- menu / popover / dialog
- button / toggle / tabs
- loading / state acknowledgement

読む:
`references/product-ui.md`

### Navigation / Gesture / Spatial transition

対象:

- route transition
- shared element
- card → detail
- drag / reorder
- swipe / pull
- scroll-linked motion
- spatial continuity

読む:
`references/navigation-gesture.md`

### Performance / Accessibility

motion を追加・変更するすべての task で読む。

読む:
`references/performance-accessibility.md`

### Mixed surface

実際の product は複数 family を含めてよい。

例:

- portfolio hero → Marketing / Expressive
- project card hover → Product UI / Feedback
- project card → detail → Navigation / Gesture

route / interaction ごとに分類する。
一つの easing / duration を全 animation へ機械的に適用しない。

## 4. Inspect real references before coding

non-trivial motion work では relevant な production references を原則 2 つ以上確認する。

production interface が十分に観察できない場合は:

1. rendered production interface
2. interactive demo / example
3. browser-computed animation / DevTools
4. public source implementation
5. official design-system / platform guidance

の順で evidence を補う。

reference 名だけから「Linear風」「Apple風」「Framer風」と想像して実装しない。

### Browser inspection

可能なら motion を実際に発火させる。

最低限確認する:

- initial state
- trigger
- intermediate movement
- settled state
- repeated invocation
- interruption during animation
- rapid repeated input
- reduced-motion behavior
- desktop / touch-sized viewport

Marketing / scroll effect ではさらに:

- first load
- normal scroll
- fast scroll
- reverse scroll
- resize
- tab visibility change / return

を確認する。

静止 screenshot だけで motion を推測しない。

## 5. Extract motion rules

reference ごとに isolated duration 値ではなく motion relationship を抽出する。

### Trigger

何が animation を開始するか:

- click / tap
- hover / focus
- drag / swipe
- scroll position
- route change
- data change
- async completion
- time / ambient loop

### Property

何が変化するか:

- opacity
- translation
- scale
- rotation
- clip / mask
- color
- blur
- shape
- layout geometry
- camera / 3D transform

### Temporal structure

- delay
- duration
- easing
- spring behavior
- stagger
- overlap
- sequence
- hold
- exit speed

単一要素の duration より、複数要素の start / end relationship を重視する。

### Spatial structure

- direction
- travel distance
- transform origin
- source / destination relationship
- shared edge / anchor
- depth
- parent-child movement

### Continuity

状態 A → B で何を invariant として見せているかを確認する。

例:

- same object position
- same visual anchor
- same selected item
- same scroll context
- same direction of navigation

### Interruption

user が途中で:

- reverse
- cancel
- click another target
- scroll away
- resize

したとき、motion が破綻しないか確認する。

## 6. Motion taxonomy

implementation 前に対象を以下のいずれかへ分類する。

1. interaction feedback
2. state transition
3. enter / exit
4. layout transition
5. shared element / morph
6. navigation / page transition
7. gesture-driven motion
8. scroll-triggered / scroll-linked motion
9. progress / loading
10. content / data motion
11. ambient / expressive motion

複数カテゴリに跨る場合は、primary purpose を決めてから secondary effect を足す。

## 7. Translate, do not clone

reference の arbitrary values や signature effect をそのまま移植しない。

悪い例:

> Reference uses 700ms expo transition, therefore use the same transition everywhere.

良い例:

> Reference gives large scene changes more travel time while direct controls settle quickly. Preserve that hierarchy using current project density, interaction frequency, distance, and platform behavior.

current product の:

- information hierarchy
- interaction frequency
- brand
- content density
- input method
- platform conventions
- accessibility requirements

を優先する。

## 8. Derive a motion system

繰り返し現れる relationship は semantic token / primitive に昇格させる。

例:

```css
--motion-duration-instant
--motion-duration-short
--motion-duration-medium
--motion-duration-long
--motion-ease-enter
--motion-ease-exit
--motion-ease-move
--motion-distance-small
--motion-distance-medium
--motion-stagger
```

spring を使う場合も semantic role を先に定義する。

例:

```text
feedback-spring
layout-spring
expressive-spring
```

大量の component-local cubic-bezier / duration を増やさない。

ただし一度しか使わない hero choreography や illustrative sequence を無理に global token 化しない。

## 9. Implementation choice

project 既存の primitive / library を優先する。

新規 mechanism を導入する前に、対象 animation が何を必要とするかを判断する。

- simple state transition → CSS transition / animation を優先
- imperative or coordinated browser animation → Web Animations API を検討
- shared layout / gesture / spring / complex sequence → existing motion library を検討
- page / view transition → platform View Transition API も compatibility を確認して検討
- cinematic / scroll storytelling → dedicated timeline / scroll tooling を必要な範囲だけ検討

library の存在を animation の理由にしない。

`transition: all` のように意図していない property まで animation させない。

## 10. Performance gate

motion は visual quality と同時に runtime quality を満たす必要がある。

原則:

- `transform` / `opacity` で表現できる motion は優先する
- layout / paint を継続的に発生させる animation は理由を確認する
- scroll-linked effect で main thread work を増やしすぎない
- large blur / filter / shadow / mask / 3D scene は実機で測る
- offscreen / hidden state でも不要な loop を継続しない
- animation 中の layout shift / input blocking を確認する

性能問題が疑われる場合は DevTools / profiler / performance trace で確認する。
見た目が滑らかに感じるだけで合格としない。

## 11. Accessibility gate

すべての meaningful motion に対して reduced-motion behavior を定義する。

`prefers-reduced-motion` / platform equivalent が利用できる場合は尊重する。

reduced motion では単純に全 animation を `0ms` にすることを唯一の解としない。

役割を維持しながら必要に応じて:

- spatial movement → fade
- large zoom → subtle opacity / scale reduction
- parallax → static composition
- ambient loop → still state
- bounce → tighter spring
- long choreography → immediate settled state

へ変換する。

重要情報を animation のみで伝えない。

## 12. Input and responsive behavior

pointer hover を touch device の primary feedback にしない。

確認する:

- pointer
- keyboard focus
- touch
- coarse pointer
- small viewport
- orientation change

mobile では desktop motion を単純縮小しない。
画面距離、gesture expectation、content density、battery / GPU cost に応じて choreography を簡略化してよい。

## 13. Visual verification gate

compile / lint / unit test success だけでは完了ではない。

rendered motion を実際に確認する。

最低限:

- trigger と response の因果関係が明確か
- enter / exit の direction が矛盾していないか
- duration が interaction frequency に対して重すぎないか
- easing / spring が目的に合っているか
- transform origin が自然か
- sequence / stagger が hierarchy を伝えているか
- animation 中も input が破綻しないか
- rapid interaction で queue / snap / flicker が起きないか
- reduced-motion variant が成立しているか
- small viewport / touch でも成立しているか
- dropped frames / layout shift が目立たないか

可能なら reference と current implementation を同じ操作・viewport 条件で比較する。

## 14. Failure modes

以下を見つけたら motion system を再検討する。

- everything fades up on scroll
- every element has a hover transform
- all transitions use the same duration without role distinction
- motion delays direct manipulation
- exit animation is unnecessarily slow
- multiple unrelated elements move at once without hierarchy
- scroll animation fights native scrolling
- layout animation causes text / controls to jitter
- transform origin is arbitrary
- animation can only finish, not be interrupted
- reduced motion removes essential state feedback
- mobile receives desktop-only cursor / parallax assumptions
- performance fixes are attempted only after adding many effects

## 15. Autonomous decision policy

以下は project evidence と references から agent が自律的に決める。

- ordinary transition duration family
- routine easing choice
- enter / exit direction consistent with spatial model
- minor stagger
- standard pressed / hover feedback
- reduced-motion substitution
- CSS vs existing project motion primitive

user に戻すのは product semantics や brand direction が変わる decision に限定する。

例:

- page navigation model 自体を変える
- major scroll storytelling を導入する
- brand identity の中心となる signature motion を新設する
- interaction order / information priority を motion のために変える

routine animation parameter を「何msがいいですか？」と user に投げない。

## 16. Report

reference research の長いレポートは要求されない限り不要。

必要なら簡潔に:

- selected motion family
- inspected references
- extracted motion rule
- reduced-motion behavior
- performance-sensitive choices
- intentional deviations

だけを示す。

最終成果は animation の数ではなく、cause-and-effect、continuity、responsiveness、comfort、rendered quality で評価する。
