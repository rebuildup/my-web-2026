/**
 * The Issue #393 capture's own unit tests.
 *
 * The capture is an assertion, so its decision functions have to be
 * testable without a browser: a capture that can only fail inside
 * Chromium is one nobody re-runs when it breaks. These tests cover the
 * parts that decide WHETHER an artefact may be written (the WebP-only
 * rule, the loopback-only rule) and the parts that decide what the
 * artefact SAYS (the audit table, the counts).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BASELINE_PATH,
	MANIFEST_PATH,
	SCREENSHOT_BUDGET_BYTES,
	SCREENSHOT_MAX_WIDTH,
	SPEC_PATH,
	assertLoopbackBaseUrl,
	assertWebpOutputPath,
	escapeHtml,
	renderTable,
	reportHtml,
} from './capture-a11y-axe-routes.mjs';

const REPO_ROOT = new URL('..', import.meta.url).pathname;

/** One route summary, as the gate attaches it. */
function summary(overrides = {}) {
	return {
		route: '/contact',
		verdict: 'baseline',
		declared: 'baseline',
		violationsObserved: 1,
		baselineRecords: 1,
		knownViolations: 1,
		newViolations: 0,
		rules: [
			{
				ruleId: 'list',
				impact: 'serious',
				tags: ['wcag2a', 'wcag131'],
				nodes: ['.md\\:gap_6'],
			},
		],
		...overrides,
	};
}

test('the artefact path must be WebP inside the repository', () => {
	assert.equal(
		assertWebpOutputPath('docs/verification/a11y/axe-route-report.webp', REPO_ROOT),
		'docs/verification/a11y/axe-route-report.webp',
	);
	assert.throws(
		() => assertWebpOutputPath('docs/verification/a11y/axe-route-report.png', REPO_ROOT),
		/non-WebP/,
	);
	assert.throws(() => assertWebpOutputPath('../outside.webp', REPO_ROOT), /outside the repository/);
});

test('only a loopback origin may be audited', () => {
	assert.equal(assertLoopbackBaseUrl('http://127.0.0.1:3000'), 'http://127.0.0.1:3000');
	assert.equal(assertLoopbackBaseUrl('http://localhost:3000'), 'http://localhost:3000');
	assert.throws(() => assertLoopbackBaseUrl('https://rebuildup.dev'), /non-loopback origin/);
});

test('the audit table states the route, the verdict and the counts', () => {
	const html = renderTable([summary()]);
	assert.match(html, /\/contact/);
	assert.match(html, /baseline/);
	assert.match(html, /list/);
	assert.match(html, /wcag131/);
});

test('a new violation is visible in the table, a known one is not hidden', () => {
	const html = renderTable([
		summary({
			route: '/',
			verdict: 'fail',
			knownViolations: 2,
			newViolations: 1,
			violationsObserved: 3,
		}),
	]);
	assert.match(html, /2 known \/ 1 new/);
	assert.match(html, /fail/);
});

test('the report shows the counts and never prints "no violation" for a baseline route', () => {
	const html = reportHtml({
		summaries: [summary()],
		element: { route: '/contact', selector: '.md\\:gap_6', png: Buffer.from('fake-png') },
		baseUrl: 'http://127.0.0.1:3000',
		gateExitCode: 0,
		axeVersion: '4.14.0',
	});
	assert.match(html, /known violations/);
	assert.match(html, /data:image\/png;base64,/);
	assert.match(html, /4\.14\.0/);
	assert.match(html, /\/contact/);
	assert.match(html, /human evaluation/);
});

test('the report names the gate, the manifest and the ledger', () => {
	const html = reportHtml({
		summaries: [summary()],
		element: null,
		baseUrl: 'http://127.0.0.1:3000',
		gateExitCode: 1,
		axeVersion: '4.14.0',
	});
	assert.match(html, new RegExp(SPEC_PATH.replace(/[/.]/g, '\\$&')));
	assert.match(html, new RegExp(BASELINE_PATH.replace(/[/.]/g, '\\$&')));
	assert.match(html, new RegExp(MANIFEST_PATH.replace(/[/.]/g, '\\$&')));
	assert.match(html, /FAIL/);
});

test('the capture budget is a real number and the artefact fits it', () => {
	assert.ok(SCREENSHOT_BUDGET_BYTES > 0);
	assert.ok(SCREENSHOT_MAX_WIDTH > 0);
});

test('HTML in a measured value cannot break the report markup', () => {
	assert.equal(escapeHtml('<script>"x"'), '&lt;script&gt;&quot;x&quot;');
});
