# Visual hierarchy references

Last reviewed: 2026-09-14

この reference family は hierarchy の exact visual recipe をコピーするためではなく、**priority と relative emphasis の関係**を比較するために使う。

current project の brand / component / token / information architecture を source of truth とし、reference 固有の font size、color、spacing、button variant 名を universal rule にしない。

## Atlassian Design System — typography and hierarchy

- [Implementing typography at scale](https://atlassian.design/whats-new/implementing-typography-at-scale)
  - Observe: heading weight / scale contrast が information-dense screens の scanability にどう使われるか。
  - Observe: minimum body size を下げずに hierarchy を強める方法。
  - Useful for: dense application surfaces where heading differentiation has weakened.
  - Avoid copying: Atlassian Sans、exact type scale、brand-specific values.

- [Atlassian UI refresh updates](https://atlassian.design/whats-new/atlassian-ui-refresh-updates)
  - Observe: distinct heading levels、readability、scanability を system-wide change として扱う方法。
  - Useful for: hierarchy drift across many product surfaces.
  - Avoid copying: current Atlassian brand treatment as a generic modern-UI preset.

- [Applying typography](https://atlassian.design/foundations/typography/applying-typography/)
  - Observe: size / weight / text color の組み合わせで primary / secondary content を分ける方法。
  - Useful for: checking whether hierarchy depends on one typographic variable only.
  - Avoid copying: token names or exact style assignments without matching current project roles.

## Carbon Design System — typography, task context, and action hierarchy

- [Typography overview](https://carbondesignsystem.com/elements/typography/overview/)
  - Observe: type weight と size が独立ではなく relative relationship として hierarchy を作ること。
  - Useful for: comparing apparent prominence when size and weight point in different directions.
  - Avoid copying: IBM Plex-specific weights / exact values as universal hierarchy rules.

- [Typography style strategies](https://carbondesignsystem.com/elements/typography/style-strategies/)
  - Observe: productive / expressive treatment の contrast が task context と foreground/background emphasis にどう接続されるか。
  - Observe: component / region 内で inconsistent な type hierarchy を作らない考え方。
  - Useful for: distinguishing task-led emphasis from purely decorative scale contrast.
  - Avoid copying: Carbon's named type sets into unrelated products.

- [Common actions](https://carbondesignsystem.com/patterns/common-actions/)
  - Observe: action importance に応じた high / medium / low emphasis と、single primary action の関係。
  - Observe: remove 等の consequential action が常に visually primary ではないこと。
  - Useful for: aligning action prominence with task priority and consequence.
  - Avoid copying: component styling without checking current action semantics.

- [Structured list](https://carbondesignsystem.com/components/structured-list/usage/)
  - Observe: grouped information を logical / scannable pattern にし、row 内で hierarchy を作る方法。
  - Useful for: local hierarchy inside repeated dense structures.
  - Avoid copying: list structure when the data/task actually requires another representation.

## GOV.UK Design System — semantic and visual heading structure

- [Headings](https://design-system.service.gov.uk/styles/headings/)
  - Observe: consistent heading styles と semantic heading levels が clear content structure を作る関係。
  - Observe: visual balance のための例外が rare / intentional として扱われていること。
  - Useful for: checking whether visual heading treatment and document structure support the same reading intent.
  - Avoid copying: GOV.UK type sizes or service-specific appearance.

- [Paragraphs](https://design-system.service.gov.uk/styles/paragraphs/)
  - Observe: lead paragraph を限定して使い、routine body content 全体を強調しない方法。
  - Useful for: emphasis scarcity and introductory-content hierarchy.
  - Avoid copying: exact paragraph classes or fixed text sizes.

## Adobe Spectrum — emphasis scarcity and action prominence

Spectrum pages below are established Spectrum guidance retained as design evidence. Current project implementation/version status must be checked separately before using Spectrum component APIs.

- [Button](https://spectrum.adobe.com/page/button/)
  - Observe: accent / primary / secondary / negative を prominence と semantics で分ける方法。
  - Observe: stronger fill, size, and variant choices being constrained rather than applied to every action.
  - Useful for: action-hierarchy and salience-competition inspection.
  - Avoid copying: exact variant count, color, size, or button styling as a universal system.

- [Action button](https://spectrum.adobe.com/web/rsp/components/action-button)
  - Observe: dense application panelsでは default emphasis を抑え、core interaction / selected state だけ prominence を上げる考え方。
  - Useful for: professional-tool surfaces where controls can overpower content.
  - Avoid copying: blue selection styling or specific size vocabulary.

- [Action group](https://spectrum.adobe.com/page/action-group/)
  - Observe: a related set of actions can remain visually quiet unless that group itself needs focus.
  - Useful for: toolbar / control-group hierarchy.
  - Avoid copying: component arrangement without matching action relationships.

## U.S. Web Design System — structural hierarchy and navigation

- [Side navigation](https://designsystem.digital.gov/components/side-navigation/)
  - Observe: parent / current / child relationships and how navigation hierarchy stays legible without making every level equally prominent.
  - Useful for: checking local structural hierarchy in deep information architectures.
  - Avoid copying: USWDS navigation styling when current product navigation semantics differ.

- [Documentation page template](https://designsystem.digital.gov/templates/documentation-page/)
  - Observe: page title / section headings / navigation / prose relationships in a production-oriented content template.
  - Useful for: comparing content hierarchy to navigation hierarchy.
  - Avoid copying: federal-site layout or exact component composition.

## Comparison prompts

複数 reference を開いたら次を比較する。

- primary target は何か。何が primary でないか。
- prominence は size / weight / position / whitespace / color / surface / fill のどれから来るか。
- 一つの target に何個の emphasis channel を重ねているか。
- secondary item は unreadable にせずどう quiet にしているか。
- action hierarchy と content hierarchy が同時に成立しているか。
- dense context ではどの channel を抑え、scan anchor をどこに残しているか。
- transient state が structural hierarchy を上書きする条件は何か。
- semantic heading/navigation structure と visual prominence がどこで一致し、どこで意図的に分かれるか。
- theme / viewport / content length が変化しても priority relationship を維持できるか。

## Translation guardrails

- reference 固有の exact font size / weight / hex / spacing / shadow / radius をそのまま移植しない。
- brand asset / proprietary font / illustration language を hierarchy rule にしない。
- `accent`, `primary`, `expressive`, `productive` 等の system-specific vocabulary を current project の semantic role に翻訳する。
- single-primary-action の evidence を「全画面必ず primary button は1個」という universal law にしない。task / region / workflow structure を確認する。
- visual salience を semantic importance と同一視せず、error / selection / destructive consequence など transient semantics も区別する。
- grayscale は diagnostic tool として使い、全 hierarchy を無彩色でも同一に見せることを goal にしない。
