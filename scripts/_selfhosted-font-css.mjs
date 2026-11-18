// Self-hosted font CSS for capture scripts (Issue #876).
//
// The shipped `@font-face` rules live in `src/styles.css` and reference
// root-relative `/fonts/*.woff2` assets in `public/fonts/`. Capture
// reports are rendered to a file and opened with `file://`, where a
// root-relative URL resolves to nothing, so this helper rewrites each
// asset URL onto an absolute origin before the rules are inlined into
// the report. The default base is the canonical production origin —
// the same bytes the deployed Worker serves — and
// `MY_WEB_FONT_BASE_URL` overrides it (e.g. a local `vite dev` origin
// while the fonts are still being verified before release).
//
// The rules are read from `src/styles.css`, never restated here: a
// report that declared its own faces would measure a font the product
// does not ship.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FONT_BASE_URL = process.env.MY_WEB_FONT_BASE_URL ?? 'https://rebuildup.dev';

const FONT_FACE_BLOCK = /@font-face\s*\{[^}]*\}/g;

/**
 * @returns {Promise<{ css: string, families: string[], baseUrl: string, ruleCount: number }>}
 *   `css` is every self-hosted `@font-face` block from
 *   `src/styles.css` with asset URLs rewritten to the absolute base;
 *   `families` is the deduplicated set of declared `font-family`
 *   names; `ruleCount` is how many blocks were found.
 */
export async function loadSelfHostedFontCss() {
	const styles = await readFile(resolve(REPO_ROOT, 'src/styles.css'), 'utf8');
	const blocks = styles.match(FONT_FACE_BLOCK) ?? [];
	const selfHosted = blocks.filter((block) => block.includes('url(/fonts/'));
	if (selfHosted.length === 0) {
		throw new Error(
			'_selfhosted-font-css: no self-hosted @font-face rules (url(/fonts/…)) in src/styles.css. ' +
				'Update this helper rather than letting the report measure a font the product does not ship.',
		);
	}
	const css = selfHosted
		.map((block) => block.replaceAll('url(/fonts/', `url(${FONT_BASE_URL}/fonts/`))
		.join('\n');
	const families = [
		...new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map(([, name]) => name)),
	];
	return { css, families, baseUrl: FONT_BASE_URL, ruleCount: selfHosted.length };
}
