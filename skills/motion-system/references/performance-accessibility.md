# Motion Performance / Accessibility References

Last reviewed: 2026-09-10

## Goal

Motion quality は見た目だけで評価しない。
frame stability、input responsiveness、browser rendering cost、reduced-motion behavior、comfort を同時に確認する。

この file は motion を追加・変更するすべての task で読む。

## Primary references

### Vercel Web Interface Guidelines — Animations

https://vercel.com/design/guidelines

Use for:

- `prefers-reduced-motion`
- CSS > Web Animations API > JavaScript library の implementation preference
- compositor-friendly `transform` / `opacity`
- interruptible animation
- input-driven motion
- autoplay / long-running decorative motion の扱い
- `transition: all` を避ける review rule

この guidance は current web implementation の practical review baseline として使う。

### web.dev — Animations

Overview:
https://web.dev/explore/animations

High-performance CSS animations:
https://web.dev/articles/animations-guide

Use for:

- browser rendering cost の理解
- transform / opacity を中心とした compositor-friendly motion
- layout / paint を誘発する property の確認
- DevTools による animation debugging
- CSS / JavaScript animation performance の比較

### Apple Accessibility — Motion

https://developer.apple.com/design/human-interface-guidelines/accessibility

Related motion guidance:
https://developer.apple.com/design/human-interface-guidelines/motion

Use for:

- Reduce Motion behavior
- fast-moving / blinking effect の comfort risk
- large zoom / scaling / peripheral motion の低減
- spatial transition を fade へ置換する考え方
- spring bounce を弱める考え方
- gesture-linked motion の扱い

Apple-specific platform styling ではなく comfort / accessibility principle を抽出する。

### animations.dev

https://animations.dev/

Public learning references:
https://animations.dev/learn/animation-theory/the-easing-blueprint

Use for:

- easing が perceived speed に与える影響
- duration / easing / spring の比較
- animation taste を言語化する観点
- performance-sensitive property choice
- 「animate しない」判断

Course-specific preset や proprietary material の再現を目的にしない。
公開されている interactive material を観察 source として使う。

## Performance inspection order

motion が重いと感じたら、library の置換から始めない。

以下の順で確認する。

1. animated property
2. affected paint / layout area
3. element count
4. blur / filter / shadow / mask / clip complexity
5. JavaScript work per frame
6. scroll handler / observer frequency
7. image / video / canvas / WebGL cost
8. offscreen animation
9. library overhead

## Property decision

### Prefer when visually equivalent

- `transform`
- `opacity`

### Measure carefully

- width / height
- top / left / margin / padding
- filter / blur
- box-shadow
- clip-path / mask
- large gradient animation
- background-position over large areas
- SVG path complexity
- canvas / WebGL scene updates

「禁止 property list」にはしない。
必要な visual result があり cost が許容できるなら使えるが、実機で測る。

## Profiling gate

complex / scroll-linked / full-screen motion では、可能なら browser DevTools で最低限確認する。

- long tasks
- frame drops
- layout / style recalculation
- paint frequency
- layer count / compositing behavior
- input blocking
- memory growth after repeated transitions

page transition や route animation は一度成功するだけでなく、複数回往復して leak / duplicated listener / stale timeline がないか確認する。

## Reduced-motion strategy

reduced motion は「animation を全部消す」ではなく、目的ごとに replacement を決める。

### Feedback

必要な state acknowledgement は残す。

例:

- scale bounce → color / opacity / static selected state

### Continuity

large spatial travel を減らし、短い fade / immediate layout update へ置換する。

### Navigation

push / zoom / parallax を crossfade または instant transition に縮退する。

### Progress

essential progress indication は残す。
ambient spin の強度や速度は低減できる。

### Expressive

ambient loop / parallax / large camera movement は static frame を基本 fallback とする。

## Autoplay / ambient loops

autoplay motion は user task を邪魔しないことを確認する。

特に:

- hero video
- particle background
- marquee / ticker
- animated gradient
- 3D canvas
- infinite logo loop

では:

- reduced-motion fallback
- visibility change での pause
- offscreen pause
- battery / mobile cost
- text readability
- user control が必要か

を確認する。

## Flash / comfort

避ける:

- rapid flashing
- large repeated zoom
- uncontrolled camera movement
- strong peripheral parallax
- long bouncing sequences
- content reading中に継続する unnecessary motion

motion が primary content の読解と同時進行する場合は特に強度を下げる。

## Mobile / low-power verification

desktop high-end environment だけで判断しない。

可能なら:

- mobile viewport
- touch interaction
- mid-range device / throttled environment
- orientation change
- background → foreground return

を確認する。

large hero WebGL / video / blur effect は mobile で static / simplified variant を持ってよい。

## Completion checklist

- reduced-motion path がある
- essential information が motion のみに依存しない
- direct interaction を animation がブロックしない
- frequent UI operation が unnecessarily slow でない
- complex effects を実機または profiler で確認した
- offscreen loop が止まる / cost が抑えられる
- repeated navigation / interaction で resource leak がない
- small viewport で large travel / zoom が過剰でない
