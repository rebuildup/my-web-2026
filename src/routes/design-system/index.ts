/**
 * Public surface for the `/design-system` showcase.
 *
 * The route shell (`src/routes/design-system.tsx`) imports
 * `DesignSystemPage` from `./DesignSystemPage` directly. This
 * barrel is for tooling (Storybook stories, e2e test imports) so
 * the page composition can be referenced as a single identifier.
 */
export { DesignSystemPage } from './DesignSystemPage';
