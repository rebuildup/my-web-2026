---
name: document-design
description: >
  Use this skill when designing reports, proposals, handouts, white papers, or other paginated documents
  where long-form hierarchy, pagination, figures, tables, reading order, and exported-document quality matter.
---

# Document Design

report / proposal / handout / white paper / paginated PDF 等を、単なる長文の流し込みではなく**情報構造・ページ構造・読書経路を持つ artifact**として設計する。

Word / DOCX / InDesign / HTML / PDF は renderer / output format であり、design principle と混同しない。

## Workflow

1. audience、reading purpose、print / screen、page size、editable delivery の必要性を確認する。
2. content を title / summary / section / subsection / body / list / table / figure / caption / note / reference に分類する。
3. 下記 reference を開き、logical hierarchy、reading order、table / figure behavior、PDF structure を確認する。
4. visual hierarchy と semantic hierarchy を一致させ、page grid / measure / spacing / heading depth を決める。
5. page break を成り行きに任せず、heading・figure・caption・table・footnote の関係を page 単位で調整する。
6. source ではなく exported / printed representation を検証する。

## Observe

- information hierarchy: heading level と見た目の強さが一致しているか
- page architecture: margins, columns, text measure, running elements, section boundaries
- paragraph rhythm: heading 前後、list、quote、caption、note の spacing
- navigation: TOC, headings, page numbers, links, bookmarks が長文探索を助けるか
- figures: 本文との参照関係、caption、近接、番号、alt / long description
- tables: data table と layout table を混同していないか、header 構造が明確か
- reading order: multi-column / sidebar / figure を含めても logical sequence が保たれるか
- pagination: orphaned heading、孤立 caption、split table、過剰な空白、bad break
- print / screen transformation: physical margins、zoom、link visibility、contrast
- export semantics: tagged PDF、heading tags、table tags、focus / tab order が維持されるか

## Decision rules

- visual style を先に決めず、**semantic structure → page structure → visual treatment** の順で設計する。
- heading level は単なる font-size preset ではなく document outline を表す。見た目だけの heading を作らない。
- complex layout は visual order だけでなく exported reading order を確認できる場合に使う。
- table は真正な tabular relationship に使い、layout のために使わない。
- figure / diagram が重要情報を持つ場合、caption と本文だけに依存せず必要な text alternative を用意する。
- PDF を最終配布物にする場合、source document が整っていても tagged structure を別途検証する。

## References

- [Microsoft — Make your Word documents accessible](https://support.microsoft.com/en-us/accessibility/word/make-your-word-documents-accessible-to-people-with-disabilities)
  - Observe: built-in headings, logical heading order, alt text, tables, links, accessibility checker
  - Useful for: authoring-stage semantic structure
- [W3C WAI — PDF3: Correct tab and reading order](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF3)
  - Observe: logical reading order, multi-column risk, tagged PDF, focus sequence
  - Useful for: exported PDF verification
- [W3C WAI — PDF9: Heading tags in PDF](https://www.w3.org/WAI/WCAG22/Techniques/pdf/PDF9.html)
  - Observe: visual headings と semantic heading tags の一致
  - Useful for: long-form navigation / tagged PDF structure
- [W3C WAI — PDF6: Table markup in PDF](https://www.w3.org/WAI/WCAG21/Techniques/pdf/PDF6)
  - Observe: row / column header relationships and table hierarchy
  - Useful for: reports containing data tables
- [HM Treasury — Accessible documents policy](https://www.gov.uk/government/organisations/hm-treasury/about/accessible-documents-policy)
  - Observe: single-column preference, clear hierarchy, chart/table titles, links, contrast
  - Useful for: public-facing document delivery policy
- [W3C WAI — Complex Images](https://www.w3.org/WAI/tutorials/images/complex/)
  - Observe: diagrams / charts / maps の short description と long description
  - Useful for: figure-heavy reports and explanatory documents

## Avoid

- heading を font size / bold だけで表現し、semantic structure を持たせない
- page を整えるために空白文字・改行・layout table を使う
- sidebar / multi-column を visual appeal だけで増やし、reading order を壊す
- figure と caption を別ページへ不用意に分離する
- source file が正常に見えることを PDF quality の証拠にする
- renderer 固有の操作手順を document design の principle にする

## Verify

- heading 一覧 / TOC だけで document structure が理解できるか確認する。
- narrow / wide page、100% zoom、high zoom、print preview で text measure / overflow / clipping を確認する。
- page thumbnails で rhythm、孤立 heading、bad break、過密ページ、空白ページを確認する。
- exported PDF の reading order、heading tags、table structure、links、alt text を accessibility tool / screen reader で確認する。
- representative pages を rasterize し、figure-caption proximity、alignment、contrast、page balance を目視確認する。

## Current status

Experimental initial skill. Real document trial 後に pagination / print-screen adaptation / tagged-PDF gate を refinement する。

Last reviewed: 2026-09-12
