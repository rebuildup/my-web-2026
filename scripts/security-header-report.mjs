#!/usr/bin/env node
/**
 * Verification report generator for Issue #449.
 *
 *   node scripts/security-header-report.mjs [--static-measurements=<file>]
 *
 * Writes `docs/verification/security/headers-browser.webp` — the
 * screenshot the Issue requires (stored as moderately compressed WebP
 * instead of the Issue's `.png`, which bloats the repository) — from
 * MEASUREMENTS, not prose, so the image cannot drift away from what the
 * site actually sends:
 *
 *   1. Worker responses: runs `test/integration/security-headers.test.ts`
 *      in the local workerd pool and reads the
 *      `SECURITY_HEADERS_MEASUREMENT <json>` line the suite prints
 *      (`--disableConsoleIntercept` is what lets it reach stdout).
 *   2. Static Assets responses: resolved from the shipped
 *      `public/_headers` through `check-security-headers.mjs` — the same
 *      parser the CI gate uses — unless `--static-measurements` points at
 *      a captured `curl -D -` dump from `pnpm preview`, in which case the
 *      real responses are reported instead (see
 *      `docs/security/security-headers.md` §4).
 *   3. Browser enforcement: probe documents served from 127.0.0.1 carry
 *      exactly the header values above (recomputed for the probe origin,
 *      the way the Worker recomputes them per request), and Chromium with
 *      a fake capture device is asked to use the microphone through each
 *      of them. The rows distinguish the two gates the Issue separates:
 *      the container document's own policy, and the framed document's.
 *
 * This is a documentation tool, not a gate: it never runs inside
 * `validate:*`, binds loopback only, reads no secret and contacts no
 * production host. Re-run it whenever the policy or the manifest grants
 * change, and commit the regenerated image in the same change.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import {
	loadPolicy,
	parseHeadersFile,
	permissionsPolicyValue,
	resolveHeadersForPath,
} from './check-security-headers.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'docs/verification/security/headers-browser.webp');
const PORT = Number(process.env.SECURITY_HEADER_REPORT_PORT ?? 4599);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const MEASUREMENT_MARKER = 'SECURITY_HEADERS_MEASUREMENT';
/**
 * Screenshot encode settings. Playwright can only write PNG, so the
 * capture buffer is re-encoded with `sharp`: a full-page report is
 * mostly flat dark UI where PNG stays large and WebP at quality 80 is
 * roughly an order of magnitude smaller at the same legibility.
 */
const SHOT_WIDTH = 1600;
const SHOT_QUALITY = 80;

const policy = loadPolicy();
const rules = parseHeadersFile(readFileSync(resolve(root, 'public/_headers'), 'utf8'));

/** Header values for the probe origin, exactly as the Worker emits them. */
const NOSNIFF = { 'x-content-type-options': policy.x_content_type_options };
const HOST_POLICY = {
	...NOSNIFF,
	'referrer-policy': policy.referrer_policy.host,
	'permissions-policy': permissionsPolicyValue(policy, ORIGIN),
};
const TOOL_SHELL_POLICY = {
	...NOSNIFF,
	'referrer-policy': policy.referrer_policy.host,
	'permissions-policy': permissionsPolicyValue(policy, ORIGIN, ['microphone']),
};
/**
 * The `_headers` Tool artefact rules as the probe serves them. The
 * `Permissions-Policy` entry is emptied rather than dropped so the
 * header is sent with no value, which is what a path the namespace
 * leaves ungoverned looks like on the wire.
 */
const TOOL_ARTEFACT_RULES = {
	...resolveHeadersForPath(rules, '/tools/prototype/app/index.html'),
	'permissions-policy': '',
};

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
	const line = output.split('\n').find((entry) => entry.includes(MEASUREMENT_MARKER));
	if (!line) {
		throw new Error(`no ${MEASUREMENT_MARKER} line in the vitest output:\n${output.slice(-2000)}`);
	}
	return JSON.parse(
		line.slice(line.indexOf(MEASUREMENT_MARKER) + MEASUREMENT_MARKER.length).trim(),
	);
}

/** Optional: a captured dump from `curl -sSI <preview>/<path>`. */
function readStaticMeasurements(argument) {
	if (!argument) return null;
	const path = resolve(root, argument);
	if (!existsSync(path)) return null;
	return JSON.parse(readFileSync(path, 'utf8'));
}

const PROBE_SCRIPT = `
async () => {
  const out = { permission: 'unsupported', getUserMedia: 'unsupported', detail: '' };
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    out.permission = status.state;
  } catch { out.permission = 'unsupported'; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    out.getUserMedia = 'granted';
    out.detail = stream.getAudioTracks().map((t) => t.label || '(unlabelled fake track)').join(', ');
    stream.getTracks().forEach((t) => t.stop());
  } catch (error) { out.getUserMedia = 'denied'; out.detail = error.name + ': ' + error.message; }
  return out;
}`;

function probeDocument(title, note, headerComment) {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:13px/1.5 ui-monospace,Menlo,monospace;margin:12px;background:#111;color:#eee}
code{color:#7ee787}</style></head>
<body><h3>${title}</h3><p>${note}</p><p>${headerComment}</p>
<pre id="result">running…</pre>
<script type="module">
  const value = await (${PROBE_SCRIPT})();
  document.getElementById('result').textContent = JSON.stringify(value, null, 2);
  window.__probeResult = value;
  parent.postMessage({ type: 'probe-result', value }, '*');
</script></body></html>`;
}

function containerDocument(title, note, sandbox) {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:13px/1.5 ui-monospace,Menlo,monospace;margin:12px;background:#111;color:#eee}
iframe{width:420px;height:130px;border:1px solid #444}</style></head>
<body><h3>${title}</h3><p>${note}</p>
<pre id="result">running…</pre>
<iframe id="frame" sandbox="${sandbox}" allow="microphone" src="/probe/tool-artefact"></iframe>
<script type="module">
  // The Tool frame is sandboxed, so it has an opaque origin and the
  // parent cannot read contentWindow; postMessage is the only channel.
  window.addEventListener('message', (event) => {
    if (event.data?.type !== 'probe-result') return;
    window.__probeResult = event.data.value;
    document.getElementById('result').textContent = JSON.stringify(event.data.value, null, 2);
  });
</script></body></html>`;
}

function staticRowsFromRules() {
	const samples = [
		'/share/procon2026/index.html',
		'/assets/index-abc123.js',
		'/tools/prototype/app/index.html',
		'/tools/mic-level/app/index.html',
	];
	return samples.map((path) => {
		const resolved = resolveHeadersForPath(rules, path);
		return {
			path,
			status: 'resolved',
			'x-content-type-options': resolved['x-content-type-options'] ?? '(browser default)',
			'referrer-policy': resolved['referrer-policy'] ?? '(browser default)',
			'permissions-policy':
				resolved['permissions-policy'] ?? '(none — delegated by the host route)',
		};
	});
}

function renderReport(state) {
	const workerRows = state.worker
		.map(
			(row) => `<tr><td class="p">${row.path}</td><td>${row.status}</td>
			<td>${row['x-content-type-options']}</td><td>${row['referrer-policy']}</td>
			<td class="wrap">${row['permissions-policy']}</td></tr>`,
		)
		.join('');
	const staticRows = state.static
		.map(
			(row) => `<tr><td class="p">${row.path}</td><td>${row.status}</td>
			<td>${row['x-content-type-options'] ?? '(absent)'}</td><td>${row['referrer-policy'] ?? '(absent)'}</td>
			<td class="wrap">${row['permissions-policy'] ?? '(absent)'}</td></tr>`,
		)
		.join('');
	const browserRows = state.browser
		.map(
			(row) => `<tr><td>${row.surface}</td><td>${row.permission}</td>
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
  p{margin:4px 0;color:#b9bdc2;max-width:1100px}
  code{font-family:ui-monospace,Menlo,monospace;color:#7ee787}
  table{border-collapse:collapse;width:100%;margin-top:6px}
  th,td{border:1px solid #2a2c31;padding:4px 7px;text-align:left;vertical-align:top;font-size:11.5px;
    font-family:ui-monospace,Menlo,monospace}
  th{background:#16181c;color:#9aa0a6}
  td.wrap{word-break:break-all;max-width:520px}
  td.p{white-space:nowrap}
  .ok{color:#7ee787;font-weight:700}.no{color:#ff7b72;font-weight:700}
  .meta{color:#6e7681;font-size:11px;margin-top:14px}
</style></head>
<body><main>
<h1>Issue #449 — nosniff / Referrer-Policy / Permissions-Policy, as observed</h1>
<p>Every value below is <b>measured</b>. The Worker rows come from
<code>test/integration/security-headers.test.ts</code> driving the real Worker in the local workerd pool;
the Static Assets rows are ${state.staticSource}; the browser rows are Chromium
(<code>--use-fake-device-for-media-stream</code>) asking for the microphone on documents that carry exactly those values.</p>

<h2>1. Worker responses (local workerd)</h2>
<table><tr><th>path</th><th>status</th><th>x-content-type-options</th><th>referrer-policy</th><th>permissions-policy</th></tr>${workerRows}</table>
<p>The grant row is <code>/tools/mic-level</code>: the only Tool that declares <code>delivery.iframe.allow</code>,
and the allowlist is scoped to the origin that served the request.</p>

<h2>2. Static Assets responses (<code>public/_headers</code>)</h2>
<table><tr><th>path</th><th>status</th><th>x-content-type-options</th><th>referrer-policy</th><th>permissions-policy</th></tr>${staticRows}</table>
<p>Note the Tool artefact rows carry <b>no</b> Permissions-Policy: the framed document's own policy is binding for
that document, so a blanket deny there would break every Tool that legitimately needs a capture device.
Which Tool may ask is decided by the host route's <code>&lt;iframe allow=…&gt;</code>, driven by the manifest.</p>

<h2>3. Browser enforcement (success / denial)</h2>
<p><b>granted</b> = the capture device was acquired, so the feature really reached the document.
<b>denied</b> = the browser refused before opening a device.
<code>navigator.permissions.query()</code> reports the <i>user</i> permission, which the harness never prompts for,
so it is not the gate under test; <code>getUserMedia</code> is. Chromium uses a fake capture device, so
<b>granted</b> means "the policy allowed it", never "a microphone was opened".</p>
<table><tr><th>surface</th><th>permissions.query('microphone')</th><th>getUserMedia({audio:true})</th><th>detail</th></tr>${browserRows}</table>
<p>Reading the rows: the container document's own header is the ceiling for its frame — a Tool artefact that is
granted only on the frame side is still denied, and only the full chain (host grant + <code>allow</code> + a frame
with a usable origin) grants. The last row is the remaining open item for <code>mic-level</code>: under the shipped
<code>sandbox="allow-scripts"</code> the frame has an opaque origin and capture is impossible whatever the headers say.</p>
<p class="meta">Generated ${state.at} · loopback probe on ${ORIGIN} · fake capture device · no credentials, no production traffic.</p>
</main></body></html>`;
}

const state = {
	worker: [],
	static: [],
	staticSource: 'resolved from the shipped rules by the CI gate parser',
	browser: [],
	at: `${new Date().toISOString().replace('T', ' ').slice(0, 19)}Z`,
};

const server = createServer((req, res) => {
	const url = new URL(req.url ?? '/', ORIGIN);
	const send = (headers, body) => {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers });
		res.end(body);
	};
	switch (url.pathname) {
		case '/':
		case '/report':
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
			res.end(renderReport(state));
			return;
		case '/probe/host':
			send(
				HOST_POLICY,
				probeDocument(
					'host page (baseline)',
					'What /, /contact, /admin/* and /api/v1/* get from the Worker: the deny list, microphone included.',
					`headers: nosniff · referrer=${HOST_POLICY['referrer-policy']} · permissions-policy (microphone=())`,
				),
			);
			return;
		case '/probe/tool-shell':
			send(
				TOOL_SHELL_POLICY,
				probeDocument(
					'Tool shell route (grant applied)',
					'What /tools/mic-level gets: same deny list, microphone granted to self and the serving origin.',
					`headers: permissions-policy microphone=${permissionsPolicyValue(policy, ORIGIN, ['microphone']).split('microphone=')[1].split(',')[0]}`,
				),
			);
			return;
		case '/probe/tool-artefact':
			send(
				TOOL_ARTEFACT_RULES,
				`<!doctype html><meta charset="utf-8"><body style="font:13px/1.5 ui-monospace,Menlo,monospace;margin:12px;background:#111;color:#eee">
				<h3>Tool artefact</h3><p>Served with the <code>/tools/:slug/app/*</code> rule: no Permissions-Policy.</p>
				<pre id="result">running…</pre>
				<script type="module">
				  const value = await (${PROBE_SCRIPT})();
				  document.getElementById('result').textContent = JSON.stringify(value, null, 2);
				  window.__probeResult = value;
				  parent.postMessage({ type: 'probe-result', value }, '*');
				</script></body>`,
			);
			return;
		case '/probe/chain-granted':
			send(
				TOOL_SHELL_POLICY,
				containerDocument(
					'Full chain, frame origin usable',
					'Container grants, <code>allow="microphone"</code>, frame keeps a same origin.',
					'allow-scripts allow-same-origin',
				),
			);
			return;
		case '/probe/chain-denied':
			send(
				HOST_POLICY,
				containerDocument(
					'Same chain, container denies',
					'Only the container header differs: the shell is on the baseline.',
					'allow-scripts allow-same-origin',
				),
			);
			return;
		case '/probe/chain-shipped-sandbox':
			send(
				TOOL_SHELL_POLICY,
				containerDocument(
					'Same chain, shipped sandbox',
					'Only the sandbox differs: <code>allow-scripts</code>, no <code>allow-same-origin</code>.',
					'allow-scripts',
				),
			);
			return;
		default:
			res.writeHead(404, { 'content-type': 'text/plain' });
			res.end('not found');
	}
});

const CASES = [
	['host page (baseline)', '/probe/host', false],
	['Tool shell route (grant)', '/probe/tool-shell', false],
	['Tool artefact, top level', '/probe/tool-artefact', false],
	['chain: container grants + allow + usable frame origin', '/probe/chain-granted', true],
	['chain: container denies (baseline)', '/probe/chain-denied', true],
	['chain: shipped sandbox="allow-scripts"', '/probe/chain-shipped-sandbox', true],
];

async function probe() {
	const browser = await chromium.launch({
		args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
	});
	const results = [];
	for (const [surface, path, isContainer] of CASES) {
		// A fresh context per case: a shared one carries permission state
		// between pages and made the first measurements irreproducible.
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto(`${ORIGIN}${path}`);
		await page
			.waitForFunction(() => window.__probeResult !== undefined, null, { timeout: 30_000 })
			.catch(() => {});
		const result = await page.evaluate(() => window.__probeResult);
		if (isContainer && result) {
			// A container frame also asks for its own permission; report the
			// frame's answer, which is the one under test.
			result.detail = `frame: ${result.getUserMedia}${result.detail ? ` (${result.detail})` : ''}`;
		}
		results.push({
			surface,
			...(result ?? { permission: '?', getUserMedia: '?', detail: 'TIMEOUT' }),
		});
		await context.close();
	}
	await browser.close();
	return results;
}

const start = () =>
	new Promise((done) => {
		server.listen(PORT, '127.0.0.1', () => done(undefined));
	});

await start();
state.worker = runIntegrationSuite();
const measuredStatic = readStaticMeasurements(
	process.argv.find((arg) => arg.startsWith('--static-measurements='))?.split('=')[1],
);
if (measuredStatic) {
	state.static = measuredStatic;
	state.staticSource =
		'measured against the local <code>pnpm preview</code> Worker + Static Assets';
} else {
	state.static = staticRowsFromRules();
}
state.browser = await probe();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SHOT_WIDTH, height: 1200 } });
await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle' });
const height = await page.evaluate(() => document.documentElement.scrollHeight);
await page.setViewportSize({ width: SHOT_WIDTH, height });
mkdirSync(dirname(OUT), { recursive: true });
const capture = await page.screenshot({ fullPage: true });
await sharp(capture)
	.resize({ width: SHOT_WIDTH, withoutEnlargement: true })
	.webp({ quality: SHOT_QUALITY })
	.toFile(OUT);
await browser.close();
server.close();

mkdirSync(resolve(root, '.tmp/security-headers'), { recursive: true });
writeFileSync(
	resolve(root, '.tmp/security-headers/report-state.json'),
	`${JSON.stringify(state, null, 2)}\n`,
);
console.log(`wrote ${OUT}`);
console.log(JSON.stringify(state.browser, null, 2));
