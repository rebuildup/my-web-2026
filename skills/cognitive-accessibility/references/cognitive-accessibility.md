# Cognitive Accessibility References

Last reviewed: 2026-09-13

この reference file は runtime input であり、W3C COGA guidance を normative WCAG requirement として扱わない。
COGA の `Making Content Usable` / supplemental guidance は、WCAG 2 適合要件を超えて cognitive / learning accessibility を改善するための informative guidance である。

## W3C WAI / COGA

- [Supplemental Guidance to WCAG 2](https://www.w3.org/WAI/WCAG2/supplemental/)
  - Observe: cognitive guidance が WCAG conformance requirement ではなく supplemental guidance と明示される点、objectives / design patterns の grouping。
  - Useful for: domain boundary と pattern discovery。
  - Avoid copying: 全 pattern を checklist として一律適用すること。

- [Making Content Usable for People with Cognitive and Learning Disabilities — Working Group Note](https://www.w3.org/TR/coga-usable/)
  - Observe: user needs、objectives、patterns、testing/research の関係。
  - Useful for: cognitive accessibility を単一 impairment や単純化 heuristic に縮退させないための canonical source。
  - Avoid copying: persona の特徴を特定 user へ推測適用すること。

- [Cognitive Accessibility at W3C / COGA Task Force](https://www.w3.org/WAI/about/groups/task-forces/coga/)
  - Observe: current task-force scope と ongoing work。
  - Useful for: guidance status / current ownership の確認。

- [Help Users Understand What Things are and How to Use Them](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o1-understandable/)
  - Observe: orientation、familiar patterns、control-purpose、control/content relationship。
  - Useful for: external memory と familiarity の判断。

- [Make the Purpose of Your Page Clear](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p01-clear-purpose/)
  - Observe: page heading / signpost / current location が memory burden をどう減らすか。
  - Useful for: interruption 後の re-orientation。

- [Make Each Step Clear](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p04-clear-steps/)
  - Observe: completed / current / pending steps と important choices の externalization。
  - Useful for: multi-step journey、long-running tasks。

- [Clearly Identify Controls and Their Use](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o1p05-clear-controls/)
  - Observe: familiar control appearance、standard interaction expectation、control/content relationship。
  - Useful for: novelty vs familiarity trade-off。

- [Use a Clear and Understandable Page Structure](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o2p03-page-structure/)
  - Observe: sections、grouping、consistent placement、primary vs unrelated content separation。
  - Useful for: attention routing / local orientation。

- [Help Users Avoid Mistakes and Know How to Correct Them](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o4-minimize-mistakes/)
  - Observe: prevention、correction、time、data preservation を一つの recovery system として扱う点。
  - Useful for: consequential task / form / transaction。

- [Let Users Go Back](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p02-back-undo/)
  - Observe: predictable back / undo、work preservation、review/edit behavior。
  - Useful for: accidental navigation、multi-step correction、high-anxiety tasks。
  - Avoid copying: every action に confirmation を足すこと。

- [Use Clear Visible Labels](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p06-clear-labels/)
  - Observe: visible / nearby / familiar labels と recognition-over-recall の関係。
  - Useful for: `content-design` と協調する control clarity。

- [Use Clear Step-by-step Instructions](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p07-step-instructions/)
  - Observe: omitted step、instruction proximity、example / illustration support。
  - Useful for: unfamiliar / high-consequence procedures。

- [Avoid Data Loss and “Timeouts”](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p09-data-loss/)
  - Observe: lookup / break time、early warning、save/resume、sensitive information timing。
  - Useful for: session expiry、application、checkout、long data entry。
  - Avoid copying: security constraint を無視して timeout を全廃すること。

- [Help Users Focus](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o5-user-focus/)
  - Observe: interruptions、critical path、content volume、task preparation。
  - Useful for: attention competition の全体像。

- [Limit Interruptions](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p01-minimal-interruptions/)
  - Observe: user-controlled reminders / changes、task interruption、pause / defer behavior。
  - Useful for: notifications、live collaboration、marketing overlays、ambient content。

- [Make Short Critical Paths](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o5p02-short-paths/)
  - Observe: required vs optional steps、most-used function の path length、forced upsell / account creation。
  - Useful for: task architecture simplification。
  - Avoid copying: fixed maximum step count。

- [Make It Easy to Find Help and Give Feedback](https://www.w3.org/WAI/WCAG2/supplemental/patterns/o7p05-findable-support/)
  - Observe: point-of-stuck access、support channel complexity、return path。
  - Useful for: high-friction or unfamiliar flows。

## GOV.UK Design System — production-backed patterns

- [Question pages](https://design-system.service.gov.uk/patterns/question-pages/)
  - Observe: one coherent question / task focus、specific page headings、section context。
  - Useful for: reducing simultaneous decision burden in linear services。
  - Avoid copying: “one thing per page” as a universal rule outside its task context。

- [Task list](https://design-system.service.gov.uk/components/task-list/)
  - Observe: when long complex services benefit from user-controlled order / multiple sessions、when simplifying first is preferable。
  - Useful for: pause/resume and complex multi-session work。

- [Recover from validation errors](https://design-system.service.gov.uk/patterns/validation/)
  - Observe: prevent avoidable errors、accept reasonable format variation、preserve correction path。
  - Useful for: error prevention / recovery evidence alongside `form-design`。

- [Interruption pages](https://design-system.service.gov.uk/patterns/interruption-pages/)
  - Observe: interruption requires evidence and a clear need; repeated interruption loses effectiveness。
  - Useful for: deciding when attention interruption is justified。

- [Navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/)
  - Observe: simplify journey before adding navigation; persistent navigation is not always helpful in linear tasks。
  - Useful for: cognitive burden at the navigation/task boundary。

- [GOV.UK Design System Accessibility Strategy](https://design-system.service.gov.uk/accessibility/accessibility-strategy/)
  - Observe: tolerance for error、low physical/cognitive effort、progressive enhancement、design/research beyond component compliance。
  - Useful for: broader production design-system evidence。

## Microsoft — supporting inclusive-design methodology

- [Microsoft Accessibility Resources](https://www.microsoft.com/accessibility/resources)
  - Observe: Inclusive Design for Cognition and Mental Health is positioned as an inclusive-design resource, not merely a conformance tool。
  - Useful for: methodology / research framing。

- [Microsoft Inclusive Tech Lab](https://www.microsoft.com/en-us/inclusive-tech-lab/)
  - Observe: inclusive design through direct inclusion and learning from people with disabilities。
  - Useful for: reminder that heuristic review does not replace participatory research / testing。

## Comparison notes

### Repeated signals across sources

- reduce avoidable task detours before polishing individual screens
- externalize state / progress so users do not have to retain it in working memory
- keep back, undo, edit, and resume predictable
- preserve entered work where security and privacy permit
- interruptions should be rare, meaningful, and controllable where possible
- familiarity / consistency can reduce learning burden, but should not preserve a harmful pattern
- help needs to be reachable near the point of difficulty
- actual task behavior matters more than static component compliance

### Important differences / trade-offs

- W3C COGA gives broad supplemental user-need patterns; GOV.UK patterns are narrower production solutions for government-service contexts. Do not universalize GOV.UK page structures to every product.
- shortening a critical path must not remove legal, safety, medical, financial, or domain information needed for an informed decision.
- avoiding timeouts can conflict with security/privacy; prefer early warning, staged sensitive input, save/resume, and safe preservation rather than ignoring the constraint.
- reducing interruptions can conflict with urgent safety/security messaging; classify urgency instead of applying a blanket no-notification rule.
- consistency lowers learning burden, but users should not be forced to retain a legacy pattern that research shows is confusing.

## Verification targets

For a representative task, inspect at least:

- uninterrupted completion
- interruption → resume
- back / edit / correction
- validation failure → recovery
- optional path avoidance
- timeout / expiry behavior when applicable
- help access → return to task
- preserved state after temporary navigation
- high-consequence action review / recovery

Record remaining assumptions when real user research or cognitive-disability participant testing has not been performed.
