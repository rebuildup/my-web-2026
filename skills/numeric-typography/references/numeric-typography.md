# Numeric Typography References

Last reviewed: 2026-09-14

この reference set は numeral treatment を特定の製品・書体の preset としてコピーするためではなく、figure style、comparison、locale、mixed-script の判断根拠を比較するために使う。

## Specifications and font semantics

- [W3C — CSS Fonts Module Level 4](https://www.w3.org/TR/css-fonts-4/)
  - Observe: `lining-nums` / `oldstyle-nums`、`proportional-nums` / `tabular-nums`、fractions、ordinals、slashed zero の semantics。
  - Useful for: Web で figure behavior を指定するときの canonical semantics。
  - Important distinction: specification 自身が prose の proportional figures と price table の tabular figures を別用途として例示する。feature の存在を universal visual rule にしない。

- [Microsoft — OpenType feature registry](https://learn.microsoft.com/en-us/typography/opentype/spec/featurelist)
  - Observe: `lnum`、`onum`、`pnum`、`tnum`、`zero`、`frac`、`ordn` 等の registered feature tags。
  - Useful for: CSS / desktop publishing toolを跨いで OpenType feature identity を確認する。
  - Avoid: tag 名だけから current font が feature を実装していると仮定しない。

- [Adobe InDesign — OpenType font attributes](https://helpx.adobe.com/indesign/desktop/fonts/opentype-font-attributes.html)
  - Observe: Tabular Lining / Proportional Oldstyle / Proportional Lining / Tabular Oldstyle、slashed zero、fraction/numerator/denominator の用途差。
  - Useful for: print/editorial artifact と figure-height × figure-width の組み合わせを比較する。
  - Current note: page was reviewed after its 2026-08-07 update.
  - Avoid: Adobe UI 操作手順を design source of truth にしない。

## Production design systems

- [Atlassian Design System — App typefaces and scale](https://atlassian.design/foundations/typography/product-typefaces-and-scale)
  - Observe: Atlassian Sans 内で tabular figures を tables/lists に、slashed zero を selected data points に限定して使う role separation。
  - Useful for: monospace family に切り替えず同一 UI family の OpenType feature を task 別に使う production evidence。
  - Avoid: Atlassian 固有の typeface feature choices を universal rule にする。

- [Atlassian Design System — MetricText](https://atlassian.design/components/primitives/metric-text)
  - Observe: body text とは別に metric display を first-class typography primitive として扱うこと。
  - Useful for: KPI / large metric が prose/table と別 role を持つ evidence。
  - Avoid: component API を numeric hierarchy の根拠にする。

- [GitHub Primer — DataTable guidelines](https://www.primer.style/product/components/data-table/guidelines/)
  - Observe: comparable numbers に right alignment と tabular-number treatment を組み合わせる guidance。
  - Useful for: exact lookup / comparison surface。
  - Avoid: number-like identifier へ同じ rule を機械適用しない。

- [GOV.UK Design System — Table](https://design-system.service.gov.uk/components/table/)
  - Observe: columns of numbersを比較するときに right alignment を使う条件。
  - Useful for: alignment を visual decoration ではなく comparison task に結び付ける evidence。

- [GOV.UK Design System — Font override classes](https://design-system.service.gov.uk/styles/font-override-classes/)
  - Observe: equal-width tabular numbers が data table/reference number の比較と dynamic counters の visual stability にどう寄与するか。
  - Useful for: static comparison と updating value の両方。
  - Avoid: right alignment を body copy 全般へ拡張しない。

- [U.S. Web Design System — Table](https://designsystem.digital.gov/components/table/)
  - Observe: numerical sum の right alignment、column format/unit consistency、numeric data に対する monospace guidance。
  - Useful for: Primer/GOV.UK と異なる production policy を比較し、monospace recommendation が universal ではないことを確認する。
  - Trade-off: USWDS の monospace guidance と Primer/Atlassian の tabular-figure approach を比較し、current project font と role で決める。

## Locale and number formatting

- [Unicode CLDR — Number and currency patterns](https://cldr.unicode.org/translation/number-currency-formats/number-and-currency-patterns)
  - Observe: decimal/grouping、currency、percent、scientific、compact notation の locale差。English K/M/B/T と Japanese 万/億/兆 のような scale expression の違い。
  - Useful for: typography が semantic formatting を上書きしないための locale evidence。
  - Avoid: one locale の separators / symbol order / compact suffix を hard-code しない。

- [Unicode CLDR — Number symbols](https://cldr.unicode.org/translation/number-currency-formats/number-symbols)
  - Observe: decimal/grouping、plus/minus、percent/per-mille、approximately、exponent 等の locale symbols。
  - Useful for: glyph width、alignment、directionality、fallback の stress test。

- [Unicode CLDR — Currency names and symbols](https://cldr.unicode.org/translation/currency-names-and-symbols/currency-names)
  - Observe: currency symbol/name choice と locale/context の差。
  - Useful for: price / financial composition で value と affix を一体として確認する。

## Japanese and mixed-script composition

- [W3C — Requirements for Japanese Text Layout (JLReq)](https://www.w3.org/International/jlreq/)
  - Observe: Japanese と Western text / European numerals の混植、full-width fixed-width numerals、vertical composition、tate-chu-yoko 等。
  - Useful for: 日本語 editorial、縦組、全角/半角数字を含む mixed text。
  - Avoid: horizontal UI に vertical-writing rules を転用しない。

- [Digital Agency Design System — Typography](https://design.digital.go.jp/dads/foundations/typography/)
  - Observe: current Japanese production typography、Sans / Mono role separation、Japanese UI の text-role context。
  - Useful for: 日本語 product UI の surrounding typography を確認する。
  - Avoid: exact token values や family choice のコピー。

## Comparison axes

reference を比較するときは少なくとも以下を記録する。

- semantic numeric role: prose / quantity / metric / dynamic / identifier / fraction-ordinal
- figure height: lining / oldstyle / default
- figure width: proportional / tabular / monospaced family
- alignment owner: right edge / decimal / sign / unit / field separator
- separator / sign / currency / unit treatment
- dynamic width and digit-count boundary behavior
- identifier ambiguity and slashed-zero need
- font feature availability and fallback behavior
- locale pattern / symbol / directionality
- Japanese mixed-script / vertical-writing context
- narrow / zoom / print-export behavior

異なる source の違いは conflict として消さない。たとえば USWDS の monospace recommendation と Primer/Atlassian の tabular-figure approach は、数字の role・current font・artifact context を判断するための比較材料として保持する。
