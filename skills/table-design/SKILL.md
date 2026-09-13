---
name: table-design
description: >
  Use when designing, implementing, or reviewing tabular information for exact lookup,
  comparison, scanning, sorting, selection, or row-level actions. Decide whether the
  surface should remain a native table or become an interactive data grid, preserve
  row/column relationships across responsive states, and verify the rendered behavior
  with realistic dense data instead of treating a component-library table as the design.
---

# Table Design

Last reviewed: 2026-09-12

表を「行と列に border を付けたもの」として設計しない。

**Task → Structure → Density → Interaction model → Responsive strategy → Verify**

目的は、利用者が値を正確に探し、比較し、必要なら対象行へ操作できること。
chart / cards / spreadsheet / generic grid の代替として無条件に table を選ばない。

## Workflow

1. 実データに近い sample と user task を確認する。
2. table が lookup / comparison / scanning / resource operation のどれを担うか決める。
3. row identity、column semantics、unit、ordering、missing value を整理する。
4. reference を比較し、density / alignment / interaction / responsive behavior を決める。
5. native table と interactive grid のどちらが必要か明示する。
6. current project の components / tokens / conventions に翻訳して実装する。
7. dense / narrow / keyboard / zoom / localization state を rendered artifact で確認する。

## Observe

### Task and structure

- row は何を一意に表すか
- primary lookup key は何か
- user は row 間 / column 間のどちらを頻繁に比較するか
- column ごとの unit / precision / date format / status vocabulary
- missing / unknown / not-applicable の違い
- sort / filter / search / selection / row action / batch action の必要性
- source / period / last updated が理解に必要か

schema が一貫しない item 群を、見た目だけ table に揃えない。

### Row identity and headers

- primary name / identifier を row identity として追えるか
- column label は短く具体的か
- table 単独で意味が曖昧なら caption / title があるか
- source / period / attribution が必要なら table context に含まれるか
- icon-only action column も programmatic name を持つか

### Density and scanning

- 1 viewport で何 rows を比較する必要があるか
- single-line / multi-line のどちらが通常か
- row separator / zebra / hover のどれが horizontal tracking を助けるか
- whitespace が row grouping を壊していないか
- dense numeric data と descriptive text に同じ density を強制していないか
- table に十分な width があり、不必要な truncation を起こしていないか

同じ table 内で row height を無理由に混在させない。

### Alignment and formatting

- text は reading direction に沿っているか
- quantitative value は桁を追って比較しやすいか
- unit / precision / separator が column 内で一貫しているか
- date / identifier 等、数字に見えても arithmetic comparison しない値を機械的に right-align していないか

数値比較では right alignment や tabular numerals を検討する。
monospace font を universal rule にせず、**桁位置・unit・precision の一貫性**を優先する。

### Interaction state

- active sort column / direction が visual / programmatic に分かるか
- formatted display value と sort key が矛盾しないか
- search / filters / sort を併用しても current state を理解できるか
- selected state を color だけで示していないか
- selection が pagination / filtering を跨ぐ場合の scope が明確か
- frequent row action は発見可能か
- overflow action が touch / keyboard でも到達可能か
- batch mode で対象件数 / cancel / row-level action との競合が整理されているか

## Native table vs interactive grid

### Native table を基本にする

次の場合は native HTML table を優先する。

- 主目的が read / compare / lookup
- cell selection / editing が不要
- interactive elements が少数
- normal tab sequence で問題ない

sorting / filtering があるだけで composite grid にしない。

### Interactive grid を検討する

次の場合だけ grid interaction を検討する。

- 大量の cell 間を keyboard で効率よく移動する必要がある
- cell selection / editing が主要操作
- spreadsheet-like navigation が user expectation に合う
- managed focus によって多数の tab stops を減らす価値がある

grid を選ぶと arrow / Home / End 等のnavigation、focus management、editing mode、screen-reader behavior まで実装責任になる。
component library の名前だけで `DataGrid` を選ばない。

## Responsive: preserve or recompose

small width で table を機械的に cards 化しない。

最初に問う:

> 複数 row / column を同じ2D座標系で比較する必要があるか。

### Preserve + horizontal scroll

向いている:

- numerical comparison
- multiple columns の関係を追う
- header alignment が理解に不可欠
- dense operational data

確認:

- table 自身が overflow ownership を持つ
- keyboard / touch で scroll できる
- scrollbar / overflow の存在を隠さない
- row identity の文脈を失わない

### Stack / recompose

向いている:

- directory / resource list
- row 単位の理解が中心
- cross-column comparison が弱い
- text-heavy content

stack 後も各 value と column label の対応を維持する。
column comparison を失うため、「mobileだから」という理由だけでstackしない。

page全体の adaptation は `responsive-design` に委譲する。

## Long-table context

row 数が多い場合は必要に応じて:

- sticky header
- pagination
- virtualization
- persistent filter / sort summary
- row identity のcontext preservation

を検討する。

sticky / virtualization は visual effect としてではなく、keyboard / screen-reader / scroll behavior まで検証する。

## References

### Structure / semantics

- [W3C WAI — Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/)
  - Observe: header-data relationship、caption、row / column headers、complex header structure。
- [W3C ARIA APG — Table Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/table/)
  - Observe: static table と widget の境界、native HTML table を優先する理由。
- [W3C ARIA APG — Grid Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
  - Observe: composite grid の managed focus、cell navigation、editing、virtualized data の責務。

### Production design systems

- [GOV.UK Design System — Table](https://design-system.service.gov.uk/components/table/)
  - Observe: simple comparison、caption、row headers、numeric formatting、large-data restraint。
- [U.S. Web Design System — Table](https://designsystem.digital.gov/components/table/)
  - Observe: table / list / chart の境界、numeric alignment、scroll vs stack、sortable / sticky / compact variants。
- [IBM Carbon — Data table](https://carbondesignsystem.com/components/data-table/usage/)
  - Observe: density、toolbar、sort、search、selection、batch / inline actions、pagination。
- [GitHub Primer — DataTable](https://primer.style/product/components/data-table/)
  - Observe: row headers、column widths、numeric alignment、density、pagination、row actions。
- [Adobe Spectrum — Table](https://spectrum.adobe.com/page/table/)
  - Observe: scan / sort / compare / action、focus / selection、cell keyboard navigation。
- [Atlassian Design System — Dynamic table](https://atlassian.design/components/dynamic-table)
  - Observe: sorting / pagination / reordering と hierarchical table とのcomponent boundary。

## Boundaries

### `data-visualization`

chart selection、encoding、scale、trend / distribution / relationship のvisual explanation は担当しない。
`table-design` は exact values、row/column comparison、resource operation を担当する。

### `layout-system`

page / dashboard region allocation は担当しない。
dense table に必要な local width constraint だけを扱う。

### `responsive-design`

table geometry を preserve するか recompose するかだけを決める。
page-level breakpoint policy は委譲する。

### `accessibility-audit`

table-specific structure / interaction model はここで決める。
最終的な broad keyboard / contrast / zoom / semantic retest は `accessibility-audit` で再確認する。

## Avoid

- layout目的に table を使う
- chart が必要な analytical question を巨大tableで代替する
- spreadsheet-level interaction を simple table に詰め込む
- library component 名だけで native table / grid を決める
- column を増やし続け重要度を整理しない
- unit / precision / date format を同じ column 内で揺らす
- essential content / action を hover-only にする
- mobile で無条件に stacked cards へ変換する
- horizontal scroll を発生させながら存在を隠す
- sort icon の見た目だけ変えて sort state を伝えない

## Verify

realistic data で最低限確認する:

- 1 row / many rows
- few columns / many columns
- long row / column labels
- localized text
- large / negative / decimal numbers
- missing / unknown values
- narrow container
- zoom / font scaling
- touch + keyboard
- sorted / filtered / selected / empty / loading states
- pagination boundary

見る:

1. row identity と column meaning を追えるか。
2. frequent comparison direction に alignment / density が合っているか。
3. sort / filter / selection 後も state と result scope が理解できるか。
4. native table を不必要に grid 化していないか。grid なら managed focus が完全か。
5. scroll / stack の選択が comparison task を壊していないか。
6. scroll region / row actions を keyboard / touch で操作できるか。
7. caption / row header / column header / sort state を assistive technology で識別できるか。
8. wide / narrow / dense-data states の rendered result を比較したか。

`rendered without errors` や Storybook example が開いたことだけを完了条件にしない。
