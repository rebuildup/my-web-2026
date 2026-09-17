/**
 * Public surface of the home feature.
 *
 * Cross-module consumers should import from `@modules/home` (or
 * `~/modules/home`) and never reach into individual files. This
 * barrel is the only file that the rest of the application uses.
 */
export { HomePage } from './ui';
export { getHomeSystemStatus } from './server';
export type { HomePageData, Capability, SystemServiceStatus } from './model';
export { CAPABILITIES, SYSTEM_SERVICES } from './data/capabilities';
