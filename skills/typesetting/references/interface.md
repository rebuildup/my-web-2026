# Interface / Dense Typesetting References

Last reviewed: 2026-09-10

## Goal

application UI、forms、tables、navigation、metadata の文字組みを、単なる小さい font size ではなく **role / density / comparison / wrapping policy** として観察する。

## Primary references

### Digital Agency Design System — Typography

Overview:
https://design.digital.go.jp/dads/foundations/typography/

Text styles:
https://design.digital.go.jp/dads/foundations/typography/text-style/

Accessibility:
https://design.digital.go.jp/dads/foundations/typography/accessibility/

Observe:

- Display / Standard / Dense / Oneline / Mono の role separation
- dense text でも line-height を用途ごとに分ける方法
- one-line label と paragraph の扱いの違い
- text scaling / font replacement を想定した guidance
- semantic style family と raw size token の違い

Inspect rendered examples, not only token tables.

### SmartHR Design System — Product Typography

Typography tokens:
https://smarthr.design/products/design-tokens/typography/

Text component:
https://smarthr.design/products/components/text/

Production design system:
https://smarthr.design/

Observe:

- heading / paragraph / label / table の role separation
- comparable numbers の alignment
- semantic text component と HTML semantics の分離
- font availability / OS setting / multilingual rendering
- dense back-office UI に必要な hierarchy

Do not copy SmartHR-specific token names or font stack blindly.

### GOV.UK Design System — Styles / Headings

Styles:
https://design-system.service.gov.uk/styles/

Headings:
https://design-system.service.gov.uk/styles/headings/

Observe:

- semantic heading order と visual scale の関係
- long heading に対する scale choice
- small-screen type behavior
- form/service content での consistent hierarchy

GOV.UK の visual identity を模倣するためではなく、task-oriented service UI で text hierarchy を安定させる reference として使う。

## Interface inspection checklist

### Labels and values

- label と value の hierarchy が weight だけに依存していないか
- multi-line value で component height が破綻しないか
- helper / error / hint が tiny text になっていないか
- disabled state でも readable か

### Navigation

- active / inactive state の差
- long item label
- localization expansion
- truncation point
- icon + label baseline
- nested navigation の hierarchy

### Forms

- label / input / helper / error の reading order
- multi-line error
- required / optional notation
- placeholder と actual value の distinction
- zoom / user font scaling 時の clipping

### Tables and data

- numeric column alignment
- tabular numeral の必要性
- unit / sign / decimal / currency
- long headers
- dense row height
- wrapping vs horizontal scroll
- empty / unavailable values

column width を均等にする前に content distribution を観察する。

### Metadata

- timestamp
- status
- owner / author
- secondary attributes
- badges / tags

secondary だからという理由だけで一律に小さく薄くしない。

## Stress-test content

最低限:

- 1–2 character label
- long Japanese label
- long English label
- mixed Japanese / Latin identifier
- large integer / decimal / percentage
- negative value
- multi-line validation error
- missing value
- translated string expansion

## Failure modes

- UI density を font size の縮小だけで作る
- component の固定高に text を押し込む
- `ellipsis` を long-content strategy の標準にする
- every secondary text = tiny gray text
- all numeric columns left aligned
- heading visual style のために semantic heading level を壊す
- label/value/error の line-height を同じに固定する
