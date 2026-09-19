/**
 * Reaction emoji slug catalog — **0.3.0 home-only, hard-coded**.
 *
 * The home reactions widget stores reaction values as opaque
 * `:slug:` strings (e.g. `:thumbs_up:`) rather than literal emoji
 * codepoints. Storing slugs keeps the data opaque (the reactions API
 * already treats `value` as an opaque string ≤16 chars), lets admins
 * add or rebind a slug without touching every existing reaction, and
 * avoids depending on the visitor's device emoji font.
 *
 * In 0.3.0 the catalog is **hard-coded** here as the simplest
 * correct shape — no DB, no admin UI. Ticket G (branch 39) moves it
 * to a `reaction_emoji_catalog` D1 table with admin CRUD; that
 * release replaces this catalog with `loadCatalog(db)` and keeps
 * the same slug format.
 *
 * Slug rules (validated by `validateEmojiSlug`):
 *   - lowercase `[a-z]` start, then `[a-z0-9_]*`
 *   - length 1..32
 *
 * The hard-coded set below covers the editorial spread's first-pass
 * vocabulary. New entries are added in source code; removing a slug
 * does NOT remove existing reactions (the slug is a stable opaque
 * key), only hides the chip on the home page.
 */

export const EMOJI_SLUG_REGEX = /^[a-z][a-z0-9_]*$/;
export const MAX_EMOJI_SLUG_LEN = 32;

/**
 * Slug → emoji codepoint. The codepoints are deliberately chosen
 * from the most common device-font set so visitors on stock iOS /
 * macOS / Android / Windows see the intended glyph.
 */
export const EMOJI_CATALOG: Readonly<Record<string, string>> = {
	thumbs_up: '👍',
	tada: '🎉',
	fire: '🔥',
	eyes: '👀',
	sparkles: '✨',
	rocket: '🚀',
	heart: '❤',
	laughing: '😄',
	thinking: '🤔',
	clap: '👏',
	wave: '👋',
	check: '✅',
	cross: '❌',
	warning: '⚠️',
	star: '⭐',
	bulb: '💡',
};

/** Sorted slug list — useful for the picker UI. */
export const EMOJI_SLUGS: readonly string[] = Object.keys(EMOJI_CATALOG).sort();

export function isKnownEmojiSlug(slug: string): boolean {
	return Object.hasOwn(EMOJI_CATALOG, slug);
}

/**
 * Resolve a slug to its emoji codepoint. Returns `null` when the slug
 * is not in the catalog so the caller can render an inert placeholder
 * rather than the raw `:slug:` text. New DB-backed entries that have
 * not yet been propagated to the catalog still render their literal
 * `:slug:` text on the home (the reactions API is unaffected).
 */
export function resolveEmojiSlug(slug: string): string | null {
	return EMOJI_CATALOG[slug] ?? null;
}

export function validateEmojiSlug(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('emoji slug must be a string');
	}
	if (value.length === 0 || value.length > MAX_EMOJI_SLUG_LEN) {
		throw new Error(`emoji slug must be 1..${MAX_EMOJI_SLUG_LEN} chars`);
	}
	if (!EMOJI_SLUG_REGEX.test(value)) {
		throw new Error('emoji slug must match ^[a-z][a-z0-9_]*$');
	}
	if (!isKnownEmojiSlug(value)) {
		throw new Error(`unknown emoji slug: ${value}`);
	}
	return value;
}
