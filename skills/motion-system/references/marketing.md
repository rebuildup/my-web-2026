# Marketing / Expressive Motion References

Last reviewed: 2026-09-10

## Goal

Marketing / portfolio surface では、animation を section ごとの装飾として足すのではなく、page hierarchy、reading rhythm、product narrative、brand personality をどう motion が支えているか観察する。

## Primary production references

### Linear

Production:
https://linear.app/

Observe:

- product UI preview が static screenshot ではなく scene としてどう見せられているか
- section entering / leaving の motion density
- text と product visual のどちらを先に動かすか
- large visual transition と small UI animation の timing hierarchy
- motion を使わず whitespace / layout change だけで rhythm を作る箇所
- scroll speed が変わっても content comprehension を邪魔しないか

Do not copy Linear-specific glow、dark styling、product imagery、signature visual treatment。

### Vercel

Production:
https://vercel.com/

Observe:

- high-density technical content で motion が控えられている箇所
- hover / focus / reveal の強度差
- graphic / demo region と surrounding copy の choreography
- border / grid / typography が強い UI で motion をどこまで使うか
- decorative motion が content interaction をブロックしない構造

Supporting guidance:
https://vercel.com/design/guidelines

### Framer

Production:
https://www.framer.com/

Observe:

- hero / showcase での continuous motion と user-triggered motion の分離
- scroll-triggered reveal、clip、mask、scale の使い分け
- motion-heavy page でも primary CTA / heading を読みやすく保つ方法
- showcase card / visual 間で variation を持たせながら coherent に見せる timing
- small viewport で effect density をどう落とすか

Framer の site-specific visual identity をそのまま personal site へ移植しない。

### Raycast

Production:
https://www.raycast.com/

Observe:

- product personality を出す illustrative / UI motion
- direct UI feedback と marketing choreography の差
- feature showcase の sequence
- motion が product behavior の説明として機能する箇所
- repeated motion pattern と one-off expressive scene の区別

## Discovery references

### HOVERSTAT.ES

Archive:
https://www.hoverstat.es/

About:
https://www.hoverstat.es/about/

Use for:

- current portfolio / editorial / experimental web motion の発見
- hover、mousemove、scroll、navigation、typography animation の異なる解法比較
- conventional SaaS reference では見つからない interaction vocabulary の探索

Usage rule:

1. task に近い interaction を archive から複数選ぶ
2. linked production site が生きていれば実際に開く
3. effect 単体ではなく page hierarchy と input relationship を観察する
4. novelty のためだけに採用しない

HOVERSTAT.ES 自体の UI を reference とするのではなく、curated production sites を discovery source として使う。

### Codrops

Tutorials:
https://tympanus.net/codrops/category/tutorials/

Current examples worth inspecting:

- SVG mask transitions on scroll:
  https://tympanus.net/codrops/2026/03/11/svg-mask-transitions-on-scroll-with-gsap-and-scrolltrigger/
- Infinite gallery / parallax / Flip transition:
  https://tympanus.net/codrops/2026/07/30/building-an-infinite-gsap-scroll-gallery-with-parallax-and-flip-transitions/
- Async page transitions:
  https://tympanus.net/codrops/2026/02/26/building-async-page-transitions-in-vanilla-javascript/

Use for:

- effect の visual result と implementation structure を対応付ける
- scroll-linked / page-transition / masking / shared-element-like motion の mechanism を理解する
- effect の cleanup、lifecycle、scroll ownership を確認する

Codrops demo は intentionally expressive である。
production UI の default motion intensity として丸ごとコピーしない。

## Extraction checklist

reference を見るとき最低限記録する:

- motion purpose
- trigger
- static first frame quality
- direction / distance
- duration hierarchy
- easing / spring character
- sequence / overlap / stagger
- scroll-triggered vs scroll-linked
- text readability during motion
- interruption behavior
- mobile simplification
- reduced-motion alternative
- whether motion is essential or decorative

## Personal / portfolio site application

個人サイトでは特に以下を分ける。

### Global motion

page 全体の personality を作る少数の rule。

例:

- route transition
- section reveal language
- cursor behavior
- default hover response

### Showcase motion

project / work の内容を説明する motion。

例:

- video / UI demo
- card → detail continuity
- before / after
- interactive prototype

### Expressive one-off

hero や一部 section だけで使う signature effect。

全 section を同じ reveal preset で埋めない。
逆に section ごとに別 animation vocabulary を発明して page coherence を失わない。
