#!/usr/bin/env node
/**
 * redirect-validation-report — regenerate the Issue #454 verification
 * screenshot from the shipped guard itself.
 *
 * What it measures
 * ----------------
 * Every row is produced by running a real `Request` through the real
 * `redirectTargetGuard` middleware (`src/http/security/redirect-guard.ts`)
 * mounted on a bare Hono app, and by running the real
 * `classifyRedirectTarget` (`src/http/security/redirect.ts`) with the
 * policy `/admin/login` uses. The status codes and reason codes in the
 * report are responses and verdicts of the shipped code, not a
 * hand-written table.
 *
 * The report is also a *safety* artefact: the requests it sends target
 * `https://evil.example` as a **string only** — nothing is fetched
 * from it, no credential is used, and the process makes no outbound
 * network request other than the Playwright browser that renders the
 * local HTML.
 *
 * Usage:
 *   node scripts/redirect-validation-report.mjs [outFile] [--html dumpPath]
 *
 * Default outFile: docs/verification/security/redirect-validation.png
 *
 * `--html` additionally writes the report markup, which is what the
 * PNG renders — useful for reviewing the matrix without an image
 * viewer. The run fails if any response is neither 200 nor a
 * `400 invalid_redirect_target`, or if the rendered page overflows
 * horizontally (a clipped column would make the report misleading).
 *
 * The mounted behaviour at `/api/v1/auth/*` (the same middleware in
 * front of the real Better Auth handler, through the real Worker
 * entry) is asserted by `src/http/security/redirect-guard.test.ts`;
 * this script exists so the matrix can be *read*, not just trusted.
 */

import { mkdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { Hono } from 'hono';

// `src/http/security/redirect-guard.ts` imports its sibling with the
// bundler-style extensionless specifier the Worker build uses
// (`./redirect`). Node's ESM resolver wants the extension, so the
// extension is filled in here rather than by changing the source to a
// specifier only this script needs. `registerHooks` (Node >= 22.15,
// satisfied by the repo's `engines.node >= 22.18`) keeps this in the
// same thread; no loader thread is spawned.
registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
				return nextResolve(`${specifier}.ts`, context);
			}
			throw error;
		}
	},
});

const { classifyRedirectTarget } = await import('../src/http/security/redirect.ts');
const { redirectTargetGuard } = await import('../src/http/security/redirect-guard.ts');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const htmlFlagIndex = argv.indexOf('--html');
const htmlDump =
	htmlFlagIndex === -1
		? null
		: resolve(ROOT, argv[htmlFlagIndex + 1] ?? '.tmp/redirect-validation.html');
const positional = argv.filter(
	(value, index) => index !== htmlFlagIndex && index !== htmlFlagIndex + 1,
);
const OUT = resolve(ROOT, positional[0] ?? 'docs/verification/security/redirect-validation.png');

/** The canonical production origin (ADR-0014). Used here only as a
 *  trusted-origin configuration value — no request is sent to it. */
const CANONICAL_ORIGIN = 'https://rebuildup.dev';

/** Mirrors `RETURN_TO_PREFIXES` in `src/routes/admin.login.tsx`. */
const LOGIN_POLICY = { allowedPrefixes: ['/admin'] };

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

/** Visible stand-ins for characters that would be invisible (or would
 *  break the report's own HTML) inside a table cell. */
function showValue(value) {
	return value
		.replaceAll('\u200b', '<zwsp>')
		.replaceAll('\u00ad', '<shy>')
		.replaceAll('\r', '<cr>')
		.replaceAll('\n', '<lf>')
		.replaceAll('\t', '<tab>');
}

function guardedApp() {
	const app = new Hono();
	app.use('/api/v1/auth/*', redirectTargetGuard({ trustedOrigins: [CANONICAL_ORIGIN] }));
	// Stands in for `auth.handler`: the guard must decide before any
	// handler runs, so reaching this response means the target passed.
	app.all('/api/v1/auth/*', (c) => c.json({ handler: 'better-auth' }));
	return app;
}

const APP = guardedApp();

/** @type {{group: string, label: string, param: string, value: string, encoding: 'query'|'json'|'form'}[]} */
const CASES = [
	{
		group: 'Accepted — internal path',
		label: 'post-sign-in return target (the login screen form)',
		param: 'callbackURL',
		value: '/admin/keys?tab=recent#list',
		encoding: 'form',
	},
	{
		group: 'Accepted — internal path',
		label: 'plain admin path',
		param: 'returnTo',
		value: '/admin',
		encoding: 'query',
	},
	{
		group: 'Accepted — internal path',
		label: 'percent-encoded separators, decoded to an internal path',
		param: 'returnTo',
		value: '%2Fadmin%2Finvitations',
		encoding: 'query',
	},
	{
		group: 'Accepted — internal path',
		label: 'same-origin absolute URL on a trusted origin, downgraded to its path',
		param: 'callbackURL',
		value: 'https://rebuildup.dev/admin',
		encoding: 'json',
	},
	{
		group: 'Refused — leaves the origin',
		label: 'absolute external URL',
		param: 'callbackURL',
		value: 'https://evil.example/login',
		encoding: 'json',
	},
	{
		group: 'Refused — leaves the origin',
		label: 'trusted origin as a prefix of an attacker host',
		param: 'callbackURL',
		value: 'https://rebuildup.dev.evil.example/',
		encoding: 'json',
	},
	{
		group: 'Refused — leaves the origin',
		label: 'userinfo trick (trusted host as userinfo)',
		param: 'callbackURL',
		value: 'https://rebuildup.dev@evil.example/',
		encoding: 'json',
	},
	{
		group: 'Refused — leaves the origin',
		label: 'scheme-relative authority',
		param: 'returnTo',
		value: '//evil.example/admin',
		encoding: 'query',
	},
	{
		group: 'Refused — leaves the origin',
		label: 'backslash authority (browsers read \\ as /)',
		param: 'returnTo',
		value: '/\\evil.example',
		encoding: 'query',
	},
	{
		group: 'Refused — encoded authority',
		label: 'single-encoded scheme-relative authority',
		param: 'callbackURL',
		value: '%2F%2Fevil.example',
		encoding: 'form',
	},
	{
		group: 'Refused — encoded authority',
		label: 'double-encoded scheme-relative authority',
		param: 'callbackURL',
		value: '%252F%252Fevil.example',
		encoding: 'json',
	},
	{
		group: 'Refused — encoded authority',
		label: 'encoded backslash authority',
		param: 'returnTo',
		value: '%2F%5Cevil.example',
		encoding: 'query',
	},
	{
		group: 'Refused — active scheme',
		label: 'javascript: URL',
		param: 'callbackURL',
		value: 'javascript:alert(1)',
		encoding: 'json',
	},
	{
		group: 'Refused — active scheme',
		label: 'data: URL',
		param: 'callbackURL',
		value: 'data:text/html,<script>alert(1)</script>',
		encoding: 'json',
	},
	{
		group: 'Refused — active scheme',
		label: 'scheme hidden behind one encoding layer',
		param: 'callbackURL',
		value: 'javascript%3Aalert(1)',
		encoding: 'form',
	},
	{
		group: 'Refused — not a path at all',
		label: 'path without a leading slash (resolves against the current page)',
		param: 'returnTo',
		value: 'admin/keys',
		encoding: 'query',
	},
	{
		group: 'Refused — not a path at all',
		label: 'traversal without a leading slash',
		param: 'returnTo',
		value: '../admin',
		encoding: 'query',
	},
	{
		group: 'Refused — parser-differential input',
		label: 'CRLF header-splitting attempt',
		param: 'callbackURL',
		value: '/admin\r\nSet-Cookie: a=b',
		encoding: 'json',
	},
	{
		group: 'Refused — parser-differential input',
		label: 'zero-width space before an authority',
		param: 'returnTo',
		value: '/\u200b/evil.example',
		encoding: 'query',
	},
	{
		group: 'Refused — parser-differential input',
		label: 'malformed percent-encoding',
		param: 'callbackURL',
		value: '/admin?x=%zz',
		encoding: 'json',
	},
	{
		group: 'Refused — parser-differential input',
		label: 'nested encoding past the decode budget',
		param: 'callbackURL',
		value: '%2525252F%2525252Fevil.example',
		encoding: 'json',
	},
];

function buildRequest(testCase) {
	const url = new URL(`${CANONICAL_ORIGIN}/api/v1/auth/sign-in/email`);
	if (testCase.encoding === 'query') {
		url.searchParams.set(testCase.param, testCase.value);
		return new Request(url, { method: 'GET' });
	}
	if (testCase.encoding === 'form') {
		return new Request(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				email: 'demo@example.test',
				password: 'not-a-real-password',
				[testCase.param]: testCase.value,
			}).toString(),
		});
	}
	return new Request(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			email: 'demo@example.test',
			password: 'not-a-real-password',
			[testCase.param]: testCase.value,
		}),
	});
}

const rows = [];
for (const testCase of CASES) {
	const response = await APP.fetch(buildRequest(testCase));
	const body = await response.json();
	const decision = classifyRedirectTarget(testCase.value, {
		trustedOrigins: [CANONICAL_ORIGIN],
	});
	rows.push({
		...testCase,
		status: response.status,
		body,
		decision,
	});
}

const refusedCount = rows.filter((row) => row.status === 400).length;
const acceptedCount = rows.length - refusedCount;
const failures = rows.filter(
	(row) =>
		(row.status === 400 && row.body.error !== 'invalid_redirect_target') ||
		(row.status !== 400 && row.status !== 200),
);

// The login screen's own decision, for the same inputs — this is the
// projection `/admin/login` renders (loader → hidden `callbackURL`).
const loginRows = rows.map((row) => {
	const decision = classifyRedirectTarget(row.value, LOGIN_POLICY);
	return { ...row, login: decision };
});

function renderRow(row) {
	const refused = row.status === 400;
	const outcome = refused ? 'refused' : 'accepted';
	const verdict = refused ? escapeHtml(String(row.body.reason)) : escapeHtml(row.decision.redirect);
	return `<tr class="${outcome}">
		<td class="group">${escapeHtml(row.group)}</td>
		<td>
			<div class="label">${escapeHtml(row.label)}</div>
			<div class="value">${escapeHtml(showValue(row.param))}=${escapeHtml(showValue(row.value))}</div>
			<div class="meta">${escapeHtml(row.encoding)}</div>
		</td>
		<td><span class="pill ${outcome}">${row.status}</span></td>
		<td class="verdict">${verdict}</td>
		<td class="login">${row.login.ok ? escapeHtml(row.login.redirect) : `/admin <span class="muted">(${escapeHtml(row.login.reason)})</span>`}</td>
	</tr>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>redirect validation — Issue #454</title>
<style>
	:root { color-scheme: light; }
	* { box-sizing: border-box; }
	body {
		margin: 0; padding: 32px 36px 40px;
		background: #fbfaf8; color: #14110f;
		font-family: ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
		font-size: 13px; line-height: 1.5;
	}
	h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
	h2 { font-size: 14px; margin: 28px 0 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #5c554e; }
	.sub { color: #5c554e; margin: 0 0 6px; }
	.meta-line { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #857c73; }
	.summary { display: flex; gap: 10px; margin: 18px 0 6px; flex-wrap: wrap; }
	.stat { border: 1px solid #e3ded6; background: #fff; border-radius: 8px; padding: 10px 14px; min-width: 132px; }
	.stat .n { font-size: 20px; font-weight: 650; }
	.stat .k { font-size: 11px; color: #6b625a; text-transform: uppercase; letter-spacing: 0.06em; }
	table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e3ded6; border-radius: 8px; overflow: hidden; }
	th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b625a; background: #f4f1ec; padding: 8px 10px; border-bottom: 1px solid #e3ded6; }
	td { padding: 8px 10px; border-bottom: 1px solid #f0ece5; vertical-align: top; }
	tr:last-child td { border-bottom: none; }
	td.group { white-space: nowrap; color: #6b625a; font-size: 11px; }
	.label { font-weight: 600; }
	.value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: #14110f; word-break: break-all; }
	.meta { font-size: 10.5px; color: #857c73; }
	.pill { display: inline-block; min-width: 38px; text-align: center; border-radius: 999px; padding: 2px 8px; font-weight: 650; font-size: 11.5px; }
	.pill.accepted { background: #e6f4ea; color: #1a6b39; }
	.pill.refused { background: #fdeaea; color: #a32020; }
	.verdict, .login { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; white-space: nowrap; }
	.muted { color: #857c73; }
	.legend { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
	.legend div { border: 1px solid #e3ded6; background: #fff; border-radius: 8px; padding: 12px 14px; }
	.legend h3 { margin: 0 0 6px; font-size: 13px; }
	.legend p { margin: 0; color: #443d37; }
	code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f0ece5; border-radius: 4px; padding: 1px 4px; font-size: 11.5px; }
	.note { color: #5c554e; margin: 8px 0 0; }
</style>
</head>
<body>
	<h1>Open-redirect validation — redirect targets</h1>
	<p class="sub">Every row is a real request through the shipped <code>redirectTargetGuard</code> (<code>src/http/security/redirect-guard.ts</code>) mounted on <code>/api/v1/auth/*</code>. Issue #454.</p>
	<p class="meta-line">trustedOrigins = [${CANONICAL_ORIGIN}] · evil.example appears as a string only; no request is sent off-origin and no credential is used.</p>

	<div class="summary">
		<div class="stat"><div class="n">${rows.length}</div><div class="k">targets exercised</div></div>
		<div class="stat"><div class="n">${acceptedCount}</div><div class="k">accepted (internal)</div></div>
		<div class="stat"><div class="n">${refusedCount}</div><div class="k">refused (400)</div></div>
		<div class="stat"><div class="n">${failures.length === 0 ? '0' : failures.length}</div><div class="k">unexpected responses</div></div>
	</div>

	<table>
		<thead>
			<tr>
				<th>Shape</th>
				<th>Input</th>
				<th>HTTP</th>
				<th>Guard verdict</th>
				<th>/admin/login returnTo</th>
			</tr>
		</thead>
		<tbody>
			${loginRows.map(renderRow).join('\n')}
		</tbody>
	</table>

	<h2>What the two outcomes mean</h2>
	<div class="legend">
		<div>
			<h3>Accepted → <code>200</code> and the request continues</h3>
			<p>The target is an internal absolute path, or an absolute URL on a trusted origin that the guard rewrote to its path. The request then reaches the handler, which applies its own rules (Better Auth still validates <code>callbackURL</code> against <code>trustedOrigins</code>). The last column shows what the value resolves to.</p>
		</div>
		<div>
			<h3>Refused → <code>400 invalid_redirect_target</code></h3>
			<p>The target would leave the origin, hide an authority behind encoding, or is not a path at all. The request is refused before any handler runs, and the response carries the parameter name and a stable reason code — never the submitted value, so the body is safe to log. <code>/admin/login</code> applies the same rules and falls back to <code>/admin</code> with a visible notice.</p>
		</div>
	</div>
	<p class="note">Regenerate with <code>node scripts/redirect-validation-report.mjs</code>. The mounted-against-Better-Auth version of this matrix is asserted by <code>src/http/security/redirect-guard.test.ts</code> in the workerd suite.</p>
</body>
</html>`;

await mkdir(dirname(OUT), { recursive: true });

if (failures.length > 0) {
	process.stderr.write(
		`redirect-validation-report: ${failures.length} unexpected response(s):\n${failures
			.map((row) => `  - ${row.param}=${showValue(row.value)} -> ${row.status}`)
			.join('\n')}\n`,
	);
	process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const overflow = await page.evaluate(
	// `clientWidth` (not `innerWidth`) excludes the vertical scrollbar,
	// so a full-page capture never reports a false overflow.
	() => document.documentElement.scrollWidth - document.documentElement.clientWidth > 1,
);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();

if (htmlDump) {
	await mkdir(dirname(htmlDump), { recursive: true });
	const { writeFile } = await import('node:fs/promises');
	await writeFile(htmlDump, html, 'utf8');
}

if (overflow) {
	process.stderr.write(
		'redirect-validation-report: the rendered report overflows horizontally — a column is clipped, which would make the PNG misleading.\n',
	);
	process.exit(1);
}

process.stdout.write(
	`redirect-validation-report: ${acceptedCount} accepted / ${refusedCount} refused -> ${OUT}\n`,
);
