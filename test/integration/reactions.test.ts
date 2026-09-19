/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	aggregateByTarget,
	deleteReaction,
	listReactionsByTarget,
	putReaction,
	reactionImageReferenced,
} from '../../src/http/reactions/reactions';

/**
 * Reactions CRUD + idempotency tests.
 *
 * Runs in the workerd pool. The schema is applied via
 * `applyD1Migrations` from inlined queries (workerd cannot
 * `fs.readFile`); the inlined queries MUST stay byte-identical to
 * `migrations/0003_reactions.sql` for the test to validate what
 * production runs.
 */

const MIGRATIONS = [
	{
		name: '0003_reactions',
		queries: [
			`CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        target_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (target_key, principal, actor_id, kind, value)
    )`,
			'CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_key)',
			'CREATE INDEX IF NOT EXISTS idx_reactions_target_kind ON reactions(target_key, kind)',
			`CREATE TABLE IF NOT EXISTS reaction_images (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
    )`,
			'CREATE INDEX IF NOT EXISTS idx_reaction_images_hash ON reaction_images(content_hash)',
		],
	},
];

const D1 = () => env.DB;

beforeAll(async () => {
	await applyD1Migrations(D1(), MIGRATIONS);
});

beforeEach(async () => {
	await D1().batch([
		D1().prepare('DELETE FROM reactions'),
		D1().prepare('DELETE FROM reaction_images'),
	]);
});

describe('putReaction', () => {
	const baseInput = {
		target_key: 'blog-intro',
		actor_id: 'visitor-1',
		principal: 'key-A',
		kind: 'emoji' as const,
		value: '👍',
	};

	it('first put creates a row', async () => {
		const result = await putReaction(D1(), baseInput);
		expect(result.created).toBe(true);
		expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
		const rows = await listReactionsByTarget(D1(), 'blog-intro');
		expect(rows.length).toBe(1);
		expect(rows[0].value).toBe('👍');
	});

	it('second put of the same payload is a no-op', async () => {
		const r1 = await putReaction(D1(), baseInput);
		const r2 = await putReaction(D1(), baseInput);
		expect(r1.created).toBe(true);
		expect(r2.created).toBe(false);
		expect(r2.id).toBe(r1.id);
		const rows = await listReactionsByTarget(D1(), 'blog-intro');
		expect(rows.length).toBe(1);
	});

	it('different actor_id on same target_key creates a new row', async () => {
		const r1 = await putReaction(D1(), baseInput);
		const r2 = await putReaction(D1(), { ...baseInput, actor_id: 'visitor-2' });
		expect(r1.created).toBe(true);
		expect(r2.created).toBe(true);
		expect(r2.id).not.toBe(r1.id);
	});

	it('different value on same (target, actor) creates a new row', async () => {
		await putReaction(D1(), baseInput);
		const r2 = await putReaction(D1(), { ...baseInput, value: '🎉' });
		expect(r2.created).toBe(true);
		const rows = await listReactionsByTarget(D1(), 'blog-intro');
		expect(rows.length).toBe(2);
	});

	it('different principal isolates the reaction space', async () => {
		const r1 = await putReaction(D1(), baseInput);
		const r2 = await putReaction(D1(), { ...baseInput, principal: 'key-B' });
		expect(r1.created).toBe(true);
		expect(r2.created).toBe(true);
		const rows = await listReactionsByTarget(D1(), 'blog-intro');
		expect(rows.length).toBe(2);
	});
});

describe('deleteReaction', () => {
	const baseInput = {
		target_key: 'blog-intro',
		actor_id: 'visitor-1',
		principal: 'key-A',
		kind: 'emoji' as const,
		value: '👍',
	};

	it('deletes an existing reaction', async () => {
		await putReaction(D1(), baseInput);
		const result = await deleteReaction(D1(), baseInput);
		expect(result.deleted).toBe(true);
		const rows = await listReactionsByTarget(D1(), 'blog-intro');
		expect(rows.length).toBe(0);
	});

	it('deleting an absent reaction is a no-op (deleted: false)', async () => {
		const result = await deleteReaction(D1(), baseInput);
		expect(result.deleted).toBe(false);
	});

	it('delete then re-put works (no stale state)', async () => {
		await putReaction(D1(), baseInput);
		await deleteReaction(D1(), baseInput);
		const r = await putReaction(D1(), baseInput);
		expect(r.created).toBe(true);
	});
});

describe('aggregateByTarget', () => {
	const A = { target_key: 'blog-intro', actor_id: 'a', principal: 'p', kind: 'emoji' as const };
	const B = { target_key: 'blog-intro', actor_id: 'b', principal: 'p', kind: 'emoji' as const };
	const C = { target_key: 'blog-intro', actor_id: 'c', principal: 'p', kind: 'emoji' as const };
	const D = { target_key: 'blog-intro', actor_id: 'd', principal: 'p', kind: 'emoji' as const };
	const E = { target_key: 'blog-intro', actor_id: 'e', principal: 'p', kind: 'emoji' as const };

	it('aggregates by (kind, value)', async () => {
		await putReaction(D1(), { ...A, value: '👍' });
		await putReaction(D1(), { ...B, value: '👍' });
		await putReaction(D1(), { ...C, value: '🎉' });
		await putReaction(D1(), { ...D, value: '👍' });
		await putReaction(D1(), { ...E, value: '🎉' });
		const aggregates = await aggregateByTarget(D1(), 'blog-intro');
		const thumbs = aggregates.find((a) => a.value === '👍');
		const party = aggregates.find((a) => a.value === '🎉');
		expect(thumbs?.count).toBe(3);
		expect(party?.count).toBe(2);
	});

	it('returns empty for unknown target', async () => {
		const aggregates = await aggregateByTarget(D1(), 'never-reacted');
		expect(aggregates.length).toBe(0);
	});
});

describe('putReaction — image reference validation', () => {
	const SEED_IMAGE_ID = '00000000-0000-0000-0000-000000000001';

	beforeEach(async () => {
		// Seed a row in reaction_images so the validation passes.
		// The actual bytes are irrelevant — only the id matters
		// for the existence check.
		await D1()
			.prepare(
				`INSERT INTO reaction_images (id, content_hash, content_type, size, r2_key, uploaded_by, uploaded_at)
         VALUES (?1, 'deadbeef', 'image/png', 1, 'reactions/deadbeef.png', 'test', 1)`,
			)
			.bind(SEED_IMAGE_ID)
			.run();
	});

	it('accepts an image reaction when the image id exists', async () => {
		const result = await putReaction(D1(), {
			target_key: 't',
			actor_id: 'a',
			principal: 'p',
			kind: 'image',
			value: SEED_IMAGE_ID,
		});
		expect(result.created).toBe(true);
		expect(await reactionImageReferenced(D1(), SEED_IMAGE_ID)).toBe(true);
	});

	it('rejects an image reaction when the image id does not exist', async () => {
		await expect(
			putReaction(D1(), {
				target_key: 't',
				actor_id: 'a',
				principal: 'p',
				kind: 'image',
				value: '00000000-0000-0000-0000-000000000000',
			}),
		).rejects.toMatchObject({ code: 'unknown_image_id' });
		// Confirm no orphan row was created.
		const rows = await listReactionsByTarget(D1(), 't');
		expect(rows.length).toBe(0);
	});

	it('emoji reactions do NOT validate any reference', async () => {
		// Emoji value is a Unicode string, not an image id.
		// Reference validation must skip the lookup entirely.
		const result = await putReaction(D1(), {
			target_key: 't',
			actor_id: 'a',
			principal: 'p',
			kind: 'emoji',
			value: '👍',
		});
		expect(result.created).toBe(true);
	});
});

describe('reactionImageReferenced', () => {
	it('returns false when no reaction references the image', async () => {
		expect(await reactionImageReferenced(D1(), 'img-unused')).toBe(false);
	});
});
