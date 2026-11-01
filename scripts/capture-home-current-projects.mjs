#!/usr/bin/env node

/**
 * capture-home-current-projects — capture the Issue #316 verification
 * screens into `docs/verification/home/current-projects-*.webp`.
 *
 * What this captures
 * ------------------
 * The shipped story (`src/home/current/CurrentProjects.stories.tsx`,
 * the `home/CurrentProjects` → `Populated` story) rendered in a
 * Chromium at three conditions:
 *
 *   - desktop 1440 — the section in its widest shipped layout;
 *   - mobile 390   — the single-column layout (the width the section
 *                    has to survive without a horizontal scroll);
 *   - reduced motion — the SAME desktop context with
 *                    `prefers-reduced-motion: reduce`, so the artefact
 *                    shows that turning motion off removes nothing but
 *                    movement.
 *
 * It is also an ASSERTION, not only a screenshot. The section ships
 * NO motion, so "no information is lost under the reduce preference"
 * is a claim about the DOM: after each capture the script reads the
 * rendered section back out of the browser and compares the heading,
 * the project count and every project name / status line against the
 * DOM it captured without the preference. A reduced-motion context
 * that dropped a project, a heading or a status line fails the capture
 * instead of producing a plausible picture.
 *
 * Why a generated harness instead of the Storybook gallery
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`) — see
 * `scripts/capture-error-state-gallery.mjs` (Issue #501). So the
 * harness below imports the SHIPPED story module itself and renders
 * the story's own `render()` output: the capture and the Storybook
 * gallery cannot drift.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The fixture data is literals in the story file.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`, which
 *     is the only reason an origin exists.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG. The capture is taken into `.tmp/`, encoded
 * with the existing `sharp` devDependency at width <= 1600 / quality
 * 80, and the committed file is the `.webp` sibling. The script
 * REFUSES any non-`.webp` output path and deletes the intermediate
 * PNGs.
 *
 * Usage:
 *   node scripts/capture-home-current-projects.mjs [options]
 *
 *   --desktop=<path>    committed desktop artefact
 *                       (default docs/verification/home/current-projects-desktop.webp)
 *   --mobile=<path>     committed mobile artefact
 *                       (default docs/verification/home/current-projects-mobile.webp)
 *   --reduced=<path>    committed reduced-motion artefact
 *                       (default docs/verification/home/current-projects-reduced-motion.webp)
 *   --png-dir=<path>    temporary PNG directory (default .tmp/home-current-projects)
 *   --json-out=<path>   report destination
 *                       (default .tmp/home-current-projects/report.json)
 *   --no-build          reuse an existing harness build in .tmp
 *   --no-capture        build and assert nothing browser-side; write no artefact
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SCREENSHOT_QUALITY,
	assertWebpOutputPath,
	screenshotBudgetVerdict,
	serveDirectory,
} from './capture-error-state-gallery.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story the capture renders. */
export const STORY_MODULE = 'src/home/current/CurrentProjects.stories.tsx';
export const STORY_EXPORT = 'Populated';

/** Readiness marker the capture waits for before reading anything. */
export const SECTION_TEST_ID = 'home-current-projects';

export const HARNESS_DIR = '.tmp/home-current-projects/harness';
export const HARNESS_DIST = '.tmp/home-current-projects/harness-dist';

/** The three capture conditions this Issue names. */
export const CAPTURES = [
	{ id: 'desktop', width: 1440, height: 640, reducedMotion: 'no-preference' },
	{ id: 'mobile', width: 390, height: 880, reducedMotion: 'no-preference' },
	{ id: 'reduced-motion', width: 1440, height: 640, reducedMotion: 'reduce' },
];

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>home current projects (#316)</title>
	</head>
	<body style="margin:0;background:#ffffff">
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

// \`${STORY_EXPORT}.render()\` is the shipped story.
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
		desktop: 'docs/verification/home/current-projects-desktop.webp',
		mobile: 'docs/verification/home/current-projects-mobile.webp',
		reduced: 'docs/verification/home/current-projects-reduced-motion.webp',
		pngDir: '.tmp/home-current-projects',
		jsonOut: '.tmp/home-current-projects/report.json',
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
			case 'desktop':
				options.desktop = value;
				break;
			case 'mobile':
				options.mobile = value;
				break;
			case 'reduced':
				options.reduced = value;
				break;
			case 'png-dir':
				options.pngDir = value;
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

/**
 * Read the rendered section back out of the browser (pure, so it runs
 * inside the page).
 *
 * The reading is deliberately complete: the heading, the project
 * count, every project's name and status line, and the animation names
 * the browser reports. A capture that only photographed the section
 * would not notice a project that vanished under the reduce
 * preference.
 */
export const READ_SECTION = ({ testId }) => {
	const section = document.querySelector(`[data-testid="${testId}"]`);
	if (!section) return null;
	const heading = section.querySelector('#current-projects-heading');
	const items = [...section.querySelectorAll('[data-testid="home-current-project"]')].map(
		(item) => ({
			id: item.getAttribute('data-project-id'),
			text: (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
		}),
	);
	const animated = [...section.querySelectorAll('*')].filter(
		(element) => getComputedStyle(element).animationName !== 'none',
	).length;
	return {
		heading: (heading?.textContent ?? '').replace(/\s+/g, ' ').trim(),
		itemCount: items.length,
		items,
		animated,
		empty: Boolean(section.querySelector('[data-testid="home-current-projects-empty"]')),
	};
};

/**
 * Compare the reduced-motion observation with the desktop one (pure,
 * so it is assertable without a browser).
 *
 * The section ships no motion, so the two documents must carry the
 * SAME information. A difference is a defect, not a styling choice.
 */
export function evaluateObservation({ desktop, reduced }) {
	const failures = [];
	if (!desktop || !reduced) {
		failures.push('one of the two browser observations is missing');
		return { ok: false, failures };
	}
	if (desktop.heading !== reduced.heading) {
		failures.push(
			`the heading changed under the reduce preference ("${desktop.heading}" vs "${reduced.heading}")`,
		);
	}
	if (desktop.itemCount !== reduced.itemCount) {
		failures.push(
			`the number of published projects changed under the reduce preference (${desktop.itemCount} vs ${reduced.itemCount})`,
		);
	}
	if (desktop.empty !== reduced.empty) {
		failures.push('the empty state appeared or disappeared under the reduce preference');
	}
	for (const item of desktop.items) {
		const other = reduced.items.find((candidate) => candidate.id === item.id);
		if (!other) {
			failures.push(`the project "${item.id}" disappeared under the reduce preference`);
			continue;
		}
		if (other.text !== item.text) {
			failures.push(`the project "${item.id}" reads differently under the reduce preference`);
		}
	}
	if (desktop.animated !== 0 || reduced.animated !== 0) {
		failures.push(
			`the section animates in one of the contexts (desktop ${desktop.animated}, reduced ${reduced.animated} animated element(s)); it ships no motion at all`,
		);
	}
	return { ok: failures.length === 0, failures };
}

async function captureCondition(browser, baseUrl, condition, pngPath) {
	const context = await browser.newContext({
		viewport: { width: condition.width, height: condition.height },
		deviceScaleFactor: 1,
		reducedMotion: condition.reducedMotion,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
		await page.waitForSelector(`[data-testid="${SECTION_TEST_ID}"]`, { timeout: 30_000 });
		const observation = await page.evaluate(READ_SECTION, { testId: SECTION_TEST_ID });
		const png = await page.screenshot({ fullPage: true, type: 'png' });
		writeFileSync(pngPath, png);
		return { ...observation, condition: condition.id, reducedMotion: condition.reducedMotion };
	} finally {
		await context.close();
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const outputs = {
		desktop: options.desktop,
		mobile: options.mobile,
		'reduced-motion': options.reduced,
	};
	if (options.capture) {
		for (const path of Object.values(outputs)) assertWebpOutputPath(path);
	}

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the current-projects harness…\n');
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
	const observations = {};
	const captures = {};
	let verdict = null;
	try {
		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			const pngDir = resolve(REPO_ROOT, options.pngDir);
			mkdirSync(pngDir, { recursive: true });
			const browser = await chromium.launch();
			try {
				for (const condition of CAPTURES) {
					const pngPath = join(pngDir, `${condition.id}.png`);
					const observation = await captureCondition(browser, server.baseUrl, condition, pngPath);
					observations[condition.id] = observation;
					const outPath = resolve(REPO_ROOT, outputs[condition.id]);
					ensureParent(outputs[condition.id]);
					await sharp(pngPath)
						.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
						.webp({ quality: SCREENSHOT_QUALITY })
						.toFile(outPath);
					// The intermediate PNG never reaches the repository.
					rmSync(pngPath, { force: true });
					const budget = screenshotBudgetVerdict(statSync(outPath).size);
					if (!budget.withinBudget) {
						throw new Error(
							`capture ${condition.id} is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
						);
					}
					captures[condition.id] = {
						artefact: outputs[condition.id],
						viewport: { width: condition.width, height: condition.height },
						reducedMotion: condition.reducedMotion,
						quality: SCREENSHOT_QUALITY,
						...budget,
					};
					process.stdout.write(`[capture] wrote ${outputs[condition.id]} (${budget.kb} kB)\n`);
				}
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation({
				desktop: observations.desktop,
				reduced: observations['reduced-motion'],
			});
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the reduced-motion capture contradicts the section contract (${verdict.failures.length} failure(s)); no artefact was kept`,
				);
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#316',
		generatedBy: 'scripts/capture-home-current-projects.mjs',
		story: { module: STORY_MODULE, export: STORY_EXPORT, testId: SECTION_TEST_ID },
		sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: REPO_ROOT,
			encoding: 'utf8',
		}).trim(),
		harness: { dir: HARNESS_DIR, dist: HARNESS_DIST, entry: harnessIndexHtml() },
		observations,
		verdict,
		captures,
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
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
