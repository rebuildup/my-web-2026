# Touch interface references

Last reviewed: 2026-09-12

Use these references as runtime evidence. Do not flatten their platform-specific values into one universal rule.

## W3C / Web

- [WCAG 2.2 — Understanding Pointer Gestures](https://www.w3.org/WAI/WCAG22/Understanding/pointer-gestures.html)
  - Observe: when multipoint or path-based gestures require a single-pointer alternative.
  - Useful for: swipe, pinch, drawing-path, and gesture-only interaction review.
  - Avoid copying: examples as a complete interaction model for every platform.

- [WCAG 2.2 — Understanding Pointer Cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html)
  - Observe: up-event completion, abort, undo, and reversal expectations.
  - Useful for: accidental activation / commit-boundary decisions.

- [WCAG 2.2 — Understanding Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
  - Observe: simple-pointer alternatives for non-essential drag operations.
  - Useful for: reorder, drag-and-drop, sliders, canvases, and spatial manipulation.

- [WCAG 2.2 — Understanding Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  - Observe: `24 × 24 CSS px` minimum, spacing model, inline/equivalent/essential exceptions.
  - Useful for: Web conformance floor.
  - Avoid copying: treating the minimum as the preferred comfort target.

- [WCAG 2.2 — Understanding Concurrent Input Mechanisms](https://www.w3.org/WAI/WCAG22/Understanding/concurrent-input-mechanisms.html)
  - Observe: avoiding unnecessary restriction to one available input modality.
  - Useful for: hybrid touch + pointer + keyboard devices.

## Apple platforms

- [Apple Human Interface Guidelines — Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures)
  - Observe: standard gesture expectations, custom-gesture criteria, alternatives, system conflicts, direct manipulation feedback.
  - Useful for: Apple-platform gesture vocabulary and cross-input behavior.
  - Avoid copying: visionOS-specific gesture rules into 2D touch interfaces.

- [WWDC24 — Design advanced games for Apple platforms](https://developer.apple.com/videos/play/wwdc2024/10085/)
  - Observe: Apple’s touch-oriented target-size guidance and distinction from pointer-oriented Mac sizing.
  - Useful for: evidence that input precision changes comfortable target sizing.
  - Avoid copying: game-specific layout choices outside their context.

## Android

- [Android Developers — Make apps more accessible](https://developer.android.com/guide/topics/ui/accessibility/apps)
  - Observe: `48dp × 48dp` touch-target recommendation, ability to extend the target beyond visual bounds, mouse/trackpad precision distinction.
  - Useful for: Android touch target and custom-control decisions.

- [Android design — Accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility)
  - Observe: gesture alternatives, touch-target guidance, haptic feedback as supplementary feedback.
  - Useful for: motor-access and gesture-only failure cases.

## Windows / Fluent

- [Microsoft Learn — Touch interactions](https://learn.microsoft.com/en-us/windows/apps/develop/input/touch-interactions)
  - Observe: direct manipulation, immediate feedback, common gesture expectations, software-keyboard occlusion, touchable vs touch-optimized target guidance.
  - Useful for: touch-enabled desktop and convertible devices.

- [Microsoft Learn — Targeting](https://learn.microsoft.com/en-us/windows/apps/develop/input/guidelines-for-targeting)
  - Observe: standard vs compact sizing, target frequency, error consequence, form factor, and touch posture.
  - Useful for: density-vs-comfort trade-offs rather than one-size-fits-all target rules.

- [Microsoft Learn — Visual feedback](https://learn.microsoft.com/en-us/windows/apps/develop/input/guidelines-for-visualfeedback)
  - Observe: feedback for precision, custom interactions, and consistency with built-in gesture behavior.
  - Useful for: manipulation and targeting feedback.

## Adobe Spectrum

- [Adobe Spectrum — Platform scale](https://spectrum.adobe.com/page/platform-scale/)
  - Observe: distinct desktop/mobile scale, component/icon sizing differences, and hybrid touch-enabled desktop considerations.
  - Useful for: separating product design language from input-specific scale.
  - Avoid copying: Spectrum’s exact scale ratio as a universal cross-product value.

## Comparison prompts

When researching a task, compare references with these questions:

- Is the cited number a conformance minimum, platform comfort recommendation, or design-system density choice?
- Can the effective target grow without changing the visible component size?
- Is a gesture standard on this platform, or product-specific?
- Is a simpler alternative available for drag / path / multipoint input?
- When is the action committed, and how can accidental input be cancelled or undone?
- Does feedback continuously communicate the relation between pointer movement and result?
- What happens when the user switches input methods mid-task?
