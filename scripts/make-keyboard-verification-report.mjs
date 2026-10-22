#!/usr/bin/env node
/**
 * Verification artefact generator for Issue #620 — the `/keyboard`
 * keyboard-layout reference page.
 *
 * What this proves
 * ----------------
 * The page a visitor sees. `/keyboard` renders the **committed**
 * snapshot under `src/keyboard/sources/**` (the obligation never
 * fetches at request time), so the page needs no binding and no
 * credential: D1, R2, Infisical and every other Cloudflare resource
 * are out of the picture. The capture is therefore reproducible on a
 * laptop with the network off.
 *
 * The route is served by the real application — the same Vite dev
 * server the robots artefact uses
 * (`pnpm exec vite dev --port <port> --strictPort`) — so the bytes in
 * the image are the bytes the Worker serves, not a hand-written
 * mock-up.
 *
 * The image is SUPPORTING evidence. The authority is the integration
 * test (`test/integration/keyboard-page.test.ts`) and the Playwright
 * spec (`e2e/keyboard.spec.ts`); the screenshot only shows what those
 * assertions saw.
 *
 * Output format
 * -------------
 * Playwright cannot encode WebP, so the capture is taken as a PNG
 * **in memory** and re-encoded with the existing `sharp` devDependency
 * as `resize({ width, withoutEnlargement: true })` followed by
 * `webp({ quality: 80 })`. No intermediate PNG is written to disk, and
 * the committed target extension is asserted to be `.webp`, so a PNG
 * can never drift back into `docs/`. `sharp` stays a devDependency and
 * is never imported by the Worker / SSR.
 *
 * Usage
 * -----
 *   node scripts/make-keyboard-verification-report.mjs
 *   pnpm run verify:keyboard-screenshot      # same thing
 *
 * Chromium must be present — `pnpm run e2e:install`.
 *
 * Status output only: path, size, viewport. No secret is read, printed
 * or required.
 */

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.KEYBOARD_VERIFICATION_PORT ?? 15941);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROUTE = '/keyboard';
const TMP_DIR = resolve(REPO_ROOT, '.tmp', 'keyboard-verification');
const WEBP_QUALITY = 80;
/** The repository keeps verification captures small; a bigger file is a bug. */
const MAX_BYTES = 300 * 1024;

/**
 * The two viewports the artefact records.
 *
 * `desktop` is the layout the page is designed for; `mobile` is the
 * narrow case where the diagram keeps its own scroll region instead of
 * widening the document (asserted by `e2e/keyboard.spec.ts`).
 */
const VIEWPORTS = [
	{ name: 'desktop', width: 1440, height: 900 },
	{ name: 'mobile', width: 390, height: 844 },
];

const out = (message) => process.stdout.write(`[keyboard-verification] ${message}\n`);

/** The committed artefacts: `docs/verification/web/` is flat by convention. */
const targetFor = (name) =>
	resolve(REPO_ROOT, 'docs/verification/web', `keyboard-page-${name}.webp`);

/**
 * Start the real application.
 *
 * `pnpm dev` is wired through Infisical (ADR-0015), which a
 * verification artefact must not depend on, so the generator spawns
 * `vite dev` directly — the same way the robots artefact is captured.
 */
function startDevServer() {
	const logPath = resolve(TMP_DIR, 'vite-dev.log');
	mkdirSync(TMP_DIR, { recursive: true });
	const log = createWriteStream(logPath, { flags: 'w' });
	const child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', String(PORT), '--strictPort'], {
		cwd: REPO_ROOT,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout.pipe(log, { end: false });
	child.stderr.pipe(log, { end: false });
	out(`dev server starting on ${BASE_URL} (log: ${relative(REPO_ROOT, logPath)})`);
	return child;
}

/**
 * Wait until the route answers 200.
 *
 * The first SSR request compiles the route, so the poll — not a fixed
 * sleep — is what makes this reliable.
 */
async function waitForServer(attempts = 120) {
	for (let i = 0; i < attempts; i += 1) {
		try {
			const response = await fetch(`${BASE_URL}${ROUTE}`);
			if (response.ok) {
				await response.arrayBuffer();
				return true;
			}
		} catch {
			// not listening yet
		}
		await sleep(1000);
	}
	return false;
}

/**
 * Fail closed on a page that is not the page under test.
 *
 * A capture of the safe state ("the layout could not be parsed") would
 * be worthless — worse, it would look like evidence. The page must
 * render its heading, its key buttons and its diagram region.
 */
function assertRealPage(page) {
	const facts = page.evaluate(() => {
		const heading = document.querySelector('h1');
		const keys = document.querySelectorAll('button[data-keyboard-key]').length;
		// The diagram's own scroll region is a labelled
		// `<section aria-label="… のキー配置。横にスクロールできます。">`.
		const diagrams = document.querySelectorAll('section[aria-label*="キー配置"]').length;
		const tabs = document.querySelectorAll('[role="tab"]').length;
		const body = document.body.innerText ?? '';
		return {
			heading: heading ? (heading.textContent ?? '').trim() : '',
			keys,
			diagrams,
			tabs,
			// The safe state ("the layout could not be parsed") would look
			// like evidence in a screenshot, so it must never be captured.
			safeState: body.includes('配列を表示できません'),
			documentWidth: document.documentElement.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
		};
	});
	return facts.then((facts) => {
		if (facts.heading.length === 0) {
			throw new Error('the page rendered no <h1> — the capture would show a broken document');
		}
		if (facts.keys === 0) {
			throw new Error(
				'the page rendered no keyboard keys — the capture would show the safe state instead of the layout',
			);
		}
		if (facts.diagrams === 0 || facts.tabs === 0) {
			throw new Error(
				'the page rendered no diagram region / tabs — the capture is not the reference page',
			);
		}
		if (facts.safeState) {
			throw new Error(
				'the page rendered the safe state ("配列を表示できません") — the capture would document a failure, not the layout',
			);
		}
		return facts;
	});
}

/** Capture one viewport and write the committed WebP. */
async function capture(browser, viewport) {
	const target = targetFor(viewport.name);
	if (extname(target) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${target}`);
	}
	mkdirSync(dirname(target), { recursive: true });

	const page = await browser.newPage({
		viewport: { width: viewport.width, height: viewport.height },
		deviceScaleFactor: 1,
	});
	try {
		const response = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: 'load' });
		if (!response || !response.ok()) {
			throw new Error(
				`GET ${BASE_URL}${ROUTE} -> ${response ? response.status() : 'no response'}; the capture would show an error page`,
			);
		}
		await page.waitForSelector('button[data-keyboard-key]');
		const facts = await assertRealPage(page);

		const png = await page.screenshot({ type: 'png', fullPage: true });
		const { default: sharp } = await import('sharp');
		const info = await sharp(png)
			.resize({ width: viewport.width, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(target);

		const bytes = statSync(target).size;
		if (bytes > MAX_BYTES) {
			throw new Error(
				`the artefact is ${bytes} B, over the ${MAX_BYTES} B cap — shrink the capture instead of committing a heavy file`,
			);
		}
		out(
			`${relative(REPO_ROOT, target)} — ${viewport.name} ${viewport.width}x${viewport.height}, webp ${info.width}x${info.height}, ${bytes} B`,
		);
		out(
			`     rendered h1="${facts.heading}", ${facts.keys} key buttons, ${facts.tabs} tabs, document width ${facts.documentWidth}/${facts.clientWidth}`,
		);
		return { target, bytes };
	} finally {
		await page.close();
	}
}

const dev = startDevServer();
let browser;
try {
	if (!(await waitForServer())) {
		throw new Error(`the dev server did not serve ${ROUTE} on ${BASE_URL} in time`);
	}
	out(`dev server ready: GET ${BASE_URL}${ROUTE} -> 200`);
	const { chromium } = await import('@playwright/test');
	browser = await chromium.launch();
	for (const viewport of VIEWPORTS) {
		await capture(browser, viewport);
	}
	out(
		'done: the artefacts are supporting evidence; the integration test and the Playwright spec are the authority',
	);
} finally {
	if (browser) await browser.close();
	dev.kill('SIGTERM');
	await sleep(1000);
	if (!dev.killed) dev.kill('SIGKILL');
}
