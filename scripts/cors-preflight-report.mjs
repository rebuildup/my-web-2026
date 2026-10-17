#!/usr/bin/env node
/**
 * Verification report generator for Issue #455.
 *
 *   node scripts/cors-preflight-report.mjs
 *
 * Writes `docs/verification/security/cors-preflight-matrix.webp` — the
 * screenshot the Issue requires — from MEASUREMENTS, so the image cannot
 * drift away from what the boundary actually does:
 *
 *   1. Runs `test/integration/cors.test.ts` in the workerd pool and
 *      reads the `CORS_PREFLIGHT_MEASUREMENT <json>` line the suite
 *      prints. Those rows are real responses from the real Worker
 *      (`SELF.fetch` → `src/server.ts` → the Hono boundary), so status
 *      codes and header values are observed, not transcribed.
 *      `--disableConsoleIntercept` is what lets the line reach stdout.
 *   2. Serves the measured header sets on a second loopback port (the
 *      "API origin") and lets Chromium perform the cross-origin `fetch`
 *      a real page would: from a third port (the "attacker origin").
 *      This is the half that separates "the header says so" from "the
 *      browser agrees": a readable body becomes `readable`, and a
 *      blocked one becomes `blocked (TypeError: Failed to fetch)`.
 *      The probe origin is a different port from the API origin, so the
 *      requests are genuinely cross-origin.
 *   3. Screenshots the rendered report and encodes it as WebP.
 *
 * WebP, not PNG
 * --------------
 * The artefact is a text-dense table screenshot: as a PNG it was
 * ~440 KB of committed repository weight for an image whose only job is
 * to be looked at in a PR. `sharp` re-encodes it at quality 80, capped
 * at 1600 px wide, which lands well under 300 KB with no loss a reader
 * can see on a text table. The path drops the `.png` extension so the
 * format is not a lie, and `docs/security/api-cors.md` §10 plus the PR
 * body both name the `.webp` path.
 *
 * This is a documentation tool, not a gate: it never runs inside
 * `validate:*`, binds loopback only, reads no secret and contacts no
 * production host. Re-run it whenever `src/http/cors/policy.ts` or the
 * route inventory changes, and commit the regenerated image in the same
 * change.
 *
 * Why the browser half replays the measured headers instead of hitting a
 * live Worker: `vite dev` answers every `OPTIONS` itself without
 * forwarding it to the Worker (measured — see
 * `docs/security/api-cors.md` §9), and a full production build needs
 * the Tool submodules. The headers the probe serves are therefore taken
 * from the workerd measurement verbatim, and the report says so.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'docs/verification/security/cors-preflight-matrix.webp');
const REPORT_PORT = 4596;
const API_PORT = 4597;
const MEASUREMENT_MARKER = 'CORS_PREFLIGHT_MEASUREMENT';

/** Longest committed edge of the screenshot, in CSS pixels. */
const SCREENSHOT_MAX_WIDTH = 1600;
/** WebP quality. Text edges stay crisp at 80; higher only adds bytes. */
const SCREENSHOT_QUALITY = 80;

export { API_PORT, MEASUREMENT_MARKER, OUT, REPORT_PORT, SCREENSHOT_MAX_WIDTH, SCREENSHOT_QUALITY };

/**
 * Pull the measurement rows out of a `vitest run` result.
 *
 * Throws on a NON-ZERO exit even when a measurement line is present.
 * That is the whole point: the suite prints its measurement from the
 * first test, so if a LATER test (the inventory gate, the
 * wildcard-invariant sweep, the SSR no-header check) fails, the line is
 * already in the output. Without this check the script would render a
 * report from a half-failing suite and overwrite the committed image
 * with numbers that no longer pass.
 *
 * @param {{ status: number | null, stdout?: string, stderr?: string }} result
 * @returns {Array<Record<string, unknown>>}
 */
export function extractMeasurement({ status, stdout, stderr }) {
	const output = `${stdout ?? ''}\n${stderr ?? ''}`;
	const line = output.split('\n').find((entry) => entry.includes(`${MEASUREMENT_MARKER} `));
	if (status !== 0) {
		throw new Error(
			`the CORS integration suite exited with status ${status}; the report must not be regenerated from a failing run:\n${output.slice(-2000)}`,
		);
	}
	if (!line) {
		throw new Error(
			`could not find the ${MEASUREMENT_MARKER} line in the vitest output:\n${output.slice(-2000)}`,
		);
	}
	return JSON.parse(
		line.slice(line.indexOf(MEASUREMENT_MARKER) + MEASUREMENT_MARKER.length).trim(),
	);
}

function runIntegrationSuite() {
	return extractMeasurement(
		spawnSync(
			'pnpm',
			['exec', 'vitest', 'run', 'test/integration/cors.test.ts', '--disableConsoleIntercept'],
			{ cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
		),
	);
}

export function escapeHtml(value) {
	return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Rebuild the response headers a probe endpoint serves from a measured
 * row, so the browser sees exactly the bytes the Worker sent.
 *
 * `allowOriginOverride` exists only for the rows explicitly labelled
 * counterfactual in `BROWSER_ROWS`: they answer "what if this response
 * had carried the header the policy refuses to emit?", which is how the
 * report separates "the refusal blocked it" from "the browser blocked
 * everything anyway".
 */
export function headersFor(row, allowOriginOverride) {
	const headers = {};
	const allowOrigin = allowOriginOverride ?? row.allowOrigin;
	if (allowOrigin !== '(absent)') headers['Access-Control-Allow-Origin'] = allowOrigin;
	// `*` and `Access-Control-Allow-Credentials` are mutually exclusive in
	// the Fetch standard, so the counterfactual wildcard row must not keep
	// the credentials header.
	if (row.allowCredentials !== '(absent)' && allowOrigin !== '*') {
		headers['Access-Control-Allow-Credentials'] = row.allowCredentials;
	}
	if (row.allowMethods !== '(absent)') headers['Access-Control-Allow-Methods'] = row.allowMethods;
	if (row.allowHeaders !== '(absent)') headers['Access-Control-Allow-Headers'] = row.allowHeaders;
	if (row.vary !== '(absent)') headers.Vary = row.vary;
	return headers;
}

/**
 * Rows the browser actually performs. Each one names a measured row plus
 * what the report claims about it.
 *
 * Every claim is written to match the verdict it sits next to. A row
 * whose text asserted more than the browser did was worse than no text:
 * the earlier revision of this file labelled the canonical-origin row
 * "readable only from an allow-listed origin — the echo is the origin
 * itself" while the browser rendered it `blocked`, because the probe
 * page's origin is `127.0.0.1:4596` and the echo names
 * `https://rebuildup.dev`. The rule below: describe the mechanism, and
 * never claim a payload was exposed when the body is the probe's own
 * synthetic JSON.
 *
 * `allowOriginOverride` marks a COUNTERFACTUAL: the probe serves a
 * different `Access-Control-Allow-Origin` than the Worker sent, to show
 * that the denial is caused by the policy and not by something incidental
 * (and, for `*`, that the Fetch standard itself refuses the combination
 * this policy avoids).
 */
export const BROWSER_ROWS = [
	{
		key: 'public-read GET from a foreign origin',
		credentials: 'omit',
		claim: 'the wildcard is CORRECT here: no secret behind this response',
	},
	{
		key: 'credentialed preflight from the canonical origin',
		credentials: 'include',
		claim:
			'blocked from THIS probe origin: the echo names https://rebuildup.dev, not 127.0.0.1:4596 — the row below re-serves the same response aimed at the caller',
	},
	{
		key: 'credentialed preflight from the canonical origin',
		credentials: 'include',
		allowOriginOverride: 'http://127.0.0.1:4596',
		counterfactual: true,
		claim:
			'counterfactual: the same response with the echo pointed at the caller instead — now readable. The echoed origin IS the gate; nothing else on the response changed',
	},
	{
		key: 'credentialed preflight from a foreign origin',
		credentials: 'include',
		claim: 'REFUSED: no allow-origin header at all, so no script can read it',
	},
	{
		key: 'credentialed preflight from a foreign origin',
		credentials: 'include',
		allowOriginOverride: '*',
		counterfactual: true,
		claim:
			'counterfactual: the wildcard this policy refuses — still blocked, because Fetch forbids * with credentials',
	},
	{
		key: 'credentialed preflight from a foreign origin',
		credentials: 'omit',
		allowOriginOverride: '*',
		counterfactual: true,
		claim:
			'counterfactual: the same wildcard WITHOUT credentials — the browser hands the body over. This is the mechanism a wildcard would open on a credentialed route (the body here is the probe’s own synthetic 403 JSON, not API data)',
	},
	{
		key: 'sandboxed Tool iframe (Origin: null) on the auth route',
		credentials: 'include',
		claim: 'REFUSED: the wildcard in _headers for /tools/<slug>/app/* cannot become API access',
	},
	{
		key: 'operator diagnostic from a foreign origin',
		credentials: 'omit',
		claim: 'unclassified path: no CORS header, so the body stays opaque to script',
	},
];

export function renderReport(state) {
	const workerRows = state.worker
		.map(
			(row) => `<tr>
			<td class="p">${escapeHtml(row.method)} ${escapeHtml(row.path)}${
				row.mode === 'mock' ? ' <span class="cf">mock</span>' : ''
			}</td>
			<td class="p">${escapeHtml(row.origin)}</td>
			<td class="n ${row.status < 400 ? '' : 'deny'}">${row.status}</td>
			<td class="wrap">${escapeHtml(row.allowOrigin)}</td>
			<td class="wrap">${escapeHtml(row.allowCredentials)}</td>
			<td class="wrap">${escapeHtml(row.allowMethods)}</td>
			<td class="lbl">${escapeHtml(row.label)}</td>
			<td class="lbl">${escapeHtml(row.meaning)}</td>
		</tr>`,
		)
		.join('');
	const browserRows = state.browser
		.map(
			(row) => `<tr>
			<td class="lbl">${escapeHtml(row.label)}</td>
			<td class="p ${row.counterfactual ? 'cf' : ''}">${escapeHtml(
				row.counterfactual ? 'counterfactual' : 'as measured',
			)}</td>
			<td class="wrap">${escapeHtml(row.servedAllowOrigin)}</td>
			<td class="p">${escapeHtml(row.credentials)}</td>
			<td class="${row.verdict.startsWith('readable') ? 'ok' : 'deny'}">${escapeHtml(row.verdict)}</td>
			<td class="lbl">${escapeHtml(row.claim)}</td>
			<td class="wrap">${escapeHtml(row.detail)}</td>
		</tr>`,
		)
		.join('');
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Issue #455 — CORS preflight matrix</title>
<style>
  body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0b0b0d;color:#e8e8ea}
  main{padding:22px 26px}
  h1{font-size:19px;margin:0 0 4px}
  h2{font-size:14px;margin:22px 0 6px;color:#9aa0a6;font-weight:600}
  p{margin:4px 0;color:#b9bdc2;max-width:1180px}
  table{border-collapse:collapse;width:100%;margin-top:6px}
  th,td{border:1px solid #2a2c31;padding:4px 7px;text-align:left;vertical-align:top;font-size:11.5px;
    font-family:ui-monospace,Menlo,monospace}
  th{background:#16181c;color:#9aa0a6}
  td.wrap{word-break:break-all;max-width:260px}
  td.p{white-space:nowrap}
  td.lbl{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;max-width:250px;color:#c9ccd1}
  td.n{text-align:right}
  .ok{color:#7ee787;font-weight:700}
  .cf{color:#d29922}
  .deny{color:#ff7b72;font-weight:700}
  .meta{color:#6e7681;font-size:11px;margin-top:14px}
  code{color:#7ee787}
</style></head>
<body><main>
<h1>Issue #455 — CORS preflight matrix (external HTTP boundary)</h1>
<p><b>read-only public API</b> and <b>credential-carried API</b> are separate contracts, and the wildcard belongs
only to the first one. Section 1 is what the Worker actually answered; section 2 is what a browser does with
exactly those bytes.</p>

<h2>1. Worker responses — measured in the local workerd pool</h2>
<p>Every row is a real request through <code>SELF.fetch</code> into <code>src/server.ts</code>, dispatched to the
Hono boundary. <code>(none)</code> in the origin column means the request carried no <code>Origin</code> header at all
(the SSR self-call / <code>curl</code> shape). <code>204</code> is an answered preflight,
<code>403</code> is a refused cross-origin request, <code>404</code> is an unclassified path that has no CORS
decision, <code>415</code> is a request the policy let through and Better Auth then refused on its media type, and
<code>401</code> is a request the policy let through and the API-key boundary then refused —
proving the gates are independent. Rows marked <code>mock</code> ran through the real
<code>externalBoundary</code> with <code>LOCAL_API_MODE=mock</code>, so the mock gate carries the same CORS surface.</p>
<table>
<tr><th>request</th><th>origin</th><th>status</th><th>allow-origin</th><th>allow-credentials</th>
<th>allow-methods</th><th>case</th><th>meaning</th></tr>
${workerRows}
</table>

<h2>2. Browser enforcement — Chromium fetching the measured headers cross-origin</h2>
<p>The page is served from <code>127.0.0.1:${REPORT_PORT}</code> and the responses from <code>127.0.0.1:${API_PORT}</code>:
different ports, so every request below is genuinely cross-origin. <b>as measured</b> rows replay the exact headers the Worker
sent in section 1. <b>counterfactual</b> rows change only <code>access-control-allow-origin</code>, to show what the browser
would do with a value this policy refuses to emit — they are labelled individually and are not claims about production.
<b>readable</b> = the browser handed the body to script. <b>blocked</b> / <b>not ok</b> = the fetch threw or the status was
refused before the body was exposed. The body in a readable row is the probe’s own synthetic JSON, never API data.</p>
<table>
<tr><th>case</th><th>row</th><th>access-control-allow-origin served</th><th>credentials mode</th>
<th>result in Chromium</th><th>what it shows</th><th>detail</th></tr>
${browserRows}
</table>

<p class="meta">Generated ${escapeHtml(state.at)} · workerd measurement + loopback probe on 127.0.0.1 ·
no credentials, no secret, no production traffic. Regenerate with <code>node scripts/cors-preflight-report.mjs</code>.</p>
</main></body></html>`;
}

/**
 * The browser half. Playwright serializes this function into the page,
 * so it runs in the page's own origin — the same code path a real
 * cross-origin caller would take, including the `TypeError` the browser
 * throws when the response is not CORS-readable.
 */
async function browserProbe({ url, credentials }) {
	try {
		const response = await fetch(url, { credentials });
		const body = await response.text();
		return {
			// "Readable" is the security question, not "ok": the answer
			// is whether the browser handed the body to script.
			verdict: `readable (${response.status})`,
			detail:
				body.length === 0
					? `fetch resolved; response readable by script (${response.status} carries no body)`
					: `fetch resolved; ${body.length} bytes of the probe's synthetic JSON exposed to script`,
		};
	} catch (error) {
		return {
			verdict: 'blocked',
			detail: `${error.name}: ${error.message || '(no message)'}`,
		};
	}
}

async function main() {
	const state = {
		worker: runIntegrationSuite(),
		workerAt: `${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`,
		browser: [],
		at: `${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`,
	};

	// API origin: replay of the measured headers, one path per measured row.
	const apiServer = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${API_PORT}`);
		const key = url.searchParams.get('case');
		const override = url.searchParams.get('allowOrigin');
		const row = state.worker.find((entry) => entry.label === key);
		if (!row) {
			res.writeHead(404, { 'content-type': 'text/plain' });
			res.end('unknown case');
			return;
		}
		const headers = headersFor(row, override ?? undefined);
		res.writeHead(row.status, { 'content-type': 'application/json', ...headers });
		res.end(
			JSON.stringify({
				case: row.label,
				status: row.status,
				allow_origin: row.allowOrigin,
				allow_credentials: row.allowCredentials,
			}),
		);
	});

	// Report origin: the "page" an attacker origin would be.
	const reportServer = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${REPORT_PORT}`);
		if (url.pathname === '/') {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end(renderReport(state));
			return;
		}
		res.writeHead(404, { 'content-type': 'text/plain' });
		res.end('not found');
	});

	const listen = (server, port) =>
		new Promise((resolveServer) => server.listen(port, '127.0.0.1', resolveServer));

	await listen(apiServer, API_PORT);
	await listen(reportServer, REPORT_PORT);

	const browser = await chromium.launch();
	const page = await browser.newPage();
	// Load the report page FIRST. The probes below run inside it, so the
	// page's own origin is the requesting origin — evaluating before the
	// first navigation would run them on `about:blank`, whose origin is
	// `null`, and every allow-origin comparison would be meaningless.
	await page.goto(`http://127.0.0.1:${REPORT_PORT}/`, { waitUntil: 'networkidle' });

	for (const probe of BROWSER_ROWS) {
		const row = state.worker.find((entry) => entry.label === probe.key);
		if (!row) throw new Error(`no measured row named ${probe.key}`);
		const url = new URL(`http://127.0.0.1:${API_PORT}/api/v1/probe`);
		url.searchParams.set('case', row.label);
		if (probe.allowOriginOverride !== undefined) {
			url.searchParams.set('allowOrigin', probe.allowOriginOverride);
		}
		const result = await page.evaluate(browserProbe, {
			url: url.toString(),
			credentials: probe.credentials,
		});
		state.browser.push({
			label: row.label,
			counterfactual: probe.counterfactual === true,
			claim: probe.claim,
			credentials: probe.credentials,
			measuredStatus: row.status,
			measuredAllowOrigin: row.allowOrigin,
			servedAllowOrigin: probe.allowOriginOverride ?? row.allowOrigin,
			...result,
		});
	}

	await page.setViewportSize({ width: SCREENSHOT_MAX_WIDTH, height: 1000 });
	await page.goto(`http://127.0.0.1:${REPORT_PORT}/`, { waitUntil: 'networkidle' });
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	await page.setViewportSize({ width: SCREENSHOT_MAX_WIDTH, height });
	const png = await page.screenshot({ fullPage: true });
	await browser.close();

	apiServer.close();
	reportServer.close();

	// PNG in memory only. Never written to the repository: the committed
	// artefact is the WebP below.
	const webp = await sharp(png)
		.resize({ width: SCREENSHOT_MAX_WIDTH, withoutEnlargement: true })
		.webp({ quality: SCREENSHOT_QUALITY })
		.toBuffer();

	mkdirSync(dirname(OUT), { recursive: true });
	mkdirSync(resolve(root, '.tmp/cors'), { recursive: true });
	writeFileSync(OUT, webp);
	writeFileSync(
		resolve(root, '.tmp/cors/report-state.json'),
		`${JSON.stringify(state, null, 2)}\n`,
	);
	console.log(`wrote ${OUT} (${webp.length} bytes, WebP q${SCREENSHOT_QUALITY})`);
	console.log(JSON.stringify(state.browser, null, 2));
}

// Only run when invoked as the entry point. `scripts/cors-preflight-
// report.test.mjs` imports the pure helpers above and must not launch a
// browser or re-run the workerd suite to assert them.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
