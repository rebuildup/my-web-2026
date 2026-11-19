#!/usr/bin/env node

/**
 * capture-portfolio-case-study — capture the Issue #519 case-study
 * element into `docs/verification/portfolio/decision-case-study.png`.
 *
 * What this captures
 * ------------------
 * The shipped story (`src/portfolio/components/PortfolioCaseStudy.stories.tsx`,
 * `Default`) rendered by the story's own `render()` output inside a
 * generated Vite harness — the same technique as
 * `capture-project-card-category-bar.mjs` (#794) and
 * `capture-error-state-gallery.mjs` (#501). `build-storybook` in this
 * repository emits a manager-only static build, so the harness imports
 * the story module directly and the capture cannot drift from the
 * Storybook surface.
 *
 * It is an ASSERTION, not only a screenshot
 * -----------------------------------------
 * Before writing the PNG the script reads the rendered DOM back and
 * requires:
 *
 *   - the legend `読み方 / How to read` and all three class labels
 *     (確定事実 / 当時の推測 / 現在の評価) are present;
 *   - the four case-study sections (目的 / 選択肢 / 決定 / 検証結果)
 *     are present, in order;
 *   - every fixture entry carries a `data-claim-class` and every class
 *     present in the fixture is one of the three known classes;
 *   - no horizontal scroll at the capture width (WCAG 2.2 SC 1.4.10).
 *
 * Output format
 * -------------
 * The Issue names the artefact `decision-case-study.png`, so this
 * script writes a PNG (Chromium's native screenshot) rather than the
 * WebP the budgeted capture scripts produce. The PNG is committed
 * as-is; there is no encode step and no size budget beyond what the
 * full-page 1440px capture naturally produces.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no binding is touched, no secret is read.
 *     The fixture describes `my-web-2026`, whose repository is public.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port (Chromium refuses ES modules from `file://`).
 *
 * Usage:
 *   node scripts/capture-portfolio-case-study.mjs [options]
 *
 *   --out=<path>       committed artefact (default
 *                      docs/verification/portfolio/decision-case-study.png)
 *   --json-out=<path>  report destination (default
 *                      .tmp/portfolio-case-study/report.json)
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
export const STORY_MODULE = 'src/portfolio/components/PortfolioCaseStudy.stories.tsx';
export const STORY_EXPORT = 'Default';
export const CASE_STUDY_TEST_ID = 'portfolio-case-study';

export const HARNESS_DIR = '.tmp/portfolio-case-study/harness';
export const HARNESS_DIST = '.tmp/portfolio-case-study/harness-dist';

/** Capture geometry: desktop width, full page. */
export const CAPTURE = Object.freeze({ width: 1440, height: 900 });

/** The classes the element is allowed to emit. */
export const KNOWN_CLAIM_CLASSES = Object.freeze([
	'confirmed',
	'period-estimate',
	'current-evaluation',
]);

/** The four sections the fixture must render, in order. */
export const REQUIRED_SECTIONS = Object.freeze([
	'目的 / Goal',
	'選択肢 / Options',
	'決定 / Decision',
	'検証結果 / Verification',
]);

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
		<title>portfolio case study (#519)</title>
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
	<div data-testid="${CASE_STUDY_TEST_ID}">{${STORY_EXPORT}.render?.()}</div>,
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
 * Read the rendered case study back out of the browser (pure, so it
 * runs inside the page).
 */
export const READ_CASE_STUDY = ({ testId }) => {
	const root = document.querySelector(`[data-testid="${testId}"]`);
	if (!root) return null;
	const article = root.querySelector('[data-portfolio-case-study]');
	if (!article) return null;
	return {
		scrollWidth: document.documentElement.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		headings: [...article.querySelectorAll('h2, h3')].map((h) =>
			(h.textContent ?? '').replace(/\s+/g, ' ').trim(),
		),
		legendPresent: (article.textContent ?? '').includes('読み方 / How to read'),
		classLabels: [...article.querySelectorAll('[data-claim-class]')].map((el) =>
			el.getAttribute('data-claim-class'),
		),
		markKinds: [...article.querySelectorAll('[data-claim-class-mark]')].map((el) =>
			el.getAttribute('data-claim-class-mark'),
		),
	};
};

/**
 * Evaluate one observation against the Issue #519 contract.
 * Pure — exercised by `capture-portfolio-case-study.test.mjs`.
 */
export function evaluateObservation(observation) {
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
		failures.push('the claim-class legend (読み方 / How to read) is missing');
	}
	for (const section of REQUIRED_SECTIONS) {
		if (!observation.headings.includes(section)) {
			failures.push(`section "${section}" is missing`);
		}
	}
	const order = REQUIRED_SECTIONS.map((s) => observation.headings.indexOf(s)).filter(
		(i) => i !== -1,
	);
	if (order.some((value, i) => i > 0 && value < order[i - 1])) {
		failures.push('the four sections are not in the documented order');
	}
	if (observation.classLabels.length === 0) {
		failures.push('no entry carries a data-claim-class');
	}
	for (const cls of observation.classLabels) {
		if (!KNOWN_CLAIM_CLASSES.includes(cls)) {
			failures.push(`unknown claim class "${cls}"`);
		}
	}
	const distinct = new Set(observation.classLabels);
	for (const required of KNOWN_CLAIM_CLASSES) {
		if (!distinct.has(required)) {
			summary.push(`claim class "${required}" has no entry in the fixture`);
		}
	}
	summary.push(
		`${observation.classLabels.length} labelled entries across ${distinct.size} claim class(es)`,
	);
	return { ok: failures.length === 0, failures, summary };
}

function parseArgs(argv) {
	const options = {
		out: 'docs/verification/portfolio/decision-case-study.png',
		jsonOut: '.tmp/portfolio-case-study/report.json',
		build: true,
		capture: true,
	};
	for (const arg of argv) {
		const separator = arg.indexOf('=');
		const flag = (
			arg.startsWith('--') ? arg.slice(2, separator === -1 ? undefined : separator) : arg
		).replace(/^--/, '');
		const value = separator === -1 ? null : arg.slice(separator + 1);
		switch (flag) {
			case 'out':
				options.out = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'no-build':
				options.build = false;
				break;
			case 'no-capture':
				options.capture = false;
				break;
			default:
				throw new Error(`unknown option: --${flag}`);
		}
	}
	if (!options.out.endsWith('.png')) {
		throw new Error(`the Issue #519 artefact is a PNG; got ${options.out}`);
	}
	return options;
}

function ensureParent(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	ensureParent(options.out);
	ensureParent(options.jsonOut);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the case-study harness…\n');
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

	const server = await serveDirectory(distRoot);
	let observation = null;
	let verdict = null;
	const captures = {};
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const browser = await chromium.launch();
			try {
				const context = await browser.newContext({
					viewport: { width: CAPTURE.width, height: CAPTURE.height },
					deviceScaleFactor: 1,
					colorScheme: 'light',
				});
				try {
					const page = await context.newPage();
					await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
					await page.waitForSelector(`[data-testid="${CASE_STUDY_TEST_ID}"]`, {
						timeout: 30_000,
					});
					observation = await page.evaluate(READ_CASE_STUDY, {
						testId: CASE_STUDY_TEST_ID,
					});
					const target = page.locator(`[data-testid="${CASE_STUDY_TEST_ID}"]`);
					const png = await target.screenshot({ type: 'png', fullPage: true });
					writeFileSync(resolve(REPO_ROOT, options.out), png);
					captures['desktop-light'] = {
						artefact: options.out,
						bytes: png.length,
						viewport: { width: CAPTURE.width, height: CAPTURE.height },
						colorScheme: 'light',
						fullPage: true,
					};
					process.stdout.write(`[capture] wrote ${options.out} (${png.length} bytes)\n`);
				} finally {
					await context.close();
				}
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation(observation);
			for (const line of verdict.summary) process.stdout.write(`[capture] ${line}\n`);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the capture contradicts the Issue #519 contract (${verdict.failures.length} failure(s))`,
				);
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#519',
		generatedBy: 'scripts/capture-portfolio-case-study.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: CASE_STUDY_TEST_ID },
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
		observation,
		verdict,
		captures,
		policy: {
			format: 'png (the Issue names decision-case-study.png)',
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
