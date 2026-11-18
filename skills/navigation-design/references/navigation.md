# Navigation references

Last reviewed: 2026-09-12

Use these references as observation inputs. Do not copy brand-specific visual treatment or arbitrary values.

## W3C WAI / ARIA APG

- [WAI Menus Tutorial — Menu Structure](https://www.w3.org/WAI/tutorials/menus/structure/)
  - Observe: semantic menu structure, navigation landmark identification, labels, current-item treatment, responsive consistency.
  - Useful for: baseline site/service navigation semantics and responsive invariants.
  - Avoid copying: example wording and markup when the current design system already provides equivalent semantics.

- [ARIA APG — Landmark Regions](https://www.w3.org/WAI/ARIA/apg/practices/landmark-regions/)
  - Observe: navigation region boundaries, repeated-landmark labels, top-level region structure.
  - Useful for: separating multiple navigation scopes and avoiding landmark noise.

- [ARIA APG — Breadcrumb Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/breadcrumb/)
  - Observe: hierarchical ancestor ordering, navigation landmark usage, current-page semantics.
  - Useful for: hierarchy orientation and breadcrumb verification.

## GOV.UK Design System

- [Help users to navigate a service](https://design-system.service.gov.uk/patterns/navigate-a-service/)
  - Observe: when persistent service navigation is justified, when a linear journey should avoid it, global-vs-service scope, selective top-level links.
  - Useful for: deciding whether navigation should exist before selecting a component.
  - Avoid copying: GOV.UK-specific branding and government account structure.

- [Service navigation](https://design-system.service.gov.uk/components/service-navigation/)
  - Observe: service identity, current section, navigation link grouping, narrow-state behavior.
  - Useful for: service/product-level navigation distinct from global shell navigation.

- [Breadcrumbs](https://design-system.service.gov.uk/components/breadcrumbs/)
  - Observe: hierarchy-only use, placement, redundancy with side navigation, flat-structure non-use.
  - Useful for: deciding when breadcrumbs add orientation rather than clutter.

- [Pagination](https://design-system.service.gov.uk/components/pagination/)
  - Observe: collection/content pagination vs linear transaction movement, previous/next context.
  - Useful for: separating pagination from wizard progress.

## U.S. Web Design System

- [Breadcrumb](https://designsystem.digital.gov/components/breadcrumb/)
  - Observe: orientation after deep-link entry, hierarchy reinforcement, redundancy with side navigation, truncated breadcrumb behavior.
  - Useful for: complex content sites and responsive hierarchy context.

- [Side navigation](https://designsystem.digital.gov/components/side-navigation/)
  - Observe: hierarchy levels, current-location treatment, persistent section navigation.
  - Useful for: repeated movement among related sections.

- [Side navigation accessibility tests](https://designsystem.digital.gov/components/side-navigation/accessibility-tests/)
  - Observe: navigation consistency, current-location cues, implementation-level verification conditions.
  - Useful for: turning navigation design decisions into repeatable checks.

- [In-page navigation](https://designsystem.digital.gov/components/in-page-navigation/)
  - Observe: section-derived navigation, sticky/current-section behavior, relationship to long-form headings.
  - Useful for: long pages where navigation scope is the current document rather than the site.

- [Extended header](https://designsystem.digital.gov/components/header/extended/)
  - Observe: trade-offs between compact and expanded global/header navigation when top-level sections increase.
  - Useful for: distinguishing information architecture pressure from merely adding more dropdowns.

- [Extended header with megamenu](https://designsystem.digital.gov/components/header/extended-mega/)
  - Observe: when many top-level sections / deep hierarchy justify a larger disclosure surface.
  - Useful for: evaluating mega-menu need rather than defaulting to one.

## GitHub Primer

- [Navigation pattern](https://primer.style/product/ui-patterns/navigation/)
  - Observe: parent-detail navigation, navigation proximity to affected content, heading-based orientation, choice among NavList / TreeView / tabs.
  - Useful for: product/tool interfaces with nested contexts.

- [UnderlineNav](https://primer.style/product/components/underline-nav/)
  - Observe: linked horizontal navigation where activation changes the URL.
  - Useful for: route-changing related views.

- [UnderlinePanels](https://primer.style/product/components/underline-panels/)
  - Observe: same-context panel switching without URL navigation.
  - Useful for: distinguishing navigation links from tab-panel interaction despite similar appearance.

## IBM Carbon Design System

- [Global header pattern](https://carbondesignsystem.com/patterns/global-header/)
  - Observe: global-vs-product scope, persistent shell behavior, header-only vs header-plus-left-panel composition.
  - Useful for: large application shells with multiple navigation scopes.

- [UI shell header accessibility](https://carbondesignsystem.com/components/UI-shell-header/accessibility/)
  - Observe: skip-to-main behavior, keyboard reachability, shell-level labeling and page structure.
  - Useful for: verifying persistent header navigation without turning the Skill into a component API guide.

- [UI shell left panel accessibility](https://carbondesignsystem.com/components/UI-shell-left-panel/accessibility/)
  - Observe: repeated secondary switching, responsive collapse, current-page semantics, expandable section behavior.
  - Useful for: deciding when a persistent side panel is justified and verifying its compact-state behavior.

- [Breadcrumb](https://carbondesignsystem.com/components/breadcrumb/usage/)
  - Observe: hierarchy depth, current-page inclusion decision, placement relative to header and page title, breadcrumb-vs-progress boundary.
  - Useful for: secondary orientation in deep product hierarchies.
