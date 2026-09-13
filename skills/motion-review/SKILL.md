---
name: motion-review
description: >
  実装済みの Web / mobile motion を read-only で批評・レビューするときに使用する。
  purpose、timing relationship、spatial continuity、interruptibility、performance、accessibility を rendered behavior と code の両方から確認する。
---

# Motion Review

実装済み motion の read-only critique Skill。
source code を変更しない。改善実装が必要なら `motion-implement` へ渡す。

## Review order

### 1. Purpose

各 motion が何を担うか確認する。

- Feedback
- Continuity
- Orientation
- Attention
- Progress
- Expression / Delight

purpose が無い decoration は削除候補にする。

### 2. Frequency and latency

interaction frequency に対して animation が重すぎないか確認する。

- repeated action を遅らせていないか
- keyboard / direct manipulation の反応を鈍くしていないか
- exit が user を待たせていないか

固定 ms threshold だけで判定しない。

### 3. Spatial model

確認する:

- enter / exit direction
- transform origin
- source / destination relationship
- shared element continuity
- navigation direction
- parent / child movement

### 4. Temporal structure

見るもの:

- duration hierarchy
- easing / spring behavior
- stagger
- overlap
- hold
- exit speed
- coordinated property timing

すべてが同じ timing token で機械的に動いていないかも確認する。

### 5. Interruptibility

rapid repeated input、reverse、cancel、gesture interruption を試す。

問題例:

- restart from zero
- queued animation
- snap
- flicker
- stale exit
- pointer state loss

### 6. Performance

必要に応じて profiler / trace を使い:

- layout / paint pressure
- expensive filters / blur / shadows
- scroll-linked main-thread work
- hidden loop
- dropped frames
- layout shift

を確認する。

### 7. Accessibility and input

- reduced-motion variant
- keyboard
- touch
- coarse pointer
- hover gating
- small viewport
- orientation change

重要な状態を motion だけで伝えない。

## Severity

issue は impact で分類する。

- Blocker — interaction が破綻、操作不能、重大な accessibility / performance 問題
- Major — continuity / latency / interruption が明確に悪化
- Minor — polish / consistency 問題
- Note — reference discrepancy や将来改善候補

## Report

各 finding に:

- severity
- location
- observed behavior
- why it matters
- evidence
- recommended relationship / direction

を含める。

単なる好みを defect として断定しない。
