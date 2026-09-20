import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
	ImagePolicyError,
	ImageReferencedError,
	deleteImage,
	listImages,
	uploadImage,
} from '../../http/reactions/images';
import { reactionImageReferenced } from '../../http/reactions/reactions';
import type { ReactionImageRow } from '../../http/reactions/schema';
import { requireAdmin } from '../auth/require-admin';

/**
 * Admin reaction-image server functions.
 *
 * Per ADR-0008, admin operations do not cross a Hono boundary — they
 * go directly from `createServerFn` to the project code. The
 * `cloudflare:workers` `env` import gives us the project's real D1 +
 * R2 bindings (the same ones `src/server.ts` exposes through Hono).
 *
 * Image content-type and size are validated on the server; the
 * admin UI also validates client-side for nicer UX. SVG is rejected
 * at the server. The delete path refuses when any reaction still
 * references the image (returns 409 Conflict-equivalent via thrown
 * error).
 */

const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

const MAX_BYTES = 256 * 1024;

const UploadInput = z.object({
	contentType: z.enum(ALLOWED_CONTENT_TYPES),
	bytes: z.string(), // base64 (standard encoding)
});

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
		const bytes = base64ToBytes(data.bytes);
		if (bytes.byteLength > MAX_BYTES) {
			throw new Error(`bytes must be ≤${MAX_BYTES}`);
		}
		const result = await uploadImage(env.DB, env.MEDIA, {
			contentType: data.contentType,
			bytes,
			// P1 review: previously hardcoded to 'admin', which
			// erased per-admin attribution. Use the authenticated
			// user id from the session shape (ADR-0009 §7).
			uploadedBy: session.user.id,
		});
		const referenced = await reactionImageReferenced(env.DB, result.image.id);
		return toAdminImage(result.image, referenced);
	});

const DeleteImageInput = z.object({ id: z.string().min(1).max(64) });

export const deleteReactionImage = createServerFn({ method: 'POST' })
	.validator(DeleteImageInput)
	.handler(async ({ data }): Promise<{ deleted: boolean }> => {
		await requireAdmin();
		try {
			await deleteImage(env.DB, env.MEDIA, data.id);
			return { deleted: true };
		} catch (err) {
			if (err instanceof ImageReferencedError) {
				throw new Error('image_referenced: delete referencing reactions first');
			}
			if (err instanceof ImagePolicyError) {
				throw new Error(`image_policy: ${err.message}`);
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
