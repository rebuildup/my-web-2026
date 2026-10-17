/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	ImagePolicyError,
	ImageReferencedError,
	deleteImage,
	listImages,
	uploadImage,
} from '../../src/http/reactions/images';
import {
	ReactionReferenceError,
	putReaction,
	reactionImageReferenced,
} from '../../src/http/reactions/reactions';
import {
	GIF_BYTES,
	JPEG_BYTES,
	PNG_BYTES,
	SVG_BYTES,
	WEBP_BYTES,
	repeatTo,
	toArrayBuffer,
} from '../helpers/image-fixtures';

/**
 * Image upload + delete policy tests.
 *
 * Covers the image policy surface that the admin UI relies on:
 *
 *   - uploadImage accepts PNG / JPEG / WebP / GIF.
 *   - uploadImage rejects SVG (active content risk).
 *   - uploadImage rejects >256 KiB.
 *   - uploadImage is content-addressed: same bytes → same row.
 *   - deleteImage refuses when a reaction references the image
 *     (returns ImageReferencedError; router maps to 409).
 *   - deleteImage removes the D1 row + R2 object when unreferenced.
 *
 * Runs in the workerd pool; the R2 binding is `env.MEDIA` (read
 * from `wrangler.jsonc`). The schema is inlined via
 * `applyD1Migrations` to match `migrations/0003_reactions.sql`.
 */

const MIGRATIONS = [
	{
		name: '0003_reactions_for_images',
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
const R2 = () => env.MEDIA;

beforeAll(async () => {
	await applyD1Migrations(D1(), MIGRATIONS);
});

beforeEach(async () => {
	await D1().batch([
		D1().prepare('DELETE FROM reactions'),
		D1().prepare('DELETE FROM reaction_images'),
	]);
	// Clean R2 objects created by previous tests. We list under
	// the `reactions/` prefix (the only prefix images.ts uses).
	const listed = await R2().list({ prefix: 'reactions/' });
	await Promise.all(listed.objects.map((o) => R2().delete(o.key)));
});

describe('uploadImage — content-type policy', () => {
	it.each([
		['image/png', PNG_BYTES],
		['image/jpeg', JPEG_BYTES],
		['image/webp', WEBP_BYTES],
		['image/gif', GIF_BYTES],
	])('accepts %s', async (contentType, bytes) => {
		const result = await uploadImage(D1(), R2(), {
			contentType,
			bytes: toArrayBuffer(bytes),
			uploadedBy: 'tester',
		});
		expect(result.image.content_type).toBe(contentType);
		expect(result.image.size).toBe(bytes.byteLength);
		expect(result.image.uploaded_by).toBe('tester');
		expect(result.reused).toBe(false);
	});

	it('rejects SVG with unsupported_content_type', async () => {
		await expect(
			uploadImage(D1(), R2(), {
				contentType: 'image/svg+xml',
				bytes: toArrayBuffer(SVG_BYTES),
				uploadedBy: 'tester',
			}),
		).rejects.toBeInstanceOf(ImagePolicyError);
	});

	it('rejects unknown content types', async () => {
		await expect(
			uploadImage(D1(), R2(), {
				contentType: 'application/octet-stream',
				bytes: toArrayBuffer(PNG_BYTES),
				uploadedBy: 'tester',
			}),
		).rejects.toMatchObject({ code: 'unsupported_content_type' });
	});
});

describe('uploadImage — size policy', () => {
	it('rejects payload above 256 KiB with oversize code', async () => {
		const oversize = repeatTo(PNG_BYTES, 257 * 1024);
		await expect(
			uploadImage(D1(), R2(), {
				contentType: 'image/png',
				bytes: oversize,
				uploadedBy: 'tester',
			}),
		).rejects.toMatchObject({ code: 'oversize' });
	});

	it('accepts payload exactly at 256 KiB', async () => {
		const boundary = repeatTo(PNG_BYTES, 256 * 1024);
		const result = await uploadImage(D1(), R2(), {
			contentType: 'image/png',
			bytes: boundary,
			uploadedBy: 'tester',
		});
		expect(result.image.size).toBe(256 * 1024);
	});
});

describe('uploadImage — content-addressed dedup', () => {
	it('returns the same row when the same bytes are uploaded twice', async () => {
		const buf = toArrayBuffer(PNG_BYTES);
		const first = await uploadImage(D1(), R2(), {
			contentType: 'image/png',
			bytes: buf,
			uploadedBy: 'tester',
		});
		const second = await uploadImage(D1(), R2(), {
			contentType: 'image/png',
			bytes: buf,
			uploadedBy: 'tester',
		});
		expect(second.reused).toBe(true);
		expect(second.image.id).toBe(first.image.id);
		const all = await listImages(D1());
		expect(all.length).toBe(1);
	});
});

describe('deleteImage — reference policy', () => {
	it('refuses when a reaction references the image', async () => {
		const buf = toArrayBuffer(PNG_BYTES);
		const upload = await uploadImage(D1(), R2(), {
			contentType: 'image/png',
			bytes: buf,
			uploadedBy: 'tester',
		});

		await putReaction(D1(), {
			target_key: 't',
			actor_id: 'a',
			principal: 'p',
			kind: 'image',
			value: upload.image.id,
		});

		expect(await reactionImageReferenced(D1(), upload.image.id)).toBe(true);
		await expect(deleteImage(D1(), R2(), upload.image.id)).rejects.toBeInstanceOf(
			ImageReferencedError,
		);
	});

	it('deletes the D1 row + R2 object when no reaction references the image', async () => {
		const buf = toArrayBuffer(PNG_BYTES);
		const upload = await uploadImage(D1(), R2(), {
			contentType: 'image/png',
			bytes: buf,
			uploadedBy: 'tester',
		});
		expect(await reactionImageReferenced(D1(), upload.image.id)).toBe(false);

		await deleteImage(D1(), R2(), upload.image.id);

		const row = await D1()
			.prepare('SELECT id FROM reaction_images WHERE id = ?1')
			.bind(upload.image.id)
			.first<{ id: string }>();
		expect(row).toBeNull();
		const obj = await R2().head(upload.image.r2_key);
		expect(obj).toBeNull();
	});

	it('returns not_found for an unknown id', async () => {
		await expect(
			deleteImage(D1(), R2(), '00000000-0000-0000-0000-000000000000'),
		).rejects.toMatchObject({ code: 'not_found' });
	});

	it('TOCTOU race: concurrent deleteImage + putReaction leave no dangling reaction (P1 #5 regression)', async () => {
		// P1 review finding: the previous check-then-delete sequence
		// had a window where a concurrent `putReaction` could land
		// between the reference check and the DB DELETE, creating a
		// dangling reaction pointing at an image whose R2 object was
		// about to be deleted. The fix is a single conditional
		// DELETE ... RETURNING that atomically claims the row only
		// when no reaction references it. Either interleaving is
		// safe; the invariant is "no dangling reaction survives".
		const buf = toArrayBuffer(PNG_BYTES);
		const upload = await uploadImage(D1(), R2(), {
			contentType: 'image/png',
			bytes: buf,
			uploadedBy: 'tester',
		});
		const imageId = upload.image.id;

		// Two interleavings to exercise:
		//   A. putReaction runs first, then deleteImage → delete must
		//      refuse (ImageReferencedError).
		//   B. deleteImage runs first, then putReaction → delete must
		//      succeed (image gone) and putReaction must throw
		//      ReactionReferenceError (image id unknown).
		// D1 is single-threaded, so Promise.all here models the
		// logical race, not the OS-level race; the invariant we test
		// is "no dangling reaction" regardless of order.

		// Interleaving A: reaction lands first.
		await putReaction(D1(), {
			target_key: 't',
			actor_id: 'a',
			principal: 'p',
			kind: 'image',
			value: imageId,
		});
		await expect(deleteImage(D1(), R2(), imageId)).rejects.toBeInstanceOf(ImageReferencedError);
		// Reaction still present; image still present.
		const referencedAfter = await D1()
			.prepare('SELECT id FROM reactions WHERE value = ?1')
			.bind(imageId)
			.first<{ id: string }>();
		expect(referencedAfter).not.toBeNull();
		const imageAfter = await D1()
			.prepare('SELECT id FROM reaction_images WHERE id = ?1')
			.bind(imageId)
			.first<{ id: string }>();
		expect(imageAfter).not.toBeNull();

		// Clean up before interleaving B.
		await D1().prepare('DELETE FROM reactions WHERE value = ?1').bind(imageId).run();
		await deleteImage(D1(), R2(), imageId); // now succeeds
		await expect(
			putReaction(D1(), {
				target_key: 't',
				actor_id: 'a',
				principal: 'p',
				kind: 'image',
				value: imageId,
			}),
		).rejects.toBeInstanceOf(ReactionReferenceError);
		// No dangling reaction: the row that putReaction tried to
		// insert never landed.
		const dangling = await D1()
			.prepare('SELECT id FROM reactions WHERE value = ?1')
			.bind(imageId)
			.first<{ id: string }>();
		expect(dangling).toBeNull();
	});
});
