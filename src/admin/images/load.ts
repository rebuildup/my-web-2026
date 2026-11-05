import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
	type ImagePolicyCode,
	ImagePolicyError,
	ImageReferencedError,
	deleteImage,
	listImages,
	uploadImage,
} from '../../http/reactions/images';
import { reactionImageReferenced } from '../../http/reactions/reactions';
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES } from '../../http/reactions/schema';
import type { AllowedImageContentType, ReactionImageRow } from '../../http/reactions/schema';
import { createAuditLogger } from '../../logging/logger';
import { requireAdmin } from '../auth/require-admin';

/**
 * Admin reaction-image server functions.
 *
 * Per ADR-0008, admin operations do not cross a Hono boundary — they
 * go directly from `createServerFn` to the project code. The
 * `cloudflare:workers` `env` import gives us the project's real D1 +
 * R2 bindings (the same ones `src/server.ts` exposes through Hono).
 *
 * Every rejection is a stable wire string (Issue #458): the upload
 * path sends `image_policy:<code>` and the delete path sends
 * `DELETE_REFERENCED_FAILURE`. The UI maps the CODE half of each to a
 * fixed Japanese sentence and shows a generic message for anything
 * else, so a failure never renders a raw server message. The
 * authoritative limits live in `src/http/reactions/schema.ts` — this
 * module imports them instead of restating them, so the client-side
 * form and the server cannot drift.
 *
 * Delete refuses when any reaction still references the image.
 */

const imagesLogger = createAuditLogger('admin.images');

/**
 * Exactly what `deleteReactionImage` rejects with when a reaction
 * still references the image.
 *
 * Exported so the failure-display contract can be asserted against
 * the value the server really sends instead of a hand-written copy of
 * it (#458 review: the UI matched a bare `image_referenced`, so this
 * string fell through to the generic upload sentence). The code is
 * what the UI acts on; the rationale after `:` is for the log.
 */
export const DELETE_REFERENCED_FAILURE = 'image_referenced: delete referencing reactions first';

const UploadInput = z.object({
	contentType: z.enum(ALLOWED_IMAGE_CONTENT_TYPES),
	/** Advisory only: validated, never stored, never part of the R2 key. */
	filename: z.string().max(512).optional(),
	bytes: z.string(), // base64 (standard encoding)
});

/**
 * Longest base64 payload that could still decode to ≤ `MAX_IMAGE_BYTES`.
 * Checked BEFORE decoding so an oversized body is refused without
 * allocating the decoded buffer.
 */
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** The only upload/delete failure shape the UI knows how to render. */
function policyError(code: ImagePolicyCode): Error {
	return new Error(`image_policy:${code}`);
}

export interface AdminImage {
	id: string;
	contentHash: string;
	contentType: string;
	size: number;
	r2Key: string;
	uploadedBy: string;
	uploadedAt: string;
	referenced: boolean;
}

export const listReactionImages = createServerFn({ method: 'GET' })
	.validator(z.object({}).strict())
	.handler(async (): Promise<readonly AdminImage[]> => {
		await requireAdmin();
		const rows = await listImages(env.DB);
		const annotated: AdminImage[] = [];
		for (const row of rows) {
			const referenced = await reactionImageReferenced(env.DB, row.id);
			annotated.push(toAdminImage(row, referenced));
		}
		return annotated;
	});

export const uploadReactionImage = createServerFn({ method: 'POST' })
	.validator(UploadInput)
	.handler(async ({ data }): Promise<AdminImage> => {
		const session = await requireAdmin();
		// Issue #377 — refuse the write while the runtime is bound to
		// production data (the upload would put bytes into the
		// production R2 bucket).
		const { assertAdminWriteAllowed } = await import('../read-only');
		await assertAdminWriteAllowed(env, 'admin:images:upload');
		return uploadReactionImageImpl({
			contentType: data.contentType,
			filename: data.filename,
			bytes: data.bytes,
			// P1 review: previously hardcoded to 'admin', which
			// erased per-admin attribution. Use the authenticated
			// user id from the session shape (ADR-0009 §7).
			uploadedBy: session.user.id,
		});
	});

export interface UploadReactionImageInput {
	contentType: AllowedImageContentType;
	filename?: string;
	/** base64 (standard encoding) of the raw file bytes. */
	bytes: string;
	uploadedBy: string;
}

/**
 * The admin upload path without the `createServerFn` wrapper.
 *
 * The wrapper needs TanStack Start's AsyncLocalStorage context, which
 * workerd tests do not provide — same split as
 * `src/admin/keys/load.ts`. Everything that decides whether bytes are
 * stored lives HERE, so the upload guard can be verified against the
 * real D1 / R2 bindings without a session.
 */
export async function uploadReactionImageImpl(
	input: UploadReactionImageInput,
): Promise<AdminImage> {
	// Pre-decode size guard: `base64ToBytes` would otherwise allocate
	// a buffer for an arbitrary client-supplied string.
	if (input.bytes.length > MAX_BASE64_CHARS) {
		throw policyError('oversize');
	}
	const bytes = base64ToBytes(input.bytes);
	if (bytes.byteLength > MAX_IMAGE_BYTES) {
		throw policyError('oversize');
	}
	let result: Awaited<ReturnType<typeof uploadImage>>;
	try {
		result = await uploadImage(env.DB, env.MEDIA, {
			contentType: input.contentType,
			bytes,
			filename: input.filename,
			uploadedBy: input.uploadedBy,
		});
	} catch (err) {
		if (err instanceof ImagePolicyError) {
			// The message carries the guard's rationale for the
			// server log; the code is what the UI is allowed to act on.
			imagesLogger.error('upload rejected:', err.code, err.message);
			throw policyError(err.code);
		}
		throw err;
	}
	const referenced = await reactionImageReferenced(env.DB, result.image.id);
	return toAdminImage(result.image, referenced);
}

const DeleteImageInput = z.object({ id: z.string().min(1).max(64) });

export const deleteReactionImage = createServerFn({ method: 'POST' })
	.validator(DeleteImageInput)
	.handler(async ({ data }): Promise<{ deleted: boolean }> => {
		await requireAdmin();
		// Issue #377 — refuse the write while the runtime is bound to
		// production data (the delete would remove a production R2
		// object and its D1 row).
		const { assertAdminWriteAllowed } = await import('../read-only');
		await assertAdminWriteAllowed(env, 'admin:images:delete');
		try {
			await deleteImage(env.DB, env.MEDIA, data.id);
			return { deleted: true };
		} catch (err) {
			if (err instanceof ImageReferencedError) {
				throw new Error(DELETE_REFERENCED_FAILURE);
			}
			if (err instanceof ImagePolicyError) {
				throw policyError(err.code);
			}
			throw err;
		}
	});

function toAdminImage(row: ReactionImageRow, referenced: boolean): AdminImage {
	return {
		id: row.id,
		contentHash: row.content_hash,
		contentType: row.content_type,
		size: row.size,
		r2Key: row.r2_key,
		uploadedBy: row.uploaded_by,
		uploadedAt: new Date(row.uploaded_at).toISOString(),
		referenced,
	};
}

function base64ToBytes(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}
