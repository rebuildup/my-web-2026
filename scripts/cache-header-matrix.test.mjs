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
import test from 'node:test';
import { evaluateObservation, policyById } from './_cache-policy.mjs';
import {
	buildTargets,
	environmentBlock,
	escapeHtml,
	toHtml,
	toMarkdown,
} from './cache-header-matrix.mjs';

const ASSET = { path: '/assets/index-B5Hb0lCH.js', source: 'dist/client/assets', candidates: 12 };

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
		cacheControl: policyById('api-json').cacheControl,
		etag: null,
		vary: null,
		revalidation: 'no validator sent',
		ok: false,
		problems: ['Cache-Control is "public, max-age=60", expected "no-store"'],
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
	assert.match(html, /every measured response carries its declared Cache-Control<\/td><td class="fail">FAIL \(1\)/);
	assert.match(
		html,
		/the immutable asset policy belongs to no other class<\/td><td class="ok">PASS/,
	);
	// The skipped row is counted, never folded into the pass total.
	assert.match(html, /1 SKIPPED/);
});

test('the environment block never reports a clean tree it did not check', () => {
	const block = environmentBlock('http://127.0.0.1:3000', null);
	assert.ok(['clean', 'dirty'].includes(block.workingTree));
	assert.match(block.runtime, /^Node v/);
	assert.ok(block.cpu.length > 0);
});
