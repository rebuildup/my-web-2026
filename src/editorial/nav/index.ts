/**
 * Public surface for the editorial nav primitives (Issue #168).
 *
 * The nav is part of the editorial visual language and lives
 * alongside `Container` and `SectionHeading` in `src/editorial/`.
 * Routes / server-fn handlers import from this barrel so the
 * underlying files can move without changing import paths.
 */
export { PublicNav, PUBLIC_NAV_ITEMS, isActiveRoute } from './PublicNav';
export type { PublicNavItem, PublicNavProps } from './PublicNav';
