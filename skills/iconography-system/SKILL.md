---
name: iconography-system
description: >
  Use when selecting, designing, extending, or auditing a UI/product icon family.
  Define semantic metaphors, family geometry, optical sizing, state variants,
  localization behavior, and icon-text relationships from platform and design-system
  references instead of mixing unrelated icon assets.
---

# Iconography System

Last reviewed: 2026-09-12

Icon を「空いている場所に合う SVG を置く作業」にしない。

**Meaning → Family → Size → State → Context → Verify** の順で、
iconography を再利用可能な visual language として扱う。

この Skill は logo / brand mark を扱わない。
identity-bearing symbol は `brand-mark` の責務とし、
ここでは主に UI / product action / status / navigation icon family を扱う。

## 1. Inspect the current icon language

新しい icon を探す前に current project を確認する。

- existing icon library / package
- filled / outline variants
- common rendered sizes
- stroke weight / corner treatment
- icon + text pairing
- selected / active state
- button / toolbar / navigation use
- color behavior
- touch / click target
- RTL / localization handling
- custom icons already in use

一つだけ異なる icon があっても、それを family rule と断定しない。
頻出する pattern を優先する。

## 2. Start from meaning

icon shape より先に意味を決める。

分類する:

- action — add, delete, share, edit
- object — file, calendar, folder, person
- navigation — back, forward, expand, menu
- status — success, warning, error, sync
- mode / tool — select, draw, crop, filter
- disclosure — more, chevron, overflow
- product / file identity — 通常の system icon と別責務

曖昧な concept に無理な pictogram を作らない。
label の方が明確なら text を使う。

## 3. Prefer an established family

current product が platform / design system に乗っている場合、
まずその family を使えるか確認する。

同一 surface で:

- Material Symbols
- SF Symbols
- Fluent
- Carbon
- random SVG icon set

を無計画に混在させない。

不足 icon を custom で補う場合も、
current family の visual grammar に合わせる。

## 4. Observe references

### Apple — SF Symbols

https://developer.apple.com/sf-symbols/

Observe:

- text と揃う weight / scale
- symbol-specific optical adjustment
- monochrome / hierarchical / palette / multicolor rendering
- variable weight と scale
- symbol effects / layer structure
- locale / reading-direction adaptation

「vector だから任意サイズへ線形拡大できる」ではなく、
target size での見え方を確認する。

### Apple — Right to left

https://developer.apple.com/design/human-interface-guidelines/right-to-left

Observe:

- directional symbol の mirroring
- semantic direction と physical direction の違い
- text-bearing icon の localization
- custom symbol の directionality

左右反転すべき icon と、shape 自体の意味を保持すべき icon を分ける。

### Material Symbols

https://developers.google.com/fonts/docs/material_symbols

Observe:

- fill / weight / grade / optical size axes
- outlined / rounded / sharp family differences
- selected state に fill axis を使う考え方
- optical size と stroke appearance の関係
- platform delivery form と visual system の分離

### Fluent 2 — Iconography

https://fluent2.microsoft.design/iconography

Observe:

- regular / filled の state relationship
- literal metaphor と naming
- modifier の位置 / complexity
- product icon と system icon の責務分離
- small-size simplification
- cultural / localization implications

### IBM Carbon — Icons

https://carbondesignsystem.com/elements/icons/usage/

Observe:

- standard artboard sizes
- typography と icon size の balance
- icon glyph と interaction target の分離
- monochrome usage
- text との alignment
- product 全体での size consistency

Carbon 固有の px 値を universal rule にしない。
「small icon をそのまま小さい target にしない」等の構造を抽出する。

## 5. Extract family geometry

custom icon / extension を作る場合、先に family profile を記述する。

見るもの:

- artboard
- nominal size
- stroke width
- cap / join
- corner radius
- fill ratio
- negative space
- dominant angle
- curve tension
- optical center
- baseline / text alignment
- detail density

例:

```text
Family:
- 20/24 nominal sizes
- outline default, fill for selected
- rounded joins
- moderate interior whitespace
- centered with text optically, not by raw path bounds
- modifiers restricted to one corner
```

exact number のコピーより、family 内での一貫性を優先する。

## 6. Metaphor rules

metaphor は recognizable であるだけでなく、
current domain で誤解されにくい必要がある。

確認:

- object metaphor が action と衝突しないか
- same symbol が別 action に使われていないか
- modifier を足しすぎて puzzle になっていないか
- cultural context で意味が変わらないか
- label なしでも頻出 action として十分理解可能か

unfamiliar / destructive / high-consequence action は
icon-only を避けることを検討する。

## 7. Size and optical behavior

SVG path を単純 scale して終わらせない。

small size では:

- detail を減らす
- interior gap を確保する
- stroke collapse を避ける
- silhouette を優先する
- modifier を簡略化する

large size では:

- 不要な細部を増やさない
- family の weight が薄く見えすぎないか確認する

rendered px size ごとに見て判断する。

## 8. State variants

selected / active を color だけに依存させない。

候補:

- outline ↔ fill
- weight / grade
- background container
- shape / marker
- label emphasis

ただし state ごとに別 metaphor へ変えない。
semantic identity は保つ。

## 9. Icon + text

見る:

- visual center
- baseline relationship
- gap
- relative emphasis
- label length
- localization

bounding box の数学的中心と、
人間が感じる optical center は一致しないことがある。

icon と label の組を component として render して確認する。

## 10. Touch target is not glyph size

small glyph を small hit target にしない。

interaction target と visual glyph を分離する。

確認:

- pointer / touch input
- minimum platform target
- surrounding spacing
- adjacent icon collisions
- hover / focus indication

target size の一般的 accessibility requirement は
`accessibility-audit` でも再確認する。

## 11. Color

system icon は原則として content hierarchy に従う。

色を使う場合:

- semantic state
- selected state
- brand/product identity
- multicolor icon family specification

のどれか理由を持たせる。

random multi-color 化で distinction を作らない。

## 12. Custom icon decision

custom icon を作る前に確認:

1. current family に同義 icon がないか
2. 近い icon を誤用していないか
3. label で解決できないか
4. custom metaphor が product-specific で本当に必要か
5. family geometry を再現できるか

必要なら既存 family から:

- proportion
- stroke
- corner
- negative space
- optical size behavior

を抽出して設計する。

reference icon の path をそのまま改変・再配布してよいとは限らない。
asset license と platform restriction を確認する。

## 13. Avoid

- icon libraries を同一 toolbar で混在させる
- icon name だけで semantic fit を判断する
- tiny glyph = tiny target にする
- SVG を全サイズで機械的に scale する
- selected state を color だけで表す
- every concept に icon を付ける
- modifier を重ねて複雑な rebus にする
- directional icon を RTL でも固定する
- product / brand icon と system action icon を同じ rule で扱う
- custom icon を family comparison なしで追加する

## 14. Verify

representative set を同時に render する。

最低限:

- navigation icons
- common actions
- destructive action
- selected / unselected pair
- status icons
- icon + short label
- icon + long/localized label
- smallest supported size
- largest common size
- light / dark surfaces
- RTL path where relevant

見る:

- silhouette recognition
- stroke / fill consistency
- optical size
- visual weight
- alignment
- family coherence
- state clarity
- target affordance
- localization failure

1 icon ずつではなく **family として並べて**違和感を探す。

## 15. Completion

完了条件:

- semantic metaphor が説明できる
- current family と geometry が一致する
- target size で optical verification 済み
- selected / disabled / destructive behavior が coherent
- text / target / localization context で確認済み
- custom asset を使う場合、license / platform constraint を確認済み
