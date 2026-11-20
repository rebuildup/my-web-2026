#!/usr/bin/env node
/**
 * capture-activity-334 — browser capture of the Home GitHub activity
 * card (Issue #334 residual) into
 * `docs/verification/activity/github-{prs,empty}.png`.
 *
 * What this captures
 * ------------------
 *   - `github-prs.png`  — the card populated from the COMMITTED
 *     `src/home/activity/github-activity.json` snapshot, projected
 *     through the same fail-closed reader (`readGitHubActivitySnapshot`)
 *     and public projection (`publicGitHubActivity`) the Home route
 *     uses. The feed carries `IssuesEvent` / `PullRequestEvent` rows,
 *     so the artefact shows the real Issue/PR classification labels,
 *     dates and repository source links — no fabricated event data.
 *   - `github-empty.png` — the same card with the snapshot's `repos`
 *     and `feed` emptied BEFORE the reader runs: the snapshot's honest
 *     "nothing observed" shape. The card keeps its header and prints
 *     「直近の公開イベントはありません。」 — the component's real
 *     empty rendering, not a mock.
 *
 * Why a generated harness instead of `pnpm run dev`
 * -------------------------------------------------
 * `scripts/capture-github-activity.mjs` (Issue #319) already photographs
 * the served card for `docs/verification/home/`; the empty state is NOT
 * reachable through the running app because the route always reads the
 * committed snapshot, which is populated. The convention for a
 * component-level verification capture is the Vite harness this script
 * generates into `.tmp/` (see `scripts/capture-home-current-projects.mjs`,
 * Issue #316): it imports the SHIPPED story module
 * (`src/home/activity/GitHubActivityCard.stories.tsx`) and renders the
 * story's own `render()` output, so the capture and the Storybook
 * surface cannot drift. `pnpm run build-storybook` emits a
 * manager-only static build (no `iframe.html`) — see
 * `scripts/capture-error-state-gallery.mjs` (Issue #501).
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The only data is the committed snapshot JSON.
 *   - The harness is served over a loopback-only HTTP server on an
 *     ephemeral port; Chromium refuses ES modules from `file://`, which
 *     is the only reason an origin exists.
 *
 * Usage:
 *   node scripts/capture-activity-334.mjs [options]
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
export const STORY_MODULE = 'src/home/activity/GitHubActivityCard.stories.tsx';

/** Readiness marker: the card's own testid, present in every state. */
export const CARD_TEST_ID = 'github-activity-card';

/** Honest-state wordings the capture must never photograph as "data". */
const UNAVAILABLE_TEXT = '読み込めませんでした';
const EMPTY_TEXT = '直近の公開イベントはありません。';

const HARNESS_DIR = '.tmp/activity-334/harness';
const HARNESS_DIST = '.tmp/activity-334/harness-dist';

/** The two artefacts: story export → committed file name. */
export const CAPTURES = [
	{ story: 'Populated', file: 'github-prs.png', expect: ['Issue', 'PR', '観測日'] },
	{ story: 'Empty', file: 'github-empty.png', expect: [EMPTY_TEXT, '観測日'] },
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
		'<!doctype html><html><head><meta charset="utf-8"><title>activity-334</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>\n',
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
// The wrapper replicates the Home status column the card ships in:
// <Container> (maxWidth 1024, paddingInline lg = 32px) → spread grid
// 4fr/8fr with columnGap 10 (40px), so the card measures the same
// ~613px column width as on the served page.
const name = new URLSearchParams(window.location.search).get('story') ?? 'Populated';
const story = stories[name];
if (!story?.render) throw new Error(\`no renderable story named \${name}\`);
// Storybook calls render(args, context); the harness passes the story's
// own args so the capture shows the same tree the gallery renders.
const element = story.render(story.args);
createRoot(container).render(
	<div
		style={{
			maxWidth: '1024px',
			marginInline: 'auto',
			paddingInline: '32px',
			boxSizing: 'border-box',
		}}
	>
		<div
			style={{
				display: 'grid',
				gridTemplateColumns: 'minmax(0, 4fr) minmax(0, 8fr)',
				columnGap: '40px',
			}}
		>
			<div />
			<div>{element}</div>
		</div>
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
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	try {
		const page = await context.newPage();
		await page.goto(`${baseUrl}/?story=${capture.story}`, {
			waitUntil: 'domcontentloaded',
			timeout: 60_000,
		});
		const card = page.locator(`[data-testid="${CARD_TEST_ID}"]`);
		await card.waitFor({ timeout: 60_000 });
		// The selector can appear before the Panda stylesheet and the web
		// fonts finish applying; a capture taken in that window photographs
		// the unstyled flash, not the shipped card.
		await page.evaluate(() => document.fonts.ready);
		await page.waitForTimeout(800);
		const text = await card.innerText();
		if (text.includes(UNAVAILABLE_TEXT)) {
			throw new Error(
				`the ${capture.file} capture would show the unavailable state — the snapshot did not render`,
			);
		}
		for (const expected of capture.expect) {
			if (!text.includes(expected)) {
				throw new Error(
					`the ${capture.file} capture is missing "${expected}" — not the shipped card`,
				);
			}
		}
		mkdirSync(dirname(outPath), { recursive: true });
		await card.screenshot({ path: outPath, type: 'png' });
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
		process.stdout.write('[capture] building the activity-334 harness…\n');
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
