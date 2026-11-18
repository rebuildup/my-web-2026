# Navigation / Gesture / Spatial Transition References

Last reviewed: 2026-09-10

## Goal

Navigation / gesture motion では、単に画面を滑らかに切り替えるのではなく、user が「どこからどこへ移動したか」「同じ object がどう変化したか」を追える spatial model を観察する。

## Primary platform references

### MDN — View Transition API

Overview:
https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API

Using:
https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using

Japanese overview:
https://developer.mozilla.org/ja/docs/Web/API/View_Transition_API

Use for:

- same-document / cross-document transition の platform model
- shared element / old-new visual relationship
- transition lifecycle
- unsupported browser でも navigation 自体は成立する progressive enhancement
- active transition を skip / control する考え方

API を使えるから transition を追加するのではない。
まず navigation semantics と continuity requirement を決める。

### Apple Human Interface Guidelines — Motion

https://developer.apple.com/design/human-interface-guidelines/motion

Observe / extract:

- direct gesture と visual response の追従
- navigation direction と motion direction の consistency
- interruptibility
- large spatial movement を減らすべき状況

### Material Design 3 — Motion

https://m3.material.io/styles/motion/overview

Observe / extract:

- container transformation
- shared spatial relationship
- motion physics
- enter / exit choreography
- touch surface での transition hierarchy

## Interactive pattern references

### Motion Examples

Examples:
https://motion.dev/examples

Useful categories:

- Page transitions:
  https://motion.dev/examples?category=page-transitions
- Layout animations:
  https://motion.dev/examples?category=layout-animations
- Scroll:
  https://motion.dev/examples?category=scroll
- Navigation:
  https://motion.dev/examples?category=navigation
- Carousel:
  https://motion.dev/examples?category=carousel

Use for comparing multiple implementations of the same interaction family.

Observe:

- source and destination geometry
- whether the same object appears continuous
- velocity / spring after direct manipulation
- gesture threshold
- reverse / cancel behavior
- layout reflow during motion
- content clipping
- focus / interaction state after transition

### Codrops — Infinite Gallery / Flip Transition

https://tympanus.net/codrops/2026/07/30/building-an-infinite-gsap-scroll-gallery-with-parallax-and-flip-transitions/

Use for:

- gallery item → detail transition
- per-item parallax
- scroll + click transition coordination
- shared-geometry-like continuity

Observe the mechanism and lifecycle, not the exact visual effect。

### Codrops — Async Page Transitions

https://tympanus.net/codrops/2026/02/26/building-async-page-transitions-in-vanilla-javascript/

Use for:

- outgoing / incoming page overlap
- async navigation lifecycle
- cleanup timing
- scroll state handling
- transition architecture

### Codrops — 1820 Productions breakdown

https://tympanus.net/codrops/2026/02/13/1820-productions-minimal-design-maximal-motion/

Use for:

- production creative site の page transition architecture
- old page freeze / new page reveal
- transition と component lifecycle cleanup の関係

## Gesture extraction model

Gesture-driven motion は以下の3 phase に分けて観察する。

```text
Direct manipulation
→ release decision
→ settling motion
```

### Direct manipulation

- finger / pointer displacement と object displacement の関係
- axis lock
- resistance
- bounds
- overscroll

### Release decision

- distance threshold
- velocity
- direction
- cancel / commit

### Settling motion

- spring / inertia
- destination
- overshoot
- interruption

release 後だけ natural-looking spring を付けても、direct manipulation が pointer と乖離していれば gesture quality は低い。

## Navigation extraction model

画面 A → B について以下を特定する。

- persistent element
- exiting element
- entering element
- shared element
- navigation direction
- visual anchor
- scroll / focus state

transition が終わる前から B の hierarchy を理解できるかを見る。

## Scroll motion distinction

必ず以下を区別する。

### Scroll-triggered

threshold を超えたら animation timeline が開始する。

例:

- reveal
- section entrance
- count-up

### Scroll-linked

scroll progress と animation progress が直接結び付く。

例:

- parallax
- scrubbed timeline
- progress-driven transform
- camera movement

scroll-triggered effect を scroll-linked にする必要はない。
scroll-linked motion は user の scroll control と競合しやすいため、より強い justification を要求する。

## Verification checklist

- back navigation で direction / continuity が破綻しない
- rapid navigation で transitions が queue されない
- transition 中の click / tap が unexpected state を作らない
- focus が old DOM に残らない
- scroll position が意図せず jump しない
- small viewport で travel distance が過剰にならない
- direct gesture が pointer / finger に追従する
- cancel gesture が自然に元へ戻る
- reduced motion でも navigation context が失われない

## Failure modes

- every route uses cinematic transition
- navigation direction と element movement が矛盾する
- shared element が途中で duplicate に見える
- old / new page の同時存在で focus / interaction が壊れる
- scroll hijacking が native scroll expectation を上書きする
- fast user input で multiple animation timelines が競合する
- swipe release 後の destination が velocity / distance と無関係に見える
