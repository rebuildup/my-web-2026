#!/usr/bin/env node

/**
 * capture-analytics-consent — capture the Issue #495 consent gallery for
 * `docs/verification/privacy/analytics-disabled.webp`.
 *
 * What this captures
 * ------------------
 * Every state of the shipped consent panel (`AnalyticsConsentPanel`):
 * undecided, granted, denied, browser off-switch, and a refused write.
 * It is the verification screen for
 * `docs/verification/privacy/analytics-disabled.md`.
 *
 * This is a REPORT of those states, not a page of the site: no route
 * mounts the panel standalone, and the capture runs no real consent
 * flow. The claims the image supports are the copy and the affordances
 * of each state; the enforcement claims belong to the suites named in
 * the report.
 *
 * Why a Vite harness instead of the Storybook gallery
 * ---------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (see `scripts/capture-error-state-gallery.mjs`), so the
 * capture renders the SAME shipped story (`AllStates`) through a local
 * Vite harness. The harness imports the story module itself, which is
 * what keeps the capture and the Storybook surface from drifting.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, and no secret
 *     value is read or printed. No network request leaves loopback.
 *   - The harness is served on an ephemeral loopback port only because
 *     Chromium refuses ES modules from `file://`.
 *
 * WebP, not PNG
 * -------------
 * Issue #495 names `analytics-disabled.png`; this repository commits
 * verification screenshots as WebP (and the sibling error-state capture
 * established the rule). The script refuses a non-`.webp` output path,
 * writes the intermediate PNG under `.tmp/`, and deletes it.
 *
 * Usage:
 *   node scripts/capture-analytics-consent.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/privacy/analytics-disabled.webp)
 *   --png=<path>          temporary PNG capture (default .tmp/analytics-consent/capture.png)
 *   --json-out=<path>     report destination
 *                         (default .tmp/analytics-consent/report.json)
 *   --width=<n>           viewport width (default 1280)
 *   --height=<n>          viewport height (default 900)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          resolve and build everything, write no artefact
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	assertWebpOutputPath,
	screenshotBudgetVerdict,
	serveDirectory,
} from './capture-error-state-gallery.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story the capture renders. */
export const STORY_MODULE = 'src/editorial/analytics/AnalyticsConsent.stories.tsx';
export const STORY_EXPORT = 'AllStates';

/** Readiness marker the capture waits for before taking the screenshot. */
export const GALLERY_TEST_ID = 'analytics-consent-gallery';

export const HARNESS_DIR = '.tmp/analytics-consent/harness';
export const HARNESS_DIST = '.tmp/analytics-consent/harness-dist';

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>analytics consent gallery (#495)</title>
	</head>
	<body>
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

// \`${STORY_EXPORT}.render()\` is the shipped gallery.
createRoot(container).render(<>{${STORY_EXPORT}.render?.()}</>);
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

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/privacy/analytics-disabled.webp',
		png: '.tmp/analytics-consent/capture.png',
		jsonOut: '.tmp/analytics-consent/report.json',
		width: 1280,
		height: 900,
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
			case 'screenshot':
				options.screenshot = value;
				break;
			case 'png':
				options.png = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'width':
				options.width = Number(value);
				break;
			case 'height':
				options.height = Number(value);
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
	return options;
}

function ensureParent(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

/** Write the generated harness (idempotent, so `--no-build` can reuse it). */
export function writeHarness(repoRoot = REPO_ROOT) {
	const dir = resolve(repoRoot, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'index.html'), harnessIndexHtml());
	writeFileSync(join(dir, 'main.tsx'), harnessMainTsx());
	writeFileSync(join(dir, 'vite.config.ts'), harnessViteConfig(HARNESS_DIR, repoRoot));
	return dir;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the consent harness…\n');
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
	let capture = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			ensureParent(options.png);
			const browser = await chromium.launch();
			try {
				const page = await browser.newPage({
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 1,
				});
				await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
				await page.waitForSelector(`[data-testid="${GALLERY_TEST_ID}"]`, { timeout: 30_000 });
				const png = await page.screenshot({ fullPage: true, type: 'png' });
				ensureParent(options.screenshot);
				await sharp(png)
					.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
					.webp({ quality: SCREENSHOT_QUALITY })
					.toFile(resolve(REPO_ROOT, options.screenshot));
				const verdict = screenshotBudgetVerdict(
					statSync(resolve(REPO_ROOT, options.screenshot)).size,
				);
				capture = {
					artefact: options.screenshot,
					story: `${STORY_MODULE}#${STORY_EXPORT}`,
					viewport: { width: options.width, height: options.height },
					deviceScaleFactor: 1,
					quality: SCREENSHOT_QUALITY,
					...verdict,
				};
				rmSync(resolve(REPO_ROOT, options.png), { force: true });
				if (!verdict.withinBudget) {
					throw new Error(`capture is ${verdict.kb} kB, over the artefact budget`);
				}
				process.stdout.write(`[capture] wrote ${options.screenshot} (${verdict.kb} kB)\n`);
			} finally {
				await browser.close();
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#495',
		generatedBy: 'scripts/capture-analytics-consent.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: GALLERY_TEST_ID },
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			issuePathSubstituted: 'docs/verification/privacy/analytics-disabled.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureParent(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] report ${options.jsonOut}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		process.stderr.write(`capture failed: ${error.message}\n`);
		process.exit(1);
	});
}
