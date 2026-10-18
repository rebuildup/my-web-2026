/**
 * Static-asset half of the cache-policy contract (Issue #484).
 *
 * The runtime half lives in `test/integration/cache-policy-matrix.test.ts`
 * and drives the real Worker through `SELF.fetch`. This file covers the
 * half no test can reach: `public/_headers` is read by Cloudflare
 * Workers Static Assets at DEPLOY time and by `vite preview` locally —
 * the Worker bundle never sees it, and no amount of `SELF.fetch` can
 * observe a rule in it. Reading the file is therefore the only
 * available evidence, and reading it by hand is how the policy drifted
 * in the first place: Issue #291 added the immutable rule with a
 * measured before/after, and nothing since has checked that the rule
 * still matches what the rest of the site assumes.
 *
 * The contract asserted here:
 *
 *   1. Fingerprinted build assets under `/assets/*` are declared
 *      immutable for at least a year — that is the whole reason Vite
 *      content-hashes their filenames.
 *   2. Mutable static artefacts (stable URL, changing bytes: `/share/**`,
 *      `/tools/<slug>/app/**`) are NOT declared immutable. A URL that
 *      outlives its bytes must never promise one year of freshness;
 *      that is the classic "users stuck on a stale build" bug.
 *   3. The declaration matches `scripts/_cache-policy.mjs`, the one
 *      table the runtime half is checked against — so the two halves
 *      cannot describe different worlds.
 *   4. The accepted matrix keeps fingerprinted assets and dynamically
 *      rendered pages on DIFFERENT policies (acceptance criterion 1),
 *      stated as an executable invariant rather than a comment.
 *
 * Run: `node --test scripts/cache-policy.test.mjs` (wired into
 * `pnpm run test`, so it is part of `validate:fast`).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	CACHE_POLICY_MATRIX,
	IMMUTABLE_ASSET_MAX_AGE_SECONDS,
	duplicateHeaderValues,
	effectiveHeaders,
	matchesPattern,
	parseCacheControl,
	parseHeadersFile,
	policyById,
	separationViolations,
} from './_cache-policy.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEADERS_FILE = resolve(REPO_ROOT, 'public', '_headers');

const rules = parseHeadersFile(readFileSync(HEADERS_FILE, 'utf8'));

/** The `Cache-Control` a concrete path would receive, or `null`. */
function cacheControlFor(pathname) {
	return effectiveHeaders(rules, pathname).get('cache-control') ?? null;
}

test('the _headers file parses into rules with at least one header each', () => {
	assert.ok(rules.length > 0, 'public/_headers produced no rules — the parser or the file broke');
	for (const rule of rules) {
		assert.ok(rule.pattern.startsWith('/'), `rule pattern must be a path: ${rule.pattern}`);
		assert.ok(rule.headers.length > 0, `rule ${rule.pattern} declares no header`);
	}
});

test('fingerprinted build assets are declared immutable for a year', () => {
	const declared = cacheControlFor('/assets/index-B5Hb0lCH.js');
	assert.ok(
		declared,
		'/assets/* declares no Cache-Control — every chunk revalidates on every visit',
	);

	const parsed = parseCacheControl(declared);
	assert.ok(parsed.immutable, `expected "immutable" in "${declared}"`);
	assert.ok(
		parsed.maxAge !== null && parsed.maxAge >= IMMUTABLE_ASSET_MAX_AGE_SECONDS,
		`expected max-age >= ${IMMUTABLE_ASSET_MAX_AGE_SECONDS} (52 weeks), got ${parsed.maxAge}`,
	);
});

test('the _headers declaration matches the canonical matrix', () => {
	const declared = cacheControlFor('/assets/index-B5Hb0lCH.js');
	const expected = policyById('immutable-build-asset').cacheControl;
	assert.equal(
		declared?.toLowerCase(),
		expected.toLowerCase(),
		'public/_headers and scripts/_cache-policy.mjs disagree about the asset policy',
	);
});

test('mutable static artefacts are not declared immutable', () => {
	// `/share/**` keeps a stable URL whose bytes change per deploy, and a
	// Tool bundle keeps the stable entry URL `app/index.html`. Neither may
	// claim one year of freshness; both are expected to fall through to the
	// Static Assets default (`public, max-age=0, must-revalidate`), which
	// means NO Cache-Control in `_headers` at all.
	for (const sample of ['/share/procon2026/index.html', '/tools/prototype/app/index.html']) {
		const declared = cacheControlFor(sample);
		if (declared === null) continue; // falls through to the platform default — correct
		const parsed = parseCacheControl(declared);
		assert.ok(
			!parsed.immutable,
			`${sample} is declared immutable ("${declared}") but its URL outlives its bytes`,
		);
		assert.notEqual(parsed.maxAge, IMMUTABLE_ASSET_MAX_AGE_SECONDS);
	}
});

test('pattern matching follows the Cloudflare subset the file uses', () => {
	assert.ok(matchesPattern('/assets/*', '/assets/index-abc.js'));
	assert.ok(matchesPattern('/assets/*', '/assets/nested/deep.js'));
	assert.ok(matchesPattern('/tools/:slug/app/*', '/tools/prototype/app/assets/x.js'));
	assert.ok(!matchesPattern('/assets/*', '/share/x.js'));
	assert.ok(!matchesPattern('/tools/:slug/app', '/tools/prototype/other'));
	// A parameter consumes exactly one segment.
	assert.ok(!matchesPattern('/tools/:slug/app', '/tools/a/b/app'));
});

test('every matrix row names an owner and the check that enforces it', () => {
	for (const row of CACHE_POLICY_MATRIX) {
		assert.ok(row.owner.length > 0, `${row.id} has no owner`);
		assert.ok(row.enforcedBy.length > 0, `${row.id} is not enforced by anything`);
		assert.ok(
			['etag', 'none'].includes(row.validator),
			`${row.id} declares validator "${row.validator}"`,
		);
	}
});

test('acceptance criterion 1: immutable assets and personal pages differ', () => {
	assert.deepEqual(
		separationViolations(),
		[],
		'a fingerprinted asset shares its policy with another class — one of the two is wrong',
	);

	// Spelled out as well, so the intent survives a table edit: the two
	// values a reader checks by eye.
	const asset = policyById('immutable-build-asset');
	const page = policyById('personal-page');
	assert.ok(asset.cacheControl.includes('immutable'));
	assert.ok(!page.cacheControl.includes('immutable'));
	assert.ok(parseCacheControl(page.cacheControl).noCache);
});

test('matching rules COMBINE a header instead of the last one winning', () => {
	// `public/_headers` records the measurement that settled this: with a
	// `/*` rule and a `:slug` rule both setting the header, the response
	// carried both values. Last-rule-wins would let this test read one
	// rule and call the contract intact while the response a visitor
	// receives carries a concatenation nobody asserted.
	const overlapping = parseHeadersFile(
		[
			'/*',
			'\tCache-Control: public, max-age=0, must-revalidate',
			'/assets/*',
			'\tCache-Control: public, max-age=31556952, immutable',
		].join('\n'),
	);
	assert.equal(
		effectiveHeaders(overlapping, '/assets/app.js').get('cache-control'),
		'public, max-age=0, must-revalidate, public, max-age=31556952, immutable',
	);
	// A path only the broad rule matches is unaffected.
	assert.equal(
		effectiveHeaders(overlapping, '/share/procon2026/index.html').get('cache-control'),
		'public, max-age=0, must-revalidate',
	);
});

test('identical duplicate values are not concatenated twice', () => {
	// Issue #448 states `frame-ancestors 'self'` on every Tool rule on
	// purpose; repeating the same token changes nothing.
	const repeated = parseHeadersFile(
		[
			'/tools/:slug/app/*',
			"\tContent-Security-Policy: frame-ancestors 'self'",
			'/tools/:slug/app',
			"\tContent-Security-Policy: frame-ancestors 'self'",
		].join('\n'),
	);
	assert.equal(
		effectiveHeaders(repeated, '/tools/prototype/app').get('content-security-policy'),
		"frame-ancestors 'self'",
	);
	assert.deepEqual(duplicateHeaderValues(repeated, '/tools/prototype/app'), []);
});

test('a differing duplicate is reported, so the collision is attributable', () => {
	// A concatenated `Cache-Control` is ambiguous rather than obvious:
	// `parseCacheControl` reads whichever `max-age` comes last and reports
	// a number no rule declares. Naming the pair of rules keeps the
	// failure attributable.
	const overlapping = parseHeadersFile(
		[
			'/assets/*',
			'\tCache-Control: public, max-age=31556952, immutable',
			'/*',
			'\tCache-Control: public, max-age=0, must-revalidate',
		].join('\n'),
	);
	const duplicates = duplicateHeaderValues(overlapping, '/assets/app.js');
	assert.equal(duplicates.length, 1);
	assert.equal(duplicates[0].name, 'cache-control');
	assert.equal(duplicates[0].patterns.length, 2);
	// Order of the rules must not change the verdict.
	const reversed = duplicateHeaderValues(
		parseHeadersFile(
			[
				'/*',
				'\tCache-Control: public, max-age=0, must-revalidate',
				'/assets/*',
				'\tCache-Control: public, max-age=31556952, immutable',
			].join('\n'),
		),
		'/assets/app.js',
	);
	assert.equal(reversed.length, 1);
	assert.deepEqual(reversed[0].values.slice().sort(), duplicates[0].values.slice().sort());
});

test('the shipped _headers never sets Cache-Control twice for one path', () => {
	// The acceptance evidence reads `effectiveHeaders`; if two matching
	// rules disagreed about the asset policy the value it compares against
	// the matrix would be a concatenation. Checked over the paths the
	// measurement tool actually probes.
	for (const sample of [
		'/assets/index-B5Hb0lCH.js',
		'/favicon.svg',
		'/share/procon2026/index.html',
		'/tools/prototype/app/index.html',
	]) {
		const collisions = duplicateHeaderValues(rules, sample).filter(
			(collision) => collision.name === 'cache-control',
		);
		assert.deepEqual(
			collisions,
			[],
			`${sample} receives Cache-Control from ${collisions[0]?.patterns.join(' and ')}`,
		);
	}
});
