#!/usr/bin/env node
/**
 * capture-activity-timeline — browser capture of the unified activity
 * timeline (Issue #352) into `docs/verification/activity/`.
 *
 * What this captures
 * ------------------
 *   - `timeline-desktop.png` — the `Populated` story of
 *     `src/activity/Timeline.stories.tsx` at a desktop viewport. The
 *     story renders the committed `src/activity/fixtures.ts`, which
 *     exercises every kind (`release` / `article` / `work`), the
 *     authored `dateLabel` path and per-source health — synthetic
 *     review data, never a claim about real publications.
 *   - `timeline-mobile.png` — the same story at a mobile viewport.
 *
 * Why a generated harness instead of `pnpm run dev`
 * -------------------------------------------------
 * The `/activity` route is follow-up integration (Issue #352 ships
 * the obligation standalone per the 2026-10-17 supplement), so there
 * is no served page to photograph. The convention for a
 * component-level verification capture is the Vite harness this
 * script generates into `.tmp/` — the same approach as
 * `scripts/capture-activity-334.mjs` (Issue #334): it imports the
 * SHIPPED story module and renders the story's own `render()` output,
 * so the capture and the Storybook surface cannot drift.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The only data is the committed fixture.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port.
 *
 * Usage:
 *   node scripts/capture-activity-timeline.mjs [options]
 *
 *   --out-dir=<path>   output directory
 *                      (default docs/verification/activity)
 *   --no-build         reuse an existing harness build in .tmp
 *   --no-capture       build only; write no artefact
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveDirectory } from './capture-error-state-gallery.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The shipped story module the harness renders. */
export const STORY_MODULE = 'src/activity/Timeline.stories.tsx';

/** Readiness marker: the timeline's own testid, present in every state. */
export const TIMELINE_TEST_ID = 'activity-timeline';

/** Honest-state wordings the capture must never photograph as "data". */
const UNAVAILABLE_TEXT = '読み込めませんでした';

const HARNESS_DIR = '.tmp/activity-timeline/harness';
const HARNESS_DIST = '.tmp/activity-timeline/harness-dist';

/** The artefacts: viewport → committed file name. */
export const CAPTURES = [
	{
		story: 'Populated',
		file: 'timeline-desktop.png',
		viewport: { width: 1440, height: 900 },
		expect: ['リリース', '記事', '作品', 'GitHub', '観測日'],
	},
	{
		story: 'Populated',
		file: 'timeline-mobile.png',
		viewport: { width: 390, height: 844 },
		expect: ['リリース', '記事', '作品', 'GitHub', '観測日'],
	},
];

function parseArgs(argv) {
	const options = { outDir: 'docs/verification/activity', build: true, capture: true };
	for (const arg of argv) {
		if (arg.startsWith('--out-dir=')) options.outDir = arg.slice('--out-dir='.length);
		else if (arg === '--no-build') options.build = false;
		else if (arg === '--no-capture') options.capture = false;
		else throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

/** Write the generated harness (idempotent, so `--no-build` can reuse it). */
function writeHarness() {
	const dir = resolve(REPO_ROOT, HARNESS_DIR);
	mkdirSync(dir, { recursive: true });
	const depth = HARNESS_DIR.split('/').length;
	const up = '../'.repeat(depth);
	writeFileSync(
		join(dir, 'index.html'),
		'<!doctype html><html><head><meta charset="utf-8"><title>activity-timeline</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>\n',
	);
	writeFileSync(
		join(dir, 'main.tsx'),
		`import { createRoot } from 'react-dom/client';
import '${up}src/styles.css';
import * as stories from '${up}${STORY_MODULE}';

const container = document.getElementById('root');
if (!container) throw new Error('harness root missing');

// The capture picks the story with ?story=<Export>; each story's own
// render() output is the shipped tree the Storybook gallery renders.
// The wrapper is a plain readable column — the timeline is a
// standalone surface until the /activity route lands.
const name = new URLSearchParams(window.location.search).get('story') ?? 'Populated';
const story = stories[name];
if (!story?.render) throw new Error(\`no renderable story named \${name}\`);
const element = story.render(story.args);
createRoot(container).render(
	<div style={{ maxWidth: '720px', marginInline: 'auto', padding: '24px', boxSizing: 'border-box' }}>
		{element}
	</div>,
);
`,
	);
	writeFileSync(
		join(dir, 'vite.config.ts'),
		`import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
	root: '${HARNESS_DIR}',
	base: './',
	plugins: [react()],
	css: {
		// The repository's Panda config: layer order, tokens and recipes come
		// from the repo postcss.config.mjs so the capture shows the shipped
		// editorial CSS rather than a bare browser default.
		postcss: '${join(REPO_ROOT, 'postcss.config.mjs')}',
	},
	build: {
		outDir: '${join(REPO_ROOT, HARNESS_DIST)}',
		emptyOutDir: true,
	},
});
`,
	);
	return dir;
}

async function captureOne(browser, baseUrl, capture, outPath) {
	const context = await browser.newContext({
		viewport: capture.viewport,
		deviceScaleFactor: 1,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/?story=${capture.story}`, {
			waitUntil: 'domcontentloaded',
			timeout: 60_000,
		});
		const timeline = page.locator(`[data-testid="${TIMELINE_TEST_ID}"]`);
		await timeline.waitFor({ timeout: 60_000 });
		// The selector can appear before the Panda stylesheet and the web
		// fonts finish applying; a capture taken in that window photographs
		// the unstyled flash, not the shipped component.
		await page.evaluate(() => document.fonts.ready);
		await page.waitForTimeout(800);
		const text = await timeline.innerText();
		if (text.includes(UNAVAILABLE_TEXT)) {
			throw new Error(
				`the ${capture.file} capture would show the unavailable state — the fixture did not render`,
			);
		}
		for (const expected of capture.expect) {
			if (!text.includes(expected)) {
				throw new Error(
					`the ${capture.file} capture is missing "${expected}" — not the shipped timeline`,
				);
			}
		}
		mkdirSync(dirname(outPath), { recursive: true });
		await timeline.screenshot({ path: outPath, type: 'png' });
		process.stdout.write(`[capture] wrote ${outPath}\n`);
	} finally {
		await context.close();
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	writeHarness();
	const distRoot = resolve(REPO_ROOT, HARNESS_DIST);
	if (options.build || !existsSync(join(distRoot, 'index.html'))) {
		process.stdout.write('[capture] building the activity-timeline harness…\n');
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
	if (!options.capture) {
		process.stdout.write('[capture] --no-capture: harness built, nothing written\n');
		return;
	}
	const server = await serveDirectory(distRoot);
	try {
		const { chromium } = await import('@playwright/test');
		const browser = await chromium.launch();
		try {
			for (const capture of CAPTURES) {
				await captureOne(
					browser,
					server.baseUrl,
					capture,
					resolve(REPO_ROOT, options.outDir, capture.file),
				);
			}
		} finally {
			await browser.close();
		}
	} finally {
		await server.close();
	}
}

await main();
