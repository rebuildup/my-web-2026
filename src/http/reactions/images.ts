import {
	ALLOWED_IMAGE_CONTENT_TYPES,
	type AllowedImageContentType,
	MAX_IMAGE_BYTES,
	type ReactionImageRow,
} from './schema';

/**
 * Reaction image upload / delete — admin path.
 *
 * Upload (Issue #458 hardened policy, cheapest check first):
 *   0. Reject an unsafe client-supplied file name (path separators,
 *      `..`, control characters, over-long). The name is advisory
 *      metadata: it is never persisted and never becomes part of an
 *      R2 key, but a traversal attempt is refused loudly instead of
 *      being silently ignored.
 *   1. Validate the DECLARED content-type (PNG / JPEG / WebP / GIF
 *      only; SVG excluded for MVP — active content risk).
 *   2. Validate size (≤256 KiB) and reject an empty payload.
 *   3. Inspect the MAGIC BYTES and require them to agree with the
 *      declaration. A declared type alone is attacker-controlled
 *      (`contentType` is a string on the wire), so a text/HTML/SVG
 *      body renamed to `.png` is rejected here.
 *   4. Compute SHA-256 content hash; reuse existing row + R2 object
 *      if the hash already exists (content-addressed dedup).
 *   5. Persist `reaction_images` row + R2 object at
 *      `reactions/{hash}.{ext}` — derived from the hash and a fixed
 *      extension map, never from caller input.
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

/** PNG: 8-byte signature. Byte-exact, so a text file cannot pass it. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** How many leading bytes are scanned for an `<svg` element. */
const SVG_SNIFF_BYTES = 1024;

/** Longest accepted client-supplied file name, in UTF-8 bytes. */
const MAX_FILENAME_BYTES = 255;

/**
 * Every rejection reason the upload policy can produce. The codes are
 * part of the admin failure contract: `src/admin/images/load.ts`
 * forwards them as `image_policy:<code>` and the UI maps each one to
 * a fixed Japanese sentence, so a rejection never has to render a raw
 * server message.
 */
export type ImagePolicyCode =
	| 'invalid_filename'
	| 'unsupported_content_type'
	| 'oversize'
	| 'empty_payload'
	| 'svg_not_allowed'
	| 'content_type_mismatch'
	| 'unrecognized_signature'
	| 'not_found';

/** What the bytes actually are — one of the accepted types, SVG, or unknown. */
export type DetectedImageContentType = AllowedImageContentType | 'image/svg+xml';

export interface UploadInput {
	contentType: string;
	bytes: ArrayBuffer;
	uploadedBy: string;
	/**
	 * Advisory client-supplied name. Validated, never stored, never
	 * part of the R2 key — see `isSafeUploadFilename`.
	 */
	filename?: string;
	now?: number;
}

export interface UploadResult {
	image: ReactionImageRow;
	reused: boolean;
}

export class ImagePolicyError extends Error {
	constructor(
		public readonly code: ImagePolicyCode,
		message: string,
	) {
		super(message);
		this.name = 'ImagePolicyError';
	}
}

function matchesBytesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
	if (bytes.length < offset + expected.length) return false;
	for (let i = 0; i < expected.length; i++) {
		if (bytes[offset + i] !== expected[i]) return false;
	}
	return true;
}

function matchesAscii(bytes: Uint8Array, offset: number, tag: string): boolean {
	if (bytes.length < offset + tag.length) return false;
	for (let i = 0; i < tag.length; i++) {
		if (bytes[offset + i] !== tag.charCodeAt(i)) return false;
	}
	return true;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
	const head = String.fromCharCode(...bytes.subarray(0, SVG_SNIFF_BYTES));
	return /<\s*svg[\s/>]/i.test(head);
}

/**
 * Identify an upload from its leading bytes.
 *
 * Signature-based only — no full decode, no image library. That is
 * deliberate: the point of the check is to refuse a body whose bytes
 * disagree with the declared type, which a header comparison answers
 * without trusting the payload at all. `null` means "no accepted
 * format matches"; the declared type then cannot be confirmed.
 */
export function sniffImageContentType(bytes: Uint8Array): DetectedImageContentType | null {
	if (bytes.length === 0) return null;
	if (matchesBytesAt(bytes, 0, PNG_SIGNATURE)) return 'image/png';
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (matchesAscii(bytes, 0, 'GIF87a') || matchesAscii(bytes, 0, 'GIF89a')) return 'image/gif';
	if (matchesAscii(bytes, 0, 'RIFF') && matchesAscii(bytes, 8, 'WEBP')) return 'image/webp';
	if (looksLikeSvg(bytes)) return 'image/svg+xml';
	return null;
}

/**
 * A file name is acceptable only when it is a plain name.
 *
 * Rejected: empty, over `MAX_FILENAME_BYTES`, leading/trailing
 * whitespace, `/` or `\`, any `..` (traversal at any depth), `.`, and
 * C0/DEL control characters. Non-ASCII (e.g. Japanese) names are fine
 * — the rule targets traversal and control characters, not script.
 */
export function isSafeUploadFilename(filename: string): boolean {
	if (filename.length === 0 || filename === '.' || filename.includes('..')) return false;
	if (filename !== filename.trim()) return false;
	if (filename.includes('/') || filename.includes('\\')) return false;
	if (new TextEncoder().encode(filename).length > MAX_FILENAME_BYTES) return false;
	for (const char of filename) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) return false;
	}
	return true;
}

/**
 * Run the whole upload policy and return the validated content-type.
 *
 * Order is cheapest-first so a hostile request is refused before any
 * hashing or storage work happens. Throws `ImagePolicyError` with the
 * specific code; never mutates D1 / R2.
 */
export function assertImageUploadPolicy(input: {
	contentType: string;
	bytes: ArrayBuffer;
	filename?: string;
}): AllowedImageContentType {
	if (input.filename !== undefined && !isSafeUploadFilename(input.filename)) {
		throw new ImagePolicyError(
			'invalid_filename',
			`filename must be a plain name of at most ${MAX_FILENAME_BYTES} bytes with no path separator, '..' or control character`,
		);
	}
	if (!(ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(input.contentType)) {
		throw new ImagePolicyError(
			'unsupported_content_type',
			`content_type must be one of: ${ALLOWED_IMAGE_CONTENT_TYPES.join(', ')}`,
		);
	}
	if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
		throw new ImagePolicyError('oversize', `bytes must be ≤${MAX_IMAGE_BYTES}`);
	}
	if (input.bytes.byteLength === 0) {
		throw new ImagePolicyError('empty_payload', 'bytes must not be empty');
	}
	const detected = sniffImageContentType(new Uint8Array(input.bytes));
	if (detected === 'image/svg+xml') {
		throw new ImagePolicyError('svg_not_allowed', 'SVG carries active content and is not accepted');
	}
	if (detected === null) {
		throw new ImagePolicyError(
			'unrecognized_signature',
			'leading bytes match none of the accepted image signatures',
		);
	}
	if (detected !== input.contentType) {
		throw new ImagePolicyError(
			'content_type_mismatch',
			`declared ${input.contentType} but the leading bytes are ${detected}`,
		);
	}
	return input.contentType as AllowedImageContentType;
}

/**
 * Content-addressed object key.
 *
 * Built only from the SHA-256 hex digest and the fixed extension map,
 * so no caller-supplied string (file name included) can steer the key.
 * The digest shape assertion is an internal invariant — a non-hex hash
 * would mean the hash computation itself is broken, which is a
 * programming error rather than a request-level policy failure.
 */
function buildR2Key(contentHash: string, contentType: AllowedImageContentType): string {
	if (!/^[0-9a-f]{64}$/.test(contentHash)) {
		throw new Error('content hash must be 64 lowercase hex characters');
	}
	return `reactions/${contentHash}.${EXT_BY_CONTENT_TYPE[contentType]}`;
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
	const contentType = assertImageUploadPolicy(input);
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
	const r2Key = buildR2Key(hash, contentType);
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
