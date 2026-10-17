#!/usr/bin/env node
/**
 * Verification-report renderer for the Issue #438 screenshot.
 *
 * Reads the JSON line the session cookie contract test prints
 * (`SESSION_COOKIE_CONTRACT_REPORT …`) and renders it as a static HTML
 * page that a Playwright screenshot captures into
 * `docs/verification/security/cookie-header-test.webp`. Nothing here
 * invents data: every row comes from the report the test computed.
 *
 * Why this script is committed
 * ----------------------------
 * The screenshot is acceptance evidence for Issue #438, so the step
 * that produced it has to be reproducible from the repository rather
 * than from a throwaway file in a developer's `.tmp/`. The redaction
 * rule is NOT implemented here on purpose: it lives in the test, at the
 * moment a raw header enters the evidence map
 * (`maskSetCookieValue`). This script only *verifies* that contract
 * held and refuses to render a payload that violates it — so a test
 * regression can never be laundered into a clean-looking screenshot.
 *
 * Usage:
 *   pnpm exec vitest run src/cloudflare/auth/session-cookie-contract.test.ts \
 *     --reporter=verbose > .tmp/cookie-contract/run.log 2>&1
 *   node scripts/render-session-cookie-report.mjs \
 *     .tmp/cookie-contract/run.log .tmp/cookie-contract/report.html
 *
 * Exit codes: 0 = rendered, 1 = payload rejected, 2 = bad usage.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const MARKER = 'SESSION_COOKIE_CONTRACT_REPORT ';
const [inputPath, outPath] = process.argv.slice(2);
if (!inputPath || !outPath) {
	process.stderr.write('usage: render-session-cookie-report.mjs <run.log> <out.html>\n');
	process.exit(2);
}

const log = readFileSync(inputPath, 'utf8');
const line = log.split('\n').find((candidate) => candidate.includes(MARKER));
if (!line) {
	process.stderr.write(`no ${MARKER} line in ${inputPath}\n`);
	process.exit(1);
}
const payload = JSON.parse(line.slice(line.indexOf(MARKER) + MARKER.length));

/**
 * Refuse to render anything that carries a cookie value. The contract
 * is `name=<masked>` for every stored header; anything else means the
 * test's masking regressed (or was bypassed) and the page would leak a
 * session token and a signed user record into a committed artefact.
 */
function rejectUnmaskedHeaders(cases) {
	for (const entry of cases) {
		for (const header of entry.headers) {
			const match = /^([^=]+)=([^;]*)/.exec(header);
			if (!match || match[2] !== '<masked>') {
				process.stderr.write(
					`refusing to render: case "${entry.id}" carries an unmasked Set-Cookie value\n`,
				);
				process.exit(1);
			}
		}
	}
}

rejectUnmaskedHeaders(payload.cases);

const esc = (value) =>
	String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const show = (value) => {
	if (value === null || value === undefined) return '—';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return esc(value);
};

/**
 * The positive cases are selected by id rather than by
 * `expectation === 'pass'`, because the evidence-safety self-check is
 * also a "pass" entry and must not be counted as an observed response.
 */
const OBSERVED_POSITIVE_IDS = ['local-workerd-sign-in', 'production-shape-fixture'];
const observedPositives = OBSERVED_POSITIVE_IDS.map((id) => {
	const entry = payload.cases.find((candidate) => candidate.id === id);
	if (!entry) {
		process.stderr.write(`payload is missing the "${id}" case\n`);
		process.exit(1);
	}
	return entry;
});
const [localCase, productionCase] = observedPositives;
const negatives = payload.cases.filter((entry) => entry.expectation === 'fail');
const maskingCase = payload.cases.find((entry) => entry.id === 'evidence-masking-self-check');

/** Attribute rows are declared by the test contract, not by the renderer. */
const ATTRIBUTE_ROWS = [
	{ key: 'name', label: 'Cookie name (prefix)' },
	{ key: 'secure', label: 'Secure' },
	{ key: 'httpOnly', label: 'HttpOnly' },
	{ key: 'sameSite', label: 'SameSite' },
	{ key: 'path', label: 'Path' },
	{ key: 'domain', label: 'Domain' },
	{ key: 'maxAge', label: 'Max-Age' },
];

function attributeTable(cookieKey, label) {
	const rows = ATTRIBUTE_ROWS.map((row) => {
		const cells = [localCase, productionCase].map((entry) => {
			const cookie = entry.cookies.find((candidate) => candidate.name.includes(cookieKey));
			return `<td><code>${show(cookie?.[row.key])}</code></td>`;
		});
		return `<tr><th scope="row">${row.label}</th>${cells.join('')}</tr>`;
	}).join('\n');

	const bothPass =
		observedPositives.length === 2 &&
		observedPositives.every((entry) => entry.violations.length === 0);
	return `<h3>${esc(label)}</h3>
<table>
<thead><tr><th scope="col">Attribute</th><th scope="col">local workerd sign-in (http profile)</th><th scope="col">production shape (https profile)</th></tr></thead>
<tbody>
${rows}
</tbody>
<tfoot><tr><td colspan="3" class="${bothPass ? 'ok' : 'bad'}">${bothPass ? 'contract satisfied — 0 violations' : 'violations reported'}</td></tr></tfoot>
</table>`;
}

const negativeRows = negatives
	.map((entry) => {
		const codes = entry.violations.map((violation) => violation.code).join(', ');
		const headers = entry.headers.map((header) => `<code>${esc(header)}</code>`).join('<br>');
		return `<tr>
<td><code>${esc(entry.id)}</code><span class="sub">${esc(entry.kind)} · ${esc(entry.profile)} profile</span></td>
<td>${headers || '<span class="sub">no Set-Cookie header in the response</span>'}</td>
<td>${show(codes)}</td>
<td class="bad">FAIL as expected</td>
</tr>`;
	})
	.join('\n');

/**
 * The self-check case proves the redaction on a header whose value is
 * an unmistakable credential placeholder, so the screenshot shows the
 * rule being applied rather than only being claimed.
 */
const maskingSection = maskingCase
	? `<h2>3. Evidence masking — a raw header entering the report</h2>
<table>
<thead><tr><th scope="col">Set-Cookie handed to the evidence map</th><th scope="col">Stored in the emitted payload</th></tr></thead>
<tbody>
<tr>
<td><code>${esc(maskingCase.id)}</code></td>
<td><code>${esc(maskingCase.headers.join(''))}</code></td>
</tr>
</tbody>
<tfoot><tr><td colspan="2" class="ok">value replaced by <code>&lt;masked&gt;</code> — attributes preserved, credential discarded</td></tr></tfoot>
</table>`
	: '';

const html = `<!doctype html>
<html lang="ja">
<meta charset="utf-8" />
<title>Session cookie attribute contract — Issue #438</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 40px 48px;
    font: 14px/1.55 ui-sans-serif, -apple-system, "Helvetica Neue", "Hiragino Sans", "Noto Sans JP", sans-serif;
    color: #14161a; background: #fbfbfa;
  }
  main { max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; margin: 36px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #d9d8d4; }
  h3 { font-size: 14px; margin: 20px 0 8px; color: #4a4f57; font-weight: 600; }
  p.sub, .sub { color: #6b7280; font-size: 12.5px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #f1f0ee; padding: 1px 5px; border-radius: 4px; }
  dl { display: grid; grid-template-columns: 260px 1fr; gap: 6px 16px; margin: 0; }
  dt { color: #6b7280; }
  dd { margin: 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #d9d8d4; padding: 7px 10px; text-align: left; vertical-align: top; }
  thead th { background: #f1f0ee; font-weight: 600; }
  tbody th { font-weight: 500; background: #fafaf9; white-space: nowrap; }
  tfoot td { background: #fafaf9; font-weight: 600; }
  .ok { color: #0f7b46; }
  .bad { color: #b3261e; font-weight: 600; }
  .note { margin-top: 34px; border-top: 1px solid #d9d8d4; padding-top: 12px; color: #4a4f57; font-size: 12.5px; }
</style>
<main>
<h1>Session cookie attribute contract — Issue #438</h1>
<p class="sub">generated from a real test run — the JSON line the contract test prints</p>

<dl>
  <dt>Environment</dt><dd>${esc(payload.origin)}</dd>
  <dt>Local profile</dt><dd>${esc(payload.profiles.local.id)} — Secure ${show(payload.profiles.local.secure)}, name prefix “${esc(payload.profiles.local.namePrefix || '(none)')}”</dd>
  <dt>Production profile</dt><dd>${esc(payload.profiles.production.id)} — Secure ${show(payload.profiles.production.secure)}, name prefix “${esc(payload.profiles.production.namePrefix)}”</dd>
  <dt>Production request issued</dt><dd>none — the production shape is computed locally from the pinned origin constant</dd>
  <dt>Account exercised</dt><dd>local-only fixture user <code>session-contract-admin@test.local</code> (role <code>admin</code>, Miniflare D1, rows deleted after the run); no real account and no production data</dd>
</dl>

<h2>1. Positive — observed attributes (must pass)</h2>
${attributeTable('session_token', 'session_token (session credential)')}
${attributeTable('session_data', 'session_data (cookie cache: signed user record)')}

<h2>2. Negative — a rejected sign-in and forged fixtures (must fail)</h2>
<table>
<thead><tr><th scope="col">Case</th><th scope="col">Set-Cookie seen by the evaluator (value masked)</th><th scope="col">Violation codes</th><th scope="col">Result</th></tr></thead>
<tbody>
${negativeRows}
</tbody>
</table>
${maskingSection}

<div class="note">
Reproduce: <code>pnpm exec vitest run src/cloudflare/auth/session-cookie-contract.test.ts --reporter=verbose</code> — the evaluator drops cookie values at parse time and <code>record()</code> masks every header it keeps, so this report (and the CI log) cannot contain a session token or a user record. No secret value and no personal information is read or printed by this check.
</div>
</main>
</html>
`;

writeFileSync(outPath, html);
process.stdout.write(
	`rendered ${negatives.length} negative cases and ${observedPositives.length} observed positive cases -> ${outPath}\n`,
);
