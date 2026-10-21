/**
 * Public entry point for the keyboard-layout obligation.
 *
 * The committed source bytes are imported with Vite's `?raw` loader
 * so the Worker bundle carries exactly the reviewed snapshot. There
 * is no request-time fetch and no runtime read of an arbitrary path:
 * the import graph is the allowlist.
 *
 * `syncKeyboardLayout` is the only writer of these files; see
 * `scripts/sync-keyboard-layout.mjs`.
 */

import macKanata from './sources/key-map-kanata/mac/kanata-us.kbd?raw';
import winKanata from './sources/key-map-kanata/win/kay-map-win.kbd?raw';
import manifestJson from './sources/manifest.json';
import onishiJson from './sources/pc-setup/platforms/macos/keyboard/onishi.json?raw';
import type { KeyboardManifest } from './types';
import type { KeyboardSourceBundle } from './catalog';

/** The committed manifest, typed at this boundary. */
export const KEYBOARD_MANIFEST = manifestJson as unknown as KeyboardManifest;

/** The committed source set the page parses. */
export const KEYBOARD_SOURCES: KeyboardSourceBundle = {
	manifest: KEYBOARD_MANIFEST,
	macKanata,
	winKanata,
	onishiJson,
};

export { loadKeyboardPage } from './load';
