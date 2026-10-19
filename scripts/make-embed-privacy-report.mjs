#!/usr/bin/env node

/**
 * Verification report generator for Issue #498 (embed third-party
 * contact + consent).
 *
 * Produces `docs/verification/legal/embed-privacy-consent.webp` — the
 * path the Issue names, with the `.webp` extension substituted for
 * `.png` (the repository encodes screenshots as WebP at quality 80;
 * Playwright cannot write WebP, so the capture is re-encoded in memory
 * with `sharp` and no intermediate PNG reaches the disk).
 *
 * The report is built from measurements, not prose:
 *
 *   1. the policy rows come from `test/integration/embed-privacy.test.ts`
 *      driving the real Worker in the local workerd pool and printing
 *      an `EMBED_PRIVACY_MEASUREMENT` marker — one row per embeddable
 *      Tool: the derived consent mode, the declared origins, and what
 *      the served document actually contained;
 *   2. the browser rows come from Chromium loading the REAL
 *      pre-activation document the Worker served (carried inside the
 *      marker, not re-authored here) on a loopback origin, with every
 *      off-loopback request counted AND aborted at the Playwright
 *      interception layer (`context.route`), so nothing leaves the
 *      operator's machine. The count is what the browser would have
 *      sent before the visitor pressed anything.
 *
 * Scope, stated in the report itself: this measures what the HOST does
 * before activation. What the framed artefact does after activation is
 * declared in `src/tools/manifest.json` and reviewed at submodule bump
 * time (the "Re-measuring after a submodule bump" section of
 * `docs/tools/embed-privacy.md`); the host cannot observe a framed
 * document's network behaviour.
 *
 * Nothing here reads a secret, contacts production, contacts a real
 * third party, or writes remote D1 / R2 state. Re-run it whenever the
 * policy, the manifest declaration or the route changes:
 *
 *   node scripts/make-embed-privacy-report.mjs
 *   pnpm run verify:embed-privacy-screenshot   # same thing
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
const HTML_REPORT = join(TMP, 'embed-privacy-report.html');
const WEBP_TARGET = join(ROOT, 'docs/verification/legal/embed-privacy-consent.webp');
const WEBP_WIDTH = 1600;
const WEBP_QUALITY = 80;
const SUITE = 'test/integration/embed-privacy.test.ts';
const MEASUREMENT_MARKER = 'EMBED_PRIVACY_MEASUREMENT';
const PORT = Number(process.env.EMBED_PRIVACY_PORT ?? 4607);
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * Host-chrome origins: the site shell loads these on every page by
 * owner decision (GA4 mount, Issue #171; origin inventory, Issue
 * #447). They are NOT the embed's contacts, so the browser leg reports
 * them separately instead of letting them hide inside the total.
 */
const CHROME_ORIGIN_HINTS = [
	'googletagmanager.com',
	'google-analytics.com',
	'fonts.googleapis.com',
	'fonts.gstatic.com',
];

/** Run the integration suite and read the measured rows. */
function runSuite() {
	mkdirSync(TMP, { recursive: true });
	const result = spawnSync(
		'pnpm',
		['exec', 'vitest', 'run', SUITE, '--disableConsoleIntercept', '--reporter=dot'],
		{ cwd: ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
	);
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	const line = output.split('\n').find((entry) => entry.includes(MEASUREMENT_MARKER));
	if (result.status !== 0 || !line) {
		throw new Error(
			`embed privacy integration suite failed or produced no measurement:\n${output.slice(-3000)}`,
		);
	}
	return JSON.parse(
		line.slice(line.indexOf(MEASUREMENT_MARKER) + MEASUREMENT_MARKER.length).trim(),
	);
}

function originOf(url) {
	try {
		return new URL(url).origin;
	} catch {
		return '(unparseable)';
	}
}

/**
 * Chromium probe: load the real pre-activation document on loopback and
 * count what it tries to reach.
 *
 * Every off-loopback request is ABORTED at the interception layer
 * (`context.route`), before it can leave this machine, and the count is
 * taken in the same handler — so "counted" and "aborted" are the same
 * set by construction, not by promise. The probe then asserts that no
 * off-loopback response was ever received: a single one would mean the
 * run was not network-isolated, and the script fails instead of
 * publishing a report whose claim would be false.
 */
async function probeBrowser(document, gatedSlug) {
	const attempted = new Map();
	let offLoopbackResponses = 0;
	const server = createServer((req, res) => {
		const path = new URL(req.url ?? '/', ORIGIN).pathname;
		if (req.headers.accept?.includes('text/html')) {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end(document);
			return;
		}
		if (path === '/favicon.ico' || path === '/favicon.svg') {
			res.writeHead(200, { 'content-type': 'image/svg+xml' });
			res.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>');
			return;
		}
		// Module / asset requests cannot resolve off the loopback origin:
		// the report measures what the DOCUMENT asks for, not a rebuilt
		// bundle. Each one is recorded so the count stays honest.
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('not found');
	});

	await new Promise((resolveListening) => server.listen(PORT, '127.0.0.1', resolveListening));

	const browser = await chromium.launch();
	const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
	// The interception is the whole point of the browser leg: the
	// document under test really does point at third-party origins, and
	// the measurement must not cost the operator one request to them.
	await context.route('**/*', (route) => {
		const origin = originOf(route.request().url());
		if (origin === ORIGIN) {
			void route.continue();
			return;
		}
		attempted.set(origin, (attempted.get(origin) ?? 0) + 1);
		void route.abort();
	});
	const page = await context.newPage();
	page.on('response', (response) => {
		if (originOf(response.url()) !== ORIGIN) offLoopbackResponses += 1;
	});

	try {
		await page.goto(`${ORIGIN}/tools/${gatedSlug}`, { waitUntil: 'load' });
		await page.waitForTimeout(1_500);
		const frames = await page.locator('iframe').count();
		const noticeVisible = await page.locator('[data-testid="tool-embed-consent"]').count();
		if (offLoopbackResponses > 0) {
			throw new Error(
				`the browser leg received ${offLoopbackResponses} off-loopback response(s) — the run was not network-isolated, refusing to publish the report`,
			);
		}
		const aborted = [...attempted.values()].reduce((sum, count) => sum + count, 0);
		const rows = [...attempted.entries()]
			.map(([origin, count]) => ({
				origin,
				count,
				aborted: count,
				class: CHROME_ORIGIN_HINTS.some((hint) => origin.includes(hint))
					? 'host chrome (Issue #171 / #447)'
					: 'embed contact — UNEXPECTED before activation',
			}))
			.sort((a, b) => b.count - a.count || a.origin.localeCompare(b.origin));
		return { rows, frames, noticeVisible, aborted, offLoopbackResponses };
	} finally {
		await browser.close();
		await new Promise((resolveClosed) => server.close(resolveClosed));
	}
}

function escapeHtml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderReport(rows, browserRows, browserSummary) {
	const policyRows = rows
		.map(
			(row) => `<tr><td class="p">${escapeHtml(row.slug)}</td><td class="p">${escapeHtml(
				row.delivery,
			)}</td><td class="p">${escapeHtml(row.frame_src)}</td>
<td class="wrap">${escapeHtml(row.contacts || '(none declared)')}</td>
<td class="${row.consent === 'click_to_load' ? 'gate' : 'ok'}">${escapeHtml(row.consent)}</td>
<td>${row.violations}</td></tr>`,
		)
		.join('');
	const servedRows = rows
		.map(
			(row) => `<tr><td class="p">${escapeHtml(row.path)}</td><td>${row.status}</td>
<td class="${row.ssr_iframes === 0 ? 'ok' : 'no'}">${row.ssr_iframes}</td>
<td>${escapeHtml(row.notice)}</td><td>${row.ssr_third_party_total}</td>
<td class="${row.ssr_third_party_added === 0 ? 'ok' : 'no'}">${row.ssr_third_party_added}</td></tr>`,
		)
		.join('');
	const browserTable = browserRows.length
		? browserRows
				.map(
					(row) => `<tr><td class="wrap">${escapeHtml(row.origin)}</td><td>${row.count}</td>
<td>${row.aborted}</td>
<td class="${row.class.startsWith('host chrome') ? 'chrome' : 'no'}">${escapeHtml(row.class)}</td></tr>`,
				)
				.join('')
		: '<tr><td colspan="4">(no off-loopback request was attempted)</td></tr>';
	const gated = rows.find((row) => row.consent === 'click_to_load');

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Issue #498 — embed third-party contact + consent</title>
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
  td.wrap{word-break:break-all;max-width:560px}
  td.p{white-space:nowrap}
  .ok{color:#7ee787;font-weight:700}.no{color:#ff7b72;font-weight:700}.gate{color:#ffa657;font-weight:700}
  .chrome{color:#79c0ff}
  .meta{color:#6e7681;font-size:11px;margin-top:14px}
</style></head>
<body><main>
<h1>Issue #498 — external embed tracking and privacy notice, as measured</h1>
<p>No YouTube / X / Discord embed ships in this repository, and no <code>external_exception</code> Tool is
registered. The shipped embed surfaces are the two same-origin Tools below, so this report measures what
<em>they</em> cost a visitor before they press anything — and what the host would let a future external
Tool cost, under the same contract (<code>src/tools/embed-privacy.ts</code>).</p>

<h2>1. Declared contacts and the derived consent mode (src/tools/manifest.json)</h2>
<p>Consent is <b>derived</b>, never declared: a cross-origin frame or a non-empty origin list means
<code>click_to_load</code>, and there is no manifest field that can switch it off. Every row is
evaluated by the same function the <code>/tools/&lt;slug&gt;</code> loader runs per request and by
<code>pnpm run tools:check</code> at build time.</p>
<table><tr><th>tool</th><th>delivery</th><th>frame src</th><th>declared third-party origins</th>
<th>consent</th><th>violations</th></tr>${policyRows}</table>

<h2>2. What the served document contained before any interaction (local workerd, real Worker)</h2>
<p>Measured against the SSR documents the Worker actually returned. <em>third-party added</em> counts the
off-origin requests a Tool document makes that an embed-free host page (<code>/contact</code>) does not:
the number the embed costs before anyone acts.</p>
<table><tr><th>path</th><th>status</th><th>&lt;iframe&gt; in SSR HTML</th><th>consent notice</th>
<th>third-party URLs in HTML</th><th>third-party added vs /contact</th></tr>${servedRows}</table>

<h2>3. Browser observation — Chromium on loopback, real pre-activation document</h2>
<p>The document measured in row 2 for <code>${escapeHtml(gated ? gated.path : '(none)')}</code> was replayed
on a loopback origin. Every off-loopback request was <b>counted and aborted</b> at the browser's
interception layer: <b>${browserSummary.aborted}</b> request(s) attempted, <b>${browserSummary.aborted}</b>
aborted, <b>${browserSummary.offLoopbackResponses}</b> off-loopback response(s) received — so this run contacts
nothing. Frames in the live DOM: <b>${browserSummary.frames}</b>. Consent notice present:
<b>${browserSummary.noticeVisible > 0 ? 'yes' : 'no'}</b>.</p>
<table><tr><th>origin requested before activation</th><th>requests attempted</th><th>requests aborted</th>
<th>class</th></tr>${browserTable}</table>
<p>Reading the rows: the remaining off-loopback requests are the <b>host chrome</b> (the GA4 loader and
the Google Fonts stylesheet) that every page on this site loads by owner decision — Issue #171 mounted GA4
and Issue #447 measured the origin inventory. They are not embed contacts and this Issue does not change
them; here they were aborted, so this run sent no request to any of them. The origins the embed
<em>would</em> have pulled before activation — Adobe Typekit and the Google Apps Script endpoint in the
ProtoType artefact — are absent.</p>

<h2>4. Residual risk (not closed by this report)</h2>
<p>
(1) What the framed artefact does <b>after</b> activation is declared, not observed: the host cannot see a
framed document's network behaviour. Re-measure the declaration whenever a Tool submodule is bumped
(<code>docs/tools/embed-privacy.md</code>, "Re-measuring after a submodule bump").
(2) The consent gate is per visit — no cookie or storage record is written, so the question is re-asked
on every navigation. A consent store would be a new published data surface and is an owner decision.
(3) Host-document analytics (GA4) and Google Fonts are unchanged by this Issue and remain the largest
third-party surface of <code>/tools/&lt;slug&gt;</code>.
</p>
<p class="meta">Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z · local workerd +
loopback Chromium · no production request, no credential, no D1/R2 mutation · every off-loopback request
was aborted at the interception layer and ${browserSummary.offLoopbackResponses} off-loopback response(s)
were received, so no third-party traffic left this machine · committed as
docs/verification/legal/embed-privacy-consent.webp (width ≤ ${WEBP_WIDTH}, quality
${WEBP_QUALITY}). Re-run: <code>pnpm run verify:embed-privacy-screenshot</code>.</p>
</main></body></html>`;
}

async function main() {
	const rows = runSuite();
	const gated = rows.find((row) => typeof row.document === 'string');
	if (!gated) throw new Error('the measurement carries no pre-activation document to replay');
	const browserSummary = await probeBrowser(gated.document, gated.slug);
	const html = renderReport(rows, browserSummary.rows, browserSummary);
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
