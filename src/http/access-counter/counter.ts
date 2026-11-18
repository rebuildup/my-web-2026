import type { GetCountOutput, RecordHitInput, RecordHitOutput } from './schema';
import { DEDUP_WINDOW_MS } from './schema';

/**
 * Access counter — atomic slot claim over the `access_counters` +
 * `access_dedup` pair (Ticket F, branch 38; per-principal storage
 * added on branch 35's review pass via migration 0005).
 *
 * The increment path runs three D1 statements in sequence. The
 * atomicity guarantee is provided by the UNIQUE primary key on
 * `access_dedup (counter_key, principal, session_id)`:
 *
 *   1. DELETE every dedup row whose `expires_at` has passed. This is
 *      what lets an expired triple's slot be re-claimed below, and it
 *      is also the table's only purge: rows whose identifier never
 *      returns are collected by the next recorded hit.
 *   2. INSERT a fresh dedup row keyed by the same triple.
 *      `meta.changes` is the canonical "did we get the slot"
 *      signal — SQLite atomically grants the slot via the UNIQUE
 *      primary key, so a second concurrent caller cannot win the
 *      same `(counter_key, principal, session_id)` slot. That is
 *      what makes the dedup atomic without an explicit transaction
 *      or `SELECT ... FOR UPDATE`.
 *   3. When step 2 reported `meta.changes = 1`, UPSERT the counter
 *      row keyed by `(key, principal)`. When step 2 reported 0
 *      (slot already held), return the existing count unchanged.
 *
 * P1 review finding (branch 35): the increment MUST be gated on
 * having won the dedup slot — otherwise a race between two
 * concurrent hits can land two increments for the same window.
 * The `if (!incremented) return …` branch is that gate.
 *
 * Per-principal storage (ADR-0012 §3): the counter PK is
 * `(key, principal)` so two consumers (API key ids) writing to the
 * same `key` each keep their own count. Migration 0005 made this
 * schema promise actual (the 0002 PK was just `key`).
 *
 * The read path (`getCount`) is a plain SELECT filtered by both
 * `key` and `principal` — no concurrency hazard.
 *
 * Expired-row bound: step 1 deletes EVERY expired dedup row, not just
 * the triple being retried. A `(key, principal, session_id)` that
 * never returns would otherwise keep its row forever and the table
 * would grow without bound under session churn. The sweep is a plain
 * indexed `expires_at <= now` delete — it also subsumes the old
 * per-triple purge, because an expired row for this triple matches
 * the same predicate. It stays lazy (no Cron trigger) and runs on
 * every recorded hit, so the published retention sentence — "deleted
 * on the next hit" — stays literally true.
 *
 * Input / output types live in `./schema` so that home-side
 * consumers can `import type` the result shape without depending on
 * this implementation file — AGENTS.md §3 keeps `home/access`
 * type-only over `http/access-counter`.
 */

export async function recordHit(db: D1Database, input: RecordHitInput): Promise<RecordHitOutput> {
	const now = input.now ?? Date.now();
	const expiresAt = now + DEDUP_WINDOW_MS;

	// Step 1: drop every expired dedup row. The predicate covers the
	// triple being retried (which is what lets its slot be re-claimed)
	// and every ghost row that never returns — without it, rows whose
	// session id is never seen again accumulate without bound.
	const purge = await db
		.prepare('DELETE FROM access_dedup WHERE expires_at <= ?1')
		.bind(now)
		.run();
	void purge;

	// Step 2: try to claim the dedup slot.
	const claim = await db
		.prepare(
			`INSERT INTO access_dedup (counter_key, principal, session_id, expires_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (counter_key, principal, session_id) DO NOTHING`,
		)
		.bind(input.key, input.principal, input.session_id, expiresAt)
		.run();
	const incremented = (claim.meta?.changes ?? 0) > 0;

	if (!incremented) {
		// Slot already held — read current count and return unchanged.
		const row = await db
			.prepare(
				'SELECT count, first_hit, last_hit FROM access_counters WHERE key = ?1 AND principal = ?2',
			)
			.bind(input.key, input.principal)
			.first<{ count: number; first_hit: number; last_hit: number }>();
		if (!row) {
			// Counter row absent even though dedup exists — pathological
			// (the INSERT/UPDATE step below should have run). Surface
			// a zero counter rather than crashing the home widget.
			return { incremented: false, count: 0, first_hit: now, last_hit: now };
		}
		return {
			incremented: false,
			count: row.count,
			first_hit: row.first_hit,
			last_hit: row.last_hit,
		};
	}

	// Step 3: increment the counter row, keyed by (key, principal).
	const bump = await db
		.prepare(
			`INSERT INTO access_counters (key, principal, count, first_hit, last_hit)
       VALUES (?1, ?2, 1, ?3, ?3)
       ON CONFLICT (key, principal) DO UPDATE
         SET count    = count + 1,
             last_hit = excluded.last_hit`,
		)
		.bind(input.key, input.principal, now)
		.run();
	void bump;

	const row = await db
		.prepare(
			'SELECT count, first_hit, last_hit FROM access_counters WHERE key = ?1 AND principal = ?2',
		)
		.bind(input.key, input.principal)
		.first<{ count: number; first_hit: number; last_hit: number }>();
	if (!row) {
		// Self-heal: the increment statement should always produce a row,
		// but if the binding fails for any reason we surface the failure
		// as a 500 via the caller — `incremented: false` would mislead.
		throw new Error(
			`access counter row missing after increment for key='${input.key}' principal='${input.principal}'`,
		);
	}
	return { incremented: true, count: row.count, first_hit: row.first_hit, last_hit: row.last_hit };
}

export async function getCount(
	db: D1Database,
	key: string,
	principal: string,
): Promise<GetCountOutput> {
	const row = await db
		.prepare(
			'SELECT count, first_hit, last_hit FROM access_counters WHERE key = ?1 AND principal = ?2',
		)
		.bind(key, principal)
		.first<{ count: number; first_hit: number; last_hit: number }>();
	if (!row) return { count: 0, first_hit: null, last_hit: null };
	return { count: row.count, first_hit: row.first_hit, last_hit: row.last_hit };
}
