---
name: reduced-motion-design
description: >
  Design and adapt interactive interfaces for users who request less motion. Use when
  transitions, parallax, zoom, rotation, persistent animation, or motion-based feedback must
  preserve task meaning while reducing non-essential movement and motion-trigger risk.
---

# Reduced Motion Design

Reduced Motion を `animation: none` の一括指定として扱わない。

この Skill は **通常の interaction model を、motion を減らした状態でも同じ task / state / hierarchy / orientation を理解できる behavior へ翻訳すること**を担当する。

通常時の motion purpose / choreography は `motion-system` を source of truth とし、この Skill では user preference が reduced motion を要求したときの **remove / replace / constrain / retain** を決める。

## When to use

使用する:

- UI に transition / transform / scroll-linked effect / parallax / zoom / rotation がある
- route / modal / pane / list / drag / loading 等の motion を reduced-motion preference に適応する
- ambient / persistent / auto-playing visual motion を持つ product を設計・reviewする
- motion を消すと state / hierarchy / progress / orientation が失われそうな UI を設計する
- platform / browser の reduced-motion preference と product独自設定の役割を整理する

主に interactive product / interface を対象とする。
standalone video / authored motion artifact の編集規則そのものは対象外とする。

## Workflow

1. current artifact の motion をすべて列挙する。
2. 各 motion が何の意味を所有しているかを `motion-system` の purpose で分類する。
3. current W3C / platform / design-system reference を実際に開く。
4. motion trigger / movement type / spatial extent / persistence / meaning を観察する。
5. 各 motion に `remove / replace / constrain / retain` の reduced-mode policy を割り当てる。
6. reduced mode を実装し、通常 mode と同じ representative task を実行する。
7. rendered behavior を normal / reduced の双方で確認し、task meaning と comfort-risk の両方を再評価する。

## Observe

### Trigger

- direct user activation で始まるか
- scroll / hover / focus / viewport entry のような indirect interaction で始まるか
- page / app 側が自動開始するか
- loading / live update / status change に連動するか
- continuous / looping / auto-advancing か

interaction-triggered animation と automatically moving / blinking / scrolling content を同じ問題として処理しない。

### Purpose and information ownership

各 motion について「これを消したとき何が分からなくなるか」を確認する。

- decoration / ambience
- feedback
- state change
- continuity
- orientation / hierarchy
- attention
- progress / activity
- direct manipulation
- brand expression

意味を説明できない movement は reduced mode で優先的に除去する。

### Motion characteristics

- translation / spatial displacement
- scale / zoom
- rotation / spin / orbit
- depth simulation / parallax / animated blur / depth-of-field
- multi-axis / multi-speed motion
- oscillation / shake / bounce
- full-screen / large-area movement
- peripheral movement
- local movement around the active element
- persistent / looping movement
- stagger / choreography involving many elements

`duration` だけで risk を判断しない。
距離、画面占有範囲、方向変化、反復、depth cue、視野内の位置も見る。

### Reduced-mode result

- movement が完全に不要になったか
- state change は瞬時でも理解できるか
- fade / highlight / color / border / content swap 等へ置換したか
- spatial movement を小さな local feedback へ限定したか
- persistent movement を停止 / pause 可能にしたか
- meaningful progress が静止画に見えてしまっていないか
- navigation hierarchy / source-destination relationship が失われていないか

代替表現も実物を確認する。
「fade だから安全」「color だから十分」と先に断定しない。

## Decision rules

### Start from purpose, not implementation

CSS property、animation library、SwiftUI modifier 等から分類しない。

まず:

1. 何が変化したか
2. user が何を理解する必要があるか
3. motion はその理解に必須か

を決める。

同じ `transform` でも decorative parallax と drag feedback では reduced-mode policy が異なる。

### Remove decorative and redundant motion first

次のように motion を除いても意味が残る場合は、reduced mode では原則として remove / instant-state を優先する。

- decorative entrance flourish
- ambient floating object
- non-essential parallax
- background drift
- repeated hover flourish
- branding-only looping animation

「短くすれば残してよい」と自動判断しない。

### Replace motion that carries meaning

motion を完全に消すと state / hierarchy / orientation / progress が不明になる場合は、意味を別 channel へ移す。

候補:

- instant state + visible selection/state treatment
- dissolve / crossfade
- highlight / color or surface change
- local emphasis around changed content
- static progress/state indicator
- source/destination label or structural continuity

Apple の current Reduced Motion guidance でも、status change や hierarchical context を担う motion は意味まで削除せず、full-screen movement を避ける代替表現を検討する。reference の具体 effect を universal preset とせず、この **meaning preservation** を抽出する。

### Constrain rather than merely shorten

movement が必要でも、reduced mode では次を比較する。

- moving distance を小さくする
- full-screen movement を local element に閉じる
- multiple axes を単一変化へ減らす
- depth / parallax を flat state change へ変える
- zoom / scale transformation を dissolve / instant swap へ変える
- repeated bounce / overshoot をなくす
- staggered group movement を同時表示へ変える

duration だけを半分にして「reduced」としない。

### Preserve direct manipulation carefully

drag / resize / pan のように user action と object response の連続性が interaction 自体を成立させる場合、すべての movement を消すと操作不能になりうる。

- pointer / touch に追従する必要な movement と decorative momentum を分ける
- release 後の overshoot / bounce / inertia を減らせるか確認する
- destination / drop result を non-motion state でも明確にする

essential を広く解釈して decorative response まで残さない。

### Treat persistent motion separately

auto-playing carousel、shimmer、ambient loop、generation indicator、live visualization のような persistent motion は bounded transition と別に評価する。

確認する:

- motion は status を伝える唯一の手段か
- reduced mode では static status / progress / text に置換できるか
- pause / stop control が必要か
- task外領域で継続して注意を奪っていないか

自動開始する moving / blinking / scrolling content には WCAG 2.2.2 の観点も確認する。

### Honor the user preference at the appropriate layer

Web では `prefers-reduced-motion`、platform app では system-wide Reduce Motion 等、利用可能な user preference を原則として尊重する。

ただし implementation mechanism を design source of truth にしない。

product-specific setting を追加する場合は:

- system preference より細かな制御が本当に必要か
- user が同じ preference を二重設定しなくてよいか
- system preference 変更が runtime に反映されるか
- product setting と system setting の優先関係が明確か

を確認する。

### Reduced motion is not loss of feedback

reduced mode でも:

- pressed / selected / expanded / collapsed
- save success / error
- navigation destination
- loading / progress
- drag target / drop result
- modal open / close state

を理解できなければならない。

motion を減らした結果、state change が invisible になるのは失敗。

## Responsibility boundaries

### `motion-system`

owns:

- motion が必要か
- feedback / continuity / orientation / attention / progress / expression の目的
- normal-mode choreography / interruption / timing system

this Skill owns:

- reduced-motion preference 時に何を remove / replace / constrain / retain するか
- meaning-preserving low/no-motion behavior
- normal / reduced task parity の確認

### `accessibility-audit`

owns broad accessibility / WCAG / platform re-test.

this Skill は reduced-motion behavior を設計する。audit の代替ではない。

### `interaction-states`

owns state semantics / visual state differentiation.

reduced mode では motion に依存していた state meaning をその state treatment へ戻すことがある。

### authored motion / video Skills

`2d-parallax`、`camera-effects`、`transition-design` 等は authored playback artifact の motion grammar を扱う。

この Skill は interactive product の user preference adaptation を中心にする。delivery surface 自体に reduced-motion mode がある場合だけ、その mode の behavior design に適用する。

## Avoid

- `prefers-reduced-motion` を検出して全 transition を機械的に `0ms` にするだけ
- decorative motion と meaningful motion を区別しない
- full-screen slide / zoom / parallax を duration だけ短くして残す
- fade / opacity / blur を自動的に安全な replacement と断定する
- motion を消して state / progress / hierarchy / focus context も消す
- system preference を無視して独自 toggle だけを提供する
- user preference がないことを「motion を好む」と解釈する
- reduced mode だけ interaction flow / focus order / task result を変える
- third-party / user-generated persistent motion を inventory から除外する
- WCAG AAA の単一 criterion だけを product の全 reduced-motion policy とみなす
- warning 文だけで problematic motion を残す

## References

非自明な判断では [`references/reduced-motion.md`](./references/reduced-motion.md) を実際に開く。

current platform / standard の status を確認し、一つの platform 固有 replacement を universal rule としてコピーしない。

## Verify

source code に media query / preference listener が存在するだけでは完了しない。

### Build a motion inventory

representative flow 内の motion ごとに記録する。

- trigger
- purpose
- movement type
- spatial extent
- persistence / repetition
- information carried
- reduced policy: remove / replace / constrain / retain

policy を割り当てられない motion は未検証とする。

### Normal vs reduced task parity

同じ representative task を normal mode と reduced mode の双方で実行する。

最低限確認する:

- route / hierarchy transition
- modal / disclosure / pane open-close
- selection / save / error 等の feedback
- loading / progress
- repeated rapid interaction
- persistent / ambient motion がある surface
- drag / direct manipulation がある場合の操作完了

比較する:

- task completion は同じか
- state meaning は同じか
- focus / reading position を失わないか
- source / destination relationship が理解できるか
- reduced mode に large-area / depth / zoom / rotation / repetitive trigger が残っていないか
- motion を削った結果、突然の layout shift が新しい混乱を作っていないか

### Rendered inspection

reduced mode を実際に有効にして interaction を発火する。

静止 screenshot だけでは判定しない。

- normal speed で一連の flow を見る
- repeated activation / interruption を試す
- scroll / hover / focus / viewport-entry trigger を試す
- auto-playing / looping content を一定時間観察する
- system preference を runtime で切り替えられる環境では切替後の behavior も確認する

### Completion gate

- current W3C / relevant platform reference を実際に開いた
- version-sensitive reference に `Last reviewed` がある
- user-triggered と automatically initiated motion を区別した
- decorative と meaning-bearing motion を区別した
- reduced mode が remove-only ではなく meaning preservation を検討している
- normal / reduced で representative task を実行した
- final rendered interaction を確認した
- remaining unsupported motion / third-party content を明示した

real interactive artifact trial をまだ実施していない場合は experimental candidate のままとし、promotion 完了と報告しない。
