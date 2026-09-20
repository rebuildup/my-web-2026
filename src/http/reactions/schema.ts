/**
 * Reactions + reaction-image schema.
 *
 * `migrations/0003_reactions.sql` is the source of truth for the
 * column shape; this file is the typed projection used by both the
 * router (`src/http/reactions/router.ts`) and the admin server
 * functions (`src/admin/images/load.ts`).
 *
 * Field conventions:
 *   - timestamps are Unix milliseconds (D1 has no native datetime).
 *   - `kind` is constrained to `'emoji' | 'image'` at the SQL layer;
 *     we narrow the type here to match.
 *   - `value` is either an emoji character (kind='emoji') or an
 *     image id (kind='image') referencing `reaction_images.id`.
 */

export type ReactionKind = 'emoji' | 'image';

export const REACTION_KINDS: readonly ReactionKind[] = ['emoji', 'image'] as const;

export const ALLOWED_IMAGE_CONTENT_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
] as const;

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export const MAX_IMAGE_BYTES = 256 * 1024;

export interface ReactionRow {
	id: string;
	target_key: string;
	actor_id: string;
	principal: string;
	kind: ReactionKind;
	value: string;
	created_at: number;
}

export interface ReactionImageRow {
	id: string;
	content_hash: string;
	content_type: AllowedImageContentType;
	size: number;
	r2_key: string;
	uploaded_by: string;
	uploaded_at: number;
}

export interface ReactionAggregate {
	kind: ReactionKind;
	value: string;
	count: number;
}

/** Maximum `target_key` length — opaque consumer-supplied string. */
export const MAX_TARGET_KEY_LEN = 256;
/** Maximum `actor_id` length — opaque consumer-supplied string. */
export const MAX_ACTOR_ID_LEN = 256;
/** Maximum emoji length (RFC suggests grapheme clusters; we cap codepoints). */
export const MAX_EMOJI_LEN = 16;

export function validateTargetKey(v: unknown): string {
	if (typeof v !== 'string' || v.length === 0 || v.length > MAX_TARGET_KEY_LEN) {
		throw new Error(`target_key must be 1..${MAX_TARGET_KEY_LEN} chars`);
	}
	return v;
}

export function validateActorId(v: unknown): string {
	if (typeof v !== 'string' || v.length === 0 || v.length > MAX_ACTOR_ID_LEN) {
		throw new Error(`actor_id must be 1..${MAX_ACTOR_ID_LEN} chars`);
	}
	return v;
}

export function validateReactionKind(v: unknown): ReactionKind {
	if (typeof v !== 'string') throw new Error('kind must be a string');
	if ((REACTION_KINDS as readonly string[]).includes(v)) return v as ReactionKind;
	throw new Error(`kind must be one of: ${REACTION_KINDS.join(', ')}`);
}

export function validateReactionValue(kind: ReactionKind, value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error('value must be a non-empty string');
	}
	if (kind === 'emoji' && value.length > MAX_EMOJI_LEN) {
		throw new Error(`emoji value must be ≤${MAX_EMOJI_LEN} codepoints`);
	}
	// image kind: value is an image id (≤64 chars hex / ulid-ish).
	if (kind === 'image' && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
		throw new Error('image value must match [A-Za-z0-9_-]{1,64}');
	}
	return value;
}
