---
name: dark-mode-design
description: >
  Use when designing or reviewing a product's dark appearance. Preserve semantic roles,
  surface hierarchy, interaction meaning, assets, and system/user preference behavior
  across light and dark modes instead of inverting a light palette or recoloring by eye.
---

# Dark Mode Design

Last reviewed: 2026-09-12

Dark mode を「light theme の色を暗くする作業」にしない。

**Inspect → Extract → Translate → Implement → Verify** の順で、appearance が変わっても information hierarchy / interaction semantics / content legibility / product identity が保たれるように設計する。

`color-system` は semantic color role と token relationship を所有する。
この Skill は、その role を **dark appearance へどう変換し、どの context / asset / system UI まで一貫させるか** を所有する。

## Workflow

1. current color roles / themes / appearance settings / rendered screens を確認する。
2. `references/dark-mode.md` の primary references を開く。
3. light / dark を role-by-role で比較し、surface / content / state / asset の relationship を抽出する。
4. raw color inversion ではなく appearance transformation rule へ翻訳する。
5. representative common tasks を light / dark の両方で実装する。
6. rendered artifact と実 interaction を cross-mode で検証する。

## Observe

reference と current product で次を見る。

- appearance preference: system follow / app override / fixed appearance
- surface hierarchy: base / raised / nested / overlay / inverse
- content hierarchy: primary / secondary / tertiary / disabled
- accent prominence: hue / saturation / luminance / occupied area
- interaction states: hover / pressed / selected / focus / disabled
- semantic status: success / warning / error / destructive / info
- borders / dividers / shadows / elevation cues
- imagery / illustration / logo / icon treatment
- code / chart / media / canvas surfaces
- browser / platform-provided controls and chrome
- increased/high-contrast combination where supported
- transition/loading behavior when appearance changes

## Decision rules

### Preserve roles, not values

Light と dark で同じ hex / tone progression を維持することを目的にしない。

保持するのは:

- 何が base surface か
- 何が foreground hierarchy か
- 何が interactive / selected / destructive か
- 何がより近い / raised / emphasized surface か
- 何が brand-bearing か

具体値は appearance ごとに変えてよい。

### Do not invert

light palette を数学的に反転して dark palette を作らない。

単純 inversion は以下を壊しやすい:

- semantic status color の意味と prominence
- image / logo / illustration
- shadow / overlay / scrim
- border / divider hierarchy
- focus / selection state
- native/browser controls
- brand color identity

必要な role だけを appearance-specific value へ再割り当てする。

### Build dark surface hierarchy intentionally

「dark = pure black background」に固定しない。

Dark surface では、system / product によって depth を **より明るい layer** として表す場合がある。Carbon の dark theme のような layering を観察し、current product の base → nested → raised の順序を決める。

pure black / near-black / dark gray のどれを使うかは、content type、platform、display、brand、viewing context に基づいて決める。

### Rebalance prominence

dark surroundings では同じ accent / white / saturated color が light appearance より強く見えることがある。

確認する:

- primary action が画面全体を支配しないか
- status color が neon-like に浮いていないか
- secondary text が必要以上に明るくないか
- divider / border が foreground と競合しないか
- large bright region が低照度環境で不快になっていないか

単純に contrast ratio が高いことだけを quality にしない。

### Theme-specific vs static color

多くの UI foreground / border / state color は appearance に適応する theme-specific role とする。

static color を使うのは、例えば:

- hue identity 自体が意味を持つ asset / badge
- brand mark
- self-contained background + foreground pair
- media / artwork whose color should not follow UI theme

のように、appearance を跨いで identity を保持する理由がある場合だけにする。

static color でも周囲との contrast / visual weight は両 appearance で確認する。

### Respect preference without hiding product choice

system-wide appearance preference を利用する product は、その preference を初期状態として尊重する。

product が manual override を提供する場合は:

- system / light / dark の意味を混同しない
- user choice を予期せず上書きしない
- page / modal / embedded region で appearance が不意に分裂しない

content-specific reason がある tool（photo/video editing など）では、device light mode でも dark application theme が成立する場合がある。Spectrum の device mode と app color theme の分離を参考に、product context から判断する。

### Coordinate browser / platform chrome

Web では author-styled surface だけ dark にして、browser-provided form control / scrollbar / canvas / default UI が light のまま残らないようにする。

`color-scheme` / `prefers-color-scheme` 等は implementation mechanism として扱い、Skill の source of truth にはしない。重要なのは **実際に support している appearance を user agent に正しく伝え、foreground/background pair を coherent にすること**。

### Treat assets as part of the theme

色 token だけ切り替えて完了しない。

確認する:

- logo with baked background
- illustration with white canvas
- screenshot / mockup
- SVG with hard-coded fills
- image border / transparent edge
- chart / heatmap / code syntax colors
- empty-state artwork

必要なら appearance-specific variant を作るが、photograph や user content を機械的に暗くしない。

### Dark mode is not high contrast mode

Dark appearance と increased/high contrast は別軸。

暗い UI が存在するだけで high-contrast 対応済みとしない。platform が Increase Contrast / forced colors 等を持つ場合は別 combination として検証し、広範な conformance audit は `accessibility-audit`、forced/high-contrast 固有設計は `high-contrast-design` 候補へ渡す。

## Boundaries

- `color-system`: semantic color roles / brand allocation / general palette relationships
- `interaction-states`: focus / pressed / selected / disabled 等の state semantics
- `accessibility-audit`: broad contrast and accessibility re-testing
- `data-visualization`: chart-specific encoding / palette behavior
- `high-contrast-design`: forced/high-contrast appearance as a separate mode

この Skill は dark appearance transformation と cross-mode continuity に集中する。

## Avoid

- light theme の RGB/HSL inversion
- every dark surface = pure black
- white text + black background を「完成形」とみなす
- light theme と同じ saturated accent を無検証で使う
- shadows / borders / disabled states を light theme のままコピーする
- image / SVG / chart / code surface を theme 対象から漏らす
- system preference を読んだだけで native/browser chrome との整合を確認しない
- dark mode を accessibility / high contrast の代替にする
- exact reference color value を product context 無視でコピーする

## Verify

同一の representative task を light / dark で並べて確認する。

最低限含める:

- base page + nested/raised surface
- dense text and controls
- primary / secondary / destructive actions
- hover / pressed / selected / focus / disabled
- success / warning / error
- form controls and browser/platform-provided UI
- modal / popover / tooltip / overlay
- image / illustration / logo / SVG
- chart / code / media surface が存在する場合
- loading / empty / error state

確認する:

- role と information hierarchy が appearance を跨いで同じか
- dark surface depth が collapse していないか
- bright/saturated element が過剰な attention を取らないか
- text / icon / non-text UI の contrast が supported appearance ごとに成立するか
- focus / selected / destructive state が dark mode でも識別できるか
- theme-specific asset の edge / background mismatch がないか
- native/browser controls が page appearance と矛盾していないか
- system preference と app override の切替で stale / mixed appearance が残らないか

platform に increased contrast がある場合は dark + increased contrast も確認する。

## Completion

完了条件:

- dark appearance が inversion ではなく role-preserving transformation になっている
- surface / content / state hierarchy が dark でも成立している
- system/app appearance preference の挙動が定義されている
- assets と browser/platform chrome まで cross-mode review 済み
- common tasks を light / dark の rendered artifact で比較した
- accessibility issue が見つかった場合は `accessibility-audit` へ渡して再検証した
