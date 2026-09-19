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
 */

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
