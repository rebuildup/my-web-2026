import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	HTTP_STATUS_EXPECTATIONS,
	checkProofWiring,
	checkRouteCoverage,
	evaluateObservation,
	observeResponse,
	openDecisions,
	robotsStateFromHtml,
	summarize,
	surfaceFromHtml,
} from './_seo-status-contract.mjs';

/**
 * Unit tests for the SEO HTTP status contract (Issue #419).
 *
 * The runtime half of the contract is proved over the real Worker in
 * `test/integration/seo-status-contract.test.ts`; this file pins the
 * evaluator itself, because a gate whose comparison logic is never
 * exercised in isolation fails in the one direction that matters: a
 * mismatch that the evaluator silently ignores.
 */

const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

function html(...parts) {
	return `<!DOCTYPE html><html><head>${parts.join('')}</head><body><h1>x</h1></body></html>`;
}

const ROBOTS_NOINDEX = '<meta name="robots" content="noindex, nofollow"/>';

test('robotsStateFromHtml distinguishes absent, noindex and other directives', () => {
	assert.equal(robotsStateFromHtml(html()), 'absent');
	assert.equal(robotsStateFromHtml(html('<meta name="robots" content="noindex"/>')), 'noindex');
	assert.equal(
		robotsStateFromHtml(html('<meta name="robots" content="noindex, nofollow"/>')),
		'noindex',
	);
	// A robots meta that says something else must not be folded into
	// "not noindex": it is its own state so it can be reported.
	assert.equal(robotsStateFromHtml(html('<meta name="robots" content="nofollow"/>')), 'declared');
	assert.equal(robotsStateFromHtml(undefined), 'absent');
});

test('surfaceFromHtml reads the shipped failure markers and nothing else', () => {
	assert.equal(surfaceFromHtml(html()), 'page');
	assert.equal(surfaceFromHtml(html('<div data-error-state="not_found">')), 'not_found');
	assert.equal(
		surfaceFromHtml(html('<div data-error-state="service_unavailable">')),
		'service_unavailable',
	);
	assert.equal(surfaceFromHtml(html('<section data-testid="tools-not-found">')), 'tools_not_found');
	// A document that merely mentions the words is not a failure surface.
	assert.equal(surfaceFromHtml('<p>not_found</p>'), 'page');
});

test('observeResponse reads a redirect as a redirect, not as an empty page', () => {
	const response = new Response(null, { status: 307, headers: { location: '/admin/login' } });
	assert.deepEqual(observeResponse(response, ''), {
		status: 307,
		location: '/admin/login',
		robots: 'not-applicable',
		surface: 'redirect',
	});
});

test('evaluateObservation accepts a matching observation', () => {
	const published = HTTP_STATUS_EXPECTATIONS.find((entry) => entry.id === 'portfolio-published');
	assert.deepEqual(
		evaluateObservation(published, { status: 200, html: html() }),
		[],
		'a published project row renders an ordinary indexable page',
	);
});

test('evaluateObservation rejects the 誤200 the Issue exists for', () => {
	const draft = HTTP_STATUS_EXPECTATIONS.find((entry) => entry.id === 'portfolio-draft-not-found');
	// The failure: an unpublished row answers 200 to a crawler.
	const violations = evaluateObservation(draft, { status: 200, html: html() });
	assert.deepEqual(
		violations.map((violation) => violation.code),
		['status-mismatch', 'surface-mismatch'],
	);
	// …and it must not be able to pass by also dropping the failure surface:
	// a 200 with no robots meta is exactly the response that would be indexed.
	const indexed = evaluateObservation(draft, { status: 200, robots: 'absent', surface: 'page' });
	assert.deepEqual(
		indexed.map((violation) => violation.code),
		['status-mismatch', 'surface-mismatch'],
	);
});

test('evaluateObservation rejects an indexable failure document', () => {
	const unmatched = HTTP_STATUS_EXPECTATIONS.find(
		(entry) => entry.id === 'unmatched-route-not-found',
	);
	const violations = evaluateObservation(unmatched, {
		status: 404,
		robots: 'noindex',
		surface: 'not_found',
	});
	assert.deepEqual(
		violations.map((violation) => violation.code),
		['robots-mismatch'],
		'a noindex added to a failure document is a contract change, not a silent pass',
	);
});

test('a redirect row accepts any redirect but requires the login Location', () => {
	const admin = HTTP_STATUS_EXPECTATIONS.find((entry) => entry.id === 'admin-anonymous-redirect');
	for (const status of REDIRECT_STATUSES) {
		assert.deepEqual(evaluateObservation(admin, { status, location: '/admin/login' }), []);
	}
	const elsewhere = evaluateObservation(admin, { status: 307, location: '/somewhere-else' });
	assert.deepEqual(
		elsewhere.map((violation) => violation.code),
		['location-mismatch'],
	);
	// A redirect row is the one place a 200 must fail.
	assert.ok(evaluateObservation(admin, { status: 200, location: null }).length > 0);
});

test('a machine row is judged on status only', () => {
	const signin = HTTP_STATUS_EXPECTATIONS.find((entry) => entry.id === 'admin-signin-rejected');
	assert.deepEqual(evaluateObservation(signin, { status: 401 }), []);
	assert.deepEqual(
		evaluateObservation(signin, { status: 200 }).map((violation) => violation.code),
		['status-mismatch'],
	);
});

test('an observation with no status is itself a violation', () => {
	const entry = HTTP_STATUS_EXPECTATIONS[0];
	assert.deepEqual(
		evaluateObservation(entry, {}).map((violation) => violation.code),
		['observation-missing'],
	);
});

test('checkRouteCoverage fails on a route nobody classified', () => {
	const violations = checkRouteCoverage(
		['/portfolio', '/new-unreviewed-route'],
		[{ id: 'portfolio-published', route: '/portfolio' }],
	);
	assert.deepEqual(
		violations.map((violation) => violation.code),
		['unclassified-route'],
	);
});

test('checkRouteCoverage fails on a row whose route no longer exists', () => {
	const violations = checkRouteCoverage(
		['/portfolio'],
		[
			{ id: 'portfolio-published', route: '/portfolio' },
			{ id: 'deleted-route', route: '/portfolio/removed' },
		],
	);
	assert.deepEqual(
		violations.map((violation) => violation.code),
		['stale-case'],
	);
});

test('non-route markers are exempt from coverage in both directions', () => {
	// `(unmatched)` is not a route of the tree, so it is neither
	// required to be covered nor reported as stale.
	assert.deepEqual(
		checkRouteCoverage(
			['/portfolio'],
			[
				{ id: 'portfolio-published', route: '/portfolio' },
				{ id: 'unmatched-route-not-found', route: '(unmatched)' },
			],
		),
		[],
	);
});

test('checkProofWiring fails on a missing file and on an uncited case', () => {
	const violations = checkProofWiring(
		[
			{
				id: 'case-a',
				route: '/',
				proves: [{ layer: 'workerd', file: 'test/integration/exists.test.ts' }],
			},
			{
				id: 'case-b',
				route: '/',
				proves: [{ layer: 'workerd', file: 'test/integration/missing.test.ts' }],
			},
		],
		{ 'test/integration/exists.test.ts': "it('case-b', …)" },
	);
	assert.deepEqual(
		violations.map((violation) => violation.code),
		['unproven-case', 'unproven-case'],
	);
});

test('the shipped matrix is non-empty, uniquely keyed, and shape-valid', () => {
	assert.ok(HTTP_STATUS_EXPECTATIONS.length >= 20);
	const ids = HTTP_STATUS_EXPECTATIONS.map((entry) => entry.id);
	assert.equal(new Set(ids).size, ids.length, 'case ids must be unique');
	for (const entry of HTTP_STATUS_EXPECTATIONS) {
		assert.ok(entry.why.length > 20, `${entry.id} needs a reason`);
		assert.ok(entry.proves.length >= 1, `${entry.id} needs at least one proof`);
		for (const proof of entry.proves) {
			assert.ok(['workerd', 'browser'].includes(proof.layer), `${entry.id} proof layer`);
		}
		if (entry.expect.surface !== 'machine') {
			assert.ok(entry.expect.surface.length > 0, `${entry.id} needs a surface`);
		}
	}
});

test('open decisions are recorded, not silently tolerated', () => {
	const open = openDecisions();
	assert.ok(open.length >= 3, 'the known-imperfect rows must stay visible');
	for (const entry of open) {
		assert.match(entry.openDecision, /error-state-gallery\.md §7/);
	}
	const { cases, open: openCount } = summarize();
	assert.equal(cases, HTTP_STATUS_EXPECTATIONS.length);
	assert.equal(openCount, open.length);
});
