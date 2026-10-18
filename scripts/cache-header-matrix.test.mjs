/**
 * Unit coverage for the cache-header measurement tool (Issue #484).
 *
 * The tool itself needs a running server and a Chromium download, so
 * only its PURE half is tested here: which targets it probes, how it
 * renders the report, and how the environment block is shaped. Those
 * are the parts that decide whether a report is reproducible and
 * readable — the parts a reviewer depends on — and they are exactly the
 * parts a later refactor would quietly break.
 *
 * The network half is covered where it can be: the policies it observes
 * are pinned by `scripts/cache-policy.test.mjs` (Static Assets) and
 * `test/integration/cache-policy-matrix.test.ts` (Worker responses).
 *
 * Run: `node --test scripts/cache-header-matrix.test.mjs` (wired into
 * `pnpm run test`).
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { evaluateObservation, policyById } from './_cache-policy.mjs';
import {
	PROBE_TIMEOUT_MS,
	assessBrowserObservation,
	assessRow,
	buildTargets,
	environmentBlock,
	escapeHtml,
	isBrowserProbeCandidate,
	probe,
	resolveProbeUrl,
	toHtml,
	toMarkdown,
	unmeasuredRequiredClasses,
} from './cache-header-matrix.mjs';

const ASSET = { path: '/assets/index-B5Hb0lCH.js', source: 'dist/client/assets', candidates: 12 };

test('a trailing slash in --base-url does not change the probed pathname', () => {
	// String concatenation produced `//favicon.svg`, which the Worker
	// treats as a different path than the contract names — while
	// Chromium navigated to `/favicon.svg`, creating a false
	// Node-vs-browser disagreement.
	const withSlash = resolveProbeUrl('http://127.0.0.1:3000/', '/favicon.svg');
	const withoutSlash = resolveProbeUrl('http://127.0.0.1:3000', '/favicon.svg');
	assert.equal(withSlash, 'http://127.0.0.1:3000/favicon.svg');
	assert.equal(new URL(withSlash).pathname, '/favicon.svg');
	assert.equal(withSlash, withoutSlash);
});

test('every matrix class is probed at least once', () => {
	const targets = buildTargets(ASSET);
	const ids = new Set(targets.map((target) => target.id));
	for (const id of [
		'immutable-build-asset',
		'mutable-static-asset',
		'reaction-image',
		'personal-page',
		'admin-page',
		'api-json',
	]) {
		assert.ok(ids.has(id), `no target for class ${id}`);
	}
});

test('an absent build produces a skipped target, never a silent pass', () => {
	const targets = buildTargets(null);
	const asset = targets.find((target) => target.id === 'immutable-build-asset');
	assert.equal(asset.path, null);
	assert.match(asset.note, /build/);
});

test('the reaction-image row explains why it is skipped instead of disappearing', () => {
	const targets = buildTargets(ASSET);
	const row = targets.find((target) => target.id === 'reaction-image');
	assert.equal(row.path, null);
	assert.match(row.note, /test\/integration\/reactions-images\.test\.ts/);
});

test('evaluation flags a Worker response that claims a validator', () => {
	const verdict = evaluateObservation({
		id: 'personal-page',
		status: 200,
		cacheControl: 'no-cache',
		etag: '"deadbeef"',
		vary: null,
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /unexpected ETag/);
});

test('evaluation flags a response that varies per user but is storable', () => {
	const verdict = evaluateObservation({
		id: 'immutable-build-asset',
		status: 200,
		cacheControl: 'public, max-age=31556952, immutable',
		etag: '"deadbeef"',
		vary: 'Cookie',
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /user-specific/);
});

test('a correct observation evaluates clean', () => {
	const verdict = evaluateObservation({
		id: 'personal-page',
		status: 200,
		cacheControl: policyById('personal-page').cacheControl,
		etag: null,
		vary: null,
	});
	assert.deepEqual(verdict, { ok: true, problems: [] });
});

test('a declared Vary token that the response omits fails the row', () => {
	// `admin-page` and `api-json` declare `Vary: Cookie, Authorization`.
	// A proxy that strips the header must be a failure, not a clean row.
	const verdict = evaluateObservation({
		id: 'api-json',
		status: 200,
		cacheControl: policyById('api-json').cacheControl,
		etag: null,
		vary: null,
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Vary .* expected to include "cookie"/);
});

test('a 404 on a representative admin path is not a measured success', () => {
	// Right headers on a missing route are not evidence that the
	// admin surface exists; `--verify` must not count it.
	const verdict = evaluateObservation({
		id: 'admin-page',
		status: 404,
		cacheControl: policyById('admin-page').cacheControl,
		etag: null,
		vary: 'Cookie, Authorization',
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /status 404/);
});

const ENVIRONMENT = environmentBlock('http://127.0.0.1:3000', '141.0.7390.0');
const ROWS = [
	{
		id: 'immutable-build-asset',
		path: '/assets/index-B5Hb0lCH.js',
		status: 200,
		cacheControl: policyById('immutable-build-asset').cacheControl,
		etag: '"7b5cc500ffc7c1439a50578c25494f28"',
		vary: 'Accept-Encoding',
		revalidation: '304 Not Modified',
		ok: true,
		problems: [],
		skipped: false,
	},
	{
		id: 'api-json',
		path: '/api/v1/health',
		status: 200,
		// Deliberately NOT the declared value: the row's `problems` and
		// its `cacheControl` must describe the same failure, or a test
		// would be asserting against two different worlds.
		cacheControl: 'public, max-age=60',
		etag: null,
		vary: null,
		revalidation: 'no validator sent',
		ok: false,
		problems: ['Cache-Control is "public, max-age=60", expected "private, no-store"'],
		skipped: false,
	},
	{
		id: 'reaction-image',
		path: null,
		status: null,
		skipped: true,
		note: 'needs a stored reaction image id',
		ok: false,
		problems: [],
	},
];

/** One clean measured row per class `--verify` requires (see REQUIRED_MEASURED_CLASSES). */
const REQUIRED_ROWS = [
	{
		id: 'immutable-build-asset',
		path: '/assets/index-B5Hb0lCH.js',
		status: 200,
		cacheControl: policyById('immutable-build-asset').cacheControl,
		etag: '"abc"',
		vary: 'Origin',
		revalidation: '304 Not Modified',
		ok: true,
		problems: [],
		skipped: false,
	},
	{
		id: 'mutable-static-asset',
		path: '/favicon.svg',
		status: 200,
		cacheControl: policyById('mutable-static-asset').cacheControl,
		etag: '"abc"',
		vary: 'Origin',
		revalidation: '304 Not Modified',
		ok: true,
		problems: [],
		skipped: false,
	},
	{
		id: 'personal-page',
		path: '/contact',
		status: 200,
		cacheControl: policyById('personal-page').cacheControl,
		etag: null,
		vary: 'Origin',
		revalidation: 'no validator sent',
		ok: true,
		problems: [],
		skipped: false,
	},
	{
		id: 'admin-page',
		path: '/admin/login',
		status: 200,
		cacheControl: policyById('admin-page').cacheControl,
		etag: null,
		vary: 'Origin',
		revalidation: 'no validator sent',
		ok: true,
		problems: [],
		skipped: false,
	},
	{
		id: 'api-json',
		path: '/api/v1/health',
		status: 200,
		cacheControl: policyById('api-json').cacheControl,
		etag: null,
		vary: 'Origin',
		revalidation: 'no validator sent',
		ok: true,
		problems: [],
		skipped: false,
	},
];

test('the markdown report names every row and its verdict', () => {
	const markdown = toMarkdown(ROWS, ENVIRONMENT);
	assert.match(markdown, /\| class \| path \| status \| Cache-Control \|/);
	assert.match(markdown, /immutable-build-asset/);
	assert.match(markdown, /\| api-json \| .*\| FAIL \(1\) \|/);
	// A skipped row must be visible as SKIPPED, not omitted.
	assert.match(markdown, /\| reaction-image \| — \| — \| — \| — \| — \| — \| SKIPPED \|/);
});

test('the markdown report carries the reproducibility block', () => {
	const markdown = toMarkdown(ROWS, ENVIRONMENT);
	for (const field of ['source SHA', 'browser', 'network', 'cpu', 'platform', 'measured at']) {
		assert.ok(markdown.includes(field), `report is missing the ${field} condition`);
	}
	assert.match(ENVIRONMENT.sourceSha, /^[0-9a-f]{40}$|^unknown$/);
	assert.match(ENVIRONMENT.browser, /Chromium/);
	assert.match(ENVIRONMENT.network, /loopback/);
});

test('the HTML report is self-contained and escapes what it prints', () => {
	const html = toHtml(ROWS, ENVIRONMENT);
	assert.match(html, /^<!doctype html>/);
	assert.ok(!html.includes('<script'), 'the report must not need JavaScript to be read');
	assert.match(html, /Measurement conditions/);
	assert.match(html, /FAIL/);
	assert.match(html, /SKIPPED/);
	assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
});

test('the HTML report states the pass criteria and their result', () => {
	const html = toHtml(ROWS, ENVIRONMENT);
	assert.match(html, /Pass criteria/);
	// One failing row in ROWS, so criterion 1 must report a failure and
	// criterion 2 must still pass (no row reuses the asset policy).
	assert.match(
		html,
		/every measured response carries its declared Cache-Control<\/td><td class="fail">FAIL \(1 of 2\)/,
	);
	assert.match(
		html,
		/the immutable asset policy belongs to no other class<\/td><td class="ok">PASS/,
	);
	// The skipped row is counted, never folded into the pass total.
	assert.match(html, /1 SKIPPED/);
});

/**
 * A pass criterion that cannot fail is not a criterion: it prints PASS
 * over a contract it never measured, which is exactly the gap between
 * "the tool judges this" and "the tool prints PASS here". Each case
 * below is one criterion driven to FAIL by a synthetic row.
 */
const CLEAN_HEADERS = { ok: true, problems: [] };

function criterionRow(html, criterion) {
	const row = new RegExp(`${criterion}</td><td class="(?:ok|fail)">([^<]*)<`);
	const match = row.exec(html);
	assert.ok(match, `criterion "${criterion}" is missing from the report`);
	return { text: match[1], ok: match[0].includes('class="ok"') };
}

test('criterion 3 fails when a validator class does not answer 304', () => {
	const html = toHtml(
		[
			{
				id: 'immutable-build-asset',
				path: '/assets/index-B5Hb0lCH.js',
				status: 200,
				cacheControl: policyById('immutable-build-asset').cacheControl,
				etag: '"abc"',
				vary: null,
				// The bytes were re-sent in full despite a matching validator.
				revalidation: '200',
				ok: false,
				problems: [],
				skipped: false,
			},
		],
		ENVIRONMENT,
	);
	const criterion = criterionRow(
		html,
		'dynamic classes offer no validator; asset classes answer 304',
	);
	assert.equal(criterion.ok, false);
	assert.match(criterion.text, /did not answer 304/);
});

test('criterion 3 fails when a dynamic class offers a validator', () => {
	const html = toHtml(
		[
			{
				id: 'personal-page',
				path: '/contact',
				status: 200,
				cacheControl: policyById('personal-page').cacheControl,
				etag: '"abc"',
				vary: null,
				revalidation: '304 Not Modified',
				ok: false,
				problems: ['unexpected ETag'],
				skipped: false,
			},
		],
		ENVIRONMENT,
	);
	const criterion = criterionRow(
		html,
		'dynamic classes offer no validator; asset classes answer 304',
	);
	assert.equal(criterion.ok, false);
	assert.match(criterion.text, /unexpected validator/);
});

test('criterion 3 passes when the conditional request answered 304', () => {
	const html = toHtml(ROWS, ENVIRONMENT);
	const criterion = criterionRow(
		html,
		'dynamic classes offer no validator; asset classes answer 304',
	);
	assert.equal(criterion.ok, true);
	assert.match(criterion.text, /asset rows answered 304/);
});

test('criterion 4 fails when a storable response varies on Cookie', () => {
	const html = toHtml(
		[
			{
				id: 'immutable-build-asset',
				path: '/assets/index-B5Hb0lCH.js',
				status: 200,
				cacheControl: policyById('immutable-build-asset').cacheControl,
				etag: '"abc"',
				vary: 'Cookie',
				revalidation: '304 Not Modified',
				ok: false,
				problems: ['user-specific'],
				skipped: false,
			},
		],
		ENVIRONMENT,
	);
	const criterion = criterionRow(html, 'no storable response varies on Cookie / Authorization');
	assert.equal(criterion.ok, false);
	assert.match(criterion.text, /FAIL \(1\)/);
});

test('criterion 5 fails when a skipped row states no reason', () => {
	const html = toHtml(
		[
			{
				id: 'personal-page',
				path: '/contact',
				status: 200,
				cacheControl: policyById('personal-page').cacheControl,
				etag: null,
				vary: null,
				revalidation: 'no validator sent',
				ok: true,
				problems: [],
				skipped: false,
			},
			{
				id: 'reaction-image',
				path: null,
				status: null,
				skipped: true,
				ok: false,
				problems: [],
			},
		],
		ENVIRONMENT,
	);
	const criterion = criterionRow(
		html,
		'rows this environment cannot produce are SKIPPED, never counted as passes',
	);
	assert.equal(criterion.ok, false);
	assert.match(criterion.text, /without a reason/);
});

test('a run that measured nothing reports NOT MEASURED instead of five PASSes', () => {
	// The shape a wrong `--base-url` or a stopped server takes: every
	// probe throws, every row becomes a SKIPPED, and "no violation was
	// found" is trivially true of an empty set.
	const html = toHtml(
		[
			{
				id: 'personal-page',
				path: '/contact',
				status: null,
				skipped: true,
				note: 'probe failed: fetch failed',
				ok: false,
				problems: [],
			},
		],
		ENVIRONMENT,
	);
	assert.doesNotMatch(html, /class="ok">PASS/);
	assert.equal(html.match(/NOT MEASURED/g)?.length, 6);
});

test('a validator that is never revalidated is a row problem, not a footnote', () => {
	const headers = CLEAN_HEADERS;
	const revalidated = assessRow({ etag: '"abc"', revalidation: '304 Not Modified' }, headers);
	assert.deepEqual(revalidated, CLEAN_HEADERS);
	const ignored = assessRow({ etag: '"abc"', revalidation: '200' }, headers);
	assert.equal(ignored.ok, false);
	assert.match(ignored.problems.join(' '), /If-None-Match was answered with 200/);
	// A class with no validator sends no conditional request, which is
	// correct and must not be reported.
	const noValidator = assessRow({ etag: null, revalidation: 'no validator sent' }, headers);
	assert.deepEqual(noValidator, CLEAN_HEADERS);
	// Header problems from `evaluateObservation` are carried through.
	const carried = assessRow(
		{ etag: null, revalidation: 'no validator sent' },
		{
			ok: false,
			problems: ['no Cache-Control'],
		},
	);
	assert.equal(carried.ok, false);
	assert.deepEqual(carried.problems, ['no Cache-Control']);
});

test('a redirect row is observed in Chromium, not skipped', () => {
	// `page.goto()` follows the 3xx, but Playwright emits
	// `page.on('response')` for the redirect response itself before
	// issuing the follow-up request, and the observation map is keyed by
	// pathname. Skipping the row would leave a browser-side middleware or
	// proxy free to change the redirect's Cache-Control with nothing
	// checking it.
	const html = toHtml(
		[
			{
				id: 'admin-page',
				path: '/admin',
				status: 307,
				cacheControl: policyById('admin-page').cacheControl,
				etag: null,
				vary: 'Cookie, Authorization',
				revalidation: 'no validator sent',
				ok: true,
				problems: [],
				skipped: false,
				browser: {
					status: 307,
					cacheControl: policyById('admin-page').cacheControl,
					etag: null,
					vary: 'Cookie, Authorization',
				},
			},
		],
		ENVIRONMENT,
	);
	assert.doesNotMatch(html, /not probed in Chromium/);
	// The 307 observed by the browser is compared like any other row and
	// rendered with its own status and headers.
	assert.match(html, /<span class="ok">ok<\/span>/);
	assert.match(html, /Chromium observed:/);
});

test('a redirect row whose browser observation disagrees fails the row', () => {
	// The gap this close: a proxy that only affects the browser changes
	// the redirect's policy, and nothing looks.
	const row = {
		id: 'admin-page',
		path: '/admin',
		status: 307,
		cacheControl: policyById('admin-page').cacheControl,
		etag: null,
	};
	const verdict = assessBrowserObservation(row, {
		status: 307,
		cacheControl: 'public, max-age=3600',
		etag: null,
		vary: 'Cookie, Authorization',
	});
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Chromium received Cache-Control/);
});

test('a matching 307 observation adds no problem', () => {
	const verdict = assessBrowserObservation(
		{
			id: 'admin-page',
			path: '/admin',
			status: 307,
			cacheControl: policyById('admin-page').cacheControl,
			etag: null,
		},
		{
			status: 307,
			cacheControl: policyById('admin-page').cacheControl,
			etag: null,
			vary: 'Cookie, Authorization',
		},
	);
	assert.deepEqual(verdict, { ok: true, problems: [] });
});

test('the environment block never reports a clean tree it did not check', () => {
	const block = environmentBlock('http://127.0.0.1:3000', null);
	assert.ok(['clean', 'dirty'].includes(block.workingTree));
	assert.match(block.runtime, /^Node v/);
	assert.ok(block.cpu.length > 0);
});

test('a browser observation that contradicts the declared class fails the row', () => {
	// Printing the disagreement next to a green `ok` is the failure mode:
	// the report would state two different policies for one URL.
	const verdict = assessBrowserObservation(
		{
			id: 'personal-page',
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
		},
		{ cacheControl: 'public, max-age=31556952, immutable', etag: '"deadbeef"', vary: 'Origin' },
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Chromium received Cache-Control/);
	assert.match(verdict.problems.join(' '), /received an ETag where the HTTP observer did not/);
});

test('a browser observation that contradicts the HTTP observer fails the row', () => {
	// Same declared value, but the two observers read different
	// deployments — the single most useful thing this tool can report.
	const verdict = assessBrowserObservation(
		{
			id: 'mutable-static-asset',
			cacheControl: 'public, max-age=0, must-revalidate',
			etag: '"abc"',
		},
		{ cacheControl: 'public, max-age=300', etag: '"abc"', vary: 'Origin' },
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /disagreement between the two observers/);
});

test('a user-specific Vary seen only by the browser fails the row', () => {
	const verdict = assessBrowserObservation(
		{
			id: 'immutable-build-asset',
			cacheControl: policyById('immutable-build-asset').cacheControl,
			etag: '"abc"',
		},
		{
			cacheControl: policyById('immutable-build-asset').cacheControl,
			etag: '"abc"',
			vary: 'Accept-Encoding, Cookie',
		},
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Vary: cookie"?, which is user-specific/);
});

test('a user-specific Vary on a never-stored response is documentation, not a violation', () => {
	// Issue #460 declares `Vary: Cookie, Authorization` together with
	// `private, no-store` on the external boundary. The directive cannot
	// make a stored body safe, but on a response that is never stored it
	// is the legible signal for intermediaries that ignore `private`, so
	// both observers must agree that it is not a violation.
	const row = { id: 'api-json', cacheControl: policyById('api-json').cacheControl, etag: null };
	const observation = {
		cacheControl: policyById('api-json').cacheControl,
		etag: null,
		vary: 'Cookie, Authorization',
	};
	assert.deepEqual(assessBrowserObservation(row, observation), { ok: true, problems: [] });
	assert.deepEqual(evaluateObservation({ ...observation, id: 'api-json', status: 200 }), {
		ok: true,
		problems: [],
	});
});

test('a browser that received no Cache-Control at all fails the row', () => {
	// The gap this closes: with an empty observation the two comparisons
	// used to be skipped, so an environment where only Chromium loses the
	// header stayed green and `--verify` exited 0.
	const verdict = assessBrowserObservation(
		{
			id: 'personal-page',
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
		},
		{ cacheControl: null, etag: null, vary: null },
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Chromium received no Cache-Control, expected/);
	assert.match(verdict.problems.join(' '), /disagreement between the two observers/);
});

test('a missing Cache-Control in both observers still fails, once', () => {
	// Both observers agree that nothing arrived — there is no
	// disagreement to report, but the class still owes a value, so the
	// row must fail on the expected-value half alone.
	const verdict = assessBrowserObservation(
		{ id: 'personal-page', cacheControl: null, etag: null },
		{ cacheControl: null, etag: null, vary: null },
	);
	assert.equal(verdict.ok, false);
	assert.deepEqual(verdict.problems, [
		`Chromium received no Cache-Control, expected "${policyById('personal-page').cacheControl}"`,
	]);
});

test('a navigation error fails the row instead of being dropped', () => {
	const verdict = assessBrowserObservation(
		{
			id: 'personal-page',
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
			browserError: 'net::ERR_CONNECTION_REFUSED',
		},
		null,
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Chromium could not load this URL/);
});

test('an agreeing browser observation adds no problem', () => {
	const verdict = assessBrowserObservation(
		{
			id: 'personal-page',
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
		},
		{ cacheControl: policyById('personal-page').cacheControl, etag: null, vary: 'Origin' },
	);
	assert.deepEqual(verdict, { ok: true, problems: [] });
	// `--no-browser`, and a redirect row the browser follows: nothing was
	// observed, so nothing was contradicted.
	assert.deepEqual(assessBrowserObservation({ id: 'admin-page', cacheControl: 'no-store' }, null), {
		ok: true,
		problems: [],
	});
});

test('a browser HTTP error status fails the row even when the headers match', () => {
	// `page.goto()` does not reject on an HTTP error, and an error page
	// carries the same `no-cache` / `private, no-store` the class declares.
	// Without the status check this observation is `ok: true` and
	// `--verify` exits 0 on a browser that never rendered the class.
	const verdict = assessBrowserObservation(
		{
			id: 'personal-page',
			status: 200,
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
		},
		{
			status: 500,
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
			vary: 'Origin',
		},
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Chromium received server error 500/);
});

test('a browser status that differs from the HTTP observer without being 5xx fails the row', () => {
	// Same disagreement as a header mismatch, on the status code: the two
	// observers answered the same URL differently.
	const verdict = assessBrowserObservation(
		{
			id: 'personal-page',
			status: 200,
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
		},
		{
			status: 404,
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
			vary: 'Origin',
		},
	);
	assert.equal(verdict.ok, false);
	assert.match(verdict.problems.join(' '), /Chromium received status 404/);
});

test('a browser status matching the HTTP observer adds no problem', () => {
	const verdict = assessBrowserObservation(
		{
			id: 'personal-page',
			status: 200,
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
		},
		{
			status: 200,
			cacheControl: policyById('personal-page').cacheControl,
			etag: null,
			vary: 'Origin',
		},
	);
	assert.deepEqual(verdict, { ok: true, problems: [] });
});

test('a run that skipped every Worker-owned class does not verify anything', () => {
	// The subtler version of a dead `--base-url`: Static Assets still
	// answer `/favicon.svg` while the Worker returns 5xx, so at least one
	// row IS measured — and none of the classes this tool exists to check
	// are among them.
	const rows = [
		{
			id: 'mutable-static-asset',
			path: '/favicon.svg',
			status: 200,
			cacheControl: policyById('mutable-static-asset').cacheControl,
			etag: '"abc"',
			vary: 'Origin',
			revalidation: '304 Not Modified',
			ok: true,
			problems: [],
			skipped: false,
		},
		{
			id: 'personal-page',
			path: '/contact',
			status: 503,
			skipped: true,
			note: 'server error 503 — this environment could not render the class',
			ok: false,
			problems: [],
		},
	];
	assert.deepEqual(unmeasuredRequiredClasses(rows), [
		'immutable-build-asset',
		'personal-page',
		'admin-page',
		'api-json',
	]);
	const criterion = criterionRow(
		toHtml(rows, ENVIRONMENT),
		'every class that needs no fixture was actually measured',
	);
	assert.equal(criterion.ok, false);
	assert.match(criterion.text, /not measured: immutable-build-asset, personal-page/);
});

test('the fixture image class is not required: no local probe can produce it', () => {
	assert.deepEqual(
		unmeasuredRequiredClasses([
			...REQUIRED_ROWS,
			{
				id: 'reaction-image',
				path: null,
				status: null,
				skipped: true,
				note: 'no fixture',
				ok: false,
			},
		]),
		[],
	);
});

test('a server that never answers makes probe abort rather than hang', async () => {
	// Pinned precisely: a server that never sends headers, a budget of
	// 200ms, and no tolerance for a probe that is still pending.
	const sockets = new Set();
	const server = createServer((request, response) => sockets.add(response));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		const baseUrl = `http://127.0.0.1:${server.address().port}`;
		const started = Date.now();
		const outcome = await probe(
			baseUrl,
			{ id: 'immutable-build-asset', path: '/assets/app.js' },
			200,
		).then(
			(row) => `resolved ${row.status}`,
			(error) => error.name,
		);
		assert.equal(outcome, 'TimeoutError');
		assert.ok(Date.now() - started < 5_000, `probe took ${Date.now() - started}ms to abort`);
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise((resolve) => server.close(resolve));
	}
});

test('a redirect row is a browser-probe candidate', () => {
	// The branch that used to skip 3xx rows: `page.goto()` follows the
	// redirect, but Playwright emits `page.on('response')` for the 3xx
	// itself, so skipping it would leave a browser-side proxy free to
	// change the redirect's Cache-Control with nothing checking.
	assert.equal(
		isBrowserProbeCandidate({ id: 'admin-page', path: '/admin', status: 307, skipped: false }),
		true,
	);
	assert.equal(
		isBrowserProbeCandidate({ id: 'admin-page', path: '/admin', status: 200, skipped: false }),
		true,
	);
	// A skipped row has no response to observe, and a target without a
	// path was never a URL.
	assert.equal(isBrowserProbeCandidate({ id: 'reaction-image', path: null, skipped: true }), false);
	assert.equal(isBrowserProbeCandidate({ id: 'reaction-image', path: '', skipped: false }), false);
});
