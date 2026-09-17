/**
 * Single source of truth for the home page's reported version.
 *
 * The version is read once at module load and is intentionally a
 * build-time constant so the visible version matches what the
 * Worker reports via `package.json`. Bumping the release requires
 * bumping `package.json`, not this file.
 */
export const PACKAGE_VERSION = '0.2.0' as const;
