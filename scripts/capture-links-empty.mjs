#!/usr/bin/env node

/**
 * capture-links-empty — capture the Issue #390 `/links` empty state
 * into `docs/verification/identity/links-empty.png`.
 *
 * What this captures
 * ------------------
 * The shipped story (`src/about/components/LinksPage.stories.tsx`,
 * `Empty`) rendered by the story's own `render()` output inside a
 * generated Vite harness — the same technique as
 * `capture-project-history.mjs` (#518) and `capture-handle-map.mjs`
 * (#524). `build-storybook` in this repository emits a manager-only
 * static build, so the harness imports the story module directly and
 * the capture cannot drift from the Storybook surface.
 *
 * It is an ASSERTION, not only a screenshot. Before writing the PNG
 * the script reads the rendered DOM back and requires:
 *
 *   - the page still renders its hero (`リンク集 / Links` h1);
 *   - the honest empty heading is present;
 *   - NO link group section rendered (no `links-group-*` testid) —
 *     an empty fixture must not smuggle a fabricated row in;
 *   - the `/contact` pointer is still offered;
 *   - no horizontal scroll at the capture width
 *     (WCAG 2.2 SC 1.4.10 Reflow).
 *
 * Output format
 * -------------
 * The Issue names a `.png` artefact, so this script writes a PNG
 * (Chromium's native screenshot). It is committed as-is; there is no
 * encode step.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no binding is touched, no secret is read.
 *     The empty fixture is `groups: []` — literals in the story.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port (Chromium refuses ES modules from `file://`).
 *
 * Usage:
 *   node scripts/capture-links-empty.mjs [options]
 *
 *   --json-out=<path>  report destination (default
 *                      .tmp/links-empty/report.json)
 *   --no-build         reuse an existing harness build in .tmp
 *   --no-capture       build and assert nothing browser-side
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDirectory } from './capture-error-state-gallery.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story the capture renders. */
export const STORY_MODULE = 'src/about/components/LinksPage.stories.tsx';
export const STORY_EXPORT = 'Empty';
export const LINKS_TEST_ID = 'links-page';

export const HARNESS_DIR = '.tmp/links-empty/harness';
export const HARNESS_DIST = '.tmp/links-empty/harness-dist';

/** The one artefact the Issue names. */
export const ARTEFACT = 'docs/verification/identity/links-empty.png';

/** The honest empty-state copy the component renders. */
export const EMPTY_HEADING = '公開しているリンクはまだありません';

/** Write the generated harness (idempotent, so `--no-build` can reuse it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, 'main.tsx'), harnessMainTsx());
	writeFileSync(join(dir, 'vite.config.ts'), harnessViteConfig(HARNESS_DIR, repoRoot));
	return dir;
}

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>links empty state (#390)</title>
	</head>
	<body style="margin:0">
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/** The generated harness entry point. Renders the shipped story. */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

createRoot(container).render(
	<div data-testid="${LINKS_TEST_ID}">{${STORY_EXPORT}.render?.()}</div>,
);
`;
}

/** The generated Vite config (harness root, repo PostCSS config). */
export function harnessViteConfig(harnessDir = HARNESS_DIR, repoRoot = REPO_ROOT) {
	const outDir = join(repoRoot, HARNESS_DIST);
	return `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	root: '${harnessDir}',
	base: './',
	plugins: [react()],
	css: {
		postcss: '${join(repoRoot, 'postcss.config.mjs')}',
	},
	build: {
		outDir: '${outDir}',
		emptyOutDir: true,
	},
});
`;
}

/**
 * Read the rendered empty state back out of the browser (pure, so it
 * runs inside the page).
 */
export const READ_LINKS_EMPTY = ({ testId, emptyHeading }) => {
	const root = document.querySelector(`[data-testid="${testId}"]`);
	if (!root) return null;
	const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
	return {
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		h1Text: text(root.querySelector('h1')),
		emptyHeadingPresent: (root.textContent ?? '').includes(emptyHeading),
		groupSectionCount: root.querySelectorAll('[data-testid^="links-group-"]').length,
		linkCount: root.querySelectorAll('a[href^="http"]').length,
		contactHrefPresent: [...root.querySelectorAll('a')].some(
			(anchor) => anchor.getAttribute('href') === '/contact',
		),
	};
};

/**
 * Evaluate one observation against the Issue #390 empty-state
 * contract. Pure — exercised by `capture-links-empty.test.mjs`.
 */
export function evaluateObservation(observation, { emptyHeading = EMPTY_HEADING } = {}) {
	const failures = [];
	const summary = [];
	if (!observation) {
		return { ok: false, failures: ['nothing rendered'], summary };
	}
	if (!observation.h1Text.includes('リンク集')) {
		failures.push(`the page hero is missing (h1: "${observation.h1Text}")`);
	}
	if (!observation.emptyHeadingPresent) {
		failures.push(`the honest empty heading "${emptyHeading}" is missing`);
	}
	if (observation.groupSectionCount !== 0) {
		failures.push(
			`the empty fixture rendered ${observation.groupSectionCount} link group section(s) — an empty fixture must not fabricate rows`,
		);
	}
	if (observation.linkCount !== 0) {
		failures.push(
			`the empty fixture rendered ${observation.linkCount} external link(s) — an empty fixture must not fabricate links`,
		);
	}
	if (!observation.contactHrefPresent) {
		failures.push('the /contact pointer is missing from the empty state');
	}
	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`horizontal scroll: scrollWidth ${observation.scrollWidth} > clientWidth ${observation.clientWidth}`,
		);
	}
	summary.push('empty heading present, 0 group sections, 0 external links, /contact pointer kept');
	return { ok: failures.length === 0, failures, summary };
}

function parseArgs(argv) {
	const options = {
		jsonOut: '.tmp/links-empty/report.json',
		width: 1440,
		height: 900,
		build: true,
		capture: true,
	};
	for (const arg of argv) {
		if (arg === '--no-build') {
			options.build = false;
			continue;
		}
		if (arg === '--no-capture') {
			options.capture = false;
			continue;
		}
		if (arg.startsWith('--json-out=')) {
			options.jsonOut = arg.slice('--json-out='.length);
			continue;
		}
		if (arg.startsWith('--width=')) {
			options.width = Number(arg.slice('--width='.length));
			continue;
		}
		if (arg.startsWith('--height=')) {
			options.height = Number(arg.slice('--height='.length));
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

function ensureParent(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	ensureParent(options.jsonOut);
	ensureParent(ARTEFACT);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the links-empty harness…\n');
		execFileSync(
			'pnpm',
			['exec', 'vite', 'build', '--config', join(HARNESS_DIR, 'vite.config.ts')],
			{ cwd: REPO_ROOT, stdio: 'inherit' },
		);
	} else {
		process.stdout.write('[capture] reusing the existing harness build\n');
	}
	if (!existsSync(join(distRoot, 'index.html'))) {
		throw new Error(`harness build produced no ${HARNESS_DIST}/index.html`);
	}

	let observation = null;
	let verdict = null;
	if (!options.capture) {
		process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
	} else {
		const server = await serveDirectory(distRoot);
		try {
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 1,
					colorScheme: 'light',
				});
				try {
					const page = await context.newPage();
					await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
					await page.waitForSelector(`[data-testid="${LINKS_TEST_ID}"]`, {
						timeout: 30_000,
					});
					observation = await page.evaluate(READ_LINKS_EMPTY, {
						testId: LINKS_TEST_ID,
						emptyHeading: EMPTY_HEADING,
					});
					verdict = evaluateObservation(observation);
					for (const line of verdict.summary) {
						process.stdout.write(`[capture] ${line}\n`);
					}
					for (const failure of verdict.failures) {
						process.stderr.write(`- ${failure}\n`);
					}
					if (!verdict.ok) {
						throw new Error(
							`the empty-state capture contradicts the Issue #390 contract (${verdict.failures.length} failure(s))`,
						);
					}
					const target = page.locator(`[data-testid="${LINKS_TEST_ID}"]`);
					const png = await target.screenshot({ type: 'png', fullPage: true });
					writeFileSync(resolve(REPO_ROOT, ARTEFACT), png);
					process.stdout.write(
						`[capture] wrote ${ARTEFACT} (${options.width}px wide, ${png.length} bytes)\n`,
					);
				} finally {
					await context.close();
				}
			} finally {
				await browser.close();
			}
		} finally {
			await server.close();
		}
	}

	const report = {
		issue: '#390',
		generatedBy: 'scripts/capture-links-empty.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: LINKS_TEST_ID },
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		treeChanges: execFileSync('git', ['status', '--porcelain'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		})
			.trim()
			.split('\n')
			.filter(Boolean).length,
		artefact: ARTEFACT,
		conditions: {
			viewport: { width: options.width, height: options.height },
			deviceScaleFactor: 1,
			colorScheme: 'light',
			waitUntil: 'networkidle',
			screenshot: 'element fullPage',
			encode: { format: 'png' },
		},
		observation,
		verdict,
		policy: {
			format: 'png (the Issue names links-empty.png)',
			reproducible:
				'the harness build is deterministic; the browser capture is not byte-reproducible',
		},
	};
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] report ${options.jsonOut}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`capture failed: ${error.message}\n`);
		process.exit(1);
	});
}
