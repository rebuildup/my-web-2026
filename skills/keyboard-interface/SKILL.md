---
name: keyboard-interface
description: >
  Design predictable keyboard interaction models for web and application interfaces, including page-level tab order,
  composite-widget focus management, overlays, dismissal, focus restoration, and optional shortcuts.
---

# Keyboard Interface

Keyboard support is not “make every interactive-looking thing tabbable”.

Use this Skill when an interface contains custom controls, composite widgets, overlays, dense action surfaces, or keyboard commands whose interaction model must remain predictable without a pointer.

Follow **Inspect → Extract → Translate → Implement → Verify**. Prefer native HTML behavior and established platform / ARIA interaction conventions before inventing new key bindings.

## When to use

Use for:

- custom tabs, menus, radio groups, toolbars, listboxes, trees, grids, comboboxes, or similar composite widgets
- dialogs, popovers, menus, command surfaces, and other overlays that move or contain focus
- dense interfaces where naive tabbing would produce excessive or ambiguous tab stops
- interfaces that expose keyboard shortcuts beyond standard control activation
- keyboard regressions involving focus order, lost focus, traps, hidden focus, or pointer/keyboard state mismatch

Do not use this Skill as a generic accessibility checklist. `accessibility-audit` owns broad conformance retesting.

## Workflow

1. **Inspect** the rendered interface, DOM/source order, interactive roles, existing keyboard behavior, and relevant references.
2. **Extract** the interaction model: page-level components, composite boundaries, focus entry points, internal navigation, activation, dismissal, and restoration.
3. **Translate** established conventions into the current interface without copying arbitrary implementation details from one design system.
4. **Implement** the smallest keyboard model that preserves task flow and existing semantics.
5. **Verify** complete keyboard-only tasks, not isolated key handlers.

## Observe

When comparing references, inspect:

- what receives a page-level `Tab` stop
- which controls are grouped as one composite component
- which keys move focus inside the component
- whether focus movement also changes selection or only changes the active item
- where focus lands when entering a component
- where focus returns after dismissing or completing an overlay
- whether disabled items remain discoverable within the component pattern
- how `Escape`, `Enter`, `Space`, arrow keys, `Home`, and `End` are assigned
- whether focused content is scrolled into view and remains visible under sticky / overlay content
- whether pointer interaction updates the same active/focus model used by keyboard interaction
- whether custom shortcuts conflict with text entry, browser/platform commands, or assistive technology

## Decision rules

### 1. Separate page traversal from component-internal navigation

`Tab` / `Shift+Tab` should normally move **between meaningful UI components**.

Inside a composite widget, use the established interaction model for that widget instead of placing every child in the page tab sequence.

Examples include tabs, menus, radio groups, toolbars, listboxes, grids, and trees. These often expose one page-level tab stop and use arrow keys or other pattern-specific keys internally.

Do not optimize for the smallest possible number of key presses if doing so creates a novel interaction model. Predictability is more important than cleverness.

### 2. Keep DOM, reading, and focus order aligned

Use logical source order as the basis of sequential focus navigation.

Do not use positive `tabindex` values as a routine tool for correcting a visually rearranged interface. If visual order and meaningful reading/focus order disagree, fix the structure or layout rather than maintaining two competing orders.

`tabindex="0"` may place a custom focusable element into natural source-order navigation. `tabindex="-1"` may support programmatic focus without adding a page-level tab stop.

### 3. Choose one focus-management strategy per composite

For custom composite widgets, choose an established strategy such as:

- **roving tabindex** — one child has `tabindex="0"`; the others use `-1`, and DOM focus moves among children
- **`aria-activedescendant`** — DOM focus remains on a container while the active descendant changes

Do not mix strategies casually inside the same interaction surface.

Whichever model is used, the visually active item must remain visible and the assistive-technology focus model must stay synchronized with what the user sees.

### 4. Separate focus movement from selection and activation

Moving keyboard focus does not automatically mean that the user committed a choice.

Automatic selection-on-focus is appropriate only when the underlying widget convention supports it and changing selection has no harmful latency or side effects.

For controls where selection triggers expensive work, navigation, destructive effects, or significant context changes, prefer explicit activation / confirmation.

`interaction-states` owns the semantic meaning of focus vs selected / checked / pressed. This Skill owns how keyboard input moves focus and invokes those states.

### 5. Treat overlays as a focus lifecycle

For dialogs, menus, popovers, and similar overlays, define all of the following together:

1. **entry** — what element receives focus when the overlay opens
2. **internal traversal** — whether focus is contained and how controls are reached
3. **dismissal / completion** — which keyboard actions close or complete the surface
4. **restoration** — where focus goes afterward

For modal dialogs, focus normally remains inside the modal until it is dismissed. For non-modal popovers, do not introduce a focus trap merely because the surface is visually overlaid.

When the surface closes, restore focus to the invoker unless the invoker no longer exists or the completed task has a more logical next target.

Provide an obvious keyboard path out. `Escape` is a conventional dismissal key for many temporary surfaces, but do not add it where it conflicts with a domain-specific interaction model.

### 6. Preserve established key conventions

Before defining keys, identify the semantic widget pattern.

Use established platform / APG conventions for common operations instead of inventing product-specific alternatives. In particular:

- `Enter` / `Space` commonly activate buttons and toggles according to native / pattern behavior
- arrow keys commonly navigate inside composite widgets
- `Home` / `End` may move to boundary items in patterns that define them
- `Escape` commonly dismisses temporary UI or exits a transient mode
- `Tab` should not be repurposed as a generic arrow key inside a composite

Do not infer a keyboard model from visual appearance alone. A row of controls that resembles tabs may still be ordinary navigation links and should then retain link behavior.

### 7. Disabled focusability is pattern-dependent

Native disabled controls usually leave the tab sequence. However, some composite patterns intentionally keep unavailable items discoverable while arrowing through the component.

Do not create one global rule that either all disabled elements must be focusable or none may be focusable.

Choose based on:

- whether users need to discover that the option exists
- whether the component convention includes disabled items in internal navigation
- whether focus would misleadingly imply that the action can be performed
- whether an explanation is available without requiring pointer hover

### 8. Do not hide focused content

Keyboard focus must remain visually perceivable while navigating.

Check sticky headers, fixed footers, drawers, cookie banners, overlays, horizontal scrolling, zoom, and virtualized content. Moving focus to an item that is technically focused but entirely hidden is not a successful keyboard interaction.

If a managed-focus component changes the active item, ensure the new item is scrolled into view where necessary.

### 9. Keep pointer and keyboard interaction synchronized

Users may switch between mouse, touch, keyboard, voice input, and assistive technology during the same task.

When pointer interaction changes the current item in a roving-tabindex or active-descendant component, update the keyboard model accordingly. Otherwise the next keyboard action can jump to stale state.

Do not create a “keyboard version” of the interface whose active item differs from the visible pointer-selected state without a deliberate semantic reason.

### 10. Treat custom shortcuts as optional commands, not hidden requirements

Add custom shortcuts only when they materially improve a repeated workflow.

For each shortcut inspect:

- collision with browser / operating-system / assistive-technology commands
- whether a focused text field should receive the keystroke instead
- whether single printable-character shortcuts can fire unexpectedly
- discoverability and visible documentation
- remapping / disabling requirements when relevant
- international keyboard layout implications

Never require an undocumented shortcut to escape a surface or access essential functionality.

## Responsibility boundaries

### `keyboard-interface`

Owns:

- tab-sequence architecture
- composite keyboard navigation model
- focus entry / internal movement / exit / restoration
- conventional key assignment
- keyboard shortcut interaction policy
- keyboard-only task verification

### `interaction-states`

Owns semantic distinction and visual treatment of focus, selected, pressed, checked, disabled, read-only, busy, and related states.

### `navigation-design`

Owns information-space navigation, hierarchy, current location, and movement between destinations.

### `accessibility-audit`

Owns broad WCAG / assistive-technology / conformance retesting across the finished interface.

### `motion-system`

Owns timing, easing, choreography, and transition continuity. Keyboard operability must not depend on motion.

## References

Open [`references/keyboard.md`](./references/keyboard.md) before designing non-trivial custom keyboard behavior.

Do not copy one reference's exact implementation. Compare multiple patterns and extract the interaction convention that matches the current semantic widget.

## Avoid

- making every descendant of a composite widget a separate tab stop
- positive `tabindex` values used to repair visual/source-order mismatches
- custom key bindings for controls that already have native keyboard behavior
- moving focus without a visible focus indication
- coupling focus movement to destructive or expensive selection side effects by default
- trapping focus in non-modal UI
- closing an overlay and dropping focus onto `<body>` or an unrelated location
- pointer-only dismissal, hover-only explanations, or drag-only actions
- shortcut systems that intercept ordinary typing
- testing only with scripted key events while ignoring the rendered focus path

## Verify

Test the final rendered interface with the keyboard only.

### Page traversal

- start from the browser chrome / page start and traverse forward with `Tab`
- traverse backward with `Shift+Tab`
- confirm the order follows meaning and visible structure
- confirm no important control is unreachable
- confirm there are no redundant internal tab stops that should belong to one composite

### Composite widgets

For every custom composite:

- enter from before the component
- use the documented internal navigation keys
- activate / select items where applicable
- leave the component in both directions
- re-enter and confirm the intended focus-entry state
- confirm focus and selection remain distinguishable

### Overlays

For every dialog / menu / popover / temporary surface:

- open it with keyboard input
- confirm initial focus is intentional
- traverse all reachable controls
- confirm focus containment only where the interaction model requires it
- dismiss / complete with keyboard input
- confirm focus restores to the invoker or a deliberate next target

### Stress cases

- zoom until layout materially changes and repeat keyboard traversal
- test sticky / fixed content and confirm focus is not obscured
- test horizontal / vertical scrolling and confirm managed focus scrolls into view
- alternate pointer interaction and keyboard interaction in the same component
- test empty, disabled, loading, and dynamically inserted states where relevant
- type inside text fields while shortcut listeners are active

### Completion gate

Do not consider the keyboard model complete until a representative end-to-end task can be completed without pointer input, without unexpected focus loss, without a keyboard trap, and without requiring undocumented commands.
