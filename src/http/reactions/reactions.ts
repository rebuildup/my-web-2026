import type { ReactionAggregate, ReactionKind, ReactionRow } from './schema';

/**
 * Reactions CRUD — idempotent PUT/DELETE + aggregate GET.
 *
 * PUT and DELETE are idempotent at the storage layer (composite
 * UNIQUE on `(target_key, principal, actor_id, kind, value)`):
 * re-sending the same payload is a no-op rather than an error.
 * DELETE on an absent row is also a no-op.
 *
 * Aggregates are computed at read time via `GROUP BY` from the
 * `reactions` table; no materialised aggregate table for MVP.
 * Aggregates are scoped to a single principal (consumer API key
 * id) — see `aggregateByTarget`. Cross-principal rolls up are
 * out of scope.
 * The composite index on `(target_key, kind)` keeps the scan
 * narrow even for popular targets.
 *
 * Image references: when `kind === 'image'`, the `value` is a
 * `reaction_images.id`. `putReaction` enforces image existence
 * atomically as part of the INSERT (P1 review finding — previously
 * was a separate `SELECT … FROM reaction_images` followed by the
 * INSERT, leaving a TOCTOU window where an image could be deleted
 * between the existence check and the reaction insert). The
 * current shape is `INSERT … SELECT … FROM reaction_images` —
 * SQLite evaluates the SELECT subquery against the same
 * connection; if the image row is gone, the SELECT returns zero
 * rows, no INSERT happens, and we throw ReactionReferenceError.
 *
 * The `images.ts` public delete path still refuses deletion when
 * a reaction references the image (`ImageReferencedError`), so in
 * practice the TOCTOU window cannot be hit by API traffic — but
 * the atomic check makes the invariant independent of API ordering.
 */

export class ReactionReferenceError extends Error {
	constructor(
		public readonly code: 'unknown_image_id',
		message: string,
	) {
		super(message);
		this.name = 'ReactionReferenceError';
	}
}

export interface UpsertReactionInput {
	target_key: string;
	actor_id: string;
	principal: string;
	kind: ReactionKind;
	value: string;
}

const REACTION_INSERT_SQL = `
INSERT INTO reactions (id, target_key, actor_id, principal, kind, value, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
WHERE (
  ?5 = 'emoji'
  OR EXISTS (SELECT 1 FROM reaction_images WHERE id = ?6)
)
ON CONFLICT (target_key, principal, actor_id, kind, value) DO NOTHING
RETURNING id
`;

const REACTION_LOOKUP_SQL = `
SELECT id FROM reactions
WHERE target_key = ?1 AND principal = ?2 AND actor_id = ?3
  AND kind = ?4 AND value = ?5
`;

export async function putReaction(
	db: D1Database,
	input: UpsertReactionInput,
	now: number = Date.now(),
): Promise<{ created: boolean; id: string }> {
	const id = crypto.randomUUID();
	const result = await db
		.prepare(REACTION_INSERT_SQL)
		.bind(id, input.target_key, input.actor_id, input.principal, input.kind, input.value, now)
		.first<{ id: string }>();

	if (result) {
		return { created: true, id: result.id };
	}

	// Either the row already exists (idempotent re-PUT — return
	// existing), or the image reference is broken (an emoji
	// reaction would always satisfy the WHERE clause). Distinguish
	// by looking up the existing row.
	const existing = await db
		.prepare(REACTION_LOOKUP_SQL)
		.bind(input.target_key, input.principal, input.actor_id, input.kind, input.value)
		.first<{ id: string }>();

	if (existing) {
		return { created: false, id: existing.id };
	}

	// No existing row + no INSERT → image is missing for an image
	// kind reaction. 'emoji' kind always satisfies the WHERE clause
	// above, so this branch is unreachable for emoji.
	if (input.kind === 'image') {
		throw new ReactionReferenceError(
			'unknown_image_id',
			`image id '${input.value}' does not exist in reaction_images`,
		);
	}
	// Defensive: should be unreachable given the WHERE clause
	// guarantees at least one row will be produced for emoji. If we
	// ever land here, surface the inconsistency.
	throw new ReactionReferenceError(
		'unknown_image_id',
		`unexpected: insert returned no row for kind='${input.kind}'`,
	);
}

export async function deleteReaction(
	db: D1Database,
	input: UpsertReactionInput,
): Promise<{ deleted: boolean }> {
	const result = await db
		.prepare(
			`DELETE FROM reactions
       WHERE target_key = ?1 AND principal = ?2 AND actor_id = ?3
         AND kind = ?4 AND value = ?5`,
		)
		.bind(input.target_key, input.principal, input.actor_id, input.kind, input.value)
		.run();
	return { deleted: (result.meta?.changes ?? 0) > 0 };
}

export async function listReactionsByTarget(
	db: D1Database,
	target_key: string,
): Promise<readonly ReactionRow[]> {
	const rows = await db
		.prepare(
			`SELECT id, target_key, actor_id, principal, kind, value, created_at
       FROM reactions WHERE target_key = ?1 ORDER BY created_at ASC`,
		)
		.bind(target_key)
		.all<ReactionRow>();
	return rows.results ?? [];
}

export async function aggregateByTarget(
	db: D1Database,
	target_key: string,
	principal: string,
): Promise<readonly ReactionAggregate[]> {
	// P1 review: aggregates MUST be principal-scoped. Each consumer
	// (API key) maintains its own reaction space; rolling up across
	// principals would conflate unrelated visitors into a single
	// tally, which is both privacy-adjacent and wrong for the
	// consumer who pays for the call. The composite UNIQUE on
	// `(target_key, principal, actor_id, kind, value)` already
	// isolates rows by principal; this WHERE clause surfaces that
	// fact in the aggregate.
	const rows = await db
		.prepare(
			`SELECT kind, value, COUNT(*) AS count
       FROM reactions WHERE target_key = ?1 AND principal = ?2
       GROUP BY kind, value ORDER BY count DESC, kind ASC, value ASC`,
		)
		.bind(target_key, principal)
		.all<ReactionAggregate & { count: number }>();
	return rows.results ?? [];
}

export async function reactionImageReferenced(db: D1Database, imageId: string): Promise<boolean> {
	const row = await db
		.prepare(
			`SELECT 1 AS one FROM reactions
       WHERE kind = 'image' AND value = ?1 LIMIT 1`,
		)
		.bind(imageId)
		.first<{ one: number }>();
	return row !== null;
}

/**
 * List the reactions this specific visitor has applied to the
 * target — `(target_key, principal, actor_id)` filtered, returned
 * as a flat `{kind, value}[]` so the home widget can render the
 * visitor's current selection set without a separate round-trip.
 *
 * Used by the home loader to drive the **toggle** predicate in the
 * widget (P1 review finding on branch 43): the widget cannot decide
 * whether a click should PUT or DELETE based on the public
 * aggregate count, because that count is "everyone's total" rather
 * than "this visitor's selection". A second visitor clicking the
 * same emoji would otherwise optimistically send DELETE on a row
 * the visitor never owned.
 *
 * Cross-visitor privacy: the `(target_key, principal, actor_id)`
 * composite is the same UNIQUE constraint that gates `putReaction`
 * / `deleteReaction`; only the visitor's own actor id (opaque,
 * stored in the `mw_actor_id` cookie) sees their own reactions.
 */
export async function listReactionsForActor(
	db: D1Database,
	target_key: string,
	principal: string,
	actor_id: string,
): Promise<readonly { kind: ReactionKind; value: string }[]> {
	const rows = await db
		.prepare(
			`SELECT kind, value FROM reactions
       WHERE target_key = ?1 AND principal = ?2 AND actor_id = ?3`,
		)
		.bind(target_key, principal, actor_id)
		.all<{ kind: ReactionKind; value: string }>();
	return rows.results ?? [];
}
