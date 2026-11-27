# Information Density References

Last reviewed: 2026-09-14

この reference set は「compact = 小さいUI」という単純化を避けるため、density mode、dense data surface、spacing foundation、target constraints を異なる first-party source で比較する。

## SAP Fiori — Content Density (Cozy and Compact)

- https://www.sap.com/design-system/fiori-design-web/v1-136/foundations/visual/cozy-compact
- Type: official design-system guidance
- Current status at review: Fiori web guideline version 1.136 page; current search also exposes newer guideline navigation.
- Observe:
  - cozy / compact を interaction style と information-density requirement に結び付ける方法
  - compact で font size は維持し、component dimensions / spaces を減らす分離
  - touchable area と visible element size の違い
  - hybrid device で automatic choice だけでなく user preference を持たせる設計
  - application-level density consistency
- Useful for:
  - density を typography shrink と同一視しない判断
  - mixed-input と persistent preference の trade-off
- Avoid copying:
  - SAP 固有 class 名、exact rem / px 値、app-level適用方式を universal implementation rule にしない

## SAP UI5 — How to Use Densities for Controls

- https://help.sap.com/docs/SAPUI5/7d0efeaa9ccd4731afb386284cfdc3a9/13e6f3bfc54c4bd7952403e20ff447e7.html
- Type: official implementation guidance
- Observe:
  - density が container hierarchy へ適用されること
  - library / component 間で default density が違うと inconsistent surface が生じ得ること
  - popup / dialog も surrounding density と整合させる必要
- Useful for:
  - local mismatch / overlay mismatch を failure mode として確認するとき
- Avoid copying:
  - framework CSS class や inheritance mechanics を design source of truth にしない

## Carbon Design System — Data Table / Style

- https://carbondesignsystem.com/components/data-table/style/
- Type: official design-system component specification
- Observe:
  - same semantic table に複数 row size があること
  - text hierarchy / typography と row geometry が別々に定義されていること
  - header / row size の整合
  - control target、row spacing、column spacing の関係
- Useful for:
  - dense operational table で geometric density を component variant として扱うとき
- Avoid copying:
  - Carbon 固有 row height や token value を他 system の既定値にしない

## Carbon Design System — Data Table / Usage

- https://carbondesignsystem.com/components/data-table/usage/
- Type: official design-system usage guidance
- Observe:
  - sizing variants と content line count の関係
  - toolbar / header / row / pagination から成る dense surface の hierarchy
  - row size を data structure に合わせる判断
- Useful for:
  - density が一つの number ではなく table anatomy 全体の整合で決まることを確認するとき

## GitHub Primer — DataTable

- https://primer.style/product/components/data-table/
- Type: first-party product design-system component
- Observe:
  - production-oriented data table の column / row / action surface
  - cell-density option と table-level operations の共存
  - dense data surface でも actions / semantics を維持する構造
- Useful for:
  - information-per-view と operational affordance を同時に観察するとき
- Avoid copying:
  - GitHub 固有 metadata や repository schema を density rule にしない

## GitHub Primer — ListView

- https://primer.style/product/internal-components/list-view/
- Type: first-party component implementation documentation
- Observe:
  - Comfortable / Condensed view mode の存在
  - density toggle と user selection persistence
  - list metadata / action bar と density mode の関係
- Useful for:
  - user-adjustable density が実 production tooling で成立する evidence
- Avoid copying:
  - internal component API / localStorage key pattern を universal design requirement にしない

## Atlassian Design System — Spacing

- https://atlassian.design/foundations/spacing
- Type: official design-system foundation
- Observe:
  - constrained spacing scale が consistency を作る方法
  - spacing system と customizable UI density の関係
  - arbitrary local tightening ではなく tokenized system を使う考え方
- Useful for:
  - density variant を random pixel reduction ではなく system-level scale として作るとき
- Avoid copying:
  - 8px base unit や token names を universal rule にしない

## Atlassian Design System — Button examples

- https://atlassian.design/guidelines/product/components/buttons
- Type: official component guidance
- Observe:
  - default / compact spacing を surrounding context、とくに table context に応じて選ぶ例
  - compact variant が global aesthetic ではなく task context に属すること
- Useful for:
  - component-local density variant と application-wide density mode を分けるとき

## W3C WAI — WCAG 2.2 Target Size (Minimum)

- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Type: official accessibility guidance for WCAG 2.2 SC 2.5.8
- Status at review: page updated under current WCAG 2.2 Understanding documentation; opened 2026-09-14.
- Observe:
  - target size と spacing の constraint
  - visible glyph size と interactive target の区別
  - small-target exceptions と adjacent-target risk
  - density control自体が利用者に有益になり得るという guidance
  - users により condensed / larger controls の preference が異なり得ること
- Useful for:
  - compact mode が operational reliability を壊していないか確認するとき
- Avoid copying:
  - minimum conformance value を「推奨 compact component size」へ読み替えない

## Cross-reference comparison

### Repeated findings

複数 source で繰り返されるのは次の構造:

1. **Density is contextual.** Data-heavy / repeated-operation context では compact variant が有効だが、すべての surface を一律に圧縮する根拠にはならない。
2. **Typography and geometry are separable.** SAP は compact 化で font size を維持し、Carbon も table typography と row geometry を別仕様として扱う。
3. **Density benefits from a system.** SAP の app-level mode、Atlassian の spacing scale、Carbon の named row variants は、ad-hoc な局所圧縮を避ける。
4. **User/input constraints matter.** SAP は touch / pointer と hybrid preference、W3C は target size / spacing、Primer は user-selectable density を示す。
5. **More items visible is not sufficient proof.** Hierarchy、target reliability、scanability、task flow を同時に確認する必要がある。

### Important differences

- SAP Fiori は density を application-level interaction mode として強く扱う。
- Carbon は component、とくに data table 内の複数 size を first-class variant として扱う。
- Primer の ListView は production tooling で user-controlled Comfortable / Condensed preference を提供する。
- Atlassian は spacing foundation を将来の customizable density の土台として位置付ける。
- WCAG は density style を定義せず、pointer target reliability の最低 constraint を定義する。

この差分から、一つの design system の density model を universal rule にせず、**task / surface scope / input / user preference / hierarchy** を observation axes として current product へ翻訳する。

## Failure modes to inspect

- font size まで一律縮小し readable hierarchy を失う
- compact control の visible icon と hit target の両方を小さくし adjacent errors を増やす
- row は compact なのに menu / dialog / overlay だけ comfortable で spatial rhythm が崩れる
- opposite direction に、全 surface を一律 compact にし reading / input task まで圧縮する
- density mode ごとに情報や機能を不用意に消し、layout preference が capability difference になる
- padding を減らす一方で redundant container / border / metadata を残し、情報効率が上がらない
- comparison に必要な metadata を disclosure の奥へ移し、viewport は空いたが task cost が増える
- compact screenshot だけ確認し、zoom / long labels / keyboard / touch / real data を試さない
