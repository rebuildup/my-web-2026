import packageJson from '../../package.json';

/**
 * Public application version.
 *
 * `package.json#version` is the only current-version source of truth.
 * Release branches update that value once; UI and runtime surfaces import it
 * instead of copying semantic-version literals into source files.
 */
export const PACKAGE_VERSION = packageJson.version;
