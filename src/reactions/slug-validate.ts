/**
 * Canonical slug / codepoint validators — re-exported by the catalog
 * module (`./emoji-catalog.ts`) for the home + admin loader paths.
 *
 * Lives at the top-level `reactions/` obligation; the home widget
 * loader, the admin loader, and any future automated import path all
 * depend on these pure helpers.
 *
 * Issue #433: `validateSlug` classifies through the shared Unicode
 * policy in `src/i18n/slug-identity.ts` instead of testing the regex
 * inline, so a non-ASCII candidate is refused as a POLICY decision with
 * a reason (rather than as an accident of the pattern) and no caller
 * grows its own normalisation step. The thrown messages below are
 * unchanged apart from the new non-ASCII case, which says what was
 * found and why it is not being folded into an ASCII URL.
 */

import { classifySlugCandidate, describeSlugRejection } from '../i18n/slug-identity.ts';
import { EMOJI_SLUG_GRAMMAR } from './slug-regex';

/** Maximum codepoint length in code units (a single emoji can be 1–4 UTF-16 code units). */
export const MAX_CODEPOINT_LEN = 16;

/**
 * Validate the slug format at the seam. The slug is the public
 * contract (`:slug:` regex, 1..16 chars — aligned to the reactions
 * API's `MAX_EMOJI_LEN`), so this validator is shared across the
 * home loader, the admin loaders, and any future automated import.
 */
export function validateSlug(value: unknown): string {
	const verdict = classifySlugCandidate(value, EMOJI_SLUG_GRAMMAR);
	if (verdict.ok) return verdict.slug;
	throw new Error(`emoji slug ${describeSlugRejection(verdict, EMOJI_SLUG_GRAMMAR)}`);
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
