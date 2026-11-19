# Dark mode references

Last reviewed: 2026-09-12

Open these references during Inspect. Extract relationships and trade-offs; do not copy exact palette values.

## Apple — Color

https://developer.apple.com/design/human-interface-guidelines/color

Observe:

- dynamic semantic colors across light / dark / increased-contrast appearances
- foreground/background role separation
- requirement to verify custom colors in light and dark contexts
- luminance balance and visual comfort on very dark surroundings
- assets / translucency interacting with surrounding colors

Useful for:

- platform appearance behavior
- semantic role preservation
- increased-contrast combination

Avoid copying:

- Apple system-color values or Liquid Glass-specific visual treatment into unrelated products

## Apple — Dark Interface evaluation criteria

https://developer.apple.com/help/app-store-connect/manage-app-accessibility/dark-interface-evaluation-criteria

Observe:

- dark appearance as an end-to-end common-task property, not one isolated screen
- gray-on-black readability trade-off
- dark appearance together with Increase Contrast
- unintended inversion of semantic colors / media

Useful for:

- completion criteria
- accessibility-oriented dark appearance review

## W3C — CSS Color Adjustment Module Level 1

https://www.w3.org/TR/css-color-adjust-1/

Observe:

- light/dark color schemes as ranges of palettes, not fixed colors
- author declaration of supported color schemes
- user-agent canvas / form controls / scrollbars / default UI participation
- why user agents cannot safely auto-convert arbitrary author colors
- relationship to forced color schemes without conflating them with dark mode

Useful for:

- Web appearance negotiation
- native/browser chrome integration
- avoiding partial foreground/background overrides

Avoid turning this reference into:

- a CSS API tutorial; implementation syntax is evidence for the underlying color-scheme contract

## Adobe Spectrum — Color fundamentals

https://spectrum.adobe.com/page/color-fundamentals/

Observe:

- device color mode vs app color theme as separate concepts
- light / dark / darkest product themes
- content-dependent reasons to keep a dark app theme even in device light mode
- target-contrast-driven values changing between themes
- dark themes using different progression rather than mirrored light values

Useful for:

- system preference vs product theme decisions
- perceptual consistency across appearances

## Adobe Spectrum — Using color

https://spectrum.adobe.com/page/using-color/

Observe:

- theme-specific vs static color roles
- background-layer hierarchy across light and dark themes
- theme-relative interaction state progression
- why transparency is not a universal substitute for theme-specific tokens
- background / foreground pairing and contrast across every supported theme

Useful for:

- asset/static-color decisions
- interaction/state transformation
- surface hierarchy

## IBM Carbon — Color overview

https://carbondesignsystem.com/elements/color/overview/

Observe:

- multiple light and dark themes rather than one binary palette
- dark-theme surface layering becoming lighter with added layers
- universal role tokens changing values per theme
- inverse/high-contrast moments embedded within a theme
- warnings against arbitrary midtone surfaces

Useful for:

- dark surface-depth logic
- role-preserving theme tokens
- nested / raised surfaces

Avoid copying:

- Carbon's Gray 90 / Gray 100 values unless Carbon itself is the current product system

## Microsoft Fluent 2 — Color

https://fluent2.microsoft.design/color

Observe:

- global palette vs alias/semantic tokens
- state color behavior and platform-specific differences
- focus styling separated from pointer state
- personalization and non-color redundancy

Useful for:

- semantic-token boundary with `color-system`
- ensuring appearance changes preserve interaction meaning rather than only recolor controls

## W3C WAI — Colors with good contrast

https://www.w3.org/WAI/perspectives/contrast.html

Observe:

- luminance contrast requirements apply to bright-on-dark as well as dark-on-bright combinations
- text, icons, buttons, and informational graphics all need distinguishable relationships

Useful for:

- cross-mode verification reminders

Broad accessibility conformance remains owned by `accessibility-audit`.
