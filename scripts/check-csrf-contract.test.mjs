/**
 * `scripts/check-csrf-contract.mjs` rules (Issue #440).
 *
 * The gate itself only inspects the real repository; these tests run
 * the same `collectViolations` against synthetic trees so each rule is
 * proven to fire (and, just as importantly, to stay quiet) without
 * touching the working tree.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectViolations, stripComments } from './check-csrf-contract.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Build a fixture tree that satisfies the contract, so each test only
 * has to introduce the ONE violation it is about.
 */
function makeFixture(overrides = {}) {
	const root = mkdtempSync(join(tmpdir(), 'csrf-contract-'));
	mkdirSync(join(root, 'src', 'http', 'middleware'), { recursive: true });
	writeFileSync(
		join(root, 'src', 'http', 'middleware', 'csrf.ts'),
		'export const csrfGuard = () => undefined;\n',
	);
	writeFileSync(
		join(root, 'src', 'http', 'hono.ts'),
		[
			"import { csrfGuard } from './middleware/csrf';",
			'',
			"externalBoundary.use('/api/v1/*', csrfGuard);",
			'',
		].join('\n'),
	);
	return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('a tree that satisfies the contract reports no violations', () => {
	const { root, cleanup } = makeFixture();
	try {
		assert.deepEqual(collectViolations(root).errors, []);
	} finally {
		cleanup();
	}
});

test('adding src/start.ts is reported', () => {
	const { root, cleanup } = makeFixture();
	try {
		writeFileSync(join(root, 'src', 'start.ts'), 'export default createStart(() => ({}));\n');
		const { errors } = collectViolations(root);
		assert.equal(errors.length, 1);
		assert.match(errors[0], /src\/start\.ts exists/);
	} finally {
		cleanup();
	}
});

test('unmounting the boundary guard is reported', () => {
	const { root, cleanup } = makeFixture();
	try {
		writeFileSync(join(root, 'src', 'http', 'hono.ts'), 'export const externalBoundary = null;\n');
		const { errors } = collectViolations(root);
		assert.equal(errors.length, 2, JSON.stringify(errors));
		assert.ok(errors.some((e) => e.includes('does not import csrfGuard')));
		assert.ok(errors.some((e) => e.includes('does not mount the guard')));
	} finally {
		cleanup();
	}
});

test('deleting the guard module is reported', () => {
	const { root, cleanup } = makeFixture();
	try {
		rmSync(join(root, 'src', 'http', 'middleware', 'csrf.ts'));
		const { errors } = collectViolations(root);
		assert.ok(errors.some((e) => e.includes('src/http/middleware/csrf.ts is missing')));
	} finally {
		cleanup();
	}
});

test('an origin-check opt-out in src/ is reported', () => {
	for (const flag of [
		'disableCsrfMiddlewareWarning',
		'skipCSRFCheck',
		'disableCSRFCheck',
		'disableOriginCheck',
	]) {
		const { root, cleanup } = makeFixture();
		try {
			writeFileSync(
				join(root, 'src', 'cloudflare-auth.ts'),
				`export const opts = { ${flag}: true };\n`,
			);
			const { errors } = collectViolations(root);
			assert.ok(
				errors.some((e) => e.includes(flag)),
				`expected ${flag} to be reported, got ${JSON.stringify(errors)}`,
			);
		} finally {
			cleanup();
		}
	}
});

test('a flag mentioned only in a comment is not a violation', () => {
	const { root, cleanup } = makeFixture();
	try {
		writeFileSync(
			join(root, 'src', 'commented.ts'),
			[
				'// never pass disableCSRFCheck here',
				'/* skipCSRFCheck is forbidden */',
				'export const a = 1;',
				'',
			].join('\n'),
		);
		assert.deepEqual(collectViolations(root).errors, []);
	} finally {
		cleanup();
	}
});

test('moving the mount below the routers is reported (Hono dispatches in registration order)', () => {
	const { root, cleanup } = makeFixture();
	try {
		writeFileSync(
			join(root, 'src', 'http', 'hono.ts'),
			[
				"import { csrfGuard } from './middleware/csrf';",
				'',
				"externalBoundary.route('/api/v1/reactions', reactionsRouter);",
				"externalBoundary.use('/api/v1/*', csrfGuard);",
				'',
			].join('\n'),
		);
		const { errors } = collectViolations(root);
		assert.equal(errors.length, 1, JSON.stringify(errors));
		assert.match(errors[0], /AFTER the first handler registration/);
	} finally {
		cleanup();
	}
});

test('a guard mentioned only in a comment is reported', () => {
	const { root, cleanup } = makeFixture();
	try {
		writeFileSync(
			join(root, 'src', 'http', 'hono.ts'),
			[
				"import { requestIdMiddleware } from './middleware/request-id';",
				'',
				"// externalBoundary.use('/api/v1/*', csrfGuard);",
				"externalBoundary.use('/api/v1/*', requestIdMiddleware);",
				'',
			].join('\n'),
		);
		const { errors } = collectViolations(root);
		assert.ok(
			errors.some((e) => e.includes('does not mount the guard')),
			JSON.stringify(errors),
		);
	} finally {
		cleanup();
	}
});

test('stripComments removes block and line comments but keeps code', () => {
	assert.equal(
		stripComments('const a = 1; // trailing\nconst b = 2;'),
		'const a = 1; \nconst b = 2;',
	);
	assert.equal(stripComments('/* head */\nconst a = 1;'), '\nconst a = 1;');
	// A URL is not a comment: the `:` guard keeps `https://` intact.
	assert.equal(
		stripComments('const u = "https://rebuildup.dev";'),
		'const u = "https://rebuildup.dev";',
	);
});

test('the real repository satisfies the contract', () => {
	assert.deepEqual(collectViolations(REPO_ROOT).errors, []);
});
