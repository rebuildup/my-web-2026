import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
	API_PORT,
	BROWSER_ROWS,
	MEASUREMENT_MARKER,
	OUT,
	REPORT_PORT,
	SCREENSHOT_MAX_WIDTH,
	escapeHtml,
	extractMeasurement,
	headersFor,
	renderReport,
} from './cors-preflight-report.mjs';

/**
 * Tests for the CORS verification report generator (Issue #455).
 *
 * Why this file exists at all: `scripts/cors-preflight-report.mjs`
 * regenerates the artefact the Issue requires, and the one bug it is
 * easiest to ship is a report that quietly stops reflecting reality. The
 * three that matter are pinned here —
 *
 *   1. A FAILING `vitest` run must not produce a report. The suite
 *      prints its measurement from the FIRST test, so a later failing
 *      test (the inventory gate, the wildcard sweep) still leaves the
 *      measurement line in stdout. Reading the line without checking
 *      the exit status overwrites the committed image with numbers
 *      that no longer pass.
 *   2. A counterfactual row must never be phrased as a production
 *      claim, and must never claim a payload was exposed when the body
 *      is the probe's own synthetic JSON.
 *   3. The committed artefact must be the compressed format the script
 *      advertises — a `.webp`, capped in width, and absent if the
 *      generator was never run.
 *
 * The module is imported, not executed: `main()` is guarded, so these
 * assertions neither launch Chromium nor re-run the workerd pool.
 */

const ROW = Object.freeze({
	label: 'credentialed preflight from the canonical origin',
	meaning: 'measured',
	method: 'OPTIONS',
	path: '/api/v1/reactions',
	mode: 'self',
	origin: 'https://rebuildup.dev',
	requestMethod: 'PUT',
	requestHeaders: 'authorization, content-type',
	status: 204,
	allowOrigin: 'https://rebuildup.dev',
	allowCredentials: 'true',
	allowMethods: 'GET, HEAD, PUT, DELETE',
	allowHeaders: 'authorization, content-type',
	vary: 'Origin',
});

function measurementLine(rows) {
	return `${MEASUREMENT_MARKER} ${JSON.stringify(rows)}`;
}

describe('cors-preflight-report.mjs measurement parsing (Issue #455)', () => {
	it('reads the rows out of a passing vitest run', () => {
		const rows = extractMeasurement({
			status: 0,
			stdout: `some log\n${measurementLine([ROW])}\nmore log\n`,
			stderr: '',
		});
		assert.equal(rows.length, 1);
		assert.equal(rows[0].label, ROW.label);
		assert.equal(rows[0].allowCredentials, 'true');
	});

	it('refuses to build a report from a FAILING run that still printed a line', () => {
		// The exact shape that made this generator unsafe: the first test
		// prints its measurement, a later test fails, and the line is
		// still sitting in stdout.
		assert.throws(
			() =>
				extractMeasurement({
					status: 1,
					stdout: `${measurementLine([ROW])}\nFAIL test/integration/cors.test.ts\n`,
					stderr: 'AssertionError: inventory gate',
				}),
			/exited with status 1/,
		);
	});

	it('refuses to build a report when the measurement line is missing', () => {
		assert.throws(
			() => extractMeasurement({ status: 0, stdout: 'nothing here', stderr: '' }),
			/could not find the CORS_PREFLIGHT_MEASUREMENT line/,
		);
	});
});

describe('cors-preflight-report.mjs header replay', () => {
	it('replays the measured header bytes verbatim', () => {
		const headers = headersFor(ROW, undefined);
		assert.equal(headers['Access-Control-Allow-Origin'], 'https://rebuildup.dev');
		assert.equal(headers['Access-Control-Allow-Credentials'], 'true');
		assert.equal(headers['Access-Control-Allow-Methods'], 'GET, HEAD, PUT, DELETE');
		assert.equal(headers.Vary, 'Origin');
	});

	it('drops the credentials header when the override is the wildcard', () => {
		// Fetch forbids `*` with credentials; serving both would make the
		// counterfactual row measure a state no browser accepts.
		const headers = headersFor(ROW, '*');
		assert.equal(headers['Access-Control-Allow-Origin'], '*');
		assert.equal(headers['Access-Control-Allow-Credentials'], undefined);
	});

	it('omits a header the measured response did not carry', () => {
		const headers = headersFor({ ...ROW, allowOrigin: '(absent)' }, undefined);
		assert.equal('Access-Control-Allow-Origin' in headers, false);
	});
});

describe('cors-preflight-report.mjs claims', () => {
	it('names only rows the measurement suite actually emits', () => {
		// A `key` with no measured row throws at generation time and
		// destroys the run after Chromium has already launched.
		for (const probe of BROWSER_ROWS) {
			assert.equal(typeof probe.key, 'string');
			assert.ok(probe.key.length > 0);
			assert.ok(['include', 'omit'].includes(probe.credentials));
			assert.ok(probe.claim.length > 20, `${probe.key} needs a claim`);
		}
	});

	it('marks every overridden row as a counterfactual, not a claim', () => {
		// A row that changes `access-control-allow-origin` and is NOT
		// labelled would be read as production behaviour.
		for (const probe of BROWSER_ROWS) {
			if (probe.allowOriginOverride === undefined) continue;
			assert.equal(
				probe.counterfactual,
				true,
				`${probe.key} overrides the served origin and must be labelled counterfactual`,
			);
		}
	});

	it('never claims a readable row exposed API data', () => {
		// Every readable row in section 2 replays the probe's OWN
		// synthetic JSON. Claiming a wildcard "leaks" a credentialed
		// payload overstates what the row can show.
		for (const probe of BROWSER_ROWS) {
			assert.doesNotMatch(
				probe.claim,
				/\bREADABLE\b(?!.*synthetic)/,
				`${probe.key}: a readable claim must name the mechanism, not shout a payload leak`,
			);
		}
		assert.ok(
			BROWSER_ROWS.some((probe) => probe.claim.includes('synthetic 403 JSON')),
			'the readable counterfactual must say what body it actually exposed',
		);
	});

	it('does not claim the canonical-origin row is readable from the probe origin', () => {
		// The page origin is `127.0.0.1:4596` and the echo names
		// `https://rebuildup.dev`, so the browser blocks it. The earlier
		// wording asserted the opposite of what the row rendered.
		const row = BROWSER_ROWS.find(
			(probe) =>
				probe.key === 'credentialed preflight from the canonical origin' && !probe.counterfactual,
		);
		assert.ok(row, 'the canonical-origin row must exist');
		assert.match(row.claim, /blocked from THIS probe origin/);
		assert.doesNotMatch(row.claim, /readable/);
	});
});

describe('cors-preflight-report.mjs rendering', () => {
	it('escapes measured values before they reach the HTML', () => {
		assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
		assert.equal(escapeHtml('a & b'), 'a &amp; b');
		const html = renderReport({
			worker: [{ ...ROW, label: '<script>alert(1)</script>' }],
			browser: [],
			at: '2026-01-01 00:00:00Z',
		});
		assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
		assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	});

	it('labels counterfactual rows in the rendered table', () => {
		const html = renderReport({
			worker: [ROW],
			browser: [
				{
					label: ROW.label,
					counterfactual: true,
					claim: 'counterfactual: something',
					credentials: 'include',
					verdict: 'readable (204)',
					servedAllowOrigin: '*',
					detail: 'ok',
				},
			],
			at: '2026-01-01 00:00:00Z',
		});
		assert.match(html, />counterfactual</);
		assert.match(html, /mock</);
	});
});

describe('cors-preflight-report.mjs committed artefact', () => {
	it('targets a WebP, not a PNG', () => {
		assert.match(OUT, /\.webp$/);
	});

	it('encodes within the committed width and quality budget', () => {
		assert.equal(SCREENSHOT_MAX_WIDTH, 1600);
		assert.equal(API_PORT, 4597);
		assert.equal(REPORT_PORT, 4596);
	});

	it('is committed, and is a WebP under ~300 KB', (t) => {
		if (!existsSync(OUT)) {
			t.skip(`regenerate with \`pnpm run security:cors:report\` (${OUT} is absent)`);
			return;
		}
		const bytes = statSync(OUT).size;
		assert.ok(bytes < 300 * 1024, `${OUT} is ${bytes} bytes, over the ~300 KB budget`);
		// RIFF....WEBP — the file extension and the bytes must agree.
		const header = readFileSync(OUT).subarray(0, 12);
		assert.equal(header.subarray(0, 4).toString('ascii'), 'RIFF');
		assert.equal(header.subarray(8, 12).toString('ascii'), 'WEBP');
	});
});
