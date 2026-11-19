# Japanese / Mixed-script Typesetting References

Last reviewed: 2026-09-10

## Goal

日本語を Latin typography の preset へ押し込まず、禁則・約物・和欧混植・数字・fallback を含む **script-specific layout behavior** を観察する。

font の雰囲気ではなく、実際の line breaking と text geometry を見る。

## Primary specification references

### W3C Japanese Script Resources

Current overview:
https://www.w3.org/TR/jpan-lreq/

Observe / consult:

- line breaking / hyphenation requirements
- alignment / justification
- punctuation behavior
- ruby
- vertical text
- gaps between current browser support and Japanese requirements

このページは 2026 年時点の Japanese script resource hub として使う。
古い JLREQ だけを固定参照しない。

### W3C Requirements for Japanese Text Layout (JLREQ)

Japanese:
https://www.w3.org/TR/jlreq/

Use particularly for:

- 行頭禁則 / 行末禁則
- 約物の配置
- 文字間の空き量
- line breaking possibilities
- line adjustment
- ruby
- vertical / horizontal composition conventions

JLREQ の数値や出版組版 rule を Web UI に無条件移植しない。
まず current medium / renderer で必要な requirement を選ぶ。

### CSS Text Module Level 4

https://www.w3.org/TR/css-text-4/

Observe / consult:

- `line-break`
- `word-break`
- `overflow-wrap`
- CJK wrap opportunities
- Japanese phrase wrapping
- strict / normal / loose line breaking differences

property 名だけで対応済みと判断せず、target browser の actual rendering を確認する。

## Current Japanese design-system references

### Digital Agency Design System — Typography

Overview:
https://design.digital.go.jp/dads/foundations/typography/

Text styles:
https://design.digital.go.jp/dads/foundations/typography/text-style/

Accessibility:
https://design.digital.go.jp/dads/foundations/typography/accessibility/

Observe:

- Display / Standard / Dense / Oneline / Mono の role separation
- font size と line-height の組み合わせ
- dense UI と reading text を同一 scale にしない方法
- user font replacement / zoom を前提にした設計
- 日本語 glyph density に対する line-height

Do not copy:

- token names
- exact px values
- government-specific visual identity

Extract role separation and stress conditions.

### SmartHR Design System — Typography

Brand typography:
https://smarthr.design/basics/typography/

Product typography tokens:
https://smarthr.design/products/design-tokens/typography/

Observe:

- system / fallback font を選ぶ理由
- OS / language rendering への配慮
- heading / paragraph / label / table の role separation
- numeric table alignment
- font availability と performance の trade-off

## Mixed-script inspection checklist

日本語 + Latin + 数字が同一 block に存在する sample を必ず render する。

確認:

- apparent glyph size
- baseline
- weight equivalence
- punctuation width
- parentheses / slash / colon / percentage / currency
- full-width / half-width symbols
- Latin word wrapping
- long English identifier inside Japanese prose
- fallback glyph substitution
- numbers in tables

## Line-break stress samples

少なくとも以下を試す。

- 句読点が line head / end 付近に来る文章
- 括弧が連続する文章
- 小書き仮名 / 長音記号を含む語
- 日本語内の長い English word / URL / identifier
- 日本語 + 半角数字 + 単位
- heading の意味境界付近での改行

manual `<br>` で一つの viewport だけ整える前に、renderer の wrap behavior を理解する。

## Failure modes

- `word-break: break-all` を万能な overflow fix にする
- 日本語本文へ広い `letter-spacing` を一律適用する
- Latin font と Japanese font の CSS size が同じだから optical size も同じとみなす
- fallback を確認しない
- short Japanese label だけで typography QA を終える
- JLREQ の print-oriented rule を context 無視で Web UI に移植する
