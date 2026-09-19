/**
 * Slug regex / length constants — the canonical `:slug:` contract.
 *
 * Used by the DB-backed catalog (`src/http/reactions/emoji-catalog.ts`)
 * and re-exported from there. Kept in a tiny module so the contract
 * is a single import for both the home loader and the admin loader.
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
