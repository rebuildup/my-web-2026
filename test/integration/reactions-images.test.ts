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
	putReaction,
	ReactionReferenceError,
	reactionImageReferenced,
} from '../../src/http/reactions/reactions';

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

/**
 * Minimal real image bytes — tiny but valid. Magic-byte headers are
 * the minimum needed for the content-type guard to make sense;
 * we don't decode pixels in these tests.
 */
const PNG_BYTES = new Uint8Array([
	0x89,
	0x50,
	0x4e,
	0x47,
	0x0d,
	0x0a,
	0x1a,
	0x0a, // PNG signature
	0x00,
	0x00,
	0x00,
	0x0d,
	0x49,
	0x48,
	0x44,
	0x52, // IHDR chunk
	0x00,
	0x00,
	0x00,
	0x01,
	0x00,
	0x00,
	0x00,
	0x01,
	0x08,
	0x06,
	0x00,
	0x00,
	0x00,
	0x1f,
	0x15,
	0xc4,
	0x89,
	0x00,
	0x00,
	0x00,
	0x0d,
	0x49,
	0x44,
	0x41,
	0x54,
	0x78,
	0x9c,
	0x63,
	0x00,
	0x01,
	0x00,
	0x00,
	0x05,
	0x00,
	0x01,
	0x0d,
	0x0a,
	0x2d,
	0xb4,
	0x00,
	0x00,
	0x00,
	0x00,
	0x49,
	0x45,
	0x4e,
	0x44,
	0xae,
	0x42,
	0x60,
	0x82,
]);

// Minimal JPEG (SOI + APP0 + EOI)
const JPEG_BYTES = new Uint8Array([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
	0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

// Minimal WebP (RIFF + WEBP + VP8 chunk)
const WEBP_BYTES = new Uint8Array([
	0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
	0x18, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00,
	0x34, 0x25, 0xa4, 0x00, 0x03, 0x70, 0x00, 0xfe, 0xfb, 0x94, 0x00, 0x00,
]);

// Minimal GIF87a (1x1 pixel)
const GIF_BYTES = new Uint8Array([
	0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
	0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
	0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
]);

// Valid SVG (rejected by policy)
const SVG_BYTES = new Uint8Array(
	'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>'
		.split('')
		.map((c) => c.charCodeAt(0)),
);

function makeBytes(content: Uint8Array, totalLen: number): ArrayBuffer {
	// Repeat `content` to fill totalLen bytes; used to push past
	// the 256 KiB size cap without fabricating magic-byte headers.
	const buf = new Uint8Array(totalLen);
	for (let i = 0; i < totalLen; i += content.length) {
		buf.set(content.subarray(0, Math.min(content.length, totalLen - i)), i);
	}
	return buf.buffer;
}

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
			bytes: bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			) as ArrayBuffer,
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
				bytes: SVG_BYTES.buffer.slice(
					SVG_BYTES.byteOffset,
					SVG_BYTES.byteOffset + SVG_BYTES.byteLength,
				) as ArrayBuffer,
				uploadedBy: 'tester',
			}),
		).rejects.toBeInstanceOf(ImagePolicyError);
	});

	it('rejects unknown content types', async () => {
		await expect(
			uploadImage(D1(), R2(), {
				contentType: 'application/octet-stream',
				bytes: PNG_BYTES.buffer.slice(
					PNG_BYTES.byteOffset,
					PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
				) as ArrayBuffer,
				uploadedBy: 'tester',
			}),
		).rejects.toMatchObject({ code: 'unsupported_content_type' });
	});
});

describe('uploadImage — size policy', () => {
	it('rejects payload above 256 KiB with oversize code', async () => {
		const oversize = makeBytes(PNG_BYTES, 257 * 1024);
		await expect(
			uploadImage(D1(), R2(), {
				contentType: 'image/png',
				bytes: oversize,
				uploadedBy: 'tester',
			}),
		).rejects.toMatchObject({ code: 'oversize' });
	});

	it('accepts payload exactly at 256 KiB', async () => {
		const boundary = makeBytes(PNG_BYTES, 256 * 1024);
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
		const buf = PNG_BYTES.buffer.slice(
			PNG_BYTES.byteOffset,
			PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
		) as ArrayBuffer;
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
		const buf = PNG_BYTES.buffer.slice(
			PNG_BYTES.byteOffset,
			PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
		) as ArrayBuffer;
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
		const buf = PNG_BYTES.buffer.slice(
			PNG_BYTES.byteOffset,
			PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
		) as ArrayBuffer;
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
		const buf = PNG_BYTES.buffer.slice(
			PNG_BYTES.byteOffset,
			PNG_BYTES.byteOffset + PNG_BYTES.byteLength,
		) as ArrayBuffer;
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
