/**
 * Content-signal assignment (Issue #764, direction B / colour system III).
 *
 * Direction B keeps the page monochrome and treats saturated colour as
 * a signal. A CONTENT signal — "this project is a design project",
 * "this note is long-form writing" — is not the operation hue and not
 * a status; it is a hue derived from the content itself, so a reader
 * can tell two items apart without the platform inventing a fixed
 * rainbow per screen.
 *
 * The rule this module owns is the ASSIGNMENT, not the palette:
 *
 *   - a seed (a category id or a slug) maps to one of the families in
 *     `signal.content.*` deterministically — the same seed always
 *     produces the same family, in every session, on every machine;
 *   - the THREE shipped content categories keep the hue they already
 *     had (`design` rose, `code` cyan, `writing` amber). Issue #812
 *     adopted colour system III, which fixes the content classes at
 *     exactly three: a Tool is not a content class and therefore has
 *     no colour face at all — the operation hue (ink) carries it;
 *   - an unknown seed is hashed (FNV-1a, 32 bit) and indexed into the
 *     family list. The hash is an assignment function, not a security
 *     function: collisions are expected and harmless, and there is no
 *     randomness, so a rendered page is reproducible.
 *
 * The caller receives a token PATH, not a hex. The hex pair lives in
 * `semantic-tokens.ts` (`signal.content.<family>`), so the palette can
 * move without changing the assignment rule.
 *
 * Two things this module deliberately does NOT do:
 *
 *   - it does not pick a family from the number of items on screen
 *     (that would make the same item change colour between pages);
 *   - it does not treat the family as the message. A content signal is
 *     always paired with a word or a `StateMark` silhouette, and the
 *     colour is rendered as one line / one word / one pill — never as
 *     a surface fill. See `src/editorial/colors.md`.
 */

/**
 * The stable assignment order. This order is part of the contract:
 * reordering it re-colours every unknown seed, so it is append-only.
 *
 * Exactly three families is also a contract (Issue #812): the owner
 * adopted colour system III, in which a single screen carries at most
 * three content hues. Adding a fourth family here would re-introduce
 * the reviewed-and-rejected variation.
 */
export const CONTENT_SIGNAL_FAMILIES = ['rose', 'cyan', 'amber'] as const;

export type ContentSignalFamily = (typeof CONTENT_SIGNAL_FAMILIES)[number];

/**
 * The three shipped content categories, kept on their existing hue. A
 * Tool is deliberately absent: under colour system III the Tool face
 * is ink, not a content hue, so a `tool` seed falls through the hash
 * path like any other unknown seed rather than being granted a fourth
 * colour.
 */
const CATEGORY_FAMILY: Readonly<Record<string, ContentSignalFamily>> = {
	design: 'rose',
	code: 'cyan',
	writing: 'amber',
};

/**
 * FNV-1a, 32 bit. Chosen because it is short, has no dependency and
 * is stable across JavaScript engines; the output is only used as an
 * index, so its distribution quality only needs to be good enough to
 * avoid a systematic bias toward the first family.
 */
export function hashContentSeed(seed: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < seed.length; index += 1) {
		hash ^= seed.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Assign a seed to a content-hue family.
 *
 * An empty seed is not a category and carries no content identity, so
 * it falls through the same hash path as any other unknown seed
 * rather than being special-cased to the first family.
 */
export function contentSignalFamily(seed: string): ContentSignalFamily {
	const known = CATEGORY_FAMILY[seed];
	if (known) return known;
	const index = hashContentSeed(seed) % CONTENT_SIGNAL_FAMILIES.length;
	return CONTENT_SIGNAL_FAMILIES[index];
}

/**
 * The semantic token path a consumer paints with, e.g.
 * `signal.content.rose`.
 */
export function contentSignalToken(seed: string): string {
	return `signal.content.${contentSignalFamily(seed)}`;
}
