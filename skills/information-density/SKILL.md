---
name: information-density
description: >
  Design task-appropriate information density for dense web and application interfaces without reducing density to smaller text or tighter spacing.
---

# Information Density

情報密度を「全部を小さくして同じ画面へ詰め込むこと」と解釈しない。

この Skill は、一覧・運用画面・管理画面・編集ツール・ダッシュボードなどで、**利用者が一度に比較・走査・操作する必要がある情報量**と、読みやすさ・操作性・入力方式の制約を両立させるときに使う。

**Task → Information needed together → Grouping / hierarchy → Geometric density → Disclosure → Verify** の順で判断する。

## When to use

使う対象:

- 多数の行・項目・metadata を比較または走査する surface
- toolbar / list / table / inspector / side panel が同居する operational UI
- comfortable / compact / condensed 等の density mode を設計するとき
- 「もっと一画面に情報を出したい」という要求を、可読性や target size を壊さず具体化するとき
- density が高すぎて hierarchy が消えている、または低すぎて比較のための scrolling / context switching が増えている interface

単なる page grid や responsive breakpoint の設計には使わない。`layout-system` / `responsive-design` の責務を置き換えない。

## Workflow

1. **Inspect** current surface の user task、比較単位、視線移動、input capability、既存 tokens / components を確認する。
2. **Extract** reference 間で「何を同時に見せるか」「何を圧縮するか」「何を維持するか」「何を後段へ送るか」を比較する。
3. **Translate** density を情報構造・spacing・control geometry・disclosure の複数軸へ分解する。
4. **Implement** current design system の既存 scale / component variant を優先し、一貫した surface-level policy として適用する。
5. **Verify** 実データ、複数 viewport、zoom、keyboard / pointer / touch 条件、density mode 切替で rendered result を確認する。

## Observe

reference を開いたら次を観察する。

### Task and comparison unit

- user が同時に見比べる必要がある単位は row / card / field / metric / action のどれか
- primary task は scan、exact lookup、compare、monitor、edit、triage のどれか
- 一画面に多く出すことで本当に task が速くなるか
- scrolling を減らす代わりに認知負荷や誤操作が増えていないか

**density の理由を viewport utilization ではなく task に置く。**

### Information-per-view

- 同時に表示される row / item / field / metadata の量
- primary / secondary / tertiary information の区別
- repeated label を省略しても column / group context から意味が保てるか
- detail を常時表示すべきか、progressive disclosure / inspector / expansion へ送れるか
- comparison に必要な情報を別 surface へ分散させていないか

### Geometric density

情報量とは別に、次を個別に見る。

- row / control height
- vertical / horizontal padding
- inter-group spacing
- label-to-value spacing
- icon / control footprint
- hit target と visible glyph の差
- line count / wrapping

compact 化で **font size と semantic hierarchy まで一緒に縮める必要はない**。SAP Fiori の compact/cozy 比較のように、文字サイズを維持しながら component dimensions と spacing を変える設計もある。

### Hierarchy under compression

- section / group boundary が spacing、divider、heading、alignment のどれで維持されるか
- primary action と row-local action の visual weight が衝突していないか
- metadata が本文と同じ強さになっていないか
- dense state でも column / baseline / key line が走査を助けるか
- whitespace を減らした結果、別 group が一つの塊に見えていないか

密度を上げるほど **alignment と grouping の品質**を上げる。

### Density mode

comfortable / compact 等の mode がある場合は、単なる global scale multiplier にしない。

比較する:

- 何が変わるか: control height / padding / row gap / visible metadata / target area
- 何を維持するか: font readability / hierarchy / semantics / feature availability
- mode が app-level か component-level か
- user preference を保存するか
- mixed-input device で automatic detection と user preference のどちらを優先するか

同一 hierarchy 内で理由なく density variant を混在させない。ただし、data table と marketing-style summary のように task が異なる region は、同じ数値へ揃えること自体を目的にしない。

### Input and target constraints

高密度でも pointer target を visible icon と同じ大きさに限定しない。

- visible control と interactive target area を分けられるか
- 隣接 target の誤操作 risk はないか
- touch / pen / mouse が混在するか
- compact mode が essential operation を細かすぎる target にしていないか
- density preference を利用者が調整する価値があるか

WCAG の minimum target size / spacing は **design optimum ではなく下限 constraint** として扱う。数値を「高密度UIの標準サイズ」として逆利用しない。

### Responsive and zoom behavior

- narrow width で高密度 desktop layout をそのまま縮小していないか
- zoom / text enlargement で row height が内容を clip しないか
- hidden metadata が task-critical information を失わせないか
- dense table / list が必要なら semantic overflow を局所化できるか
- density mode と responsive transformation を同じものとして扱っていないか

`responsive-design` は available space に対する reflow / transform を所有する。この Skill は各 state 内での information-per-view と geometric density の判断を所有する。

## Decision rules

### 1. Start from simultaneous information need

まず「この task で何を同時に見られる必要があるか」を決める。

高密度が向く例:

- 多数の近接項目を比較する
- status / metric を横断的に走査する
- repeated operations を高速に行う
- context を保ったまま複数 item を triage する

低〜中密度が向く例:

- 項目を一つずつ理解・入力する
- 誤操作 cost が高い
- long-form reading が中心
- touch-first で精密な pointing を期待できない

### 2. Compress repetition before meaning

密度を上げるときは次の順で検討する。

1. 重複した container / decoration を減らす
2. repeated labels を shared header / group context に統合する
3. spacing / control chrome を既存 compact scale 内で調整する
4. secondary detail を progressive disclosure へ送る
5. それでも必要な場合だけ layout structure を再設計する

本文・label の font size を最初に縮めない。

### 3. Preserve scan anchors

compact state でも、比較を助ける alignment、column、baseline、group heading、state cue を残す。

space を削ることで scan anchor が消えるなら、情報密度ではなく **visual ambiguity** が増えている。

### 4. Use modes only when they represent a real user need

comfortable / compact toggle は、単に設定項目を増やすために作らない。

次の場合に検討する:

- 同じ product が touch と precise pointer の両方で常用される
- novice / occasional use と expert / high-throughput use の双方がある
- users が表示件数と操作余白の trade-off を繰り返し選びたい

mode を提供する場合、選択を可能なら persist し、mode 間で情報 semantics や action availability を不必要に変えない。

### 5. Treat local compact variants as task-specific

table row、toolbar button、metadata list など component-local compact variant は有効だが、page 全体を無条件で compact にする根拠にはならない。

局所 variant は surrounding task と hierarchy に合わせる。

### 6. Do not confuse hidden information with reduced density

critical context を tooltip / hover / menu の奥へ移して「すっきり」させても、task が遅くなるなら改善ではない。

比較・判断に必要な情報は同時表示を優先し、rare detail や secondary explanation を disclosure 候補にする。

## Responsibility boundaries

### `information-density`

Owns:

- information-per-view の task-driven 判断
- geometric density と information density の分離
- compact / comfortable policy
- dense surface 内の grouping / scan anchors / disclosure balance
- density-specific rendered verification

### `layout-system`

Owns page / region composition、grid、alignment system、macro spatial structure。

### `responsive-design`

Owns viewport / container / zoom に応じた reflow、breakpoint、responsive transformation、overflow ownership。

### `table-design`

Owns table semantics、row/column structure、sort / filter / select / action、table固有の responsive behavior。情報密度は table size を選ぶ際の一入力に留める。

### `touch-interface`

Owns touch / coarse-pointer interaction model、gesture、target reliability、mixed-input operation。ここでは density がそれらを破壊しないかだけ確認する。

### `visual-hierarchy`

将来独立 Skill 化する場合は、cross-domain の priority / emphasis system を所有する。information-density は compression 後も hierarchy が保たれるかを consumer として検証する。

## References

詳細な source-specific observation は [`references/information-density.md`](./references/information-density.md) を開く。

reference 固有の px 値、component name、brand expression を universal rule としてコピーしない。

## Avoid

- 「professional tool だから小さくする」のように persona label だけで compact 化する
- font size を縮めることを density strategy の中心にする
- card / border / divider を増やし、content 数だけ増やす
- every metadata field を常時表示して scan hierarchy を失う
- critical comparison data を hover-only にする
- touch-capable環境を無視して adjacent target を過密化する
- page 内で compact / comfortable を理由なく混在させる
- density mode ごとに別機能セットを作り、layout preference と product capability を混同する
- screenshot 1枚の「情報量が多い」印象だけで成功判定する

## Verify

最終 rendered artifact を、実データまたは realistic な worst-case data で確認する。

### Task verification

- representative task を comfortable / compact の両方で完了する
- scan / compare task で必要情報が同時に見えるか確認する
- primary action と row-local / secondary action を取り違えないか確認する
- hidden detail を開く回数が task を不必要に分断していないか確認する

### Visual verification

- representative full-page screenshot と dense region の crop を比較する
- normal / long label / many metadata / selected / error / disabled 等を並べる
- group boundary、column alignment、baseline、state cue が compact state でも判別できるか見る
- densityを上げた結果、文字が極端に小さくなっていないか確認する

### Interaction / environment verification

- keyboard-only で dense surface を操作する
- mouse / trackpad と、対象productで必要なら touch / coarse-pointer でも誤操作を確認する
- narrow viewport で responsive transformation 後の density を見る
- browser zoom / text enlargement 後に clipping、overlap、hidden controls がないか見る
- overlay / menu / tooltip が density mode と矛盾した scale になっていないか見る

### Mode comparison

mode を持つ場合は side-by-side または同一 task の recording で比較し、次を記録する。

- viewport 内 item count
- primary task に必要な scroll / context switch の変化
- control target / spacing の変化
- hierarchy / readability の維持
- user preference persistence

**多く表示できたことだけを成功条件にしない。** task efficiency、誤操作、読みやすさ、context retention を合わせて判断する。

### Completion gate

real artifact trial で少なくとも一つの dense operational surface を comfortable / compact の双方または materially different な2 density案で比較し、rendered result と task flow を inspection するまで experimental status を超えて promotion しない。
