---
name: color-system
description: >
  Use when designing, implementing, or auditing a product color system. Build semantic
  color roles, surface hierarchy, accent allocation, state colors, and light/dark
  transformations from project context and current platform/design-system references
  instead of generating an arbitrary palette.
---

# Color System

Last reviewed: 2026-09-12

Color を「きれいな palette を作る作業」にしない。

**Inspect → Assign roles → Build relationships → Apply → Verify** の順で、
色を information hierarchy / interaction state / brand / surface structure の system として扱う。

`token-audit` は token vocabulary と drift を監査する。
この Skill は、その token に **どの visual / semantic role を与えるべきか** を決める。

## 1. Inspect current evidence first

先に current project を確認する。

- existing color tokens / CSS variables / theme objects
- light / dark / high-contrast modes
- brand colors
- surfaces / elevation / borders
- text / icon hierarchy
- interactive states
- status / feedback colors
- charts / diagrams
- screenshots of representative screens

既存値を全削除して新 palette を入れる前提を置かない。
repeated role がすでに成立しているなら、その関係を優先する。

## 2. Model roles before values

raw color name より role を先に定義する。

最低限分類する:

### Surface

- canvas / page background
- raised or nested surface
- selected / emphasized surface
- inverse surface
- overlay / scrim

### Content

- primary text / icon
- secondary
- tertiary / disabled
- inverse content
- link / interactive emphasis

### Action / accent

- primary action
- selected state
- focus / active indication
- brand accent

### Feedback / status

- success
- warning
- error / destructive
- information
- pending / neutral status

### Structural

- border
- divider
- focus ring
- subtle fill
- hover / pressed / selected layer

role と raw swatch を 1:1 固定しない。
theme / contrast mode / surrounding surface に応じて value が変わってよい。

## 3. Observe references

reference を開き、色コードそのものより relationship を見る。

### Apple — Color

https://developer.apple.com/design/human-interface-guidelines/color

Observe:

- semantic / dynamic system color
- foreground と background の role separation
- light / dark / increased-contrast で value がどう変わるか
- 同じ color を異なる meaning に再利用しない原則
- brand color を UI 全体へ過剰配分しない考え方

### Apple — Branding

https://developer.apple.com/design/human-interface-guidelines/branding

Observe:

- brand accent を control 全体へ広げず、重要な action / status / content へ配分する考え方
- platform-native hierarchy と brand expression の balance
- logo repetition ではなく product experience 全体で identity を作る方法

### Material 3 — Color scheme / roles

https://developer.android.com/develop/ui/compose/designsystems/material3

Observe:

- primary / secondary / tertiary と container / on-* の relationship
- accent と neutral surface の分離
- tonal palette から semantic role へ割り当てる構造
- light / dark / dynamic color で role を保ったまま value が変わる方法
- elevation を shadow だけでなく tonal relationship でも表現する考え方

Material 固有の role 名を current project へそのままコピーしない。
role-pairing の考え方を抽出する。

### Adobe Spectrum — Color fundamentals

https://spectrum.adobe.com/page/color-fundamentals/

Observe:

- color theme と device mode の区別
- target contrast を持つ theme-specific color
- perception と numerical lightness の差
- dark theme で単純反転しない color progression

### Adobe Spectrum — Using color

https://spectrum.adobe.com/page/using-color/

Observe:

- theme-specific color と static color の使い分け
- background layer / content color の pairing
- state color の progression
- color-only communication を避ける方法

### USWDS — Using color

https://designsystem.digital.gov/design-tokens/color/overview/

Observe:

- broad system palette と project-level role tokens の分離
- family / grade / theme token の vocabulary
- limited subset へ絞る考え方
- system consistency と project identity の balance

## 4. Extract a project color model

reference を見た後、current project の役割へ翻訳する。

例:

```text
primitive
  gray/*
  blue/*
  red/*

semantic
  surface/base
  surface/raised
  content/primary
  content/secondary
  action/primary
  state/error
  border/subtle

component
  button/primary/*
  input/*
  nav/selected/*
```

primitive の数より semantic relationship の安定性を優先する。

`primary-500` を「primary action の色」と思い込まず、
実際の role を semantic token で表す。

## 5. Build hierarchy with more than hue

hierarchy を hue だけで作らない。

使える軸:

- luminance / tone
- saturation
- contrast
- surface relationship
- border presence
- typography weight
- spacing / grouping

特に neutral UI では、accent color を増やすより
surface / content contrast の段階を整理した方が hierarchy が明確になることがある。

## 6. Brand color allocation

brand color は存在感を出すために全面へ塗る必要はない。

優先候補:

- primary action
- selected / active state
- brand-bearing content
- illustration / media
- small signature moments

避ける:

- every button / every icon / every border
- status color と brand color の semantic collision
- body text への無差別な brand tint

brand identity と interaction semantics が競合する場合は、
操作の理解を優先する。

## 7. Theme transformation

dark mode を light palette の inversion として作らない。

確認する:

- surface hierarchy が保持されるか
- text / icon hierarchy が保持されるか
- accent が発光して見えすぎないか
- borders が強すぎ / 弱すぎないか
- status colors の prominence が変わっていないか
- image / chart / code surface が theme に馴染むか

platform が dynamic / user-derived color を持つ場合も、
semantic role と project-specific constraints を失わない。

## 8. State colors

hover / pressed / selected / disabled を別 palette にしない。

state は base role との relationship として設計する。

- hover: affordance を明確化
- pressed: immediate action feedback
- selected: persistent state
- focus: keyboard / input focus
- disabled: unavailable state without disappearing
- destructive: consequence distinction

opacity だけで state を作る場合は、underlying background で結果が変わることを確認する。

## 9. Data visualization boundary

categorical / sequential / diverging palette の詳細設計は `data-visualization` を使う。

この Skill では:

- UI semantic colors と chart colors を混同しない
- success=green / error=red を categorical series に流用しない
- chart palette が application chrome より過剰に attention を取らない

ことを決める。

## 10. Avoid

- arbitrary palette generator output をそのまま採用する
- raw hex / hue 名を semantic role として使い続ける
- 同じ色に action / status / decoration の複数意味を持たせる
- brand accent を everywhere に使う
- light theme の単純反転で dark theme を作る
- disabled を「薄くしてほぼ見えない」にする
- color だけで status / selection / chart category を伝える
- reference の exact color values を product context 無視でコピーする

## 11. Verify

representative screens を実際に render して確認する。

最低限:

- light theme
- dark theme
- high-contrast / increased-contrast path がある場合
- primary / secondary / destructive action
- success / warning / error
- dense text + controls
- selected / hover / pressed / focus / disabled
- empty / loading / error states

見るもの:

- role の一貫性
- surface depth
- content hierarchy
- accent allocation
- brand presence
- state distinguishability
- contrast
- color なしでも意味が残るか

必要なら grayscale / color-vision simulation も使うが、
simulation だけを accessibility の完了条件にしない。

## 12. Completion

完了条件:

- semantic role が raw palette から分離されている
- light / dark transformation が role-preserving
- brand / action / status が衝突していない
- representative rendered screens で hierarchy を確認した
- accessibility issue が見つかった場合は `accessibility-audit` で再検証した
