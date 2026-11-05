import type { GetCountOutput } from '../../http/access-counter/schema';

/**
 * Read the page-view counter straight from D1, across principals.
 *
 * Why this exists (Issue #377)
 * ----------------------------
 * In the production-readonly development mode the dev server's
 * bindings point at the PRODUCTION D1. The home's normal read path
 * calls the external API over the same origin, and that API scopes
 * its answer to the calling API key's principal — a DEV key that does
 * not exist in the production database, so the API answers 401 and the
 * widget shows an empty counter.
 *
 * The owner's instruction for this sprint is explicit: page views and
 * reactions should show the PRODUCTION numbers locally. The API route
 * cannot deliver that without copying a production secret into the
 * development environment (AGENTS.md §4 forbids it), so the read goes
 * through the BINDING instead — which is exactly what the
 * production-readonly mode enables.
 *
 * Why the aggregate crosses principals
 * ------------------------------------
 * The API's per-principal scope exists so one consumer cannot read
 * another consumer's rows. On the home target there is exactly one
 * consumer (the home's own API key), so the cross-principal sum IS the
 * production figure the widget shows in production. Summing rather
 * than filtering also means the local number does not silently become
 * "0" when the development key is unknown to the production database.
 *
 * The query mirrors `getCount` in `src/http/access-counter/counter.ts`
 * (the boundary owns the per-principal variant). The two must not
 * drift: `test/integration/dev-data-source.test.ts` asserts that this
 * aggregate equals the boundary's aggregate over the same rows.
 */
export async function readProductionCounter(db: D1Database, key: string): Promise<GetCountOutput> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(count), 0) AS count,
        MIN(first_hit) AS first_hit,
        MAX(last_hit) AS last_hit
     FROM access_counters WHERE key = ?1`,
		)
		.bind(key)
		.first<{ count: number | null; first_hit: number | null; last_hit: number | null }>();
	if (!row) return { count: 0, first_hit: null, last_hit: null };
	return {
		count: row.count ?? 0,
		first_hit: row.first_hit ?? null,
		last_hit: row.last_hit ?? null,
	};
}
