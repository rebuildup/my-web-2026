/**
 * Slug regex / length constants — the canonical `:slug:` contract
 * for the reactions domain.
 *
 * This file lives at the top-level `reactions/` obligation (NOT under
 * `http/`) because the slug grammar is owned by `home/` and `admin/`
 * jointly: the home widget stores each slug as the opaque `value` of
 * a `kind: 'emoji'` reaction, the admin surface manages the catalog
 * of `slug → glyph` mappings, and the HTTP boundary itself has no
 * use for the catalog. ADR-0008 §2 calls this out as the canonical
 * shape: a resource owned jointly by two obligations becomes its
 * own owner.
 *
 * Issue #433: the grammar is also published as a `SlugGrammar`
 * descriptor so the Unicode policy in `src/i18n/slug-identity.ts` can
 * classify a candidate without any caller re-deriving the pattern. The
 * descriptor stays HERE — this file owns the grammar; `i18n` only owns
 * the rule for applying it.
 */

import type { SlugGrammar } from '../i18n/slug-identity';

export const EMOJI_SLUG_REGEX = /^[a-z][a-z0-9_]*$/;

/**
 * Maximum slug length in characters.
 *
 * The home widget stores each slug AS the opaque `value` of a
 * `kind: 'emoji'` reaction. `src/http/reactions/schema.ts`
 * `MAX_EMOJI_LEN` constrains that value to 16 chars; admin slugs
 * longer than 16 would silently 400 at PUT/DELETE via the reactions
 * API. We align the catalog contract to the reactions API so admin
 * can register any slug the reaction flow can carry.
 */
export const MAX_EMOJI_SLUG_LEN = 16;

/**
 * The reactions slug grammar as one value, for the Unicode policy
 * (`src/i18n/slug-identity.ts`) and for anything else that needs the
 * contract as data rather than as two constants it has to remember to
 * pass together.
 */
export const EMOJI_SLUG_GRAMMAR: SlugGrammar = {
	name: 'emoji-slug',
	pattern: EMOJI_SLUG_REGEX,
	maxLength: MAX_EMOJI_SLUG_LEN,
};
