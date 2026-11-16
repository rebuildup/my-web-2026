# Content design references

Last reviewed: 2026-09-12

Open the references relevant to the current task. Compare several sources; do not turn one organization's house style into a universal rule.

## GOV.UK — content design and publishing

- [Understand content design](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/understand-content-design/)
  - Observe: user-need-first framing, deciding amount / format / placement before writing, duplication removal, maintenance expectations.
  - Useful for: deciding whether content should exist and where it belongs.
  - Avoid copying: UK-government-specific publishing structure.

- [Use clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/)
  - Observe: plain-language rationale, audience breadth, treatment of specialist language.
  - Useful for: wording and comprehension decisions.
  - Avoid copying: organization-specific terminology rules without checking the current audience.

- [Write effective links](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/)
  - Observe: destination specificity, duplication avoidance, link purpose and context.
  - Useful for: body links and destination wording.
  - Avoid copying: GOV.UK publishing restrictions that do not apply to the current product.

- [Government Design Principles](https://www.gov.uk/guidance/government-design-principles)
  - Observe: start with user needs, do less, simplify through design work rather than transferring complexity to users.
  - Useful for: resolving stakeholder-content pressure against user task clarity.

## NHS digital service manual

- [Content guide](https://service-manual.nhs.uk/content)
  - Observe: current content-design entry points and the distinction between guidance and rigid rules.
  - Useful for: healthcare/public-service content where clarity and trust matter.

- [How we write](https://service-manual.nhs.uk/content/how-we-write)
  - Observe: clear / concise language, common wording, jargon explanation, active structure, headings and lists.
  - Useful for: translating complex domain information into readable content.
  - Avoid copying: reading-age or sentence-length targets as universal magic numbers.

- [Voice and tone](https://service-manual.nhs.uk/content/voice-and-tone)
  - Observe: stable voice versus context-sensitive tone, emotional and risk context, non-patronizing language.
  - Useful for: sensitive, error, reassurance, health, or consequential content.
  - Avoid copying: NHS-specific brand voice.

- [Accessibility — Content](https://service-manual.nhs.uk/accessibility/content)
  - Observe: clear labels, connection between controls and content, understandable errors and recovery information.
  - Useful for: labels, instructions, and error content.

- [Error message](https://service-manual.nhs.uk/design-system/components/error-message)
  - Observe: concise corrective wording, error association, page-level summary relationship.
  - Useful for: checking whether an error message tells the user how to recover.

## W3C WAI — cognitive accessibility

These are W3C supplemental cognitive-accessibility patterns rather than a replacement for normative WCAG conformance requirements.

- [Use Clear and Understandable Content](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/)
  - Observe: clear words, short blocks, unambiguous language, simple structure, relationship between visual chunking and comprehension.
  - Useful for: broad comprehension review.

- [Use Clear Words](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o3p01-clear-words/)
  - Observe: common wording, jargon / acronym explanation, avoiding invented meanings.
  - Useful for: terminology and vocabulary decisions.

- [Make the Purpose of Your Page Clear](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p01-clear-purpose/)
  - Observe: page title / heading as orientation and memory support.
  - Useful for: page purpose and heading verification.

- [Use Clear Step-by-step Instructions](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p07-step-instructions/)
  - Observe: instruction placement, completeness, examples where needed, reducing preventable errors.
  - Useful for: setup, transactional, and multi-step tasks.

- [Use Clear Visible Labels](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/)
  - Observe: familiar label language, proximity and persistence.
  - Useful for: control labels and task cues.

- [Provide Feedback](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p10-status-feedback/)
  - Observe: explicit success / failure / status feedback after user action.
  - Useful for: confirmation and result messages.

- [Help Users Avoid Mistakes and Know How to Correct Them](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o4-minimize-mistakes/)
  - Observe: prevention, instructions, undo/recovery, data-loss risk, consequence visibility.
  - Useful for: consequential actions and error recovery.

## Microsoft — product and UI writing

- [Windows apps — Writing style](https://learn.microsoft.com/en-us/windows/apps/design/style/writing-style)
  - Observe: lead with what matters, action-oriented UI text, dialog-title / button relationship, error/help wording, accessibility and localization considerations.
  - Useful for: application UI copy.
  - Avoid copying: Windows-specific capitalization or punctuation conventions when the current platform differs.

- [Microsoft Writing Style Guide — Scannable content](https://learn.microsoft.com/en-us/style-guide/scannable-content/)
  - Observe: front-loading keywords, short sections, parallel structures, navigation within long content.
  - Useful for: long pages, documentation-like surfaces, settings/help content.

- [Microsoft Writing Style Guide — Describing interactions with the UI](https://learn.microsoft.com/en-us/style-guide/procedures-instructions/describing-interactions-with-ui)
  - Observe: input-neutral verbs and instructions that describe actions rather than assuming mouse/touch input.
  - Useful for: instructions shared across keyboard, touch, mouse, voice, or assistive input.

- [Top 10 tips for Microsoft style and voice](https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice)
  - Observe: directness, brevity, conversational wording, revision of weak phrasing.
  - Useful for: quick prose-quality review.
  - Avoid copying: Microsoft brand voice as a default brand voice.

## U.S. Web Design System

- [Prose accessibility tests](https://designsystem.digital.gov/components/prose/accessibility-tests/)
  - Observe: implementation-level plain-language / comprehension testing and zoom checks.
  - Useful for: verifying delivered prose rather than source text alone.

## Comparison prompts

When comparing references, ask:

- Do they start from wording, or from the user need and information decision?
- What information do they move earlier, remove, split, or defer?
- How do they distinguish voice from tone?
- How do they write action labels, destination links, instructions, errors, and confirmations?
- Where do they intentionally preserve specialist terms for precision?
- Which rules are universal comprehension principles, and which are organization-specific house style?
- What can be verified in the rendered task flow rather than by prose lint alone?
