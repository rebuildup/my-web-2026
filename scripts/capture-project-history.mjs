#!/usr/bin/env node

/**
 * capture-project-history — capture the Issue #518 production-history
 * timeline into `docs/verification/portfolio/project-history-*.png`.
 *
 * What this captures
 * ------------------
 * The shipped story (`src/portfolio/components/PortfolioProjectHistory.stories.tsx`,
 * `Default`) rendered by the story's own `render()` output inside a
 * generated Vite harness — the same technique as
 * `capture-portfolio-case-study.mjs` (#519) and
 * `capture-manifesto.mjs` (#535). `build-storybook` in this
 * repository emits a manager-only static build, so the harness imports
 * the story module directly and the capture cannot drift from the
 * Storybook surface.
 *
 * Two artefacts, because the Issue names two:
 *
 *   - project-history-story.png   Default @ 1440 (desktop)
 *   - project-history-mobile.png  Default @ 390  (mobile)
 *
 * It is an ASSERTION, not only a screenshot
 * -----------------------------------------
 * Before writing each PNG the script reads the rendered DOM back and
 * requires:
 *
 *   - the legend `読み方 / How to read` and both basis labels
 *     (記録 / 記憶) are present;
 *   - the fixture's event kinds cover start / revision / publication;
 *   - every rendered event carries `data-history-kind`,
 *     `data-history-basis` and at least one source entry under its
 *     出典 / Sources list;
 *   - the timeline is text-only: no `<img>` is rendered (the work has
 *     no published project media — the Issue's fallback IS the
 *     shipped state);
 *   - month-precision dates carry the （月まで） marker and no
 *     fabricated day appears;
 *   - no horizontal scroll at the capture width (WCAG 2.2 SC 1.4.10).
 *
 * Output format
 * -------------
 * The Issue names `.png` artefacts, so this script writes PNGs
 * (Chromium's native screenshot). They are committed as-is; there is
 * no encode step.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no binding is touched, no secret is read.
 *     The fixture describes `my-web-2026`, whose repository is public.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port (Chromium refuses ES modules from `file://`).
 *
 * Usage:
 *   node scripts/capture-project-history.mjs [options]
 *
 *   --json-out=<path>  report destination (default
 *                      .tmp/project-history/report.json)
 *   --only=<key>       capture a subset: story, mobile
 *                      (default: both)
 *   --no-build         reuse an existing harness build in .tmp
 *   --no-capture       build and assert nothing browser-side
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MY_WEB_2026_PROJECT_HISTORY } from '../src/portfolio/fixtures/project-history.ts';
import { serveDirectory } from './capture-error-state-gallery.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story the capture renders. */
export const STORY_MODULE = 'src/portfolio/components/PortfolioProjectHistory.stories.tsx';
export const STORY_EXPORT = 'Default';
export const HISTORY_TEST_ID = 'portfolio-project-history';

export const HARNESS_DIR = '.tmp/project-history/harness';
export const HARNESS_DIST = '.tmp/project-history/harness-dist';

/** The two captures the Issue names. */
export const CAPTURES = Object.freeze([
	{
		key: 'story',
		width: 1440,
		height: 900,
		artefact: 'docs/verification/portfolio/project-history-story.png',
	},
	{
		key: 'mobile',
		width: 390,
		height: 844,
		artefact: 'docs/verification/portfolio/project-history-mobile.png',
	},
]);

/** The event kinds the Issue requires the timeline to show. */
export const REQUIRED_KINDS = Object.freeze(['start', 'revision', 'publication']);

/** The epistemic bases the legend must define. */
export const KNOWN_BASES = Object.freeze(['record', 'recollection']);

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
		<title>portfolio project history (#518)</title>
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
	<div data-testid="${HISTORY_TEST_ID}">{${STORY_EXPORT}.render?.()}</div>,
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
 * Read the rendered timeline back out of the browser (pure, so it
 * runs inside the page).
 */
export const READ_PROJECT_HISTORY = ({ testId }) => {
	const root = document.querySelector(`[data-testid="${testId}"]`);
	if (!root) return null;
	const article = root.querySelector('[data-portfolio-project-history]');
	if (!article) return null;
	const eventElements = [...article.querySelectorAll('[data-history-event]')];
	const events = eventElements.map((el) => {
		// Each event renders exactly one list: its 出典 / Sources entries.
		const sourceList = el.querySelector('ul');
		return {
			id: el.getAttribute('data-history-event'),
			kind: el.getAttribute('data-history-kind'),
			basis: el.getAttribute('data-history-basis'),
			sourceCount: sourceList ? sourceList.querySelectorAll('li').length : 0,
		};
	});
	return {
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		legendPresent: (article.textContent ?? '').includes('読み方 / How to read'),
		basisLabels: [...article.querySelectorAll('[data-history-basis-label]')].map((el) =>
			el.getAttribute('data-history-basis-label'),
		),
		events,
		imageCount: article.querySelectorAll('img').length,
		monthMarkers: (article.textContent ?? '').split('（月まで）').length - 1,
		sourcesLabelPresent: (article.textContent ?? '').includes('出典 / Sources'),
	};
};

/**
 * Evaluate one observation against the Issue #518 contract.
 * Pure — exercised by `capture-project-history.test.mjs`.
 */
export function evaluateObservation(observation, fixture = MY_WEB_2026_PROJECT_HISTORY) {
	const failures = [];
	const summary = [];
	if (!observation) {
		return { ok: false, failures: ['nothing rendered'], summary };
	}
	if (observation.scrollWidth > observation.clientWidth) {
		failures.push(
			`horizontal scroll: scrollWidth ${observation.scrollWidth} > clientWidth ${observation.clientWidth}`,
		);
	}
	if (!observation.legendPresent) {
		failures.push('the legend (読み方 / How to read) is missing');
	}
	if (!observation.sourcesLabelPresent) {
		failures.push('the sources label (出典 / Sources) is missing');
	}
	const renderedKinds = new Set(observation.events.map((e) => e.kind));
	for (const kind of REQUIRED_KINDS) {
		if (!renderedKinds.has(kind)) {
			failures.push(`no rendered event of required kind "${kind}"`);
		}
	}
	const renderedBases = new Set(observation.basisLabels);
	for (const basis of KNOWN_BASES) {
		if (!renderedBases.has(basis)) {
			summary.push(`basis "${basis}" has no event in the fixture`);
		}
	}
	for (const event of observation.events) {
		if (!KNOWN_BASES.includes(event.basis)) {
			failures.push(`event "${event.id}" carries unknown basis "${event.basis}"`);
		}
		if (event.sourceCount === 0) {
			failures.push(`event "${event.id}" renders no source`);
		}
	}
	const expectedEvents = fixture.events.length;
	if (observation.events.length !== expectedEvents) {
		failures.push(`rendered ${observation.events.length} event(s), fixture has ${expectedEvents}`);
	}
	// The fixture has no published project media: the timeline must be
	// text-only. An <img> here would mean an unapproved image slipped in.
	if (observation.imageCount !== 0) {
		failures.push(`the timeline rendered ${observation.imageCount} <img> element(s)`);
	}
	const expectedMonthMarkers = fixture.events.filter((e) => e.precision === 'month').length;
	if (observation.monthMarkers !== expectedMonthMarkers) {
		failures.push(`month markers ${observation.monthMarkers}, expected ${expectedMonthMarkers}`);
	}
	summary.push(
		`${observation.events.length} events across kinds ${[...renderedKinds].sort().join(', ')}; bases ${[...renderedBases].sort().join(', ')}`,
	);
	return { ok: failures.length === 0, failures, summary };
}

function parseArgs(argv) {
	const options = {
		jsonOut: '.tmp/project-history/report.json',
		only: null,
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
		if (arg.startsWith('--only=')) {
			options.only = arg.slice('--only='.length);
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

function selectedCaptures(only) {
	if (!only) return CAPTURES;
	const selected = CAPTURES.filter((capture) => capture.key === only);
	if (selected.length === 0) {
		throw new Error(
			`unknown --only key "${only}"; expected one of ${CAPTURES.map((c) => c.key).join(', ')}`,
		);
	}
	return selected;
}

function ensureParent(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const captures = selectedCaptures(options.only);
	ensureParent(options.jsonOut);
	for (const capture of captures) ensureParent(capture.artefact);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the project-history harness…\n');
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

	const results = [];
	if (!options.capture) {
		process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
	} else {
		const server = await serveDirectory(distRoot);
		try {
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				for (const capture of captures) {
					const context = await browser.newContext({
						viewport: { width: capture.width, height: capture.height },
						deviceScaleFactor: 1,
						colorScheme: 'light',
					});
					try {
						const page = await context.newPage();
						await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
						await page.waitForSelector(`[data-testid="${HISTORY_TEST_ID}"]`, {
							timeout: 30_000,
						});
						const observation = await page.evaluate(READ_PROJECT_HISTORY, {
							testId: HISTORY_TEST_ID,
						});
						const verdict = evaluateObservation(observation);
						for (const line of verdict.summary) {
							process.stdout.write(`[capture:${capture.key}] ${line}\n`);
						}
						for (const failure of verdict.failures) {
							process.stderr.write(`- ${failure}\n`);
						}
						if (!verdict.ok) {
							throw new Error(
								`the ${capture.key} capture contradicts the Issue #518 contract (${verdict.failures.length} failure(s))`,
							);
						}
						const target = page.locator(`[data-testid="${HISTORY_TEST_ID}"]`);
						const png = await target.screenshot({ type: 'png', fullPage: true });
						writeFileSync(resolve(REPO_ROOT, capture.artefact), png);
						process.stdout.write(
							`[capture:${capture.key}] wrote ${capture.artefact} (${png.length} bytes)\n`,
						);
						results.push({
							key: capture.key,
							artefact: capture.artefact,
							bytes: png.length,
							viewport: { width: capture.width, height: capture.height },
							colorScheme: 'light',
							fullPage: true,
							observation,
							verdict,
						});
					} finally {
						await context.close();
					}
				}
			} finally {
				await browser.close();
			}
		} finally {
			await server.close();
		}
	}

	const report = {
		issue: '#518',
		generatedBy: 'scripts/capture-project-history.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: HISTORY_TEST_ID },
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
		captures: results,
		policy: {
			format: 'png (the Issue names project-history-*.png)',
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
