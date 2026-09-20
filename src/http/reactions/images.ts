import {
	ALLOWED_IMAGE_CONTENT_TYPES,
	type AllowedImageContentType,
	MAX_IMAGE_BYTES,
	type ReactionImageRow,
} from './schema';

/**
 * Reaction image upload / delete — admin path.
 *
 * Upload:
 *   1. Validate content-type (PNG / JPEG / WebP / GIF only; SVG
 *      excluded for MVP — active content risk).
 *   2. Validate size (≤256 KiB).
 *   3. Compute SHA-256 content hash; reuse existing row + R2 object
 *      if the hash already exists (content-addressed dedup).
 *   4. Persist `reaction_images` row + R2 object at
 *      `reactions/{hash}.{ext}`.
 *
 * Delete:
 *   - The check-then-delete sequence (lookup → isReferenced? → R2
 *     delete → DB delete) had a TOCTOU window: a concurrent
 *     `putReaction` between the reference check and the DB delete
 *     could insert a reaction row pointing at the now-orphaned
 *     image (P1 review finding #5). The fix is a single
 *     conditional DELETE that atomically claims the row only when
 *     no reaction references it; the R2 cleanup is a best-effort
 *     follow-up. If the conditional DELETE returns 0 rows we
 *     disambiguate 404 (image absent) vs 409 (image now referenced)
 *     with a follow-up read.
 *
 * Read:
 *   - `getImageStream(db, media, id)` — public read by image id,
 *     used by `GET /api/v1/reaction-images/:id`. Streams from R2
 *     with `Cache-Control: public, max-age=31536000, immutable`.
 */

const EXT_BY_CONTENT_TYPE: Record<AllowedImageContentType, string> = {
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
};

export interface UploadInput {
	contentType: string;
	bytes: ArrayBuffer;
	uploadedBy: string;
	now?: number;
}

export interface UploadResult {
	image: ReactionImageRow;
	reused: boolean;
}

export class ImagePolicyError extends Error {
	constructor(
		public readonly code: 'unsupported_content_type' | 'oversize' | 'not_found',
		message: string,
	) {
		super(message);
		this.name = 'ImagePolicyError';
	}
}

export class ImageReferencedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageReferencedError';
	}
}

export async function uploadImage(
	db: D1Database,
	media: R2Bucket,
	input: UploadInput,
): Promise<UploadResult> {
	if (!(ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
		throw new ImagePolicyError(
			'unsupported_content_type',
			`content_type must be one of: ${ALLOWED_IMAGE_CONTENT_TYPES.join(', ')}`,
		);
	}
	if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
		throw new ImagePolicyError('oversize', `bytes must be ≤${MAX_IMAGE_BYTES}`);
	}
	const contentType = input.contentType as AllowedImageContentType;
	const hashBytes = await crypto.subtle.digest('SHA-256', input.bytes);
	const hash = Array.from(new Uint8Array(hashBytes), (b) => b.toString(16).padStart(2, '0')).join(
		'',
	);

	const existing = await db
		.prepare(
			`SELECT id, content_hash, content_type, size, r2_key, uploaded_by, uploaded_at
       FROM reaction_images WHERE content_hash = ?1`,
		)
		.bind(hash)
		.first<ReactionImageRow>();
	if (existing) {
		return { image: existing, reused: true };
	}

	const id = crypto.randomUUID();
	const ext = EXT_BY_CONTENT_TYPE[contentType];
	const r2Key = `reactions/${hash}.${ext}`;
	await media.put(r2Key, input.bytes, {
		httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
	});
	const now = input.now ?? Date.now();
	await db
		.prepare(
			`INSERT INTO reaction_images (id, content_hash, content_type, size, r2_key, uploaded_by, uploaded_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
		)
		.bind(id, hash, contentType, input.bytes.byteLength, r2Key, input.uploadedBy, now)
		.run();
	const row: ReactionImageRow = {
		id,
		content_hash: hash,
		content_type: contentType,
		size: input.bytes.byteLength,
		r2_key: r2Key,
		uploaded_by: input.uploadedBy,
		uploaded_at: now,
	};
	return { image: row, reused: false };
}

export async function deleteImage(db: D1Database, media: R2Bucket, id: string): Promise<void> {
	// DB-first claim: atomically delete the reaction_images row only
	// if no reaction references it. This closes the TOCTOU window
	// between "check referenced" and "delete row" (P1 review finding
	// #5): a concurrent `putReaction` cannot interleave because the
	// conditional DELETE either wins the slot and removes the row
	// or sees the new reaction and returns 0 rows.
	const claimed = await db
		.prepare(
			`DELETE FROM reaction_images
       WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM reactions WHERE kind = 'image' AND value = ?1)
       RETURNING r2_key`,
		)
		.bind(id)
		.first<{ r2_key: string }>();
	if (!claimed) {
		// Disambiguate 404 (image absent) vs 409 (image now
		// referenced) so the HTTP layer can return the right status.
		const exists = await db
			.prepare('SELECT 1 AS one FROM reaction_images WHERE id = ?1')
			.bind(id)
			.first<{ one: number }>();
		if (!exists) {
			throw new ImagePolicyError('not_found', `image ${id} not found`);
		}
		throw new ImageReferencedError(
			`image ${id} is referenced by one or more reactions; delete them first`,
		);
	}
	// Best-effort R2 cleanup. The DB row is already gone, so no
	// future reaction can reference this image; an orphan R2 object
	// is harmless and can be GC'd by a future sweep.
	try {
		await media.delete(claimed.r2_key);
	} catch (err) {
		console.error('[reactions.images] R2 delete failed (orphan):', claimed.r2_key, err);
	}
}

export async function listImages(db: D1Database): Promise<readonly ReactionImageRow[]> {
	const rows = await db
		.prepare(
			`SELECT id, content_hash, content_type, size, r2_key, uploaded_by, uploaded_at
       FROM reaction_images ORDER BY uploaded_at DESC`,
		)
		.all<ReactionImageRow>();
	return rows.results ?? [];
}

export async function getImageStream(
	db: D1Database,
	media: R2Bucket,
	id: string,
): Promise<{
	body: ReadableStream;
	contentType: string;
	cacheControl: string;
} | null> {
	const row = await db
		.prepare('SELECT r2_key, content_type FROM reaction_images WHERE id = ?1')
		.bind(id)
		.first<{ r2_key: string; content_type: string }>();
	if (!row) return null;
	const object = await media.get(row.r2_key);
	if (!object) return null;
	return {
		body: object.body,
		contentType: row.content_type,
		cacheControl: 'public, max-age=31536000, immutable',
	};
}
