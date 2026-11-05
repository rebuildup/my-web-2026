import type { ReactionAggregate } from '../../http/reactions/schema';

/**
 * Read the reaction aggregates straight from D1, across principals.
 *
 * Why this exists (Issue #377)
 * ----------------------------
 * Same reason as `src/home/access/production-read.ts`: in the
 * production-readonly development mode the API path cannot answer,
 * because the development API key is not a row in the production
 * database and the API scopes every answer to the calling principal.
 * The owner's instruction for this sprint is that reactions show the
 * PRODUCTION numbers locally, and the only route to them without
 * copying a production secret into development (AGENTS.md §4) is the
 * binding the production-readonly mode provides.
 *
 * The query mirrors `aggregateByTarget` in
 * `src/http/reactions/reactions.ts` (the boundary owns the
 * per-principal variant). The two must not drift:
 * `test/integration/dev-data-source.test.ts` asserts that this
 * aggregate equals the boundary's aggregate over the same rows.
 *
 * The visitor's own reactions are NOT read here. They are scoped to
 * `(target, principal, actor_id)`, and in this mode the visitor has no
 * rows to own — the widget renders the public aggregate and shows no
 * personal selection, which is the honest state for a read-only
 * session.
 */
export async function readProductionReactionAggregates(
	db: D1Database,
	target: string,
): Promise<readonly ReactionAggregate[]> {
	const rows = await db
		.prepare(
			`SELECT kind, value, COUNT(*) AS count
       FROM reactions WHERE target_key = ?1
       GROUP BY kind, value ORDER BY count DESC, kind ASC, value ASC`,
		)
		.bind(target)
		.all<{ kind: string; value: string; count: number }>();
	const results = rows?.results ?? [];
	return results.map((row) => ({
		kind: row.kind === 'image' ? 'image' : 'emoji',
		value: row.value,
		count: row.count,
	}));
}
