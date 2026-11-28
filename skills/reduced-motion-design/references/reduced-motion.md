# Reduced Motion References

Last reviewed: 2026-09-14

この reference file は reduced-motion behavior の design decision に使う。
API / framework syntax を universal rule としてコピーせず、各 source が定義する **user preference、motion trigger、meaning preservation、testing behavior** を比較する。

## Standards / normative preference model

### W3C — Media Queries Level 5: `prefers-reduced-motion`

- URL: https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion
- Status reviewed: 2026-09-14
- Observe:
  - `reduce` は system が non-essential motion を最小化するよう user が要求した preference
  - user preference media feature であり、特定の animation library の機能ではない
  - `no-preference` は motion を積極的に好むという意味ではなく、preference が表明されていない状態
  - user agent / OS preference が source になりうる
- Useful for:
  - Web で reduced-motion preference を design input として扱う
  - implementation mechanism と design policy を分離する
- Avoid copying:
  - media-query syntaxだけを実装して各 animation の意味を評価しないこと

https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion

### W3C WAI — Understanding SC 2.3.3: Animation from Interactions

- URL: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions
- Status reviewed: 2026-09-14
- Observe:
  - interaction-triggered non-essential motion が対象
  - parallax / scroll-triggered extra movement が vestibular trigger になりうる
  - unnecessary animation を避ける、disable control を提供する、system/user-agent preference を利用する、という複数の対応経路
  - essential motion の例外は「なくすと情報・機能が根本的に変わる」場合であり、単に気持ちよい/brandらしいという理由ではない
  - motion animation の定義と、instant appearance / non-spatial visual change との区別
- Useful for:
  - user-triggered motion の risk / essentiality 判定
  - reduced policy の根拠
- Avoid copying:
  - Level AAA criterion 一つだけで product 全体の accessibility policy が完成したとみなすこと

https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions

### W3C WAI — Understanding SC 2.2.2: Pause, Stop, Hide

- URL: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide
- Status reviewed: 2026-09-14
- Observe:
  - moving / blinking / scrolling / auto-updating content が user activation なしに始まる場合の別責務
  - hover / focus / viewport entry 等の indirect interaction で始まる movement も自動開始側の問題になりうる
  - interaction-triggered motion と persistent/auto motion の overlap
- Useful for:
  - carousel / marquee / ambient / live-updating / looping motion の inventory
  - bounded transition と persistent motion を分ける
- Avoid copying:
  - reduced motion を interaction-triggered transition だけの問題に限定すること

https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide

## Platform guidance

### Apple Human Interface Guidelines — Motion

- URL: https://developer.apple.com/design/human-interface-guidelines/motion
- Japanese URL: https://developer.apple.com/jp/design/human-interface-guidelines/motion
- Status reviewed: 2026-09-14
- Observe:
  - motion を目的なく追加しない
  - important information を animation だけで伝えない
  - frequent UI operation に unnecessary motion を加えない
  - animation 完了待ちで interaction を block しない
  - peripheral / world-scale movement、position movement、rotation 等の platform-specific risk guidance
- Useful for:
  - motion purpose / interruption / large-area movement を reduced-mode inventory に含める
  - platform behavior と general principle の区別
- Avoid copying:
  - visionOS 固有 guidance や platform-specific number を 2D Web/mobile 全体へ一般化すること

https://developer.apple.com/design/human-interface-guidelines/motion

### Apple — Reduced Motion evaluation criteria

- URL: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria
- Japanese URL: https://developer.apple.com/jp/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria/
- Status reviewed: 2026-09-14
- Observe:
  - zoom / rotation / peripheral motion が 2D screen でも discomfort trigger になりうる
  - depth simulation: parallax、animated blur、depth-of-field
  - multi-axis / multi-speed movement、rotation、spiral-like effects
  - auto-advancing / continuous movement
  - decorative motion は停止候補
  - status change / hierarchical transition の意味を motion が担う場合、単純削除ではなく dissolve / highlight / color change 等の代替を検討する
  - system setting を検出することで user に二重設定を要求しない考え方
  - common tasks を reduced mode で実際に評価する
- Useful for:
  - `remove / replace / constrain / retain` の判断
  - task-parity verification
- Avoid copying:
  - Apple の具体的 replacement animation を universal preset にすること

https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria

## Current design-system / production policy evidence

### Microsoft Fluent 2 — Motion

- URL: https://fluent2.microsoft.design/motion
- Status reviewed: 2026-09-14
- Observe:
  - motion を functional relationship / transition として扱う
  - accessible motion section で no-motion setting、short/constrained movement、flash/jarring movement 回避、alternate information channel を明示
  - top-level transition では large-area slide より quick fade を選ぶ例
  - motion hierarchy が attention をどう所有するか
- Useful for:
  - local vs large-area movement の比較
  - meaning を motion 以外でも伝える policy
- Avoid copying:
  - Fluent の easing / duration / transition catalog を universal reduced-motion values とすること

https://fluent2.microsoft.design/motion

### Microsoft Fluent 2 — iOS Shimmer

- URL: https://fluent2.microsoft.design/components/ios/core/shimmer/usage
- Status reviewed: 2026-09-14
- Observe:
  - loading skeleton/shimmer のような persistent status motion が Reduce Motion 時に non-animated variant へ変わる production component policy
  - motion を停止しても loading semantics を別 channel で維持する必要性
- Useful for:
  - persistent / loading motion の具体例
- Avoid copying:
  - shimmer 自体を universal loading solution とすること

https://fluent2.microsoft.design/components/ios/core/shimmer/usage

### Atlassian Design System — Motion

- URL: https://atlassian.design/foundations/motion
- Status reviewed: 2026-09-14
- Current status note:
  - 2026-09-14 時点で motion foundation は Early Access と明示されている。current status を固定仕様として一般化しない。
- Observe:
  - motion を clarity / function / brand expression に分類する
  - reduced motion active 時は current system policy として motion off / instant を採用している
  - flashing / rapid oscillation / large screen sweep を避ける
  - all motion disabled でも UI が fully usable であることを verification にする
  - everyday UI と expressive brand moment の強度差
- Useful for:
  - design-system-level reduced behavior の current production policy
  - normal/reduced task parity
- Avoid copying:
  - Early Access token / exact duration / implementation API を stable universal rule とすること
  - Atlassian の current `instant` policy を全 product の唯一解にすること

https://atlassian.design/foundations/motion

## Comparison checklist

複数 source を比較するときは次を埋める。

| Axis | Questions |
| --- | --- |
| Trigger | user activation / indirect interaction / automatic / persistent のどれか |
| Purpose | decoration / feedback / continuity / orientation / attention / progress / direct manipulation のどれか |
| Spatial extent | local / regional / full-screen / peripheral のどれか |
| Transform | translate / scale / zoom / rotation / depth / parallax / blur / multi-axis / oscillation のどれか |
| Persistence | one-shot / repeated / loop / continuous / auto-advance のどれか |
| Meaning | motion を消したとき失われる情報は何か |
| Reduced policy | remove / replace / constrain / retain のどれか |
| Replacement | state、highlight、fade、color、text、static progress 等で意味を保持できるか |
| Preference | system/user-agent preference を自動尊重できるか。product control が必要か |
| Verification | normal/reduced で同じ task が完了し、state/hierarchy/focus/progress が保たれるか |

## Failure signals

- reduced mode が存在するが large-area parallax / zoom / rotation が残る
- 全 animation を instant 化した結果、state / location / progress が分からない
- decorative motion と functional motion に同じ処理をする
- persistent animation を transition inventory から漏らす
- system preference を読み取らず app setting を user に再設定させる
- preference change 後も既に走っている loop / animation が止まらない
- no-preference を「motion preferred」と解釈する
- reduced behavior のみ focus / reading position / navigation context が跳ぶ
- third-party / user-generated moving media を無視する
- implementation flag の存在だけで rendered reduced behavior を確認しない
