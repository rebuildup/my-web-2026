---
name: visual-hierarchy
description: >
  Use when a rendered interface or 2D artifact needs a coherent cross-channel priority
  system. Translate semantic and task priority into relative visual emphasis across
  position, area, typography, contrast, grouping, imagery, and actions, then verify
  that hierarchy survives realistic content, state, theme, zoom, and layout changes.
---

# Visual Hierarchy

Visual hierarchy を「大きい見出し」「派手な色」「強い primary button」の集合にしない。

**Inspect priority → Observe references → Allocate emphasis → Resolve competition → Verify** の順で進める。

この Skill は、layout / typography / color など個別の表現手段を設計し直すのではなく、
**何を先に・次に・補助的に見せるかという product priority を、複数の visual channel へ一貫して割り当てる**ために使う。

## When to use

次のようなときに使う。

- どこを見ればよいか分かりにくい画面を整理する
- title / content / action / status / metadata が互いに attention を奪っている
- layout・type・color は個別には整っているが、全体の優先順位が弱い
- dense UI で primary information が埋もれる
- sparse / marketing surface で複数の large treatment が競合する
- responsive / localization / theme change 後に hierarchy が崩れる
- component ごとの emphasis は妥当だが page-level hierarchy と衝突する

単一 component の typography、color、spacing、state の詳細設計だけが問題なら、その domain Skill を優先する。

## 1. Inspect semantic priority first

見た目を変更する前に、current artifact で情報と操作の優先順位を確認する。

最低限整理する:

- user がこの surface で最初に理解すべきこと
- 最初に実行すべき / 最も頻繁な action
- current object / page / task identity
- decision に必要な supporting information
- secondary / optional / reference-only information
- warning / error / selected / pending など state-specific information
- user が比較・探索・入力のどれをしているか

最初から `primary = blue`、`secondary = small gray text` のように visual treatment を決めない。

priority と presentation を分離して考える。

## 2. Define attention targets

surface ごとに、固定の階層数ではなく **relative attention targets** を作る。

例:

```text
first attention
  current task / decisive content / dominant action

next attention
  supporting context / alternative action / comparison target

available but quiet
  metadata / low-frequency action / explanatory detail
```

すべての情報を一列の rank にする必要はない。

別 region では local hierarchy を持てる。ただし local primary が page primary より常に強く見える状態を作らない。

## 3. Observe references before choosing a treatment

non-trivial な hierarchy work では `references/visual-hierarchy.md` の relevant source を複数開く。

reference では exact size / color / token をコピーせず、次を見る。

- 何が最初に見えるか
- その prominence は product/task priority と一致しているか
- どの visual channel が prominence を作っているか
- secondary information がどう subordinate されているか
- action hierarchy と content hierarchy が競合していないか
- emphasis が何個同時に存在するか
- dense / sparse context で同じ treatment の強さがどう変わるか
- selected / warning / error など transient state が structural hierarchy をどう上書きするか

## 4. Separate hierarchy level from expression channel

priority level と、それを表現する property を 1:1 に固定しない。

使える channel:

### Position / area

- early / prominent placement
- larger useful area
- stable alignment
- surrounding negative space

### Grouping / separation

- proximity
- section boundary
- container / surface relationship
- repeated alignment

### Typography

- size
- weight
- line treatment
- measure / width
- spacing before / after

### Contrast / color

- foreground-background contrast
- neutral-vs-accent allocation
- surface contrast
- selected / feedback emphasis

### Action treatment

- primary / secondary / quiet action distinction
- label visibility
- placement relative to task content

### Imagery / iconography

- image area
- crop / focal point
- illustration prominence
- icon presence and scale

一つの primary target に **全 channel を最大強度で重ねない**。

大きい + bold + saturated + raised + centered + isolated + animated を同時に使わなくても hierarchy は作れる。

## 5. Manage salience competition

hierarchy は absolute style ではなく relative relationship で成立する。

強い treatment を追加する前に、競合する既存 emphasis を確認する。

特に見る:

- primary action が複数並んでいないか
- heading / KPI / illustration / banner が同じ強さで競合していないか
- every card が accent / shadow / border で浮いていないか
- metadata まで bold / high contrast になっていないか
- status color が通常 content より常に強くなっていないか
- selected state と destructive / warning state の意味が visual prominence だけで衝突していないか

必要なら新しい emphasis を足すより、secondary treatment を quiet にする。

**差が見えること**が hierarchy であり、すべてを強くすることではない。

## 6. Distinguish structural and transient hierarchy

### Structural hierarchy

比較的持続する:

- page / task identity
- main content
- primary action
- supporting content
- metadata

### Transient hierarchy

状態によって一時的に prominence が必要になる:

- error / blocking warning
- active selection
- focused editing state
- progress / pending
- temporary confirmation
- contextual action mode

transient emphasis は必要な間だけ structural hierarchy を上書きする。

一時 state の visual treatment を通常状態へ常時残さない。

status / destructive / selected の semantic color 自体は `color-system`、interaction behavior は `interaction-states` の責務とする。

## 7. Preserve semantic structure

visual hierarchy と semantic structure を別物として扱うが、意図的な理由なく矛盾させない。

確認する:

- visual heading relationship と document / accessibility heading structure
- visual order と reading / focus / DOM order
- primary-looking control と実際の task priority
- visually quiet information が task completion に必須ではないか
- visual grouping と semantic group / label relationship

semantic heading level を、見た目のサイズを得るためだけに変更しない。

逆に semantic structure が正しいだけで rendered hierarchy が十分とは判断しない。

## 8. Translate within the current design system

reference の exact treatment をコピーせず、current project の primitives へ翻訳する。

例:

悪い例:

> Reference の primary heading が 32px / semibold なので同じ値にする。

良い例:

> Reference は task identity を body/supporting content から scale + spacing で分離している。current type scale と spacing tokens の中で同じ relative separation を作る。

優先する:

- existing semantic type roles
- existing surface / content / action color roles
- existing spacing / layout primitives
- existing action variants
- established imagery / icon language

hierarchy repair のためだけに新しい token family を大量追加しない。

## 9. Coordinate with neighboring Skills

### `layout-system`

layout-system は grid、area、pane、alignment、scroll ownership を決める。
visual-hierarchy は、その geometry が priority をどう表現するかを cross-channel で確認する。

### `typesetting`

typesetting は text role、measure、line-height、line break、mixed-script behavior を決める。
visual-hierarchy は text treatment が他の visual channel と比較して強すぎ / 弱すぎないかを見る。

### `color-system`

color-system は semantic color role、surface hierarchy、theme/state color を決める。
visual-hierarchy は accent / contrast の配分が overall attention order と一致するかを見る。

### `information-density`

information-density は task に必要な information-per-view と geometric compression を決める。
visual-hierarchy は圧縮後も priority / grouping / scan anchors が残るかを見る。

### `content-design`

content-design は wording、content sequence、labels、instructions を扱う。
visual-hierarchy はその semantic priority を rendered surface で正しく見せる。

## 10. Failure modes

避ける:

- hierarchy = font-size scale と考える
- primary information を brand/accent color だけで示す
- all cards / panels / headings を同じ強さで emphasize する
- importance を表すために every element を bold にする
- secondary information を単に tiny / low-contrast にする
- destructive / warning color を「目立つから primary action」に流用する
- local component の primary treatment が page-level task を食う
- selected / hover / focus state が通常 hierarchy より恒常的に強い
- responsive で geometry だけ変え、priority order が逆転する
- localization の長文化で primary label が truncation され、metadata の方が目立つ
- visual order のためだけに semantic / focus order を不自然に変える
- grayscale にすると hierarchy が完全に消えるほど hue だけへ依存する
- reference 固有の exact size / contrast / spacing を universal rule にする

## 11. Verify the rendered hierarchy

source code / token assignment だけで完了しない。

representative artifact を実際に render して確認する。

### A. Normal-view scan

数秒で見る:

- 最初に何へ目が行くか
- 次に何を読む / 操作するか
- supporting information が見つかるか
- intended priority と apparent priority が一致するか

「必ず同じ視線経路になる」ことを要求しない。
重要なのは competing targets や misleading prominence がないこと。

### B. Competition check

同時に強い要素を列挙する。

- heading
- primary action
- alert
- KPI
- illustration / media
- selected state
- floating controls

複数が primary attention を要求するなら、task reason があるか確認する。

### C. Reduced-color inspection

必要に応じて grayscale / low-saturation view を確認する。

目的は monochrome でも同一 appearance にすることではない。
color 以外の size / spacing / grouping / typography でも基本 hierarchy が残るかを見る。

### D. Real-content stress test

最低限:

- typical content
- long realistic labels / titles
- dense metadata
- empty / loading / error / selected state
- localization expansion が relevant なら translated content

placeholder の短文だけで判断しない。

### E. Environment transformation

Web/UI なら可能な範囲で:

- wide
- narrow
- browser zoom / text enlargement
- light / dark
- high-contrast path がある場合

を確認する。

同じ geometry を維持する必要はない。
**priority relationship が維持されているか**を見る。

### F. Compare alternatives when hierarchy is ambiguous

問題が解消したか判断しにくい場合、materially different な 2 案を render して比較する。

例:

- area/placement 主導 vs typography 主導
- stronger primary vs quieter secondary
- image-led vs content-led

細かな 1px / 1-step 差だけを A/B 案にしない。

## 12. Completion

完了条件:

- semantic/task priority を visual treatment より先に整理した
- hierarchy level と expression channel を分離した
- multiple channels の相互作用を確認した
- competing emphasis を減らした
- structural hierarchy と transient state を分離した
- neighboring Skills の canonical responsibility を侵食していない
- realistic rendered artifact で scan / competition / content / environment stress を確認した

実 project trial が未実施なら experimental state のまま扱う。
