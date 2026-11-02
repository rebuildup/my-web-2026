#!/usr/bin/env node

/**
 * capture-project-card-category-bar — capture and measure the Issue #794
 * change to `ProjectCard` in `docs/verification/portfolio/`.
 *
 * What this captures
 * ------------------
 * The shipped story (`src/portfolio/components/ProjectCard.stories.tsx`,
 * `AllCategories` and `Monochrome`) in a Chromium at six conditions:
 *
 *   - desktop 1440 × light / dark — the two-column card;
 *   - mobile 390 × light / dark — the single-column card;
 *   - monochrome proof (desktop) × light / dark — the same four cards
 *     inside `MonochromeProof`, where the only surviving cue may be a
 *     luminance step, a shape and a word.
 *
 * It is an ASSERTION, not only a screenshot
 * -----------------------------------------
 * After each capture the script reads the rendered cards back out of the
 * browser and checks the owner's decision (2026-11-01) structurally:
 *
 *   `--label=after`  every card has NO absolutely positioned decoration
 *                    (which covers the mobile `width: 0` state a
 *                    width-based check would miss), no inline-start
 *                    border, no `accent.category.*` class, and a fill that
 *                    differs from the page canvas;
 *   `--label=before` every card HAS exactly the decorative absolute node
 *                    and the `accent.category.*` class — i.e. the run is
 *                    really the pre-change baseline, not a mislabelled
 *                    copy of the after state.
 *
 * Both labels additionally require the four categories to keep four
 * distinct `StateMark` silhouettes and their upper-case word: the
 * non-colour channel is the property that must survive the removal.
 *
 * Why a generated harness instead of the Storybook gallery
 * --------------------------------------------------------
 * `pnpm run build-storybook` in this repository emits a MANAGER-ONLY
 * static build (no `iframe.html`) — see `scripts/capture-error-state-
 * gallery.mjs`. The harness imports the SHIPPED story module and renders
 * the story's own `render()` output, so the capture and the gallery cannot
 * drift.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no binding is touched, no secret is read or
 *     printed. The fixtures are the story's synthetic placeholders.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`, which is
 *     the only reason an origin exists.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG. The capture goes into `.tmp/`, is encoded with
 * `sharp` at width <= 1600 / quality 80, and the committed file is the
 * `.webp` sibling. The script REFUSES any non-`.webp` output path and
 * deletes the intermediate PNGs.
 *
 * Reproducing the baseline
 * ------------------------
 * `--label=before` is only meaningful on a tree that still has the bar:
 *
 *   git stash push -- src/portfolio/components/ProjectCard.tsx \
 *                      src/portfolio/components/ProjectCard.stories.tsx
 *   node scripts/capture-project-card-category-bar.mjs --label=before
 *   git stash pop
 *   node scripts/capture-project-card-category-bar.mjs --label=after
 *
 * Usage:
 *   node scripts/capture-project-card-category-bar.mjs [options]
 *
 *   --label=before|after  which state the tree is expected to be in
 *                         (default after)
 *   --out-dir=<path>      directory for the committed artefacts
 *                         (default docs/verification/portfolio)
 *   --png-dir=<path>      temporary PNG directory
 *                         (default .tmp/project-card-category/png)
 *   --json-out=<path>     report destination
 *                         (default .tmp/project-card-category/report.json)
 *   --no-build            reuse an existing harness build in .tmp
 *   --no-capture          build and assert nothing browser-side
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
export const STORY_MODULE = 'src/portfolio/components/ProjectCard.stories.tsx';
export const STORY_EXPORT = 'AllCategories';
export const MONOCHROME_EXPORT = 'Monochrome';

/** Readiness markers the capture waits for. */
export const CUES_TEST_ID = 'project-card-cues';
export const MONOCHROME_TEST_ID = 'project-card-monochrome';

export const HARNESS_DIR = '.tmp/project-card-category/harness';
export const HARNESS_DIST = '.tmp/project-card-category/harness-dist';

/** The category word each facet must still print beside its mark. */
export const CATEGORY_WORD = Object.freeze({
	design: 'Design',
	code: 'Develop',
	tool: 'Video',
	writing: 'Other',
});

/** Captured states. Four cue frames + two greyscale proofs. */
export const CAPTURES = [
	{ id: 'desktop-light', kind: 'cues', width: 1440, height: 900, colorScheme: 'light' },
	{ id: 'desktop-dark', kind: 'cues', width: 1440, height: 900, colorScheme: 'dark' },
	{ id: 'mobile-light', kind: 'cues', width: 390, height: 900, colorScheme: 'light' },
	{ id: 'mobile-dark', kind: 'cues', width: 390, height: 900, colorScheme: 'dark' },
	{ id: 'monochrome-light', kind: 'monochrome', width: 1440, height: 900, colorScheme: 'light' },
	{ id: 'monochrome-dark', kind: 'monochrome', width: 1440, height: 900, colorScheme: 'dark' },
];

/** The committed artefact path for one label/condition pair. */
export function artefactPath(outDir, label, conditionId) {
	return `${outDir}/project-card-category-${label}-${conditionId}.webp`;
}

/** `rgb()` / `rgba()` → channel object. Pure, so the tests can use it. */
export function parseRgb(value) {
	const match = String(value).match(/rgba?\(([^)]+)\)/);
	if (!match) return null;
	const parts = match[1]
		.split(/[\s,/]+/)
		.filter(Boolean)
		.map(Number);
	if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
	return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
}

/** WCAG relative luminance of one sRGB channel triple. */
export function relativeLuminance({ r, g, b }) {
	const channel = (value) => {
		const v = value / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two opaque colours. Returns `null` when
 * either colour is not opaque: a transparent card has no plane to
 * compare, and silently treating it as white would manufacture a number.
 */
export function contrastRatio(a, b) {
	const left = parseRgb(a);
	const right = parseRgb(b);
	if (!left || !right) return null;
	if (left.a < 1 || right.a < 1) return null;
	const la = relativeLuminance(left);
	const lb = relativeLuminance(right);
	const [hi, lo] = la > lb ? [la, lb] : [lb, la];
	return Number(((hi + 0.05) / (lo + 0.05)).toFixed(3));
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

/** The generated harness page. */
export function harnessIndexHtml() {
	return `<!doctype html>
<html lang="ja">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>portfolio ProjectCard category cue (#794)</title>
	</head>
	<body style="margin:0">
		<div id="root"></div>
		<script type="module" src="./main.tsx"></script>
	</body>
</html>
`;
}

/** The generated harness entry point. Renders the shipped stories. */
export function harnessMainTsx(harnessDir = HARNESS_DIR) {
	const depth = harnessDir.split('/').length;
	const up = '../'.repeat(depth);
	return `import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import { ${STORY_EXPORT}, ${MONOCHROME_EXPORT} } from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

createRoot(container).render(
	<>
		<section data-testid="${CUES_TEST_ID}">{${STORY_EXPORT}.render?.()}</section>
		<section data-testid="${MONOCHROME_TEST_ID}">{${MONOCHROME_EXPORT}.render?.()}</section>
	</>,
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
 * Read the rendered cards back out of the browser (pure, so it runs
 * inside the page).
 *
 * `absoluteDecorations` counts ABSOLUTELY POSITIONED descendants, not
 * "4px-wide" ones: the shipped baseline collapses the bar to `width: 0`
 * below the `md` breakpoint, so a width-based probe would report mobile
 * as clean while the node is still there.
 */
export const READ_CARDS = ({ testId }) => {
	const root = document.querySelector(`[data-testid="${testId}"]`);
	if (!root) return null;
	const canvasSheet = getComputedStyle(document.body);
	const cards = [...root.querySelectorAll('article')].map((article) => {
		const style = getComputedStyle(article);
		const decorations = [...article.querySelectorAll('*')]
			.filter((element) => getComputedStyle(element).position === 'absolute')
			.map((element) => {
				const box = element.getBoundingClientRect();
				return {
					width: Number(box.width.toFixed(2)),
					height: Number(box.height.toFixed(2)),
					className: element.getAttribute('class') ?? '',
					background: getComputedStyle(element).backgroundColor,
				};
			});
		return {
			category: article.getAttribute('data-category'),
			className: article.getAttribute('class') ?? '',
			background: style.backgroundColor,
			borderInlineStartWidth: style.borderInlineStartWidth,
			absoluteDecorations: decorations,
			marks: [...article.querySelectorAll('[data-state-mark]')].map((mark) =>
				mark.getAttribute('data-state-mark'),
			),
			text: (article.textContent ?? '').replace(/\s+/g, ' ').trim(),
		};
	});
	return {
		canvas: canvasSheet.backgroundColor,
		colorScheme: getComputedStyle(document.documentElement).colorScheme,
		cards,
	};
};

/**
 * Evaluate one run against the label's contract.
 *
 * `before` and `after` assert OPPOSITE things about the removed cue on
 * purpose: a capture that is labelled `before` but was taken from the
 * changed tree (or the other way round) must fail instead of silently
 * producing two identical artefacts.
 */
export function evaluateObservation({ label, observations }) {
	if (label !== 'before' && label !== 'after') {
		throw new Error(`unknown label: ${label}`);
	}
	const failures = [];
	const summary = [];
	const seen = new Set();

	for (const [id, observation] of Object.entries(observations)) {
		if (!observation) {
			failures.push(`${id}: nothing rendered`);
			continue;
		}
		if (observation.cards.length !== 4) {
			failures.push(`${id}: ${observation.cards.length} card(s), expected 4`);
			continue;
		}
		const categories = observation.cards.map((card) => card.category);
		if (new Set(categories).size !== 4) {
			failures.push(`${id}: categories are not distinct (${categories.join(', ')})`);
		}
		for (const card of observation.cards) {
			const where = `${id}/${card.category}`;
			if (seen.has(`${id}:${card.category}`)) failures.push(`${where}: duplicate card`);
			seen.add(`${id}:${card.category}`);

			if (label === 'after') {
				if (card.absoluteDecorations.length !== 0) {
					failures.push(
						`${where}: ${card.absoluteDecorations.length} absolutely positioned decoration(s) remain (${JSON.stringify(card.absoluteDecorations)})`,
					);
				}
				if (card.className.includes('accent.category')) {
					failures.push(`${where}: still paints accent.category.* on the card itself`);
				}
				if (Number.parseFloat(card.borderInlineStartWidth) !== 0) {
					failures.push(`${where}: border-inline-start is ${card.borderInlineStartWidth}`);
				}
				const ratio = contrastRatio(card.background, observation.canvas);
				if (ratio === null) {
					failures.push(
						`${where}: no opaque fill of its own (background ${card.background} on canvas ${observation.canvas})`,
					);
				} else if (ratio <= 1) {
					failures.push(`${where}: fill is the canvas colour (${card.background})`);
				} else {
					summary.push(
						`${where}: plane ${card.background} vs canvas ${observation.canvas} = ${ratio}:1`,
					);
				}
			} else if (card.absoluteDecorations.length !== 1) {
				failures.push(
					`${where}: ${card.absoluteDecorations.length} absolutely positioned decoration(s), expected the 1 baseline bar`,
				);
			} else if (!card.absoluteDecorations[0].className.includes('accent.category')) {
				// The baseline bar is the one ABSOLUTE element, and its hue is
				// what the owner's decision removes. A `before` capture without
				// it is not the baseline, however it is labelled.
				failures.push(`${where}: baseline bar does not paint accent.category.*`);
			} else {
				// Recorded, not asserted: the baseline puts the hue class on the
				// bar, and whether that class actually resolves to a painted
				// colour is a fact about the token layer, not about this label.
				const bar = card.absoluteDecorations[0];
				summary.push(
					`${where}: baseline bar class=${bar.className} width=${bar.width}px background=${bar.background}`,
				);
			}

			// The non-colour channel has to be intact in BOTH states: the
			// removal is a removal of the cue, not of the information.
			if (card.marks.length !== 1) {
				failures.push(`${where}: ${card.marks.length} state mark(s), expected 1`);
			}
			const word = CATEGORY_WORD[card.category];
			if (!word) {
				failures.push(`${where}: unknown category`);
			} else if (!card.text.includes(word)) {
				failures.push(`${where}: the category word "${word}" is missing`);
			}
		}
		const marks = observation.cards.flatMap((card) => card.marks);
		if (new Set(marks).size !== 4) {
			failures.push(
				`${id}: the four cards do not resolve to four distinct marks (${marks.join(', ')})`,
			);
		}
	}

	return { ok: failures.length === 0, failures, summary };
}

function parseArgs(argv) {
	const options = {
		label: 'after',
		outDir: 'docs/verification/portfolio',
		pngDir: '.tmp/project-card-category/png',
		// Derived from the label below, so a `before` run never overwrites
		// the `after` report (both are evidence for one change).
		jsonOut: null,
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
			case 'label':
				options.label = value;
				break;
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
	if (options.label !== 'before' && options.label !== 'after') {
		throw new Error(`--label must be before or after, got ${options.label}`);
	}
	options.jsonOut ??= `.tmp/project-card-category/report-${options.label}.json`;
	return options;
}

function ensureParent(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

async function captureCondition(browser, baseUrl, condition, pngPath) {
	const context = await browser.newContext({
		viewport: { width: condition.width, height: condition.height },
		deviceScaleFactor: 1,
		colorScheme: condition.colorScheme,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle' });
		const testId = condition.kind === 'cues' ? CUES_TEST_ID : MONOCHROME_TEST_ID;
		await page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 30_000 });
		const observation = await page.evaluate(READ_CARDS, { testId });
		const target = page.locator(`[data-testid="${testId}"]`);
		const png = await target.screenshot({ type: 'png' });
		writeFileSync(pngPath, png);
		return observation;
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
	for (const condition of CAPTURES) {
		assertWebpOutputPath(artefactPath(options.outDir, options.label, condition.id));
	}

	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the project-card harness…\n');
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
					const pngPath = join(pngDir, `${options.label}-${condition.id}.png`);
					const observation = await captureCondition(browser, server.baseUrl, condition, pngPath);
					if (observation) observations[condition.id] = observation;
					captures[condition.id] = {
						...(await writeArtefact({
							sharp,
							pngPath,
							outPath: artefactPath(options.outDir, options.label, condition.id),
							condition,
						})),
						viewport: { width: condition.width, height: condition.height },
						colorScheme: condition.colorScheme,
					};
				}
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation({ label: options.label, observations });
			for (const line of verdict.summary) process.stdout.write(`[capture] ${line}\n`);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the captures contradict the label "${options.label}" (${verdict.failures.length} failure(s))`,
				);
			}
		}
	} finally {
		await server.close();
	}

	const report = {
		issue: '#794',
		generatedBy: 'scripts/capture-project-card-category-bar.mjs',
		label: options.label,
		story: {
			module: STORY_MODULE,
			exports: [STORY_EXPORT, MONOCHROME_EXPORT],
			testIds: [CUES_TEST_ID, MONOCHROME_TEST_ID],
		},
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
