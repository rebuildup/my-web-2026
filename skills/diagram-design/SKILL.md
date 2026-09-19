---
name: diagram-design
description: >
  Use this skill when designing architecture, process, hierarchy, relationship, or explanatory diagrams
  that must communicate a specific question through consistent nodes, connectors, grouping, labels, and abstraction.
---

# Diagram Design

architecture / process / flow / hierarchy / relationship / explanatory diagram を、box と arrow の装飾ではなく**特定の問いに答える visual model**として設計する。

Mermaid / Graphviz / diagrams.net / Figma / Visio / SVG は renderer であり、diagram semantics の source of truth にはしない。

## Workflow

1. diagram が答える question、audience、decision / explanation の目的を一文で固定する。
2. 必要な abstraction level と diagram type を選び、1枚にすべての detail を詰めない。
3. 下記 reference を開き、node / connector / grouping / label / legend / progressive disclosure を比較する。
4. visual difference を semantic difference に対応させ、同じ意味には同じ表現を使う。
5. layout を flow と relationship に従って整理し、crossing / ambiguity / unlabeled relation を減らす。
6. final render と text alternative の両方で理解可能か検証する。

## Observe

- purpose and audience: architecture review / onboarding / process explanation / executive overview の違い
- abstraction: context / container / component / sequence / topology 等の detail level
- node semantics: shape / size / border / icon / fill が何を意味するか
- connector semantics: direction、line style、label、request/response、dependency、sequence
- grouping: boundary / zone / subsystem / ownership / trust boundary がどう示されるか
- flow: dominant direction と scan order が安定しているか
- labels: node / edge / group の名前が短く具体的か
- consistency: 同種要素の casing / icon size / line weight / arrowhead / spacing
- progressive disclosure: overview から detail diagram へ分割できるか
- legend / metadata: custom semantics、scope、version、last updated が理解できるか
- accessibility: color-only encoding を避け、pattern / line style / labels を併用しているか
- alternate representation: complex diagram の essential information を text でも説明できるか

## Decision rules

- diagram type は「描きやすいもの」ではなく、audience が答えを得たい question から選ぶ。
- 一つの visual difference に一つの意味を持たせる。semantic difference がないのに node style を増やさない。
- relationship は可能なら direction を明示し、bidirectional arrow で曖昧さを隠さない。
- edge crossing を減らすために layout を曲げる前に、diagram の abstraction が過剰でないか見直す。
- overview に detail を詰めず、context → focused detail の複数 diagram に分ける。
- vendor / product icon を使う場合は official icon と product name を尊重し、generic concept の代用にしない。
- color だけを status / type の唯一の encoding にしない。

## References

- [IBM Design Language — Technical diagrams: Design](https://www.ibm.com/design/language/infographics/technical-diagrams/design/)
  - Observe: node families, connectors, typography, grid, spacing, color, additional semantics
  - Useful for: technical / architecture / process diagrams の visual system
- [IBM Design Language — Technical diagrams: Usage](https://www.ibm.com/design/language/infographics/technical-diagrams/usage/)
  - Observe: clarity, node-type mixing, documentation / presentation / white-paper usage, subsystem extensions
  - Useful for: diagram family を複数mediaへ展開するとき
- [Microsoft Azure Well-Architected — Architecture design diagrams](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams)
  - Observe: audience-driven diagram type, arrow direction, labeling, legends, accuracy, metadata, layering
  - Useful for: architecture diagrams and multi-level technical communication
- [Microsoft Azure Architecture Center — Azure icons](https://learn.microsoft.com/en-us/azure/architecture/icons/)
  - Observe: official icon usage, product labels, distortion / recolor avoidance
  - Useful for: vendor-specific architecture diagrams
- [W3C WAI — Complex Images](https://www.w3.org/WAI/tutorials/images/complex/)
  - Observe: flowchart / organizational chart / diagram の equivalent long description
  - Useful for: diagram accessibility and non-visual fallback

## Avoid

- node / arrow / color の意味を定義せず、見た目だけを増やす
- every subsystem / runtime path / data classification を一枚へ入れる
- relationship label のない line を大量に交差させる
- official service icon を変形・回転・意味変更して使う
- IBM 等の reference 固有の grid 値や色を current project に blind copy する
- diagram source が生成できたことを clarity の証拠にする

## Verify

- diagram を初見の target audience に相当する視点で見て、何を示す図か数秒で特定できるか確認する。
- legend を隠しても standard semantics が理解でき、custom semantics は legend で復元できるか確認する。
- grayscale / color-vision simulation でも type / status / flow が区別できるか確認する。
- small display / document embed / presentation projection で label が読めるか確認する。
- edge crossing、ambiguous direction、orphan node、inconsistent style、stale metadata を目視監査する。
- complex diagram には essential relationships を説明する text alternative / long description を用意し、visual を見なくても主要情報が伝わるか確認する。

## Current status

Experimental initial skill. Real architecture / process diagram trial 後に abstraction selection と visual-density gate を refinement する。

Last reviewed: 2026-09-12
