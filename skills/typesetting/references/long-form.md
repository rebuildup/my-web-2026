# Long-form / Reading Typesetting References

Last reviewed: 2026-09-10

## Goal

article、documentation、guidance、report などの長文を、単なる `max-width` と本文サイズではなく **reading continuity / scan hierarchy / paragraph rhythm** として観察する。

## Primary references

### GOV.UK — Content and Publishing Guidance

Production guidance site:
https://guidance.publishing.service.gov.uk/

Content design guidance:
https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/understand-content-design/

Observe:

- title / lead / section heading / body の hierarchy
- paragraph length
- list usage
- content width
- section rhythm
- navigation / contents と本文の関係
- dense policy information を scan 可能に保つ方法

### GOV.UK Design System — Headings / Lists

Headings:
https://design-system.service.gov.uk/styles/headings/

Lists:
https://design-system.service.gov.uk/styles/lists/

Observe:

- long-form page 用の heading scale
- heading level と visual hierarchy の consistency
- multi-line heading
- list item が複数行になる場合の spacing
- small-screen typography changes

### W3C — Japanese Script Resources / JLREQ

Japanese Script Resources:
https://www.w3.org/TR/jpan-lreq/

JLREQ:
https://www.w3.org/TR/jlreq/

Japanese long-form では以下を合わせて確認する。

- line break behavior
- punctuation
- paragraph layout
- justification / alignment
- ruby
- vertical writing requirements if relevant

### SmartHR Design System

Production site:
https://smarthr.design/

Typography:
https://smarthr.design/products/design-tokens/typography/

Observe rendered documentation pages as actual Japanese long-form surfaces:

- Japanese body measure
- heading intervals
- inline code / links / lists
- metadata / side navigation と reading column の relation
- Japanese / Latin mixed text

## Extraction checklist

### Reading column

- width at normal desktop viewport
- behavior on wide viewport
- behavior on narrow viewport
- whether media / tables break out of the prose measure
- whether navigation affects reading width

### Vertical rhythm

- body line-height
- paragraph gap
- heading before / after spacing
- list item spacing
- quote / note spacing
- section boundary

isolated values より ratio と recurring pattern を見る。

### Scan hierarchy

page を本文まで読まずに眺め、以下が識別できるか確認する。

- page title
- lead / summary
- section hierarchy
- list / procedure
- note / warning
- metadata

bold の多用で hierarchy を作らない。

### Line-break quality

- heading が一語だけ次行へ残らないか
- Japanese punctuation が不自然な位置へ出ないか
- long English words / URLs / identifiers が overflow しないか
- link / inline code が reading rhythm を壊さないか

### Content structures

prose だけでなく:

- unordered list
- ordered procedure
- definition-like content
- table
- quotation
- code block
- note / callout

を含めて確認する。

## Responsive inspection

mobile では desktop scale を一律縮小しない。

見る:

- reading width
- heading wrap
- line-height
- paragraph spacing
- list indentation
- table overflow
- contents navigation

font size の縮小より、layout / measure の変更で解決できないか先に確認する。

## Accessibility stress cases

- browser zoom 200%
- user font replacement / font scaling where applicable
- long headings
- long link text
- nested list
- Japanese + Latin mixed paragraph

content を fixed-height box に閉じ込めない。

## Failure modes

- viewport が広いほど本文も無制限に広げる
- heading / paragraph / list の spacing を個別値で増殖させる
- visual balance のためだけに heading semantics を崩す
- centered body copy を長文へ使う
- renderer の quality を確認せず full justification を使う
- manual line breaks で特定 viewport の heading shape を固定する
- long-form readability を font choice だけで解決しようとする
