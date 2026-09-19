import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { getCount, recordHit } from './counter';
import { DEDUP_WINDOW_MS } from './schema';

/**
 * Access counter — atomicity tests (Ticket F, branch 38).
 *
 * Coverage:
 *   1. First hit creates the counter row and increments to 1.
 *   2. Second hit inside `DEDUP_WINDOW_MS` with the same
 *      `(key, principal, session_id)` is a no-op (incremented=false).
 *   3. Hit after window expiry increments again.
 *   4. Different `session_id`s both increment.
 *   5. Concurrent hits via `Promise.all` with different session_ids
 *      both land as increments — D1 serialises the `INSERT … ON
 *      CONFLICT DO NOTHING` race.
 */

const ACCESS_COUNTER_SQL = `
CREATE TABLE IF NOT EXISTS access_counters (
    key        TEXT PRIMARY KEY,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_dedup (
    counter_key TEXT    NOT NULL,
    principal   TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (counter_key, principal, session_id)
);
CREATE INDEX IF NOT EXISTS idx_access_dedup_expires
    ON access_dedup(expires_at);
`;

async function ensureSchema(): Promise<void> {
	for (const stmt of ACCESS_COUNTER_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await env.DB.prepare(stmt).run();
	}
}

async function clearRows(): Promise<void> {
	for (const table of ['access_counters', 'access_dedup']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

describe('access counter — recordHit', () => {
	beforeEach(async () => {
		await ensureSchema();
		await clearRows();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('first hit creates the row and sets count=1', async () => {
		const result = await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 'session1',
			now: 1_000,
		});
		expect(result.incremented).toBe(true);
		expect(result.count).toBe(1);
		expect(result.first_hit).toBe(1_000);
		expect(result.last_hit).toBe(1_000);
	});

	it('second hit inside DEDUP_WINDOW_MS is a no-op', async () => {
		await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 'session1',
			now: 1_000,
		});
		const result = await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 'session1',
			now: 2_000, // still inside window
		});
		expect(result.incremented).toBe(false);
		expect(result.count).toBe(1);
	});

	it('hit after DEDUP_WINDOW_MS increments again', async () => {
		await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 'session1',
			now: 1_000,
		});
		const result = await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 'session1',
			now: 1_000 + DEDUP_WINDOW_MS + 1, // expired by 1ms
		});
		expect(result.incremented).toBe(true);
		expect(result.count).toBe(2);
	});

	it('different session_ids both increment', async () => {
		const r1 = await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 'session1',
			now: 1_000,
		});
		const r2 = await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 'session2',
			now: 1_500,
		});
		expect(r1.incremented).toBe(true);
		expect(r2.incremented).toBe(true);
		expect(r2.count).toBe(2);
	});

	it('concurrent hits with different session_ids both land as increments', async () => {
		// 8 concurrent hits with distinct session_ids — the dedup UNIQUE
		// PK serialises them. D1's batch support is per-statement; the
		// `INSERT … ON CONFLICT DO NOTHING` is the only statement with
		// potential race. After the test the count must be 8.
		const hits = Array.from({ length: 8 }, (_, i) =>
			recordHit(env.DB, {
				key: 'home-page',
				principal: 'keyA',
				session_id: `session-${i}`,
				now: 1_000,
			}),
		);
		const results = await Promise.all(hits);
		const incrementedCount = results.filter((r) => r.incremented).length;
		expect(incrementedCount).toBe(8);
		expect(results[results.length - 1]?.count).toBe(8);
	});
});

describe('access counter — getCount', () => {
	beforeEach(async () => {
		await ensureSchema();
		await clearRows();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('returns zero + null timestamps for an unknown key', async () => {
		const result = await getCount(env.DB, 'unknown');
		expect(result).toEqual({ count: 0, first_hit: null, last_hit: null });
	});

	it('returns the current count + timestamps after hits', async () => {
		await recordHit(env.DB, {
			key: 'home-page',
			principal: 'keyA',
			session_id: 's1',
			now: 1_000,
		});
		const result = await getCount(env.DB, 'home-page');
		expect(result.count).toBe(1);
		expect(result.first_hit).toBe(1_000);
		expect(result.last_hit).toBe(1_000);
	});
});
