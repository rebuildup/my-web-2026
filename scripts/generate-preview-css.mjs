/**
 * Issue #764 — regenerates the six direction stylesheets in
 * `public/preview-assets/` (comparison harness, never merged).
 *
 *   node scripts/generate-preview-css.mjs
 *
 * The stylesheets are committed because the browser links them by a static
 * URL from a parser-blocking head script; nothing builds them at request time.
 *
 * This lives under `scripts/**` on purpose: it is operator tooling that runs
 * outside the Worker bundle, so it prints status-only output directly instead
 * of going through `src/logging/` (AGENTS.md §4, Issue #467). `src/**` may not
 * touch `console` at all.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreviewCss } from '../src/preview/preview-css.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'preview-assets');

mkdirSync(OUT_DIR, { recursive: true });

for (const direction of ['a', 'b', 'c']) {
	for (const theme of ['dark', 'light']) {
		const file = join(OUT_DIR, `dir-${direction}-${theme}.css`);
		writeFileSync(file, buildPreviewCss(direction, theme));
		console.log(`wrote ${relative(ROOT, file)}`);
	}
}
