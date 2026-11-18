# Product UI / Feedback Motion References

Last reviewed: 2026-09-10

## Goal

Product UI では animation の目立ちやすさより、操作への反応、状態変化、continuity、速度感を観察する。
頻繁に触る control ほど短く直接的で、重要な状態変化ほど理解に必要な motion を持つかを見る。

## Primary references

### Apple Human Interface Guidelines — Motion

Guidance:
https://developer.apple.com/design/human-interface-guidelines/motion

Japanese:
https://developer.apple.com/jp/design/human-interface-guidelines/motion

Observe / extract:

- motion が status / feedback / instruction のどれを伝えるか
- custom motion を追加しない方がよい frequent interaction
- direct manipulation に対する response
- animation を user input で中断できる設計
- visual motion 以外の feedback と役割分担する考え方
- platform component が持つ既定 motion を上書きする必要が本当にあるか

Use Apple guidance as interaction principle evidence, not as a requirement to imitate Apple visual styling。

### Material Design 3 — Motion

Guidance:
https://m3.material.io/styles/motion/overview

Material 3:
https://m3.material.io/

Observe / extract:

- transition を spatial relationship として扱う考え方
- motion physics / spring が component role とどう対応するか
- expressive motion と utility motion の強度差
- container / shared element / enter-exit の choreography
- mobile touch interaction での continuity

Material component shape / color language と motion principle を分離して読む。

### Vercel Web Interface Guidelines — Animations

Guidance:
https://vercel.com/design/guidelines

Observe / extract:

- motion necessity check
- CSS / Web Animations API / JavaScript animation の選択優先度
- compositor-friendly property
- interruptible interaction
- input-driven motion
- `transition: all` を避ける理由
- reduced-motion variant

この reference は Web product の implementation review checklist として使いやすい。

### Motion Examples

Examples:
https://motion.dev/examples

Useful categories:

- Interactions:
  https://motion.dev/examples?category=interactions
- Buttons:
  https://motion.dev/examples?category=buttons
- Dialog:
  https://motion.dev/examples?category=dialog
- Layout animations:
  https://motion.dev/examples?category=layout-animations
- Loading:
  https://motion.dev/examples?category=loading
- Navigation:
  https://motion.dev/examples?category=navigation

Observe:

- before / after state
- trigger と response の距離
- spring / easing の role
- enter と exit の非対称性
- hover / tap / focus の違い
- layout continuity
- repeated input 時の挙動

Motion library 固有 API を project に導入することを前提にしない。
visual / temporal pattern の比較 source として使う。

## Production surfaces

### Linear

Production:
https://linear.app/

Observe:

- dense product UI を示す animation の速度感
- selected / active / loading / status change の視覚的優先順位
- product preview 中で small UI motion と large scene transition をどう分けるか

### Raycast

Production:
https://www.raycast.com/

Observe:

- keyboard-driven product の速度感を損なわない motion
- control feedback と personality の両立
- icon / menu / overlay / command interaction を見せる transition

## Interaction extraction checklist

各 motion について以下を特定する。

```text
Trigger
→ immediate feedback
→ state transition
→ settled state
```

確認:

- feedback が input の直後に始まるか
- input target 自体が反応するか、それとも離れた箇所だけが動くか
- state が motion 完了前から理解できるか
- transition 中に次の input を受けられるか
- exit が enter より不要に長くないか
- keyboard / touch でも意味が保たれるか

## Common translation rules

### Pressed / selected

large scale animation を毎回使わない。
直接操作する control は response の即時性を優先する。

### Popover / menu / dialog

transform origin、trigger proximity、enter / exit direction を観察する。
center-scale preset を全 overlay に流用しない。

### Accordion / disclosure

content geometry の変化と chevron / label feedback の同期を見る。
height animation そのものより、reading position が飛ばないことを優先する。

### Loading

loading indicator を見せること自体を目的にしない。
短い処理で flicker が生じる場合、delay / minimum visible time / optimistic feedback の必要性を検討する。

### Success / error

animation だけで semantic state を伝えない。
color、icon、text、aria state 等と併用する。

## Failure modes

- hover するたび card 全体が大きく跳ねる
- primary action が animation completion を待たないと次へ進めない
- dialog と dropdown が同じ scale transition を使う
- loading state が短時間でも必ず spinner を点滅させる
- selected state が animation 中しか分からない
- keyboard focus に motion / feedback が無いのに hover だけ作り込む
