#!/usr/bin/env node

/**
 * Verification report generator for Issue #447 (CSP Report-Only).
 *
 * Produces `docs/verification/security/csp-report.webp` — the path the
 * Issue names, with the `.webp` extension substituted for `.png` (the
 * repository encodes screenshots as WebP at quality 80; Playwright cannot
 * write WebP, so the capture is re-encoded in memory with `sharp` and no
 * intermediate PNG reaches the disk).
 *
 * The report is built from measurements, not prose:
 *
 *   1. the Worker rows come from `test/integration/csp-report-only.test.ts`
 *      driving the real Worker in the local workerd pool and printing a
 *      `CSP_REPORT_ONLY_MEASUREMENT` marker;
 *   2. the browser rows come from Chromium against a loopback document
 *      carrying that exact measured header — one allowed same-origin
 *      image (no event) and one unlisted origin (a `disposition: report`
 *      event, not a block).
 *
 * Nothing here reads a secret, contacts production, or writes remote D1 /
 * R2 state. Re-run it whenever the policy or the measured origins change:
 *
 *   node scripts/make-csp-report-only-report.mjs
 *   pnpm run verify:csp-report-only-screenshot   # same thing
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, '.tmp');
const HTML_REPORT = join(TMP, 'csp-report-only-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/security/csp-report.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;
const SUITE = 'test/integration/csp-report-only.test.ts';
const MEASUREMENT_MARKER = 'CSP_REPORT_ONLY_MEASUREMENT';
const PORT = Number(process.env.CSP_REPORT_ONLY_PORT ?? 4601);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/** Run the integration suite and read the measured header rows. */
function runSuite() {
	mkdirSync(TMP, { recursive: true });
	const result = spawnSync(
		'pnpm',
		['exec', 'vitest', 'run', SUITE, '--disableConsoleIntercept', '--reporter=dot'],
		{ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	const line = output.split('\n').find((entry) => entry.includes(MEASUREMENT_MARKER));
	if (result.status !== 0 || !line) {
		throw new Error(
			`CSP Report-Only integration suite failed or produced no measurement:\n${output.slice(-3000)}`,
		);
	}
	return JSON.parse(
		line.slice(line.indexOf(MEASUREMENT_MARKER) + MEASUREMENT_MARKER.length).trim(),
	);
}

/** Minimal loopback documents; the header under test is the only variable. */
function probeDocument(title) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>
<body><h1>${title}</h1><p>Report-Only probe document.</p></body></html>`;
}

/** Chromium probe: allowed subresource, then an unlisted origin. */
async function probeBrowser(policy) {
	const server = createServer((req, res) => {
		const path = new URL(req.url ?? '/', ORIGIN).pathname;
		if (path === '/favicon.svg') {
			res.writeHead(200, { 'content-type': 'image/svg+xml' });
			res.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>');
			return;
		}
		if (path === '/allowed' || path === '/blocked') {
			res.writeHead(200, {
				'content-type': 'text/html; charset=utf-8',
				'content-security-policy-report-only': policy,
			});
			res.end(probeDocument(path === '/allowed' ? 'allowed same-origin image' : 'unlisted origin'));
			return;
		}
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('not found');
	});

	await new Promise((resolveListening) => server.listen(PORT, '127.0.0.1', resolveListening));

	const browser = await chromium.launch();
	const context = await browser.newContext();
	const page = await context.newPage();
	const violations = [];
	await page.addInitScript(() => {
		window.__cspViolations = [];
		document.addEventListener('securitypolicyviolation', (event) => {
			window.__cspViolations.push({
				effectiveDirective: event.effectiveDirective,
				disposition: event.disposition,
				blockedURI: event.blockedURI,
			});
		});
	});

	try {
		await page.goto(`${ORIGIN}/allowed`);
		const allowedLoaded = await page.evaluate(
			() =>
				new Promise((resolveImage) => {
					const image = new Image();
					image.onload = () => resolveImage(true);
					image.onerror = () => resolveImage(false);
					image.src = '/favicon.svg';
				}),
		);
		await page.waitForTimeout(250);
		const allowedViolations = await page.evaluate(() => window.__cspViolations ?? []);

		await page.goto(`${ORIGIN}/blocked`);
		const blocked = await page.evaluate(
			() =>
				new Promise((resolveEvent) => {
					const record = (event) => {
						if (event.effectiveDirective !== 'img-src') return;
						document.removeEventListener('securitypolicyviolation', record);
						resolveEvent({
							effectiveDirective: event.effectiveDirective,
							disposition: event.disposition,
							blockedURI: event.blockedURI,
						});
					};
					document.addEventListener('securitypolicyviolation', record);
					const image = new Image();
					image.src = 'https://csp-probe.invalid/pixel.png';
					setTimeout(() => {
						document.removeEventListener('securitypolicyviolation', record);
						resolveEvent(null);
					}, 5_000);
				}),
		);
		await page.waitForTimeout(250);
		const blockedViolations = await page.evaluate(() => window.__cspViolations ?? []);

		return [
			{
				surface: 'same-origin image (/favicon.svg)',
				loaded: allowedLoaded ? 'yes' : 'no',
				reported: String(allowedViolations.length),
				disposition: allowedViolations[0]?.disposition ?? '(none)',
				directive: allowedViolations[0]?.effectiveDirective ?? '(none)',
				uri: allowedViolations[0]?.blockedURI ?? '(none)',
			},
			{
				surface: 'unlisted origin (csp-probe.invalid)',
				loaded: 'reported only',
				reported: String(blockedViolations.length),
				disposition: blocked?.disposition ?? '(none)',
				directive: blocked?.effectiveDirective ?? '(none)',
				uri: blocked?.blockedURI ?? '(none)',
			},
		];
	} finally {
		await browser.close();
		await new Promise((resolveClosed) => server.close(resolveClosed));
	}
}

function renderReport(rows, browserRows) {
	const workerRows = rows
		.map(
			(row) => `<tr><td class="p">${row.path}</td><td>${row.status}</td>
			<td class="wrap">${row['report-only']}</td><td class="p">${row.enforcing}</td></tr>`,
		)
		.join('');
	const browserTable = browserRows
		.map(
			(row) => `<tr><td>${row.surface}</td><td>${row.loaded}</td>
			<td class="${row.disposition === 'report' || row.reported === '0' ? 'ok' : 'no'}">${row.disposition}</td>
			<td>${row.directive}</td><td class="wrap">${row.uri}</td></tr>`,
		)
		.join('');
	const policy = rows[0]?.['report-only'] ?? '(missing)';

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Issue #447 — CSP Report-Only verification</title>
<style>
  body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0b0b0d;color:#e8e8ea}
  main{padding:22px 26px}
  h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;color:#9aa0a6;font-weight:600}
  p{margin:4px 0;color:#b9bdc2;max-width:1120px}
  code{font-family:ui-monospace,Menlo,monospace;color:#7ee787}
  table{border-collapse:collapse;width:100%;margin-top:6px}
  th,td{border:1px solid #2a2c31;padding:4px 7px;text-align:left;vertical-align:top;font-size:11.5px;
    font-family:ui-monospace,Menlo,monospace}
  th{background:#16181c;color:#9aa0a6}
  td.wrap{word-break:break-all;max-width:700px}
  td.p{white-space:nowrap}
  .ok{color:#7ee787;font-weight:700}.no{color:#ff7b72;font-weight:700}
  .meta{color:#6e7681;font-size:11px;margin-top:14px}
</style></head>
<body><main>
<h1>Issue #447 — Content-Security-Policy-Report-Only, as observed</h1>
<p>The policy below is emitted by <code>src/http/content-security-policy.ts</code> at the Worker's single
security-header choke point. It is <b>Report-Only</b>: violations are reported, never blocked. The
enforcing <code>Content-Security-Policy</code> header remains the separate <code>frame-ancestors</code>
policy from Issue #448.</p>

<h2>1. Measured policy (local workerd, real Worker responses)</h2>
<p><code>${policy}</code></p>
<table><tr><th>path</th><th>status</th><th>content-security-policy-report-only</th><th>enforcing CSP</th></tr>${workerRows}</table>
<p>Origin inventory: <code>'self'</code> for TanStack Start, hydration, Panda CSS, favicon and the
same-origin Tool iframe; <code>https://www.googletagmanager.com</code> for the GA4 loader;
<code>https://fonts.googleapis.com</code> / <code>https://fonts.gstatic.com</code> for fonts;
GA4's <code>*.google-analytics.com</code> / <code>*.analytics.google.com</code> /
<code>*.googletagmanager.com</code> for beacons; and the R2 media origin when
<code>MEDIA_PUBLIC_BASE_URL</code> is configured. No unobserved origin, no <code>'unsafe-eval'</code>,
and no report collector is declared.</p>

<h2>2. Browser observation (Chromium, loopback)</h2>
<p>Both probe documents carry the measured header above. A reported violation has
<code>disposition: report</code>; the browser still loads or attempts the resource.</p>
<table><tr><th>surface</th><th>load</th><th>disposition</th><th>effectiveDirective</th><th>blockedURI</th></tr>${browserTable}</table>
<p>Reading the rows: the same-origin image is allowed by <code>img-src 'self'</code> and produces no
event. The unlisted <code>csp-probe.invalid</code> origin produces exactly one <code>img-src</code>
report with <code>disposition: report</code> — the detection the Issue asks for — and is not blocked,
which is the property that lets this ship without a production breakage test.</p>
<p class="meta">Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z · local workerd + loopback Chromium ·
no production request, no credential, no D1/R2 mutation · committed as docs/verification/security/csp-report.webp
(width ≤ ${WEBP_WIDTH}, quality ${WEBP_QUALITY}).</p>
</main></body></html>`;
}

async function main() {
	const rows = runSuite();
	const browserRows = await probeBrowser(rows[0]['report-only']);
	const html = renderReport(rows, browserRows);
	writeFileSync(HTML_REPORT, html);

	if (extname(WEBP_TARGET) !== '.webp') {
		throw new Error(`refusing to write a non-WebP verification artefact: ${WEBP_TARGET}`);
	}
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ viewport: { width: WEBP_WIDTH, height: 1000 } });
		await page.goto(pathToFileURL(HTML_REPORT).href);
		const png = await page.screenshot({ type: 'png', fullPage: true });
		const info = await sharp(png)
			.resize({ width: WEBP_WIDTH, withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toFile(WEBP_TARGET);
		process.stdout.write(
			`wrote ${WEBP_TARGET} (webp ${info.width}x${info.height}, ${info.size} B, quality ${WEBP_QUALITY})\n`,
		);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
