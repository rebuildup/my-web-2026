#!/usr/bin/env node
/**
 * Verification report generator for Issue #449.
 *
 *   node scripts/security-header-report.mjs
 *
 * Writes `docs/verification/security/headers-browser.png` — the
 * screenshot the Issue requires — from MEASUREMENTS, not prose, so the
 * image cannot drift away from what the Worker actually sends:
 *
 *   1. Runs `test/integration/security-headers.test.ts` in the workerd
 *      pool and reads the `SECURITY_HEADERS_MEASUREMENT <json>` line the
 *      suite prints (real Worker responses, real headers).
 *      `--disableConsoleIntercept` is what lets that line reach stdout.
 *   2. Resolves the Static Assets half from the shipped
 *      `public/_headers` through `check-security-headers.mjs`, so the
 *      report cannot disagree with the canonical policy.
 *   3. Serves probe documents on 127.0.0.1 carrying exactly those header
 *      values and lets Chromium decide what each can do with
 *      `getUserMedia` (fake capture device, no prompt):
 *        - host baseline page         -> must be denied
 *        - the Tool grant document    -> must be granted
 *        - both embedded in an iframe -> isolates the sandbox gate from
 *          the policy gate
 *   4. Screenshots the rendered report.
 *
 * This is a documentation tool, not a gate: it never runs inside
 * `validate:*`, binds loopback only, reads no secret and contacts no
 * production host. Re-run it whenever the policy or the manifest grants
 * change, and commit the regenerated PNG in the same change.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { loadPolicy, parseHeadersFile, resolveHeadersForPath } from './check-security-headers.mjs';
import { readFileSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'docs/verification/security/headers-browser.png');
const PORT = 4599;

const policy = loadPolicy();
const rules = parseHeadersFile(readFileSync(resolve(root, 'public/_headers'), 'utf8'));

function runIntegrationSuite() {
	const result = spawnSync(
		'pnpm',
		[
			'exec',
			'vitest',
			'run',
			'test/integration/security-headers.test.ts',
			'--disableConsoleIntercept',
		],
		{ cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	const match = output.split('\n').find((line) => line.includes('SECURITY_HEADERS_MEASUREMENT '));
	if (!match) {
		throw new Error(
			`could not find the measurement line in the vitest output:\n${output.slice(-2000)}`,
		);
	}
	const marker = 'SECURITY_HEADERS_MEASUREMENT';
	return JSON.parse(match.slice(match.indexOf(marker) + marker.length).trim());
}

const PROBE_SCRIPT = `
async () => {
  const out = { permission: 'unsupported', getUserMedia: 'unsupported', detail: '' };
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    out.permission = status.state;
  } catch (error) { out.permission = 'unsupported'; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    out.getUserMedia = 'granted';
    out.detail = stream.getAudioTracks().map((t) => t.label || '(unlabelled fake track)').join(',');
    stream.getTracks().forEach((t) => t.stop());
  } catch (error) { out.getUserMedia = 'denied'; out.detail = error.name + ': ' + error.message; }
  return out;
}
`;

function probeDocument(title, note) {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:14px/1.5 ui-monospace,Menlo,monospace;margin:12px;background:#111;color:#eee}
code{color:#7ee787}</style></head>
<body><h3>${title}</h3><p>${note}</p>
<pre id="result">running…</pre>
<script type="module">
  const fn = ${PROBE_SCRIPT};
  const run = async () => {
    const value = await fn();
    document.getElementById('result').textContent = JSON.stringify(value, null, 2);
    window.__probeResult = value;
    parent.postMessage({ type: 'probe-result', value }, '*');
  };
  window.__probe = run;
  run();
</script></body></html>`;
}

const hostHeaders = () => resolveHeadersForPath(rules, '/share/procon2026/index.html');
const toolHeaders = () => resolveHeadersForPath(rules, '/tools/mic-level/app/index.html');

function applyPolicy(res, headers, contentType) {
	res.writeHead(200, { 'content-type': contentType, ...headers });
}

function renderReport(state) {
	const rows = (state.worker ?? [])
		.map(
			(row) => `<tr>
			<td class="p">${row.path}</td><td>${row.status}</td>
			<td>${row['x-content-type-options']}</td>
			<td>${row['referrer-policy']}</td>
			<td class="wrap">${row['permissions-policy']}</td></tr>`,
		)
		.join('');
	const staticRows = (state.static ?? [])
		.map(
			(row) => `<tr>
			<td class="p">${row.path}</td><td>${row.status}</td>
			<td>${row['x-content-type-options'] ?? '(absent)'}</td>
			<td>${row['referrer-policy'] ?? '(absent)'}</td>
			<td class="wrap">${row['permissions-policy'] ?? '(absent)'}</td></tr>`,
		)
		.join('');
	const browserRows = (state.browser ?? [])
		.map(
			(row) => `<tr>
			<td>${row.surface}</td><td>${row.permissionsQuery}</td>
			<td class="${row.getUserMedia === 'granted' ? 'ok' : 'no'}">${row.getUserMedia}</td>
			<td class="wrap">${row.detail}</td></tr>`,
		)
		.join('');
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Issue #449 — security header verification</title>
<style>
  body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0b0b0d;color:#e8e8ea}
  main{padding:22px 26px}
  h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;color:#9aa0a6;font-weight:600}
  p{margin:4px 0;color:#b9bdc2;max-width:1000px}
  table{border-collapse:collapse;width:100%;margin-top:6px}
  th,td{border:1px solid #2a2c31;padding:4px 7px;text-align:left;vertical-align:top;font-size:11.5px;
    font-family:ui-monospace,Menlo,monospace}
  th{background:#16181c;color:#9aa0a6}
  td.wrap{word-break:break-all;max-width:560px}
  td.p{white-space:nowrap}
  .ok{color:#7ee787;font-weight:700}.no{color:#ff7b72;font-weight:700}
  .meta{color:#6e7681;font-size:11px;margin-top:14px}
</style></head>
<body><main>
<h1>Issue #449 — nosniff / Referrer-Policy / Permissions-Policy verification</h1>
<p>Header values below are <b>measured</b>, not transcribed. The Worker rows come from
<code>test/integration/security-headers.test.ts</code> running the real Worker in the workerd pool;
the Static Assets rows come from the <code>public/_headers</code> rules resolved by
<code>scripts/check-security-headers.mjs</code>. The browser rows are Chromium
(<code>--use-fake-device-for-media-stream</code>) running <code>getUserMedia</code> against documents that carry
exactly those header values.</p>

<h2>1. Worker responses (local workerd, ${state.workerAt})</h2>
<table><tr><th>path</th><th>status</th><th>x-content-type-options</th><th>referrer-policy</th><th>permissions-policy</th></tr>${rows}</table>

<h2>2. Static Assets responses (<code>public/_headers</code> as resolved locally)</h2>
<table><tr><th>path</th><th>status</th><th>x-content-type-options</th><th>referrer-policy</th><th>permissions-policy</th></tr>${staticRows}</table>

<h2>3. Browser enforcement (success / denial)</h2>
<p><b>granted</b> = the capture device was acquired, so the feature really reached the document.
<b>denied</b> = the browser refused before any device work.
Two different gates are visible here: <code>navigator.permissions.query()</code> reports the
<i>user</i> permission (here the harness never shows a prompt, so it reads <code>denied</code> even where the
document is allowed), while <code>getUserMedia</code> is the authoritative result of the
<i>policy</i> gate this Issue changes. Chromium runs with
<code>--use-fake-device-for-media-stream</code>, so a <code>granted</code> row means "policy allowed it",
never "a real microphone was opened".</p>
<table><tr><th>surface</th><th>navigator.permissions.query('microphone')</th><th>getUserMedia({audio:true})</th><th>detail</th></tr>${browserRows}</table>
<p>Reading the rows: the host page is denied by the deny baseline; the Tool document is allowed because its own
response carries the grant declared in <code>delivery.iframe.allow</code>; the iframe rows isolate the
<b>sandbox</b> gate from the policy gate (see the PR body for what that means for <code>mic-level</code>).</p>
<p class="meta">Generated ${state.at} · local probe on 127.0.0.1 · no credentials, no production traffic.</p>
</main></body></html>`;
}

const state = {
	worker: [],
	workerAt: '',
	static: [],
	browser: [],
	at: `${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`,
};

const hostProbeHeaders = hostHeaders();
const toolProbeHeaders = toolHeaders();

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
	if (url.pathname === '/' || url.pathname === '/report') {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		res.end(renderReport(state));
		return;
	}
	if (url.pathname === '/probe/host') {
		applyPolicy(res, hostProbeHeaders, 'text/html; charset=utf-8');
		res.end(
			probeDocument(
				'host page policy (baseline)',
				'A normal page: every denied feature, microphone included. This is what /, /contact, /admin and /api/v1/* get.',
			),
		);
		return;
	}
	if (url.pathname === '/probe/tool-grant') {
		applyPolicy(res, toolProbeHeaders, 'text/html; charset=utf-8');
		res.end(
			probeDocument(
				'Tool grant policy (mic-level)',
				'The Tool artefact document: same deny list, microphone granted to self + the serving origin.',
			),
		);
		return;
	}
	if (url.pathname === '/probe/container-same-origin') {
		applyPolicy(res, { ...hostProbeHeaders }, 'text/html; charset=utf-8');
		res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>container (allow-same-origin)</title>
<style>body{font:14px ui-monospace,Menlo,monospace;margin:12px;background:#111;color:#eee}</style></head>
<body><h3>host page + Tool iframe with <code>sandbox="allow-scripts allow-same-origin"</code></h3>
<p>Same container grant, same document grant — only the sandbox differs.</p>
<pre id="result">running…</pre>
<iframe id="frame" sandbox="allow-scripts allow-same-origin" allow="microphone" src="/probe/tool-grant" style="width:420px;height:150px;border:1px solid #444"></iframe>
<script type="module">
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'probe-result') return;
    document.getElementById('result').textContent =
      'iframe getUserMedia -> ' + JSON.stringify(event.data.value, null, 2);
  });
</script></body></html>`);
		return;
	}
	if (url.pathname === '/probe/container') {
		applyPolicy(res, { ...hostProbeHeaders }, 'text/html; charset=utf-8');
		res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>container</title>
<style>body{font:14px ui-monospace,Menlo,monospace;margin:12px;background:#111;color:#eee}</style></head>
<body><h3>host page embedding a Tool iframe</h3>
<p>Container side: <code>&lt;iframe sandbox="allow-scripts" allow="microphone"&gt;</code></p>
<pre id="result">…</pre>
<iframe id="frame" sandbox="allow-scripts" allow="microphone" src="/probe/tool-grant" style="width:420px;height:150px;border:1px solid #444"></iframe>
<script type="module">
  // The Tool frame is sandboxed WITHOUT allow-same-origin, so it has an
  // opaque origin and the parent cannot read contentWindow. postMessage
  // is the only channel — which is also the channel a real Tool uses.
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'probe-result') return;
    document.getElementById('result').textContent =
      'iframe getUserMedia -> ' + JSON.stringify(event.data.value, null, 2);
  });
</script></body></html>`);
		return;
	}
	res.writeHead(404, { 'content-type': 'text/plain' });
	res.end('not found');
});

function start() {
	return new Promise((resolveServer) =>
		server.listen(PORT, '127.0.0.1', () => resolveServer(server)),
	);
}

const main = async () => {
	await start();
	const origin = `http://127.0.0.1:${PORT}`;

	// 1. measured Worker rows
	state.worker = runIntegrationSuite();
	`${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`;

	// 2. Static Assets rows, resolved from the shipped _headers
	for (const [path, headers] of [
		['/share/procon2026/index.html', hostProbeHeaders],
		[
			'/tools/prototype/app/index.html',
			resolveHeadersForPath(rules, '/tools/prototype/app/index.html'),
		],
		['/tools/mic-level/app/index.html', toolProbeHeaders],
	]) {
		state.static.push({
			path,
			status: path.includes('mic-level') ? 'rule / grant' : 'rule',
			'x-content-type-options': headers['x-content-type-options'],
			'referrer-policy': headers['referrer-policy'],
			'permissions-policy': headers['permissions-policy'],
		});
	}

	// 3. browser enforcement
	const browser = await chromium.launch({
		args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
	});
	const context = await browser.newContext({ permissions: [] });
	const page = await context.newPage();

	for (const [surface, path] of [
		['host page (baseline)', '/probe/host'],
		['Tool document (grant, top level)', '/probe/tool-grant'],
	]) {
		await page.goto(`${origin}${path}`);
		await page.waitForFunction(() => document.getElementById('result').textContent !== 'running…');
		const result = await page.evaluate(() => window.__probeResult);
		state.browser.push({ surface, ...result });
	}
	for (const [surface, path] of [
		['Tool iframe — sandbox="allow-scripts" (shipped)', '/probe/container'],
		[
			'Tool iframe — sandbox="allow-scripts allow-same-origin" (hypothetical)',
			'/probe/container-same-origin',
		],
	]) {
		await page.goto(`${origin}${path}`);
		await page.waitForFunction(
			() => document.getElementById('result').textContent !== 'running…',
			null,
			{ timeout: 30000 },
		);
		const frameText = await page.locator('#result').textContent();
		let frameResult = { permission: '?', getUserMedia: '?', detail: frameText.trim() };
		try {
			frameResult = {
				...JSON.parse(frameText.slice(frameText.indexOf('{'))),
				detail: frameText.trim(),
			};
		} catch {
			/* keep the raw text */
		}
		state.browser.push({ surface, ...frameResult });
	}

	await browser.close();

	// 4. screenshot the report
	mkdirSync(dirname(OUT), { recursive: true });
	const reportPage = await context.newPage().catch(() => null);
	const browser2 = await chromium.launch();
	const page2 = await browser2.newPage({ viewport: { width: 1600, height: 1200 } });
	await page2.goto(`${origin}/`, { waitUntil: 'networkidle' });
	const height = await page2.evaluate(() => document.documentElement.scrollHeight);
	await page2.setViewportSize({ width: 1600, height });
	await page2.screenshot({ path: OUT, fullPage: true });
	await browser2.close();
	void reportPage;

	server.close();
	mkdirSync(resolve(root, '.tmp/security-headers'), { recursive: true });
	writeFileSync(
		resolve(root, '.tmp/security-headers/report-state.json'),
		`${JSON.stringify(state, null, 2)}\n`,
	);
	console.log(`wrote ${OUT}`);
	console.log(JSON.stringify(state.browser, null, 2));
};

await main();
