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
 * The composite index on `(target_key, kind)` keeps the scan
 * narrow even for popular targets.
 *
 * Image references: when `kind === 'image'`, the `value` is a
 * `reaction_images.id`. `putReaction` rejects references to
 * non-existent image ids before the INSERT (P1 review finding —
 * previously any string passing the format validator was accepted
 * and stored as a broken reference). The reference check runs on
 * every PUT, including idempotent re-PUTs; in production this is
 * fine because image deletion refuses when a reaction still
 * references the image (`ImageReferencedError`), so a referenced
 * image cannot be removed out from under its reactions.
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

async function assertImageExists(db: D1Database, imageId: string): Promise<void> {
	const row = await db
		.prepare('SELECT 1 AS one FROM reaction_images WHERE id = ?1 LIMIT 1')
		.bind(imageId)
		.first<{ one: number }>();
	if (row === null) {
		throw new ReactionReferenceError(
			'unknown_image_id',
			`image id '${imageId}' does not exist in reaction_images`,
		);
	}
}

export async function putReaction(
	db: D1Database,
	input: UpsertReactionInput,
	now: number = Date.now(),
): Promise<{ created: boolean; id: string }> {
	if (input.kind === 'image') {
		// Validate the image id exists before insert (P1 finding).
		// Doing this before the INSERT avoids creating an orphan
		// reaction row that references a deleted image.
		await assertImageExists(db, input.value);
	}
	const id = crypto.randomUUID();
	const result = await db
		.prepare(
			`INSERT INTO reactions (id, target_key, actor_id, principal, kind, value, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (target_key, principal, actor_id, kind, value) DO NOTHING
       RETURNING id`,
		)
		.bind(id, input.target_key, input.actor_id, input.principal, input.kind, input.value, now)
		.first<{ id: string }>();

	if (result) {
		return { created: true, id: result.id };
	}

	// Conflict: row already exists. Look it up so we can return its id.
	const existing = await db
		.prepare(
			`SELECT id FROM reactions
       WHERE target_key = ?1 AND principal = ?2 AND actor_id = ?3
         AND kind = ?4 AND value = ?5`,
		)
		.bind(input.target_key, input.principal, input.actor_id, input.kind, input.value)
		.first<{ id: string }>();
	return { created: false, id: existing?.id ?? id };
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
): Promise<readonly ReactionAggregate[]> {
	const rows = await db
		.prepare(
			`SELECT kind, value, COUNT(*) AS count
       FROM reactions WHERE target_key = ?1
       GROUP BY kind, value ORDER BY count DESC, kind ASC, value ASC`,
		)
		.bind(target_key)
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
