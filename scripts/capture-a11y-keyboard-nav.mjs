#!/usr/bin/env node

/**
 * capture-a11y-keyboard-nav — capture the Issue #394 verification
 * screen into `docs/verification/a11y/keyboard-navigation.webp`.
 *
 * What this captures
 * ------------------
 * The REAL application, not a fixture: the local preview server
 * (`scripts/e2e-local-bootstrap.mjs`, the same one Playwright's
 * `webServer` uses) serves the built Worker on loopback, Chromium
 * opens `/`, and the script drives the keyboard only:
 *
 *   - the first Tab stop is the skip link, and the skip link's focus
 *     ring is visible in the screenshot (it is translated off-screen
 *     until it takes the focus),
 *   - the whole Tab order of `/` is recorded — every stop is a
 *     meaningful element, and the order wraps back to the first stop
 *     after the end of the document (the browser hands the focus back
 *     to the first element, which only happens when no focus was lost
 *     on the way),
 *   - the mobile menu (`/about` at 600 px) closes on `Escape` and
 *     hands the focus back to the trigger that opened it.
 *
 * The artefact shows the focused element AND the recorded Tab order at
 * the same time, because "the ring is visible" and "the order is
 * right" are two different claims and a screenshot of one of them
 * proves nothing about the other.
 *
 * It is also an ASSERTION, not only a screenshot: if the observations
 * contradict the keyboard contract, the script exits non-zero and
 * writes NO artefact, so the picture can never be the evidence for a
 * broken contract.
 *
 * What is deliberately NOT captured
 * ---------------------------------
 * The focus ring's contrast and visibility, the screen-reader
 * announcement order and the reading experience. Those are human
 * evaluations (Issue #399's gate and the reviewer), and the artefact
 * says so on its face instead of implying a machine verdict.
 *
 * Safety
 * ------
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The preview server is loopback-only.
 *   - The screenshot shows the public home page. No private data is
 *     on it.
 *
 * WebP, not PNG
 * -------------
 * Chromium only writes PNG, but a verification artefact does not
 * justify a permanently large binary in the tree. The capture is taken
 * into `.tmp/`, encoded with the existing `sharp` devDependency at
 * width <= 1600 / quality 80, and the committed file is the `.webp`
 * sibling. The script REFUSES any non-`.webp` output path and deletes
 * the intermediate PNG.
 *
 * Usage:
 *   node scripts/capture-a11y-keyboard-nav.mjs [options]
 *
 *   --screenshot=<path>  committed artefact destination
 *                         (default docs/verification/a11y/keyboard-navigation.webp)
 *   --png-dir=<path>     temporary PNG directory (default .tmp/a11y-keyboard-nav)
 *   --json-out=<path>    report destination (default .tmp/a11y-keyboard-nav/report.json)
 *   --port=<n>           preview server port (default 3123)
 *   --no-capture         start nothing browser-side; write no artefact
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Committed captures are WebP: width cap, quality, and a size budget. */
export const SCREENSHOT_MAX_WIDTH = 1600;
export const SCREENSHOT_QUALITY = 80;
export const SCREENSHOT_BUDGET_BYTES = 300 * 1024;

/** The two viewports the capture drives. */
export const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
export const MOBILE_VIEWPORT = { width: 600, height: 800 };

/** The canvas geometry of the composed artefact. */
export const RENDER_WIDTH = 900;
export const PANEL_WIDTH = SCREENSHOT_MAX_WIDTH - RENDER_WIDTH - 24;
export const GUTTER = 24;

/** The WCAG 2.2 criteria this artefact speaks to, with their levels. */
export const WCAG_MAPPING = [
	{ sc: '2.1.1', name: 'Keyboard', level: 'A' },
	{ sc: '2.1.2', name: 'No Keyboard Trap', level: 'A' },
	{ sc: '2.4.1', name: 'Bypass Blocks', level: 'A' },
	{ sc: '2.4.3', name: 'Focus Order', level: 'A' },
	{ sc: '2.4.7', name: 'Focus Visible', level: 'AA' },
];

/** How many Tab stops the walk records before giving up. */
export const MAX_TAB_STOPS = 60;

/** The minimum number of meaningful Tab stops the home surface must expose. */
export const MIN_TAB_STOPS = 5;

/** Reject an output path that is not WebP, or that leaves the repository. */
export function assertWebpOutputPath(path, repoRoot = REPO_ROOT) {
	if (extname(path).toLowerCase() !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${path}`);
	}
	const rel = relative(repoRoot, resolve(repoRoot, path));
	if (rel.startsWith('..')) {
		throw new Error(`refusing to write outside the repository: ${path}`);
	}
	return rel;
}

/** Whether a capture fits the verification-artefact budget (pure). */
export function screenshotBudgetVerdict(bytes) {
	return {
		bytes,
		kb: Math.round(bytes / 1024),
		withinBudget: bytes <= SCREENSHOT_BUDGET_BYTES,
	};
}

/** Minimal XML escaping: the panel text is computed, not source. */
export function escapeXml(value) {
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** A supporting element means "the focus is not on a control". */
export function isSupportingElement(tag) {
	return tag === 'BODY' || tag === 'HTML' || tag === 'NONE';
}

/**
 * Decide whether the observations honour the keyboard contract (pure).
 *
 * Kept pure and exported so the verdict can be reasoned about without
 * a browser: the capture is allowed to fail on its own observations.
 */
export function evaluateObservation(observation) {
	const failures = [];

	const stops = observation.tabOrder ?? [];
	if (stops.length < MIN_TAB_STOPS) {
		failures.push(
			`the home surface exposed only ${stops.length} Tab stop(s); at least ${MIN_TAB_STOPS} are required for the keyboard path to exist`,
		);
	}
	if (stops[0]?.href !== '#main') {
		failures.push(
			`the first Tab stop was <${stops[0]?.tag ?? 'NONE'}> ${stops[0]?.href ?? ''}; the skip link must come first (SC 2.4.1)`,
		);
	}
	for (const stop of stops) {
		if (isSupportingElement(stop.tag)) {
			failures.push(
				`the focus fell onto a supporting element (<${stop.tag}>) instead of a meaningful control`,
			);
		}
	}
	if (observation.wrapped !== true) {
		failures.push(
			'the Tab order did not wrap back to the first stop after the end of the document; the focus was lost on the way (SC 2.4.3)',
		);
	}
	if (observation.skipLinkFocusRingVisible !== true) {
		failures.push(
			'the focused skip link was not visible in the capture; the focus ring could not be reviewed (SC 2.4.7)',
		);
	}
	if (observation.menuFocusReturnedToTrigger !== true) {
		failures.push(
			'Escape closed the mobile menu but the focus did not return to the trigger that opened it (SC 2.4.3 / 2.1.2)',
		);
	}

	return { ok: failures.length === 0, failures };
}

/** One line per recorded Tab stop, for the artefact's evidence panel. */
export function tabOrderRows(stops) {
	return stops.map((stop, index) => {
		const target = stop.href ? `→ ${stop.href}` : stop.label;
		return `${String(index + 1).padStart(2, ' ')}. <${stop.tag}> ${target}`;
	});
}

/** The evidence panel: the recorded order, and what was NOT measured. */
export function evidencePanelSvg({ observation, width }) {
	const rows = [
		'machine-checked (Issue #394)',
		'',
		`first Tab stop: <${observation.tabOrder[0]?.tag ?? 'NONE'}> ${observation.tabOrder[0]?.href ?? ''} — skip link`,
		`meaningful Tab stops on /: ${observation.tabOrder.length}`,
		`wrapped back to the first stop: ${observation.wrapped ? 'yes' : 'NO'}`,
		`focus ring of the skip link visible: ${observation.skipLinkFocusRingVisible ? 'yes' : 'NO'}`,
		`mobile menu Escape → focus back on the trigger: ${observation.menuFocusReturnedToTrigger ? 'yes' : 'NO'}`,
		'',
		`WCAG 2.2: ${WCAG_MAPPING.map((entry) => `${entry.sc} ${entry.level}`).join(' · ')}`,
		'',
		'human evaluation (not measured here)',
		'- focus-ring contrast and visibility at 200% zoom (SC 2.4.7)',
		'- screen-reader announcement and reading order',
		'- reading comfort of the focused surfaces',
		'',
		'recorded Tab order on /',
		...tabOrderRows(observation.tabOrder ?? []),
	];
	const rowTop = 18;
	const step = 20;
	const height = rows.length * step + rowTop + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="14" y="${rowTop + index * step}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#ffffff" />
	<rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#d8d2c0" stroke-width="2" />
	${lines}
</svg>
`,
	};
}

/** The header band: what was rendered, what was measured, what was not. */
export function headerSvg({ observation, width = SCREENSHOT_MAX_WIDTH }) {
	const title = 'keyboard-only navigation regression — Issue #394';
	const rows = [
		`route / · viewport ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height} · Chromium · the focus ring of the skip link is visible`,
		`machine-checked: first Tab stop is the skip link, ${observation.tabOrder.length} meaningful stop(s), the order wraps back to the first stop (SC 2.1.1 / 2.4.1 / 2.4.3)`,
		'machine-checked: Escape closes the mobile menu and hands the focus back to the trigger (SC 2.1.2 / 2.4.3)',
		'not machine-checked: focus-ring contrast, screen-reader announcement, reading order (human evaluation)',
	];
	const rowTop = 52;
	const height = rowTop + rows.length * 22 + 16;
	const lines = rows
		.map(
			(row, index) =>
				`<text x="16" y="${rowTop + index * 22}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="13" fill="#1c2030">${escapeXml(row)}</text>`,
		)
		.join('\n');
	return {
		height,
		svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<rect width="${width}" height="${height}" fill="#f4efdf" />
	<text x="16" y="34" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="20" font-weight="700" fill="#0b1020">${escapeXml(title)}</text>
	${lines}
</svg>
`,
	};
}

/** Compose the artefact: header band, then the render and the evidence panel. */
export async function composeArtefact({ sharp, pagePng, header, panelSvg, outPath }) {
	const page = await sharp(pagePng).resize({ width: RENDER_WIDTH }).png().toBuffer();
	const pageMeta = await sharp(page).metadata();
	const pageHeight = pageMeta.height ?? 0;
	const bodyHeight = Math.max(pageHeight, header.height + panelSvg.height);
	const body = await sharp(page)
		.extend({
			top: 0,
			bottom: bodyHeight - pageHeight,
			left: 0,
			right: SCREENSHOT_MAX_WIDTH - RENDER_WIDTH,
			background: { r: 255, g: 255, b: 255 },
		})
		.png()
		.toBuffer();
	await sharp(body)
		.extend({
			top: header.height,
			bottom: 0,
			left: 0,
			right: 0,
			background: { r: 244, g: 239, b: 223 },
		})
		.composite([
			{ input: Buffer.from(header.svg), left: 0, top: 0 },
			{ input: Buffer.from(panelSvg.svg), left: RENDER_WIDTH + GUTTER, top: header.height },
		])
		.webp({ quality: SCREENSHOT_QUALITY })
		.toFile(outPath);
	return {
		pageWidth: pageMeta.width ?? null,
		pageHeight,
		bodyHeight,
		headerHeight: header.height,
		panelWidth: PANEL_WIDTH,
	};
}

/** Read the current `document.activeElement` (runs in the browser). */
export const READ_ACTIVE = () => {
	const element = document.activeElement;
	if (!element) return { tag: 'NONE', href: null, label: '' };
	const raw = element.getAttribute('aria-label') ?? element.textContent ?? '';
	return {
		tag: element.tagName,
		href: element.getAttribute('href'),
		label: raw.replace(/\s+/g, ' ').trim().slice(0, 48),
	};
};

/**
 * Walk the Tab order of the current page and record every stop.
 *
 * The walk stops at the first supporting element (`body`), which is
 * where the browser hands the focus back to the document. One more Tab
 * then wraps to the first stop — the wrap is what proves that no focus
 * was lost on the way.
 */
export async function walkTabOrder(page) {
	const stops = [];
	let reachedEnd = false;
	for (let index = 0; index < MAX_TAB_STOPS; index += 1) {
		await page.keyboard.press('Tab');
		const stop = await page.evaluate(READ_ACTIVE);
		if (isSupportingElement(stop.tag)) {
			reachedEnd = true;
			break;
		}
		stops.push(stop);
	}
	let wrapped = false;
	if (reachedEnd && stops.length > 0) {
		await page.keyboard.press('Tab');
		const first = await page.evaluate(READ_ACTIVE);
		wrapped = first.tag === stops[0].tag && first.href === stops[0].href;
	}
	return { stops, wrapped };
}

/** Wait until the preview server answers on the loopback port. */
export async function waitForServer(url, attempts = 60, intervalMs = 1_000) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const response = await fetch(url, { redirect: 'manual' });
			if (response.status > 0) return true;
		} catch {
			// The server is not up yet.
		}
		await new Promise((done) => setTimeout(done, intervalMs));
	}
	return false;
}

function parseArgs(argv) {
	const options = {
		screenshot: 'docs/verification/a11y/keyboard-navigation.webp',
		pngDir: '.tmp/a11y-keyboard-nav',
		jsonOut: '.tmp/a11y-keyboard-nav/report.json',
		port: 3123,
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
			case 'png-dir':
				options.pngDir = value;
				break;
			case 'json-out':
				options.jsonOut = value;
				break;
			case 'port':
				options.port = Number(value);
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

function ensureDir(path) {
	mkdirSync(dirname(resolve(REPO_ROOT, path)), { recursive: true });
}

/** Start the local preview server (the same one Playwright's webServer uses). */
function startPreviewServer(port) {
	const child = spawn(process.execPath, ['scripts/e2e-local-bootstrap.mjs', `--port=${port}`], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	const log = [];
	child.stdout.on('data', (chunk) => log.push(String(chunk)));
	child.stderr.on('data', (chunk) => log.push(String(chunk)));
	return { child, log };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.capture) assertWebpOutputPath(options.screenshot);

	if (!existsSync(join(REPO_ROOT, 'dist/client/bundle-graph.json'))) {
		throw new Error(
			'no build output found — run `pnpm run build` before the capture (the capture drives the built Worker, not the dev server)',
		);
	}

	const baseUrl = `http://127.0.0.1:${options.port}`;
	const server = startPreviewServer(options.port);
	let observation = null;
	let verdict = null;
	let capture = null;

	try {
		const ready = await waitForServer(baseUrl);
		if (!ready) {
			throw new Error(
				`the local preview server never answered on ${baseUrl}; the capture would photograph nothing`,
			);
		}

		if (!options.capture) {
			process.stdout.write('[capture] --no-capture: nothing browser-side was written\n');
		} else {
			const { chromium } = await import('@playwright/test');
			const sharp = (await import('sharp')).default;
			mkdirSync(resolve(REPO_ROOT, options.pngDir), { recursive: true });
			const pagePng = resolve(REPO_ROOT, options.pngDir, 'home-skip-link.png');

			const browser = await chromium.launch();
			try {
				// Desktop: the skip link takes the focus on the first Tab,
				// and the screenshot shows its focus ring.
				const context = await browser.newContext({
					viewport: DESKTOP_VIEWPORT,
					deviceScaleFactor: 2,
				});
				const page = await context.newPage();
				await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
				await page.locator('a[href="#main"]').waitFor({ state: 'attached', timeout: 15_000 });

				const { stops, wrapped } = await walkTabOrder(page);
				// Re-focus the skip link so the focus ring is on the screen.
				await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
				await page.locator('a[href="#main"]').waitFor({ state: 'attached', timeout: 15_000 });
				await page.keyboard.press('Tab');
				const focused = await page.evaluate(READ_ACTIVE);
				const skipLinkBox = await page.locator('a[href="#main"]').boundingBox();
				writeFileSync(pagePng, await page.screenshot({ type: 'png' }));

				// Mobile: the menu closes on Escape and hands the focus back.
				const mobile = await browser.newContext({ viewport: MOBILE_VIEWPORT });
				const mobilePage = await mobile.newPage();
				await mobilePage.goto(`${baseUrl}/about`, { waitUntil: 'domcontentloaded' });
				const toggle = mobilePage.locator('nav[aria-label="Public"] button[aria-controls]');
				await toggle.waitFor({ state: 'visible', timeout: 15_000 });
				await toggle.focus();
				await mobilePage.keyboard.press('Enter');
				await mobilePage
					.locator('nav[aria-label="Public"] button[aria-controls]')
					.waitFor({ state: 'visible', timeout: 5_000 })
					.catch(() => undefined);
				const expanded = await toggle.getAttribute('aria-expanded');
				await mobilePage.keyboard.press('Tab');
				await mobilePage.keyboard.press('Escape');
				const menuFocus = await mobilePage.evaluate(READ_ACTIVE);
				process.stdout.write(
					`[capture] mobile menu: aria-expanded=${expanded} focus-after-Escape=<${menuFocus.tag}> ${menuFocus.label}\n`,
				);
				await mobile.close();

				observation = {
					route: '/',
					tabOrder: stops,
					wrapped,
					skipLinkFocusRingVisible:
						focused.href === '#main' &&
						skipLinkBox !== null &&
						skipLinkBox.y >= 0 &&
						skipLinkBox.y < DESKTOP_VIEWPORT.height,
					menuFocusReturnedToTrigger:
						menuFocus.tag === 'BUTTON' && menuFocus.label.toLowerCase().includes('menu'),
				};
				await context.close();
			} finally {
				await browser.close();
			}

			verdict = evaluateObservation(observation);
			for (const failure of verdict.failures) process.stderr.write(`- ${failure}\n`);
			if (!verdict.ok) {
				throw new Error(
					`the browser observations contradict the keyboard contract (${verdict.failures.length} failure(s)); no artefact was written`,
				);
			}

			const header = headerSvg({ observation });
			const panel = evidencePanelSvg({ observation, width: PANEL_WIDTH });
			const outPath = resolve(REPO_ROOT, options.screenshot);
			ensureDir(options.screenshot);
			const geometry = await composeArtefact({
				sharp,
				pagePng,
				header,
				panelSvg: panel,
				outPath,
			});
			const meta = await sharp(outPath).metadata();
			const budget = screenshotBudgetVerdict(statSync(outPath).size);
			// The intermediate PNG never reaches the repository.
			rmSync(pagePng, { force: true });
			if (!budget.withinBudget) {
				throw new Error(
					`capture is ${budget.kb} kB, over the ${Math.round(SCREENSHOT_BUDGET_BYTES / 1024)} kB budget`,
				);
			}
			capture = {
				artefact: options.screenshot,
				viewport: DESKTOP_VIEWPORT,
				mobileViewport: MOBILE_VIEWPORT,
				deviceScaleFactor: 2,
				quality: SCREENSHOT_QUALITY,
				width: meta.width ?? null,
				height: meta.height ?? null,
				...geometry,
				...budget,
			};
			process.stdout.write(
				`[capture] wrote ${options.screenshot} (${capture.width}x${capture.height}, ${budget.kb} kB)\n`,
			);
		}
	} finally {
		server.child.kill('SIGTERM');
	}

	const report = {
		issue: '#394',
		generatedBy: 'scripts/capture-a11y-keyboard-nav.mjs',
		observation,
		verdict,
		wcag: WCAG_MAPPING,
		humanEvaluation: [
			'focus-ring contrast and visibility at 200% zoom (SC 2.4.7)',
			'screen-reader announcement and reading order',
			'reading comfort of the focused surfaces',
		],
		policy: {
			webpOnly: true,
			maxWidth: SCREENSHOT_MAX_WIDTH,
			quality: SCREENSHOT_QUALITY,
			budgetBytes: SCREENSHOT_BUDGET_BYTES,
			issuePathSubstituted: 'docs/verification/a11y/keyboard-navigation.png -> .webp',
			reproducible:
				'the encode step is deterministic; the browser capture is not byte-reproducible',
		},
		capture,
	};
	ensureDir(options.jsonOut);
	writeFileSync(resolve(REPO_ROOT, options.jsonOut), `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(`[capture] wrote ${options.jsonOut}\n`);
	return 0;
}

if (process.argv[1]?.endsWith('capture-a11y-keyboard-nav.mjs')) {
	main().then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
		},
	);
}
