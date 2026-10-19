import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HTTP_STATUS_EXPECTATIONS, openDecisions } from './_seo-status-contract.mjs';
import {
	captureRows,
	escapeHtml,
	matrixRows,
	reportHtml,
	suiteRows,
} from './_seo-status-report.mjs';

/**
 * Unit tests for the Issue #419 report renderer.
 *
 * The capture itself needs `dist/`, a preview server and chromium; the
 * LAYOUT does not, and the layout is where a report silently starts
 * lying: a row that prints an expectation instead of the observed value,
 * an unescaped path that injects markup, or a verdict column that says
 * MATCH because it never compared anything. Those are pinned here.
 */

const CAPTURES = [
	{
		caseId: 'unmatched-route-not-found',
		path: '/this-route-does-not-exist-419',
		status: 404,
		surface: 'not_found',
		robots: 'absent',
		violations: [],
		pngDataUri: 'data:image/png;base64,AAA',
	},
	{
		caseId: 'portfolio-invalid-query-input-failure',
		path: '/portfolio?facets=a&facets=b',
		status: 500,
		surface: 'not_found',
		robots: 'absent',
		violations: [{ code: 'status-mismatch', message: 'expected status 404, observed 500' }],
		pngDataUri: 'data:image/png;base64,BBB',
	},
];

const ASSERTIONS = [
	{ title: 'public-home', status: 'passed', ms: 12 },
	{ title: 'admin-anonymous-redirect', status: 'failed', ms: 7 },
];

function render(overrides = {}) {
	return reportHtml({
		captures: CAPTURES,
		expectations: HTTP_STATUS_EXPECTATIONS,
		assertions: ASSERTIONS,
		suitePath: 'test/integration/seo-status-contract.test.ts',
		origin: 'http://127.0.0.1:3100',
		...overrides,
	});
}

test('escapeHtml neutralises every character that could break out of markup', () => {
	assert.equal(
		escapeHtml(`<img src=x onerror="alert('x')">&`),
		'&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;',
	);
});

test('a capture row prints the observed values and the evaluator verdict', () => {
	const rows = captureRows(CAPTURES);
	// The MATCH row carries the status, the surface and the robots state
	// that were READ, not the ones the contract hopes for.
	assert.match(rows, /404<\/td>\s*<td>not_found<\/td>\s*<td><code>absent<\/code>/);
	assert.match(rows, /MATCH/);
	// A mismatch is printed with the reason, never silently dropped.
	assert.match(rows, /MISMATCH — expected status 404, observed 500/);
	assert.match(rows, /class="bad"/);
});

test('a capture row embeds the screenshot as a data URI', () => {
	const rows = captureRows(CAPTURES);
	assert.match(rows, /src="data:image\/png;base64,AAA"/);
	assert.match(rows, /<img alt="\/this-route-does-not-exist-419 — 404"/);
});

test('the matrix table renders every declared case, straight from the contract', () => {
	const rows = matrixRows(HTTP_STATUS_EXPECTATIONS);
	for (const entry of HTTP_STATUS_EXPECTATIONS) {
		assert.ok(rows.includes(entry.id), `${entry.id} must appear in the report`);
	}
	// A row with a recorded open decision says so, and exactly as many rows
	// say it as the contract records — a report cannot mark fewer rows
	// imperfect than the contract admits to.
	const openMarkers = rows.match(/open decision \(§7\)/g) ?? [];
	assert.equal(openMarkers.length, openDecisions().length);
	assert.ok(openMarkers.length > 0);
});

test('the suite table prints the real status, never a hard-coded PASS', () => {
	// A red run prints the failing assertion, so a reader can see WHICH one.
	const rows = suiteRows(ASSERTIONS);
	assert.match(rows, /FAILED/);
	assert.match(rows, /class="failed"/);
	assert.match(rows, /admin-anonymous-redirect/);
});

test('a green suite is summarised as one row, not thirty', () => {
	const rows = suiteRows(ASSERTIONS.map((test) => ({ ...test, status: 'passed' })));
	assert.match(rows, /2 assertion\(s\) all passed/);
	assert.match(rows, /class="passed"/);
});

test('the report counts the captures it actually reconciled', () => {
	const html = render();
	// One of two captures matched: the header must say 1/2, not 2/2.
	assert.match(html, /contract match<\/div><div class="v bad">1\/2</);
	// …and the one failing suite assertion must be counted as failed, not
	// rounded into a green summary.
	assert.match(html, /tests<\/div><div class="v">2<\/div>/);
	assert.match(html, /passed<\/div><div class="v ok">1<\/div>/);
	assert.match(html, /failed<\/div><div class="v bad">1<\/div>/);
});

test('the report embeds the screenshot bytes inline (no remote asset)', () => {
	const html = render();
	assert.match(html, /src="data:image\/png;base64,/);
	assert.doesNotMatch(html, /<img[^>]+src="(?!data:)/);
});

test('the report states the local origin it captured from', () => {
	assert.match(render(), /http:\/\/127\.0\.0\.1:3100/);
	// The reproduction command belongs in the artefact, not only in the PR.
	assert.match(render(), /pnpm run capture:seo-status/);
});

test('an injected path cannot become markup in the report', () => {
	const html = render({
		captures: [
			{
				...CAPTURES[0],
				path: '/x"><script>alert(1)</script>',
				pngDataUri: 'data:image/png;base64,AAA',
			},
		],
	});
	assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
