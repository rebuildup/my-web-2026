/**
 * Single source of truth for the home page's reported version.
 *
 * This is an explicit build-time constant used by the public home
 * surface. Release tickets keep it in lockstep with `package.json`;
 * changing either value without the other is release drift.
 */
export const PACKAGE_VERSION = '0.3.0' as const;
