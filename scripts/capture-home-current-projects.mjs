#!/usr/bin/env node

/**
 * capture-home-current-projects — capture the Issue #316 verification
 * screens into `docs/verification/home/current-projects-*.webp`.
 *
 * What this captures
 * ------------------
 * The shipped story (`src/home/current/CurrentProjects.stories.tsx`,
 * `Shipped`, which composes the owner's roster with this repository's
 * committed git snapshot) in a Chromium at seven conditions:
 *
 *   - desktop 1440 × light / dark — the widest shipped layout in both
 *     appearances the document declares via `color-scheme`;
 *   - mobile 390 × light / dark — the single-column layout at the width
 *     the section has to survive without a horizontal scroll;
 *   - reduced motion (desktop, light) — the same document with
 *     `prefers-reduced-motion: reduce`, so the artefact shows that turning
 *     motion off removes nothing but movement;
 *   - change marker (desktop, light) — the ONE motion surface, after a real
 *     fact changed between two visits;
 *   - change marker under reduced motion — the same marker with the fade
 *     suppressed. The marker is information and stays; only the animation
 *     is gone.
 *
 * It is an ASSERTION, not only a screenshot
 * -----------------------------------------
 * After each capture the script reads the rendered section back out of the
 * browser and compares the conditions against each other:
 *
 *   - light and dark must publish the SAME projects with the SAME text;
 *   - desktop and mobile must publish the SAME projects with the SAME text;
 *   - a first visit must render NO marker and animate NOTHING (nothing has
 *     changed yet, and a first paint that animates is the fake-live
 *     behaviour the design forbids);
 *   - a changed fact must render exactly one marker, animated under
 *     `no-preference` and NOT animated under `reduce`;
 *   - the reduced document must carry the same information as the
 *     unreduced one.
 *
 * The marker state is produced the way a visitor produces it: the page is
 * loaded once (first visit → the browser stores the current signatures),
 * one stored signature is then rewritten to a previous value, and the page
 * is reloaded. Nothing is faked in the DOM.
 *
 * Why a generated harness instead of the Storybook gallery
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY static
 * build (no `iframe.html`) — see `scripts/capture-error-state-gallery.mjs`
 * (Issue #501). So the harness below imports the SHIPPED story module and
 * renders the story's own `render()` output: the capture and the Storybook
 * gallery cannot drift.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is read
 *     or printed. The fixture data is committed (roster + git snapshot).
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`, which is
 *     the only reason an origin exists.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG. The capture is taken into `.tmp/`, encoded with
 * the existing `sharp` devDependency at width <= 1600 / quality 80, and the
 * committed file is the `.webp` sibling. The script REFUSES any non-`.webp`
 * output path and deletes the intermediate PNGs.
 *
 * Usage:
 *   node scripts/capture-home-current-projects.mjs [options]
 *
 *   --out-dir=<path>    directory for the committed artefacts
 *                       (default docs/verification/home)
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
export const STORY_EXPORT = 'Shipped';

/** Readiness marker the capture waits for before reading anything. */
export const SECTION_TEST_ID = 'home-current-projects';

/**
 * The localStorage key the section compares against. Kept in step with
 * `CHANGE_SIGNATURE_STORAGE_KEY` in
 * `src/home/current/use-changed-projects.ts`; the vitest suite pins that
 * constant, and this script only has to know the same string because it
 * seeds a previous visit.
 */
export const STORAGE_KEY = 'mw_home_current_projects_v1';

export const HARNESS_DIR = '.tmp/home-current-projects/harness';
export const HARNESS_DIST = '.tmp/home-current-projects/harness-dist';

/**
 * The sentence the change marker prints. Duplicated here only to take it out
 * of the information comparison; the component owns the wording.
 */
const MARKER_TEXT = '前回の表示から更新';

/** The documents captured without a seeded previous visit. */
export const CAPTURES = [
	{
		id: 'desktop-light',
		width: 1440,
		height: 720,
		colorScheme: 'light',
		reducedMotion: 'no-preference',
	},
	{
		id: 'desktop-dark',
		width: 1440,
		height: 720,
		colorScheme: 'dark',
		reducedMotion: 'no-preference',
	},
	{
		id: 'mobile-light',
		width: 390,
		height: 900,
		colorScheme: 'light',
		reducedMotion: 'no-preference',
	},
	{
		id: 'mobile-dark',
		width: 390,
		height: 900,
		colorScheme: 'dark',
		reducedMotion: 'no-preference',
	},
	{ id: 'reduced-motion', width: 1440, height: 720, colorScheme: 'light', reducedMotion: 'reduce' },
];

/** The documents captured after a real fact changed between two visits. */
export const MARKER_CAPTURES = [
	{
		id: 'change-marker',
		width: 1440,
		height: 720,
		colorScheme: 'light',
		reducedMotion: 'no-preference',
	},
	{
		id: 'change-marker-reduced',
		width: 1440,
		height: 720,
		colorScheme: 'light',
		reducedMotion: 'reduce',
	},
];

/** The generated harness page. The canvas colour comes from `src/styles.css`. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>home current projects (#316)</title>
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
		outDir: 'docs/verification/home',
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
			case 'out-dir':
				options.outDir = value;
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

/** The committed artefact path for one condition. */
export function artefactPath(outDir, id) {
	return `${outDir}/current-projects-${id}.webp`;
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
 * Read the rendered section back out of the browser (pure, so it runs inside
 * the page).
 *
 * The reading is deliberately complete: the heading, every project's id and
 * text, the change markers, and the animation names the browser actually
 * reports. A capture that only photographed the section would not notice a
 * project that vanished under a preference, or a marker that animated when
 * it should not have.
 */
export const READ_SECTION = ({ testId }) => {
	const section = document.querySelector(`[data-testid="${testId}"]`);
	if (!section) return null;
	const heading = section.querySelector('#current-projects-heading');
	const items = [...section.querySelectorAll('[data-testid="home-current-project"]')].map(
		(item) => ({
			id: item.getAttribute('data-project-id'),
			text: (item.textContent ?? '').replace(/\s+/g, ' ').trim(),
			changed: Boolean(item.querySelector('[data-testid="home-current-project-changed"]')),
		}),
	);
	const animated = [...section.querySelectorAll('*')]
		.map((element) => getComputedStyle(element).animationName)
		.filter((name) => name !== 'none');
	return {
		heading: (heading?.textContent ?? '').replace(/\s+/g, ' ').trim(),
		itemCount: items.length,
		items,
		markers: items.filter((item) => item.changed).length,
		animated: animated.length,
		animationNames: [...new Set(animated)],
		empty: Boolean(section.querySelector('[data-testid="home-current-projects-empty"]')),
		colorScheme: getComputedStyle(document.documentElement).colorScheme,
	};
};

/**
 * A comparison projection: the information, without the appearance.
 *
 * The change marker's sentence is removed here, because the marker is the
 * one thing a changed fact is SUPPOSED to add; comparing with it left in
 * would make the marker capture differ from the first-visit capture by
 * construction and turn the information check into a tautology.
 */
function projection(observation) {
	return {
		heading: observation.heading,
		empty: observation.empty,
		items: observation.items.map((item) => ({
			id: item.id,
			text: item.text.replace(MARKER_TEXT, '').replace(/\s+/g, ' ').trim(),
		})),
	};
}

function assertSameInformation(failures, a, b, label) {
	const left = projection(a);
	const right = projection(b);
	if (left.heading !== right.heading) {
		failures.push(`${label}: the heading differs ("${left.heading}" vs "${right.heading}")`);
	}
	if (left.empty !== right.empty) {
		failures.push(`${label}: the empty state appeared or disappeared`);
	}
	if (left.items.length !== right.items.length) {
		failures.push(
			`${label}: the number of published projects differs (${left.items.length} vs ${right.items.length})`,
		);
	}
	for (const item of left.items) {
		const other = right.items.find((candidate) => candidate.id === item.id);
		if (!other) {
			failures.push(`${label}: the project "${item.id}" is missing`);
			continue;
		}
		if (other.text !== item.text) {
			failures.push(`${label}: the project "${item.id}" reads differently`);
		}
	}
}

/**
 * Judge every observation against the section's contract (pure).
 *
 * `observations` is keyed by condition id. A missing observation is a
 * failure: a capture that silently skipped a condition would otherwise pass
 * on the strength of the ones it did take.
 */
export function evaluateObservation({ observations }) {
	const failures = [];
	const required = [...CAPTURES, ...MARKER_CAPTURES];
	for (const condition of required) {
		if (!observations[condition.id]) failures.push(`no observation for "${condition.id}"`);
	}
	if (failures.length > 0) return { ok: false, failures };

	for (const id of ['desktop', 'mobile']) {
		assertSameInformation(
			failures,
			observations[`${id}-light`],
			observations[`${id}-dark`],
			`${id}: light vs dark`,
		);
	}
	for (const scheme of ['light', 'dark']) {
		assertSameInformation(
			failures,
			observations[`desktop-${scheme}`],
			observations[`mobile-${scheme}`],
			`desktop vs mobile (${scheme})`,
		);
	}
	assertSameInformation(
		failures,
		observations['desktop-light'],
		observations['reduced-motion'],
		'reduced motion',
	);
	assertSameInformation(
		failures,
		observations['desktop-light'],
		observations['change-marker'],
		'change marker',
	);

	// The appearance really switched — otherwise the two artefacts above are
	// the same picture twice.
	for (const [id, expected] of [
		['desktop-light', 'light'],
		['desktop-dark', 'dark'],
		['mobile-light', 'light'],
		['mobile-dark', 'dark'],
	]) {
		if (!String(observations[id].colorScheme).includes(expected)) {
			failures.push(
				`${id}: the browser did not apply the ${expected} colour scheme (${observations[id].colorScheme})`,
			);
		}
	}

	// A first visit knows nothing to compare against: no marker, no motion.
	for (const condition of CAPTURES) {
		const observation = observations[condition.id];
		if (observation.markers !== 0) {
			failures.push(
				`${condition.id}: ${observation.markers} marker(s) on a first visit; nothing had changed`,
			);
		}
		if (observation.animated !== 0) {
			failures.push(
				`${condition.id}: ${observation.animated} animated element(s) on a first visit (${observation.animationNames.join(', ')})`,
			);
		}
	}

	// A changed fact marks exactly one row, and only that row moves.
	const marker = observations['change-marker'];
	if (marker.markers !== 1) {
		failures.push(`change-marker: ${marker.markers} marker(s) after one changed fact, expected 1`);
	}
	if (marker.animated !== 1) {
		failures.push(
			`change-marker: ${marker.animated} animated element(s), expected exactly the marker (${marker.animationNames.join(', ') || 'none'})`,
		);
	}
	if (!marker.animationNames.includes('currentLocationChange')) {
		failures.push('change-marker: the marker did not report the currentLocationChange animation');
	}

	// Under the reduce preference the marker is still information, and only
	// the animation is gone.
	const reducedMarker = observations['change-marker-reduced'];
	if (reducedMarker.markers !== 1) {
		failures.push(
			`change-marker-reduced: ${reducedMarker.markers} marker(s); the marker is information and must stay`,
		);
	}
	if (reducedMarker.animated !== 0) {
		failures.push(
			`change-marker-reduced: ${reducedMarker.animated} animated element(s) under the reduce preference`,
		);
	}

	return { ok: failures.length === 0, failures };
}

async function captureCondition(browser, baseUrl, condition, pngPath) {
	const context = await browser.newContext({
		viewport: { width: condition.width, height: condition.height },
		deviceScaleFactor: 1,
		colorScheme: condition.colorScheme,
		reducedMotion: condition.reducedMotion,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
		await page.waitForSelector(`[data-testid="${SECTION_TEST_ID}"]`, { timeout: 30_000 });
		const observation = await page.evaluate(READ_SECTION, { testId: SECTION_TEST_ID });
		const png = await page.screenshot({ fullPage: true, type: 'png' });
		writeFileSync(pngPath, png);
		return {
			...observation,
			condition: condition.id,
			colorSchemePreference: condition.colorScheme,
			reducedMotion: condition.reducedMotion,
		};
	} finally {
		await context.close();
	}
}

/**
 * Capture a changed fact the way a visitor produces one.
 *
 * Visit 1 stores the current signatures. The script then rewrites ONE stored
 * signature to a previous value, reloads, and the section marks exactly that
 * project. No DOM is edited and no motion is forced — the marker is produced
 * by the shipped comparison.
 */
async function captureChangeMarker(browser, baseUrl, condition, pngPath) {
	const context = await browser.newContext({
		viewport: { width: condition.width, height: condition.height },
		deviceScaleFactor: 1,
		colorScheme: condition.colorScheme,
		reducedMotion: condition.reducedMotion,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
		await page.waitForSelector(`[data-testid="${SECTION_TEST_ID}"]`, { timeout: 30_000 });
		await page.waitForFunction(
			(key) => {
				try {
					return window.localStorage.getItem(key) !== null;
				} catch {
					return false;
				}
			},
			STORAGE_KEY,
			{ timeout: 30_000 },
		);
		const seededId = await page.evaluate((key) => {
			const raw = window.localStorage.getItem(key);
			const parsed = raw ? JSON.parse(raw) : {};
			const ids = Object.keys(parsed);
			if (ids.length === 0) throw new Error('the section stored no signature');
			// One recorded fact changed since the last visit.
			parsed[ids[0]] = 'previous-visit';
			window.localStorage.setItem(key, JSON.stringify(parsed));
			return ids[0];
		}, STORAGE_KEY);
		await page.reload({ waitUntil: 'networkidle' });
		await page.waitForSelector('[data-testid="home-current-project-changed"]', {
			timeout: 30_000,
		});
		// Let the 200ms fade settle so the artefact shows the marker at rest.
		await page.waitForTimeout(400);
		const observation = await page.evaluate(READ_SECTION, { testId: SECTION_TEST_ID });
		const png = await page.screenshot({ fullPage: true, type: 'png' });
		writeFileSync(pngPath, png);
		return {
			...observation,
			condition: condition.id,
			colorSchemePreference: condition.colorScheme,
			reducedMotion: condition.reducedMotion,
			seededId,
		};
	} finally {
		await context.close();
	}
}

async function writeArtefact({ sharp, pngPath, outPath, condition }) {
	ensureParent(outPath);
	await sharp(pngPath)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(resolve(REPO_ROOT, outPath));
	// The intermediate PNG never reaches the repository.
	rmSync(pngPath, { force: true });
	const budget = screenshotBudgetVerdict(statSync(resolve(REPO_ROOT, outPath)).size);
	if (!budget.withinBudget) {
		throw new Error(
			`capture ${condition.id} is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
		);
	}
	process.stdout.write(`[capture] wrote ${outPath} (${budget.kb} kB)\n`);
	return { artefact: outPath, ...budget };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const conditions = [...CAPTURES, ...MARKER_CAPTURES];
	const outputFor = (condition) => artefactPath(options.outDir, condition.id);
	if (options.capture) {
		for (const condition of conditions) assertWebpOutputPath(outputFor(condition));
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
				for (const condition of conditions) {
					const pngPath = join(pngDir, `${condition.id}.png`);
					const markerCapture = MARKER_CAPTURES.includes(condition);
					const observation = markerCapture
						? await captureChangeMarker(browser, server.baseUrl, condition, pngPath)
						: await captureCondition(browser, server.baseUrl, condition, pngPath);
					observations[condition.id] = observation;
					const written = await writeArtefact({
						sharp,
						pngPath,
						outPath: outputFor(condition),
						condition,
					});
					captures[condition.id] = {
						...written,
						viewport: { width: condition.width, height: condition.height },
						colorScheme: condition.colorScheme,
						reducedMotion: condition.reducedMotion,
						markers: observation.markers,
						animated: observation.animated,
					};
				}
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation({ observations });
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the captures contradict the section contract (${verdict.failures.length} failure(s))`,
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
