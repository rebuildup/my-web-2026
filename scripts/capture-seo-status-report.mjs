#!/usr/bin/env node
/**
 * capture-seo-status-report — the Issue #419 verification capture.
 *
 * What it photographs
 * -------------------
 * The two responses the Issue names, captured from a REAL origin and
 * read back out of the response itself:
 *
 *   1. `404` — a URL the platform does not resolve
 *      (`/this-route-does-not-exist-419`): the shared `not_found`
 *      surface.
 *   2. `500` — a permanent client-input failure
 *      (`/portfolio?facets=a&facets=b`): the served status is the
 *      framework's error status while the document is the `not_found`
 *      surface. This is the recorded gap from
 *      `docs/verification/ops/error-state-gallery.md` §7 #8 (a), and it
 *      is the honest 500 to photograph — a 503 would have to be faked.
 *
 * The status and the `robots` state shown next to each capture are read
 * from the real response and judged by the same evaluator the CI suite
 * uses, so the report cannot claim something the contract does not say.
 *
 * Why a real origin instead of a rendered component
 * -------------------------------------------------
 * Issue #501 already photographs the failure COMPONENTS
 * (`docs/verification/ops/error-state-gallery.webp`). What stays
 * unproved is the HTTP contract around them: which status, which
 * `robots` state, which document a browser actually receives. That
 * question needs a served response, so this script drives a browser
 * against one.
 *
 * Safety
 * ------
 *   - LOCAL origin only. `--base-url` is honoured but must be a loopback
 *     host, and the server this script starts is bound to 127.0.0.1, so
 *     the capture cannot become a production read.
 *   - Nothing is deployed, no remote binding is touched, no secret is
 *     read or printed. The preview server runs from the local `dist/`
 *     build against the local `.tmp/d1state`.
 *   - Intermediate PNGs stay in memory and in `.tmp/`, which is removed
 *     afterwards; only the WebP is committed (Issue #419 names a `.png`
 *     path and the `.webp` sibling is committed in its place, for the
 *     same reason as Issue #418's capture: a verification artefact must
 *     not become a second copy of the document in repository history).
 *
 * Usage:
 *   pnpm run build                       # the preview server serves dist/
 *   pnpm run capture:seo-status          # this script
 *   pnpm run capture:seo-status -- --base-url=http://127.0.0.1:3000
 *
 *   --base-url=<url>   capture against an already-running local origin
 *   --port=<n>         port for the server this script starts (default 3100)
 *   --keep-server      leave the started server running after the capture
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	HTTP_STATUS_EXPECTATIONS,
	evaluateObservation,
	robotsStateFromHtml,
	surfaceFromHtml,
} from './_seo-status-contract.mjs';
import { reportHtml } from './_seo-status-report.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(REPO_ROOT, '.tmp/seo-status');
const JSON_REPORT = join(TMP, 'suite-results.json');
const HTML_REPORT = join(TMP, 'seo-status-report.html');
const WEBP_TARGET = join(REPO_ROOT, 'docs/verification/seo/404-and-500-state.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;
const SUITE = 'test/integration/seo-status-contract.test.ts';

/** The two responses the Issue asks to be photographed. */
const CAPTURE_TARGETS = [
	{
		caseId: 'unmatched-route-not-found',
		path: '/this-route-does-not-exist-419',
		caption: '404 — URL that matches no route (shared not_found surface)',
	},
	{
		caseId: 'portfolio-invalid-query-input-failure',
		path: '/portfolio?facets=a&facets=b',
		caption: '500 — permanent input failure answered with the not_found surface',
	},
];

function arg(name, fallback) {
	const found = process.argv.slice(2).find((value) => value.startsWith(`--${name}=`));
	return found ? found.slice(name.length + 3) : fallback;
}

function fail(message) {
	process.stderr.write(`capture-seo-status-report: ${message}\n`);
	process.exit(2);
}

/** Refuse anything that is not a loopback origin. */
function assertLocalOrigin(origin) {
	const { hostname } = new URL(origin);
	if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
		fail(
			`refusing to capture from a non-local origin (${origin}). This script never reads the canonical production origin; point --base-url at a local preview server.`,
		);
	}
	return origin.replace(/\/$/, '');
}

/** Run the workerd suite and return its assertions (the CI record). */
function runSuite() {
	mkdirSync(TMP, { recursive: true });
	execFileSync('npx', ['vitest', 'run', SUITE, '--reporter=json', `--outputFile=${JSON_REPORT}`], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
	});
	const report = JSON.parse(readFileSync(JSON_REPORT, 'utf8'));
	return (report.testResults ?? []).flatMap((file) =>
		(file.assertionResults ?? []).map((test) => ({
			title: test.fullName ?? test.title,
			status: test.status,
			ms: test.duration ?? 0,
		})),
	);
}

async function isReachable(origin) {
	try {
		await fetch(origin, { redirect: 'manual' });
		return true;
	} catch {
		return false;
	}
}

/**
 * Start the local preview server unless one is already up.
 *
 * `scripts/e2e-local-bootstrap.mjs` is the same entry point
 * `playwright.config.ts` boots: it migrates and seeds `.tmp/d1state`
 * BEFORE the server binds, which is the ordering the webServer hook
 * guarantees there. Reusing it keeps the capture and the E2E suite on one
 * origin preparation.
 */
async function resolveOrigin(port) {
	const origin = `http://127.0.0.1:${port}`;
	if (await isReachable(origin)) return { origin, child: null };
	if (!existsSync(join(REPO_ROOT, 'dist/client'))) {
		fail(`no local origin on port ${port} and no dist/client build. Run \`pnpm run build\` first.`);
	}
	const child = spawn('node', ['scripts/e2e-local-bootstrap.mjs', `--port=${port}`], {
		cwd: REPO_ROOT,
		stdio: 'inherit',
	});
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		if (await isReachable(origin)) return { origin, child };
		if (child.exitCode !== null) break;
		await new Promise((done) => setTimeout(done, 500));
	}
	child.kill('SIGTERM');
	fail(`the local preview server never became ready on port ${port}.`);
	return null;
}

/** Capture each target's real response and the document it rendered. */
async function captureTargets(origin, browser) {
	const captures = [];
	for (const target of CAPTURE_TARGETS) {
		const row = HTTP_STATUS_EXPECTATIONS.find((entry) => entry.id === target.caseId);
		if (!row) fail(`no contract case named "${target.caseId}"`);
		const page = await browser.newPage({
			viewport: { width: 1280, height: 900 },
			deviceScaleFactor: 1,
		});
		const response = await page.goto(new URL(target.path, origin).href, { waitUntil: 'load' });
		const html = await page.content();
		const status = response?.status() ?? 0;
		captures.push({
			caseId: target.caseId,
			path: target.path,
			caption: target.caption,
			status,
			robots: robotsStateFromHtml(html),
			surface: surfaceFromHtml(html),
			violations: evaluateObservation(row, { status, html }),
			png: await page.screenshot({ fullPage: true }),
		});
		await page.close();
	}
	return captures;
}

async function main() {
	const port = arg('port', '3100');
	const keepServer = process.argv.includes('--keep-server');
	const baseUrl = arg('base-url', null);
	const { origin: startedOrigin, child } = baseUrl
		? { origin: assertLocalOrigin(baseUrl), child: null }
		: await resolveOrigin(port);
	const origin = assertLocalOrigin(startedOrigin);

	try {
		mkdirSync(TMP, { recursive: true });
		const assertions = runSuite();

		const { chromium } = await import('@playwright/test');
		const { default: sharp } = await import('sharp');
		if (extname(WEBP_TARGET) !== '.webp') {
			fail(`refusing to write a non-WebP verification artefact: ${WEBP_TARGET}`);
		}

		const browser = await chromium.launch();
		let info;
		let captures;
		try {
			captures = await captureTargets(origin, browser);
			const html = reportHtml({
				captures: captures.map((capture) => ({
					...capture,
					pngDataUri: `data:image/png;base64,${capture.png.toString('base64')}`,
				})),
				expectations: HTTP_STATUS_EXPECTATIONS,
				assertions,
				suitePath: SUITE,
				origin,
			});
			writeFileSync(HTML_REPORT, html);
			process.stdout.write(`wrote ${HTML_REPORT}\n`);

			const reportPage = await browser.newPage({
				viewport: { width: 1280, height: 900 },
				deviceScaleFactor: 1,
			});
			await reportPage.goto(pathToFileURL(HTML_REPORT).href, { waitUntil: 'load' });
			// Playwright cannot emit WebP: screenshot into memory (never a
			// file) and re-encode with the `sharp` devDependency.
			const capture = await reportPage.screenshot({ fullPage: true });
			await reportPage.close();
			info = await sharp(capture)
				.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
				.webp({ quality: WEBP_QUALITY })
				.toFile(WEBP_TARGET);
		} finally {
			await browser.close();
		}

		rmSync(TMP, { recursive: true, force: true });
		process.stdout.write(
			`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB, quality ${WEBP_QUALITY})\n`,
		);
		for (const capture of captures) {
			process.stdout.write(
				`  ${capture.status} ${capture.path} — surface=${capture.surface} robots=${capture.robots} ` +
					`contract=${capture.violations.length === 0 ? 'MATCH' : `MISMATCH (${capture.violations.length})`}\n`,
			);
		}
		const mismatches = captures.filter((capture) => capture.violations.length > 0);
		process.stdout.write(
			'reproduce: pnpm run build && pnpm run capture:seo-status && pnpm exec playwright test e2e/seo-status.spec.ts\n',
		);
		return mismatches.length === 0 ? 0 : 1;
	} finally {
		if (child && !keepServer) child.kill('SIGTERM');
	}
}

process.exit(await main());
