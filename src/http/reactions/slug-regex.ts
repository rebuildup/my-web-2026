/**
 * Slug regex / length constants — the canonical `:slug:` contract.
 *
 * Used by the DB-backed catalog (`src/http/reactions/emoji-catalog.ts`)
 * and re-exported from there. Kept in a tiny module so the contract
 * is a single import for both the home loader and the admin loader.
 */

export const EMOJI_SLUG_REGEX = /^[a-z][a-z0-9_]*$/;

/** Maximum slug length in characters (Ticket E contract). */
export const MAX_EMOJI_SLUG_LEN = 32;
