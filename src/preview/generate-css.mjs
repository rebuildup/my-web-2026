/**
 * Issue #764 — regenerates the six direction stylesheets in
 * `public/preview-assets/` (WORKTREE ONLY, never merged).
 *
 *   node src/preview/generate-css.mjs
 *
 * The stylesheets are committed because the browser links them by a static
 * URL from a parser-blocking head script; nothing builds them at request time.
 */
import { writeFileSync } from 'node:fs';
import { buildPreviewCss } from './preview-css.mjs';

for (const direction of ['a', 'b', 'c']) {
	for (const theme of ['dark', 'light']) {
		const file = `public/preview-assets/dir-${direction}-${theme}.css`;
		writeFileSync(file, buildPreviewCss(direction, theme));
		console.log(`wrote ${file}`);
	}
}
