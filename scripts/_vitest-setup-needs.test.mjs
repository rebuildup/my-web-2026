import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	AUTH_SCHEMA_ENV_VAR,
	WARMUP_ENV_VAR,
	encodeAuthSchemaTestFiles,
	encodeWarmupTestFiles,
	needsAuthSchema,
	needsWarmup,
} from './_vitest-setup-needs.mjs';

/**
 * Setup-file scope decision (Issue #618).
 *
 * The contract is one-directional: every input this function cannot
 * interpret must return `true` (apply the Better Auth schema). A false
 * negative leaves a D1 test without its tables, which surfaces later as
 * an opaque Better Auth schema mismatch; a false positive only repeats
 * the pre-Issue-#618 behaviour for that file.
 */

const TEST_PATH = '/repo/src/home/access/load.test.ts';

describe('needsAuthSchema', () => {
	it('applies the schema when the file is in the scanned set', () => {
		assert.equal(needsAuthSchema(TEST_PATH, encodeAuthSchemaTestFiles([TEST_PATH])), true);
	});

	it('skips the schema when the file is not in the scanned set', () => {
		assert.equal(
			needsAuthSchema(TEST_PATH, encodeAuthSchemaTestFiles(['/repo/src/other.test.ts'])),
			false,
		);
	});

	it('fails safe for a missing or empty environment value', () => {
		assert.equal(needsAuthSchema(TEST_PATH, undefined), true);
		assert.equal(needsAuthSchema(TEST_PATH, ''), true);
	});

	it('fails safe for malformed JSON', () => {
		assert.equal(needsAuthSchema(TEST_PATH, '{not json'), true);
	});

	it('fails safe when the value is not an array', () => {
		assert.equal(needsAuthSchema(TEST_PATH, '{"a":1}'), true);
		assert.equal(needsAuthSchema(TEST_PATH, '"a"'), true);
	});

	it('fails safe when the current test path is unknown', () => {
		const encoded = encodeAuthSchemaTestFiles([TEST_PATH]);
		assert.equal(needsAuthSchema(undefined, encoded), true);
		assert.equal(needsAuthSchema('', encoded), true);
	});

	it('exposes one environment variable name', () => {
		assert.equal(AUTH_SCHEMA_ENV_VAR, 'BETTER_AUTH_SCHEMA_TEST_FILES');
	});
});

describe('encodeAuthSchemaTestFiles', () => {
	it('round-trips absolute paths through JSON', () => {
		const files = ['/repo/a.test.ts', '/repo/b.test.tsx'];
		assert.deepEqual(JSON.parse(encodeAuthSchemaTestFiles(files)), files);
	});
});

describe('needsWarmup', () => {
	/**
	 * The failure direction is the opposite of `needsAuthSchema`: a
	 * warm-up that was not needed costs one cheap request, while a
	 * warm-up that was missing restores the flake this ticket exists to
	 * remove. So an undecidable input returns `true`.
	 */
	it('warms up when the file is in the scanned set', () => {
		assert.equal(needsWarmup(TEST_PATH, encodeWarmupTestFiles([TEST_PATH])), true);
	});

	it('skips the warm-up when the file is not in the scanned set', () => {
		assert.equal(needsWarmup(TEST_PATH, encodeWarmupTestFiles(['/repo/src/other.test.ts'])), false);
	});

	it('fails safe for a missing or empty environment value', () => {
		assert.equal(needsWarmup(TEST_PATH, undefined), true);
		assert.equal(needsWarmup(TEST_PATH, ''), true);
	});

	it('fails safe for malformed JSON', () => {
		assert.equal(needsWarmup(TEST_PATH, '{not json'), true);
	});

	it('fails safe when the value is not an array', () => {
		assert.equal(needsWarmup(TEST_PATH, '{"a":1}'), true);
		assert.equal(needsWarmup(TEST_PATH, '"a"'), true);
	});

	it('fails safe when the current test path is unknown', () => {
		const encoded = encodeWarmupTestFiles([TEST_PATH]);
		assert.equal(needsWarmup(undefined, encoded), true);
		assert.equal(needsWarmup('', encoded), true);
	});

	it('exposes one environment variable name', () => {
		assert.equal(WARMUP_ENV_VAR, 'WORKERD_WARMUP_TEST_FILES');
	});
});

describe('encodeWarmupTestFiles', () => {
	it('round-trips absolute paths through JSON', () => {
		const files = ['/repo/a.test.ts', '/repo/b.test.tsx'];
		assert.deepEqual(JSON.parse(encodeWarmupTestFiles(files)), files);
	});
});
