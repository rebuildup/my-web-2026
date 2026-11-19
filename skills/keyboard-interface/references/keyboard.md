# Keyboard Interface References

Last reviewed: 2026-09-12

Use these references to identify established keyboard conventions before defining custom behavior. Prefer the semantic widget pattern over visual resemblance.

## W3C WAI / ARIA APG

- [Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
  - Observe: page tab sequence vs composite-internal navigation, focus vs selection, roving `tabindex`, `aria-activedescendant`, disabled-item discoverability, shortcut guidance.
  - Useful for: the general interaction model and focus-management strategy.
  - Avoid copying: implementation choices that do not match the semantic widget in the current product.

- [Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
  - Observe: one tab stop for the tablist, arrow-key movement, automatic vs manual activation, orientation-dependent keys.
  - Useful for: separating focus movement from panel activation.

- [Menu and Menubar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)
  - Observe: entry focus, arrow-key traversal, submenu opening, Escape behavior, disabled-item focusability.
  - Useful for: dense command/menu surfaces.

- [Radio Group Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/radio/)
  - Observe: group-level Tab entry/exit, checked item as entry target, arrow movement and selection behavior.
  - Useful for: comparing native-like grouped selection with generic lists of buttons.

- [Toolbar Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)
  - Observe: reducing tab stops by grouping controls, orientation-aware arrow keys, conflicts between toolbar navigation keys and child-control operation.
  - Useful for: dense editor/action surfaces.

- [Dialog (Modal) Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  - Observe: initial focus, contained Tab order, Escape dismissal, focus restoration, choice of initial focus for large/destructive dialogs.
  - Useful for: focus lifecycle in modal surfaces.

## WCAG / WAI

- [Accessibility Principles — Operable user interface and navigation](https://www.w3.org/WAI/fundamentals/accessibility-principles/#operable)
  - Observe: all pointer functionality must remain available through a keyboard interface and focus must not become trapped.
  - Useful for: baseline operability boundary.

- [What’s New in WCAG 2.2 — Focus Not Obscured / Focus Appearance](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/)
  - Observe: sticky / overlay content obscuring keyboard focus; focus visibility expectations.
  - Useful for: rendered verification at zoom and with fixed UI.

- [WCAG 2.2 — Keyboard Accessible guideline](https://www.w3.org/TR/WCAG22/#keyboard-accessible)
  - Observe: keyboard operation, no-keyboard-trap, and character-key-shortcut requirements.
  - Useful for: checking custom shortcuts and exit paths.

## GitHub Primer

- [Focus management](https://primer.style/accessibility/design-guidance/focus-management/)
  - Observe: practical page/application focus management and keyboard-only test flow.
  - Useful for: production-system evidence beyond normative ARIA guidance.

- [Popover accessibility](https://primer.style/product/components/popover/accessibility/)
  - Observe: non-modal focus entry, keyboard dismissal, focus return, DOM relationship, and the explicit absence of an automatic focus trap.
  - Useful for: distinguishing popovers from modal dialogs.

- [Overlay accessibility](https://primer.style/product/components/overlay/accessibility/)
  - Observe: role-dependent behavior, initial focus, keyboard close path, and restoration to the activating control.
  - Useful for: production verification criteria for temporary surfaces.

- [ActionList accessibility](https://primer.style/product/components/action-list/accessibility/)
  - Observe: inactive-item discoverability and keyboard access to explanations.
  - Useful for: trade-offs around unavailable actions.

## IBM Carbon

- [Text input — Accessibility](https://carbondesignsystem.com/components/text-input/accessibility/)
  - Observe: native input keyboard behavior retained by a production design system; additional information/password controls remain keyboard-operable.
  - Useful for: evidence that native semantics should be preserved instead of replaced with custom key models.

- [Toggle — Accessibility](https://carbondesignsystem.com/components/toggle/accessibility/)
  - Observe: Tab reachability and standard activation keys in a production component.
  - Useful for: comparing ordinary controls with composite widgets.

## U.S. Web Design System

- [Accessibility](https://designsystem.digital.gov/documentation/accessibility/)
  - Observe: keyboard-only navigation as part of manual component verification, alongside touch, zoom, screen-reader, and cross-browser testing.
  - Useful for: final-artifact verification expectations.

- [Combo box accessibility tests](https://designsystem.digital.gov/components/combo-box/accessibility-tests/)
  - Observe: keyboard access to all functions, visible focus, and no unexpected context change on focus.
  - Useful for: testing a complex composite in realistic product context.

- [Language selector accessibility tests](https://designsystem.digital.gov/components/language-selector/accessibility-tests/)
  - Observe: keyboard operation, no keyboard trap, and visible focus as explicit manual checks.
  - Useful for: repeatable verification rather than relying only on implementation intent.

## Cross-reference boundaries

- `interaction-states`: focus / selected / checked / pressed / disabled state meaning and visible distinction.
- `navigation-design`: information architecture, current location, hierarchy, and movement between destinations.
- `accessibility-audit`: broad WCAG and assistive-technology audit after the interaction model exists.
- `motion-system`: temporal feedback and transitions; keyboard operation must not depend on animation.
