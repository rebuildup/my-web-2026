import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { D1_TARGETS, assertProductionAuthorization, normaliseRows, resolveTarget } from './_d1.mjs';
import { D1_DATABASE_ID, ACCOUNT_ID } from './_cloudflare-identity.mjs';

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

describe('assertProductionAuthorization (Issue #247)', () => {
	it('authorizes the canonical production identity', () => {
		assert.doesNotThrow(() =>
			assertProductionAuthorization({ target: 'production', execute: true }),
		);
	});

	it('refuses a production write against a different database ID', () => {
		// A NAME is never sufficient. Identity is the ID.
		assert.throws(
			() =>
				assertProductionAuthorization({
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
				assertProductionAuthorization({
					target: 'production',
					execute: true,
					accountId: '0'.repeat(32),
				}),
			/refusing a production D1 mutation on account/,
		);
	});

	it('is a no-op outside production', () => {
		assert.doesNotThrow(() => assertProductionAuthorization({ target: 'local', execute: true }));
	});
});

describe('identity constants (Issue #247)', () => {
	it('pins the canonical production database by ID', () => {
		assert.equal(D1_DATABASE_ID, 'd761ddb7-8179-48dd-855f-c8b7b2924bad');
		assert.equal(ACCOUNT_ID, 'c6ab6651a5d4d6d0d07686bbd3c3d56f');
	});
});
