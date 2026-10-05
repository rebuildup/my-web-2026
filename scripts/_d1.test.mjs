import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCOUNT_ID, D1_DATABASE_ID } from './_cloudflare-identity.mjs';
import { D1_TARGETS, assertProductionWriteAllowed, normaliseRows, resolveTarget } from './_d1.mjs';
import { parseD1Args } from './d1.mjs';

/**
 * D1 driver tests (Issue #247).
 *
 * The parsers are built against fixtures CAPTURED from real
 * `cf@1.0.0-beta.12` output, not from documentation — a beta CLI
 * can change its envelope, and the point of `normaliseRows` is that
 * only this file has to change when it does.
 */

/** Captured: `cf d1 raw <id> --local --persist-to .tmp/d1state --sql "SELECT slug …"`. */
const RAW_LOCAL_FIXTURE = [
	{
		success: true,
		results: {
			columns: ['slug', 'codepoint'],
			rows: [
				['bulb', '1F4A1'],
				['check', '2705'],
			],
		},
		meta: {
			served_by: 'miniflare.db',
			duration: 1,
			changes: 0,
			last_row_id: 0,
			changed_db: false,
			size_after: 253952,
			rows_read: 2,
			rows_written: 0,
			total_attempts: 1,
		},
	},
];

/** Captured shape of the Cloudflare D1 query API `result` (object rows). */
const QUERY_REMOTE_FIXTURE = [
	{
		success: true,
		results: [{ slug: 'multislicer' }, { slug: 'aulymo-v01' }],
		meta: { rows_read: 2 },
	},
];

describe('normaliseRows (Issue #247)', () => {
	it('turns raw {columns, rows} into object rows', () => {
		assert.deepEqual(normaliseRows(RAW_LOCAL_FIXTURE), [
			{ slug: 'bulb', codepoint: '1F4A1' },
			{ slug: 'check', codepoint: '2705' },
		]);
	});

	it('passes query-style object rows through unchanged', () => {
		assert.deepEqual(normaliseRows(QUERY_REMOTE_FIXTURE), [
			{ slug: 'multislicer' },
			{ slug: 'aulymo-v01' },
		]);
	});

	it('gives both paths the SAME outward shape', () => {
		// The whole point: callers never branch on which CLI surface ran.
		assert.ok(Array.isArray(normaliseRows(RAW_LOCAL_FIXTURE)));
		assert.ok(Array.isArray(normaliseRows(QUERY_REMOTE_FIXTURE)));
		assert.ok(
			normaliseRows(RAW_LOCAL_FIXTURE).every((r) => typeof r === 'object' && !Array.isArray(r)),
		);
		assert.ok(
			normaliseRows(QUERY_REMOTE_FIXTURE).every((r) => typeof r === 'object' && !Array.isArray(r)),
		);
	});

	it('is safe on empty and absent payloads', () => {
		assert.deepEqual(normaliseRows(null), []);
		assert.deepEqual(normaliseRows(undefined), []);
		assert.deepEqual(normaliseRows([]), []);
		assert.deepEqual(normaliseRows([{ success: true, results: [] }]), []);
	});
});

describe('resolveTarget (Issue #247)', () => {
	it('defaults to local, never to production', () => {
		// `cf` defaults D1 to REMOTE, so an omitted target here would be
		// a production write. The safe default is load-bearing.
		assert.equal(resolveTarget(undefined), 'local');
		assert.equal(resolveTarget(null), 'local');
	});

	it('offers no "remote" target', () => {
		assert.deepEqual([...D1_TARGETS], ['local', 'production']);
		assert.throws(() => resolveTarget('remote'), /no "remote" target|refusing D1 target/);
	});

	it('rejects any unknown target', () => {
		assert.throws(() => resolveTarget('prod'), /refusing D1 target/);
		assert.throws(() => resolveTarget('staging'), /refusing D1 target/);
	});
});

describe('assertProductionWriteAllowed (Issue #247)', () => {
	it('authorizes the canonical production identity', () => {
		assert.doesNotThrow(() =>
			assertProductionWriteAllowed({ target: 'production', execute: true }),
		);
	});

	it('refuses a production write against a different database ID', () => {
		// A NAME is never sufficient. Identity is the ID.
		assert.throws(
			() =>
				assertProductionWriteAllowed({
					target: 'production',
					execute: true,
					databaseId: 'my-web-2026',
				}),
			/refusing a production D1 mutation/,
		);
	});

	it('refuses a production write on a different account', () => {
		assert.throws(
			() =>
				assertProductionWriteAllowed({
					target: 'production',
					execute: true,
					accountId: '0'.repeat(32),
				}),
			/refusing a production D1 mutation on account/,
		);
	});

	it('is a no-op outside production', () => {
		assert.doesNotThrow(() => assertProductionWriteAllowed({ target: 'local', execute: true }));
	});
});

describe('identity constants (Issue #247)', () => {
	it('pins the canonical production database by ID', () => {
		assert.equal(D1_DATABASE_ID, 'd761ddb7-8179-48dd-855f-c8b7b2924bad');
		assert.equal(ACCOUNT_ID, 'c6ab6651a5d4d6d0d07686bbd3c3d56f');
	});
});

/* -- Issue #247: the production write gate is not caller-dependent -- */

describe('assertProductionWriteAllowed (Issue #247)', () => {
	it('refuses a production write without an explicit execute', () => {
		assert.throws(
			() => assertProductionWriteAllowed({ target: 'production', execute: false, kind: 'batch' }),
			/requires an explicit execute/,
		);
	});

	it('refuses a production write on a non-canonical database', () => {
		assert.throws(
			() =>
				assertProductionWriteAllowed({
					target: 'production',
					execute: true,
					kind: 'batch',
					databaseId: 'my-web-2026',
				}),
			/refusing a production D1 batch against database/,
		);
	});

	it('refuses a production write on a non-canonical account', () => {
		assert.throws(
			() =>
				assertProductionWriteAllowed({
					target: 'production',
					execute: true,
					kind: 'batch',
					accountId: '0'.repeat(32),
				}),
			/on account/,
		);
	});

	it('allows a production write only with all four conditions', () => {
		assert.doesNotThrow(() =>
			assertProductionWriteAllowed({ target: 'production', execute: true, kind: 'batch' }),
		);
	});

	it('does not gate local writes', () => {
		assert.doesNotThrow(() =>
			assertProductionWriteAllowed({ target: 'local', execute: false, kind: 'batch' }),
		);
	});
});

/* -- Issue #247: the CLI parser boundary --------------------------------- */

describe('parseD1Args (Issue #247)', () => {
	it('reads --execute as execute=true', () => {
		// Regression: the parser called `has('--execute')` while `has()`
		// already prefixes `--`, so it searched for `----execute`, never
		// matched, and silently downgraded a production apply to a
		// listing. The migration would never run in production.
		assert.equal(parseD1Args(['apply', '--target=production', '--execute']).execute, true);
	});

	it('leaves execute=false when the flag is absent', () => {
		assert.equal(parseD1Args(['apply', '--target=production']).execute, false);
		assert.equal(parseD1Args(['apply']).execute, false);
	});

	it('selects the production apply path only with --execute', () => {
		// The two conditions, checked at the parser boundary and then at
		// the gate. No remote call is made: the gate throws first.
		const withFlag = parseD1Args(['apply', '--target=production', '--execute']);
		const without = parseD1Args(['apply', '--target=production']);
		assert.doesNotThrow(() =>
			assertProductionWriteAllowed({
				target: withFlag.target,
				execute: withFlag.execute,
				kind: 'apply',
			}),
		);
		assert.throws(
			() =>
				assertProductionWriteAllowed({
					target: without.target,
					execute: without.execute,
					kind: 'apply',
				}),
			/requires an explicit execute/,
		);
	});

	it('accepts both --name=value and --name value', () => {
		// Shell quoting turns `--sql "SELECT 1"` into two argv entries.
		assert.equal(parseD1Args(['query', '--sql=SELECT 1']).sql, 'SELECT 1');
		assert.equal(parseD1Args(['query', '--sql', 'SELECT 1']).sql, 'SELECT 1');
	});

	it('defaults the target to local and never to production', () => {
		assert.equal(parseD1Args(['apply']).target, 'local');
		assert.equal(parseD1Args(['apply', '--execute']).target, 'local');
	});
});
