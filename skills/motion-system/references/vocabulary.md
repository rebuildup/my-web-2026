# Motion Vocabulary

motion reference を「なんとなく似た感じ」で模倣せず、observable な relationship として記述するための共通語彙。

この vocabulary は preset catalog ではない。実装値は current project / production reference / platform behavior から決める。

## State and visibility

- **enter** — absent / hidden state から settled state へ入る
- **exit** — settled state から absent / hidden state へ出る
- **reveal** — object geometry を保ったまま mask / clip / opacity 等で露出する
- **crossfade** — old / new state の visibility を時間的に重ねて交換する
- **expand / collapse** — region の occupied space / visible extent が変化する

## Spatial continuity

- **source-anchored** — trigger / source object を origin として出現・展開する
- **destination-anchored** — destination relationship を motion direction に反映する
- **shared-element** — state A / B 間で同一 object と知覚できる visual invariant を保つ
- **push / pop** — navigation hierarchy を方向で示す
- **reorder** — item identity を保ちながら layout position を変える
- **morph** — shape / visual role の連続性を保った transition

## Temporal structure

- **stagger** — related elements の開始時刻を少しずらし hierarchy / sequence を示す
- **overlap** — outgoing / incoming motion を部分的に同時進行させる
- **hold** — intentional pause / deliberate confirmation のため状態を維持する
- **asymmetric timing** — enter / exit、press / release 等で異なる response speed を持たせる
- **interruptible transition** — current value から reverse / retarget できる transition

## Gesture and physical response

- **spring response** — velocity / displacement に応じて連続的に settle する
- **rubber-band / resistance** — boundary 超過に対し movement を徐々に減衰させる
- **momentum / inertial motion** — release 時 velocity を movement に引き継ぐ
- **drag-driven** — time ではなく pointer / touch displacement が primary progress になる

## Scroll and expressive motion

- **scroll-triggered** — threshold / visibility を trigger に time-based animation を開始する
- **scroll-linked** — scroll progress と motion progress が直接対応する
- **parallax** — visual layers 間で scroll / camera movement への response rate を変える
- **ambient loop** — user action と独立して継続する expressive motion
- **kinetic typography** — type の position / scale / shape / reveal を temporal composition として扱う

## Observation format

reference を観察したら、少なくとも次の形へ落とす。

```text
trigger:
purpose:
vocabulary:
initial state:
settled state:
spatial relationship:
temporal relationship:
interruption:
reduced-motion behavior:
```

例:

```text
trigger: popover open
purpose: continuity
vocabulary: source-anchored enter + asymmetric timing
initial state: trigger origin に近い compact state
settled state: readable popover geometry
spatial relationship: trigger edge を invariant にする
temporal relationship: enter より exit を短くする
interruption: rapid reopen で current state から retarget
reduced-motion behavior: movement distance を削減し opacity relationship を維持
```

## Avoid

- vocabulary 名だけを implementation recipe として扱う
- named product / creator の style label だけから motion を推測する
- exact duration / easing を vocabulary に固定する
