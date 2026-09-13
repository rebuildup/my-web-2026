---
name: accessibility-audit
description: >
  Existing Web UI の accessibility を automated scan + keyboard + visual inspection で監査・修正するときに使用する。
  WCAG checklist を読むだけでなく、実際の rendered interface と interaction を検証し、severity 順に改善する。
---

# Accessibility Audit

accessibility を lint rule の集合として扱わない。

**Automated scan → Keyboard inspection → Visual inspection → Semantic inspection → Fix → Re-test** を実行する。

この Skill は `dawitlabs/ui-skills` の `a11y` skill から、axe-core と keyboard traversal を併用する検証フローを取り入れている。

Upstream: https://github.com/dawitlabs/ui-skills/tree/master/skills/a11y
License: MIT

## 1. Establish scope

対象 screen / route を列挙し、重要度順に確認する。

優先:

1. primary workflow
2. authentication / onboarding
3. forms / destructive actions
4. navigation
5. settings / secondary surfaces

representative desktop と mobile viewport を含める。

## 2. Automated scan

利用可能なら axe-core / equivalent を実際の page に対して実行する。

scan では最低限:

- accessible names
- labels
- ARIA validity
- landmark / semantic structure
- contrast detectable by tooling
- duplicate IDs
- invalid roles / relationships

を見る。

Automated scan の pass を accessibility 完了条件にしない。

## 3. Keyboard inspection

mouse を使わず primary workflow を通す。

確認:

- logical tab order
- visible focus
- skip navigation when relevant
- Enter / Space activation
- Escape dismissal
- arrow-key patterns where expected
- focus trap and focus return for dialogs
- no unreachable controls
- no keyboard trap

custom interaction は platform / ARIA pattern の期待する keyboard behavior と比較する。

## 4. Visual accessibility

rendered UI を確認する。

最低限:

- text contrast
- non-text / control contrast
- focus visibility
- disabled vs enabled distinction
- selected / active distinction without color alone
- error / success state without color alone
- zoom / text enlargement
- clipping / overflow
- target size and spacing
- reduced-motion behavior where motion exists

数値基準だけでなく、実際に hierarchy が知覚できるかを見る。

## 5. Semantic inspection

DOM / accessibility tree を確認する。

見る:

- heading hierarchy
- landmarks
- native element preference
- button vs link semantics
- form association
- error description
- dialog name / description
- table semantics
- list semantics
- image alt strategy
- live region usage

ARIA を native semantics の代替として乱用しない。

## 6. Fix priority

severity は少なくとも以下で整理する。

### P0 — Blocks task or access

例:

- keyboard-only user が primary action を実行できない
- dialog から抜けられない
- essential control に accessible name がない

### P1 — Major barrier

例:

- pervasive contrast failure
- focus がほぼ見えない
- form error が識別できない

### P2 — Degraded usability

例:

- target size が小さい
- heading structure が不安定
- secondary interaction の keyboard behavior が不完全

### P3 — Polish / resilience

例:

- redundant announcement
- minor landmark improvement
- non-blocking semantics cleanup

severity は WCAG criterion の番号だけで決めず、actual task impact を見る。

## 7. Preserve product quality

accessibility fix を理由に UI を無条件に大型化・冗長化しない。

例:

- icon button → visible label を常設する前に accessible name / tooltip / context を検討
- target size → glyph 自体を巨大化せず hit area を確保できるか検討
- contrast → brand color を捨てる前に role / surface / state の組み合わせを見直す
- focus ring → global に派手な outline を足す前に component states と整合させる

accessibility と visual hierarchy を同じ design system 内で解決する。

## 8. Re-test gate

fix 後に同じ条件で再実行する。

完了前に最低限:

- automated violations comparison
- keyboard traversal
- screenshots of focus / error / selected states
- representative mobile viewport
- 200% zoom / text enlargement check
- 320 CSS px 相当 / 400% zoom の reflow check
- reduced-motion check when applicable

を確認する。

## 9. Report

必要なら以下を簡潔に示す。

- scope tested
- P0 / P1 findings
- important fixes
- remaining manual-test items
- verification performed

自動検査で確認できない screen reader quality を「pass」と断定しない。