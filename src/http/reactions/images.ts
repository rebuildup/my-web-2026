import { reactionImageReferenced } from './reactions';
import {
	ALLOWED_IMAGE_CONTENT_TYPES,
	MAX_IMAGE_BYTES,
	type AllowedImageContentType,
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
 *   - Refuse (409) if any reaction references the image. Admin
 *     must first delete referencing reactions.
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
	const row = await db
		.prepare(
			`SELECT id, content_hash, content_type, size, r2_key, uploaded_by, uploaded_at
       FROM reaction_images WHERE id = ?1`,
		)
		.bind(id)
		.first<ReactionImageRow>();
	if (!row) {
		throw new ImagePolicyError('not_found', `image ${id} not found`);
	}
	if (await reactionImageReferenced(db, id)) {
		throw new ImageReferencedError(
			`image ${id} is referenced by one or more reactions; delete them first`,
		);
	}
	await media.delete(row.r2_key);
	await db.prepare('DELETE FROM reaction_images WHERE id = ?1').bind(id).run();
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
