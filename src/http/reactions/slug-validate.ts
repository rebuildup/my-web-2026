/**
 * Canonical slug / codepoint validators — re-exported by the catalog
 * module (`src/http/reactions/emoji-catalog.ts`) for the home + admin
 * loader paths.
 *
 * Kept in a tiny file so both the catalog module and the admin
 * load.ts can import without crossing the `home/` boundary.
 */

import { EMOJI_SLUG_REGEX, MAX_EMOJI_SLUG_LEN } from './slug-regex';

/** Maximum codepoint length in code units (a single emoji can be 1–4 UTF-16 code units). */
export const MAX_CODEPOINT_LEN = 16;

/**
 * Validate the slug format at the seam. The slug is the public
 * contract (`:slug:` regex, 1..16 chars — aligned to the reactions
 * API's `MAX_EMOJI_LEN`), so this validator is shared across the
 * home loader, the admin loaders, and any future automated import.
 */
export function validateSlug(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('emoji slug must be a string');
	}
	if (value.length === 0 || value.length > MAX_EMOJI_SLUG_LEN) {
		throw new Error(`emoji slug must be 1..${MAX_EMOJI_SLUG_LEN} chars`);
	}
	if (!EMOJI_SLUG_REGEX.test(value)) {
		throw new Error('emoji slug must match ^[a-z][a-z0-9_]*$');
	}
	return value;
}

/**
 * Validate the codepoint. We require a non-empty, printable string
 * with a sane upper bound (most emoji are ≤ 4 UTF-16 code units; we
 * allow a small cushion for variation selectors / ZWJ sequences).
 */
export function validateCodepoint(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('codepoint must be a string');
	}
	if (value.length === 0 || value.length > MAX_CODEPOINT_LEN) {
		throw new Error(`codepoint must be 1..${MAX_CODEPOINT_LEN} chars`);
	}
	// Reject control characters + DEL; allow all printable Unicode
	// (incl. ZWJ, variation selectors, flag emoji, etc.).
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code <= 0x1f || code === 0x7f) {
			throw new Error('codepoint must not contain control chars');
		}
	}
	return value;
}
