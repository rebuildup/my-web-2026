#!/usr/bin/env node
/**
 * Render the Issue #486 evidence PNG.
 *
 *     pnpm run build && node scripts/image-cls-report.mjs
 *
 * Produces `docs/verification/perf/images-cls-fixture.png` — the
 * screenshot the Issue requires — plus a machine-readable
 * `.tmp/image-cls-report.json` carrying the same numbers.
 *
 * What it measures, and why it is not the E2E spec
 * -----------------------------------------------
 * `e2e/image-cls.spec.ts` is the gate: it fails the build. This
 * script is the record: it prints the conditions, the before/after
 * numbers and the pass criteria into one image a reviewer can read
 * without checking out a branch.
 *
 * Both drive the SAME conditions, imported from
 * `scripts/_image-cls.mjs` — route, response delay, CPU throttle,
 * budget, scope. If the two ever measured under different conditions
 * the PNG would be evidence for a number the gate never asserted,
 * which is worse than no evidence at all.
 *
 * "Before" means the pre-#486 rendering
 * -------------------------------------
 * Not a checkout of the old revision: `stripImageReservation` removes
 * the `width` / `height` attributes and the inline `aspect-ratio`
 * from the lazy `<img>`, which reproduces exactly what the component
 * emitted before this ticket (no reservation, no ratio, and a class
 * carrying only `width: 100%` + `height: auto`). Both states are
 * then measured in the same browser at the same viewport with the
 * same network and CPU conditions — the only way a before/after
 * comparison means anything.
 *
 * Each pass gets a FRESH page. `page.addInitScript` accumulates, so
 * running both passes on one page would install the layout-shift
 * observer twice and double-count every entry.
 *
 * Server
 * ------
 * The script boots its own preview through
 * `scripts/e2e-local-bootstrap.mjs` (the same migrate + seed path
 * Playwright's `webServer` uses) on a dedicated port, and tears it
 * down at the end. `--base-url=<url>` points it at an already-running
 * server instead. It never touches the deployed origin.
 *
 * Requires `pnpm run build` first: the preview serves the Build
 * Output, which is where `/fixtures/*.png` ends up.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
	BOX_EPSILON_PX,
	CLS_BUDGET,
	CPU_THROUGHPLE_RATE,
	IMAGE_CLS_ROUTE,
	IMAGE_RESPONSE_DELAY_MS,
	LAYOUT_SHIFT_INIT_SCRIPT,
	LAZY_SCOPE_FIXTURE,
	LAZY_SCOPE_IMAGE,
	LAZY_SCOPE_IMG_SELECTOR,
	LAZY_SCOPE_SENTINEL_SELECTOR,
	LAZY_SCOPE_SIZE,
	readLayoutShift,
	sleep,
	stripImageReservation,
} from './_image-cls.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PNG = join(REPO_ROOT, 'docs', 'verification', 'perf', 'images-cls-fixture.png');
const OUT_JSON = join(REPO_ROOT, '.tmp', 'image-cls-report.json');
const LOCAL_PORT = Number(process.env.IMAGE_CLS_PORT ?? 4310);
const VIEWPORT = { width: 1280, height: 900 };

/** Selector for the box that holds the lazy figure AND the sentinel below it. */
const REGION_SELECTOR = '[data-cls-region="lazy-region"]';

const baseUrlFlag = process.argv.find((arg) => arg.startsWith('--base-url='));
const BASE_URL = baseUrlFlag
	? baseUrlFlag.slice('--base-url='.length)
	: `http://127.0.0.1:${LOCAL_PORT}`;

/**
 * One measured state: reserved (as shipped) or pre-#486 emulated.
 *
 * `stripReservation` is applied after the page has loaded and
 * immediately before the first box read — React re-applies the
 * inline `aspect-ratio` during hydration, and a decoded image
 * carries its own ratio, so the window for a meaningful strip is
 * narrow and the result is verified rather than assumed.
 */
async function measurePass(context, label, { stripReservation }) {
	const page = await context.newPage();
	try {
		await page.addInitScript({ content: LAYOUT_SHIFT_INIT_SCRIPT });
		// Delay only the fixture raster the lazy cell requests; the rest
		// of the page (HTML, CSS, the eager cover) is untouched so the
		// measurement isolates the lazy path.
		await page.route(`**${LAZY_SCOPE_IMAGE}`, async (route) => {
			await sleep(IMAGE_RESPONSE_DELAY_MS);
			await route.continue();
		});
		const client = await page.context().newCDPSession(page);
		await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROUGHPLE_RATE });

		// No fragment: `#design-system-image` would scroll the lazy cell
		// into range during the initial navigation, so the fetch would
		// start before this script controls anything.
		await page.goto(`${BASE_URL}${IMAGE_CLS_ROUTE}`);
		const img = page.locator(LAZY_SCOPE_IMG_SELECTOR);
		await img.waitFor({ state: 'attached' });
		await img.scrollIntoViewIfNeeded();

		let stripped = null;
		if (stripReservation) {
			stripped = await stripImageReservation(page);
		}

		const decodedBefore = await img.evaluate(
			(node) => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0,
		);
		const region = page.locator(REGION_SELECTOR);
		const sentinel = page.locator(LAZY_SCOPE_SENTINEL_SELECTOR);
		const sentinelBefore = await sentinel.boundingBox();
		const boxBefore = await img.boundingBox();
		// In-flight capture: the reserved (or collapsed) box with the
		// bytes still on the wire. This is the image that makes "the
		// placeholder height is already there" reviewable rather than
		// asserted.
		const beforePng = await region.screenshot();

		await page.waitForFunction(
			(selector) => {
				const node = document.querySelector(selector);
				return node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0;
			},
			LAZY_SCOPE_IMG_SELECTOR,
			{ timeout: 20_000 },
		);
		const boxAfter = await img.boundingBox();
		const sentinelAfter = await sentinel.boundingBox();
		// Let the compositor settle so a load-time shift, if any, has
		// been delivered to the observer before it is read.
		await sleep(250);
		const afterPng = await region.screenshot();
		const cls = await readLayoutShift(page);

		// Viewport capture of the surface itself (the first viewport of
		// the fixture section). Taken AFTER the CLS read so scrolling
		// here cannot contaminate the measurement, and only for the
		// as-shipped pass — the emulated state is not a real rendering
		// and must not be shown as one.
		let surfacePng = null;
		if (!stripReservation) {
			await page.locator('[data-cls-fixture="eager-cover"]').scrollIntoViewIfNeeded();
			await sleep(150);
			surfacePng = (await page.screenshot()).toString('base64');
		}

		return {
			label,
			stripReservation,
			stripped,
			decodedBefore,
			boxBefore,
			boxAfter,
			sentinelBefore,
			sentinelAfter,
			cls,
			surfacePng,
			beforePng: beforePng.toString('base64'),
			afterPng: afterPng.toString('base64'),
		};
	} finally {
		await page.close();
	}
}

function gitSha() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
	} catch {
		return 'unknown';
	}
}

function gitDirty() {
	try {
		return (
			execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT }).toString().trim() !== ''
		);
	} catch {
		return null;
	}
}

/** Playwright version range the repo pins, next to the binary that actually ran. */
function playwrightPinned() {
	try {
		const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
		return pkg.devDependencies?.['@playwright/test'] ?? 'unknown';
	} catch {
		return 'unknown';
	}
}

/** Boot the local preview unless the caller pointed us at a running one. */
async function ensureServer() {
	if (baseUrlFlag) {
		await waitForServer(BASE_URL);
		return { stop: async () => {} };
	}
	const child = spawn('node', ['scripts/e2e-local-bootstrap.mjs', `--port=${LOCAL_PORT}`], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
	});
	child.on('error', (error) => {
		process.stderr.write(`[image-cls-report] could not start the preview: ${error.message}\n`);
		process.exit(1);
	});
	await waitForServer(BASE_URL);
	return {
		stop: async () => {
			child.kill('SIGTERM');
			await sleep(500);
			child.kill('SIGKILL');
		},
	};
}

async function waitForServer(url) {
	const deadline = Date.now() + 120_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url + IMAGE_CLS_ROUTE);
			if (res.ok) {
				await res.arrayBuffer();
				return;
			}
		} catch {
			// not up yet
		}
		await sleep(500);
	}
	const buildHint =
		'Run `pnpm run build` first — the preview serves the Build Output, which is\n' +
		'where /fixtures/*.png and the Worker bundle live.\n';
	process.stderr.write(
		`[image-cls-report] ${url}${IMAGE_CLS_ROUTE} never became ready.\n${buildHint}`,
	);
	process.exit(1);
}

const px = (value) => `${Math.round(value * 100) / 100}px`;

/**
 * The measured table.
 *
 * `pass` is evaluated on BOTH states: a row only counts as evidence if
 * the pre-#486 rendering fails the criterion AND the shipped one meets
 * it. A row that passes in both states would be measuring nothing.
 */
const ROWS = [
	{
		name: 'box height read BEFORE decode',
		before: (m) => px(m.boxBefore.height),
		after: (m) => px(m.boxBefore.height),
		criterion: `> ${BOX_EPSILON_PX}px (already reserved)`,
		pass: (b, a) => b.boxBefore.height <= BOX_EPSILON_PX && a.boxBefore.height > BOX_EPSILON_PX,
	},
	{
		name: 'box height Δ across decode',
		before: (m) => px(m.boxAfter.height - m.boxBefore.height),
		after: (m) => px(m.boxAfter.height - m.boxBefore.height),
		criterion: `|Δ| ≤ ${BOX_EPSILON_PX}px`,
		pass: (b, a) =>
			Math.abs(b.boxAfter.height - b.boxBefore.height) > BOX_EPSILON_PX &&
			Math.abs(a.boxAfter.height - a.boxBefore.height) <= BOX_EPSILON_PX,
	},
	{
		name: 'sentinel y Δ across decode',
		before: (m) => px(m.sentinelAfter.y - m.sentinelBefore.y),
		after: (m) => px(m.sentinelAfter.y - m.sentinelBefore.y),
		criterion: `|Δ| ≤ ${BOX_EPSILON_PX}px`,
		pass: (b, a) =>
			Math.abs(b.sentinelAfter.y - b.sentinelBefore.y) > BOX_EPSILON_PX &&
			Math.abs(a.sentinelAfter.y - a.sentinelBefore.y) <= BOX_EPSILON_PX,
	},
	{
		name: 'scoped layout-shift score (CLS)',
		before: (m) => String(m.cls.scoped),
		after: (m) => String(m.cls.scoped),
		criterion: `≤ ${CLS_BUDGET}`,
		pass: (b, a) => b.cls.scoped > CLS_BUDGET && a.cls.scoped <= CLS_BUDGET,
	},
];

function renderReport({ after, before, browser, playwright, sha, dirty, generatedAt }) {
	const tableRows = ROWS.map((row) => {
		const pass = row.pass(before, after);
		return `<tr>
			<td>${row.name}</td>
			<td class="num">${row.before(before)}</td>
			<td class="num strong">${row.after(after)}</td>
			<td>${row.criterion}</td>
			<td class="${pass ? 'pass' : 'fail'}">${pass ? 'PASS' : 'FAIL'}</td>
		</tr>`;
	}).join('');

	const shot = (pass, title, caption) => `
		<figure class="shot">
			<figcaption>${title}<br /><span>${caption}</span></figcaption>
			<div class="pair">
				<div><img src="data:image/png;base64,${pass.beforePng}" alt="" /><span class="tag">in flight (bytes on the wire)</span></div>
				<div><img src="data:image/png;base64,${pass.afterPng}" alt="" /><span class="tag">decoded</span></div>
			</div>
		</figure>`;

	const verdict = ROWS.every((row) => row.pass(before, after)) ? 'PASS' : 'FAIL';

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 28px 32px;
		background: #f7f8fa; color: #101b26;
		font: 14px/1.55 -apple-system, "Noto Sans JP", system-ui, sans-serif;
	}
	h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
	h2 { margin: 28px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: #5c6b7a; }
	.sub { margin: 0 0 18px; color: #5c6b7a; font-size: 13px; }
	.verdict { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 4px; font-weight: 700; font-size: 12px; letter-spacing: 0.08em; }
	.verdict.pass { background: #e2f4ea; color: #0f7a4d; }
	.verdict.fail { background: #fbe6e5; color: #b3261e; }
	table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dde3e9; }
	th, td { border-bottom: 1px solid #e7ecf1; padding: 7px 10px; text-align: left; vertical-align: top; }
	th { background: #eef2f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #5c6b7a; }
	td.num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	td.strong { font-weight: 700; }
	.pass { color: #0f7a4d; font-weight: 700; }
	.fail { color: #b3261e; font-weight: 700; }
	.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
	dl.conditions { display: grid; grid-template-columns: 230px 1fr; margin: 0; background: #fff; border: 1px solid #dde3e9; }
	dl.conditions dt { padding: 7px 10px; border-bottom: 1px solid #e7ecf1; background: #eef2f6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #5c6b7a; }
	dl.conditions dd { margin: 0; padding: 7px 10px; border-bottom: 1px solid #e7ecf1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
	.shot { margin: 0; background: #fff; border: 1px solid #dde3e9; padding: 12px; }
	.shot.wide { margin-bottom: 4px; }
	.shot img.full { width: 100%; border: 1px solid #dde3e9; display: block; }
	.shot figcaption { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
	.shot figcaption span { font-weight: 400; color: #5c6b7a; font-size: 12px; }
	.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
	.pair img { width: 100%; border: 1px solid #dde3e9; display: block; }
	.tag { display: block; margin-top: 4px; font-size: 11px; color: #5c6b7a; letter-spacing: 0.06em; text-transform: uppercase; }
	.note { margin: 10px 0 0; color: #5c6b7a; font-size: 12px; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #eef2f6; padding: 1px 4px; }
</style></head>
<body>
	<h1>Image CLS regression — Issue #486<span class="verdict ${verdict === 'PASS' ? 'pass' : 'fail'}">${verdict}</span></h1>
	<p class="sub">
		<code>${BASE_URL}${IMAGE_CLS_ROUTE}</code> → section <code>07 — Image</code>, cell
		<code>${LAZY_SCOPE_FIXTURE}</code> · measured ${generatedAt} ·
		source <code>${sha}</code>${dirty ? ' (worktree DIRTY — not the committed state)' : ''}
	</p>

	<h2>Reproduction conditions</h2>
	<dl class="conditions">
		<dt>browser</dt><dd>Chromium ${browser} · Playwright ${playwright} (pinned range)</dd>
		<dt>viewport</dt><dd>${VIEWPORT.width}×${VIEWPORT.height} · deviceScaleFactor 1 · colorScheme light</dd>
		<dt>network</dt><dd>local preview · <code>${LAZY_SCOPE_IMAGE}</code> response held ${IMAGE_RESPONSE_DELAY_MS}ms · everything else unthrottled</dd>
		<dt>cpu</dt><dd>CDP <code>Emulation.setCPUThrottlingRate</code> = ${CPU_THROUGHPLE_RATE}×</dd>
		<dt>source sha</dt><dd>${sha}</dd>
		<dt>gate</dt><dd><code>pnpm exec playwright test e2e/image-cls.spec.ts</code> — same constants, imported from <code>scripts/_image-cls.mjs</code></dd>
	</dl>

	<h2>The surface under test</h2>
	<figure class="shot wide">
		<figcaption>${BASE_URL}${IMAGE_CLS_ROUTE} → <code>07 — Image</code>, first viewport
			<br /><span>eager cover (16:9 reserved), placeholder frame (16:9 reserved), lazy cover 220vh below</span></figcaption>
		<img class="full" src="data:image/png;base64,${after.surfacePng}" alt="" />
	</figure>

	<h2>Before / after</h2>
	<table>
		<thead><tr>
			<th>measurement</th><th>before — pre-#486 rendering</th><th>after — as shipped</th>
			<th>pass criterion</th><th>verdict</th>
		</tr></thead>
		<tbody>${tableRows}</tbody>
	</table>
	<p class="note">
		"before" is the same page, same browser, same conditions, with <code>width</code> /
		<code>height</code> / inline <code>aspect-ratio</code> removed from the lazy
		<code>&lt;img&gt;</code> — byte-for-byte the DOM this component emitted before the ticket.
		Page-level CLS for the run was ${before.cls.total} (before) / ${after.cls.total} (after); the gate
		scores only the <code>${LAZY_SCOPE_FIXTURE}</code> cell, because the <code>unknown-size</code>
		cell has no reservation by design. A row only counts when the pre-#486 rendering FAILS it
		and the shipped rendering passes it — otherwise the row measures nothing.
	</p>

	<h2>Rendered evidence — the lazy figure and the sentinel it would push</h2>
	<div class="grid2">
		${shot(before, 'Before — reservation removed', 'the in-flight box has collapsed to 0px, so the sentinel sits higher; when the bytes land it is pushed down')}
		${shot(after, 'After — as shipped', 'the in-flight box already has its final height, and the sentinel is in the same place before and after the decode')}
	</div>
	<p class="note">
		Fixture raster: <code>${LAZY_SCOPE_IMAGE}</code> (${LAZY_SCOPE_SIZE.width}×${LAZY_SCOPE_SIZE.height},
		byte-reproducible via <code>node scripts/generate-image-fixtures.mjs</code>).
		Regenerating this image is expected to change it — the timestamp and the commit SHA are part of the
		evidence. Read <code>docs/verification/perf/README.md</code> for what this measurement does and does not cover.
	</p>
</body></html>`;
}

/** Strip the base64 payloads before writing the JSON sidecar. */
function toJson(pass) {
	return {
		label: pass.label,
		stripReservation: pass.stripReservation,
		stripped: pass.stripped,
		decodedBefore: pass.decodedBefore,
		boxBefore: pass.boxBefore,
		boxAfter: pass.boxAfter,
		sentinelBefore: pass.sentinelBefore,
		sentinelAfter: pass.sentinelAfter,
		cls: pass.cls,
	};
}

async function main() {
	const server = await ensureServer();
	const browser = await chromium.launch();
	try {
		const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });

		const after = await measurePass(context, 'as shipped (Issue #486)', {
			stripReservation: false,
		});
		const before = await measurePass(context, 'pre-#486 rendering (emulated)', {
			stripReservation: true,
		});

		const sha = gitSha();
		const reportPage = await context.newPage();
		await reportPage.setContent(
			renderReport({
				after,
				before,
				browser: browser.version(),
				playwright: playwrightPinned(),
				sha,
				dirty: gitDirty(),
				generatedAt: `${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`,
			}),
			{ waitUntil: 'load' },
		);

		mkdirSync(dirname(OUT_PNG), { recursive: true });
		await reportPage.screenshot({ path: OUT_PNG, fullPage: true });

		mkdirSync(dirname(OUT_JSON), { recursive: true });
		writeFileSync(
			OUT_JSON,
			`${JSON.stringify(
				{
					conditions: {
						browser: `Chromium ${browser.version()}`,
						playwright: playwrightPinned(),
						viewport: VIEWPORT,
						baseUrl: BASE_URL,
						route: IMAGE_CLS_ROUTE,
						imageResponseDelayMs: IMAGE_RESPONSE_DELAY_MS,
						cpuThrottlingRate: CPU_THROUGHPLE_RATE,
						sourceSha: sha,
					},
					budget: { cls: CLS_BUDGET, boxEpsilonPx: BOX_EPSILON_PX },
					before: toJson(before),
					after: toJson(after),
				},
				null,
				2,
			)}\n`,
		);

		const verdict = ROWS.every((row) => row.pass(before, after)) ? 'PASS' : 'FAIL';
		process.stdout.write(
			`[image-cls-report] ${verdict} — wrote ${OUT_PNG}\n` +
				`[image-cls-report] after : box ${px(after.boxBefore.height)} in flight, Δ ${px(after.boxAfter.height - after.boxBefore.height)}, scoped CLS ${after.cls.scoped}, page CLS ${after.cls.total}\n` +
				`[image-cls-report] before: box ${px(before.boxBefore.height)} in flight, Δ ${px(before.boxAfter.height - before.boxBefore.height)}, scoped CLS ${before.cls.scoped}, page CLS ${before.cls.total}\n`,
		);
		if (verdict !== 'PASS') process.exitCode = 1;
	} finally {
		await browser.close();
		await server.stop();
	}
}

await main();
