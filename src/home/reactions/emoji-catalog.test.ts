import { describe, expect, it } from 'vitest';
import {
	type CatalogEntry,
	EMOJI_SLUG_REGEX,
	MAX_EMOJI_SLUG_LEN,
	buildCatalogLookup,
	listActiveSlugs,
	resolveEmojiSlug,
	validateEmojiSlug,
} from './emoji-catalog';

/**
 * Home-side catalog facade — unit tests (Ticket G, branch 39).
 *
 * Branch 37's tests asserted the hard-coded `EMOJI_CATALOG` constant
 * and the synchronous `validateEmojiSlug(value)` signature. With the
 * DB-backed catalog, both move to "load catalog, then validate".
 * These tests pin the **new** contract: callers must supply a loaded
 * catalog to `validateEmojiSlug` and to `resolveEmojiSlug`. The slug
 * grammar itself is unchanged.
 */

const seededCatalog: readonly CatalogEntry[] = [
	{ slug: 'thumbs_up', codepoint: '👍', enabled: true },
	{ slug: 'rocket', codepoint: '🚀', enabled: true },
	{ slug: 'bulb', codepoint: '💡', enabled: false },
];

describe('EMOJI_SLUG_REGEX', () => {
	it('accepts the documented first-pass slugs', () => {
		expect(EMOJI_SLUG_REGEX.test('thumbs_up')).toBe(true);
		expect(EMOJI_SLUG_REGEX.test('a')).toBe(true);
		expect(EMOJI_SLUG_REGEX.test('rocket_v2')).toBe(true);
		expect(EMOJI_SLUG_REGEX.test('one23')).toBe(true);
	});

	it('rejects malformed slugs', () => {
		expect(EMOJI_SLUG_REGEX.test('Thumbs_Up')).toBe(false);
		expect(EMOJI_SLUG_REGEX.test('1leading_digit')).toBe(false);
		expect(EMOJI_SLUG_REGEX.test('-dash')).toBe(false);
		expect(EMOJI_SLUG_REGEX.test('with space')).toBe(false);
		expect(EMOJI_SLUG_REGEX.test('with-dash')).toBe(false);
		expect(EMOJI_SLUG_REGEX.test('')).toBe(false);
		expect(EMOJI_SLUG_REGEX.test('emoji-😀')).toBe(false);
	});
});

describe('listActiveSlugs', () => {
	it('returns the enabled slugs in input order', () => {
		// The DB loader returns rows sorted by slug; this helper
		// preserves input order and filters out disabled entries.
		expect(listActiveSlugs(seededCatalog)).toEqual(['thumbs_up', 'rocket']);
	});

	it('skips disabled entries', () => {
		expect(listActiveSlugs(seededCatalog)).not.toContain('bulb');
	});

	it('returns empty when every entry is disabled', () => {
		const disabled = seededCatalog.map((e) => ({ ...e, enabled: false }));
		expect(listActiveSlugs(disabled)).toEqual([]);
	});
});

describe('resolveEmojiSlug', () => {
	it('returns the codepoint for enabled slugs', () => {
		expect(resolveEmojiSlug(seededCatalog, 'thumbs_up')).toBe('👍');
		expect(resolveEmojiSlug(seededCatalog, 'rocket')).toBe('🚀');
	});

	it('returns null for disabled slugs', () => {
		expect(resolveEmojiSlug(seededCatalog, 'bulb')).toBeNull();
	});

	it('returns null for unknown slugs', () => {
		expect(resolveEmojiSlug(seededCatalog, 'unknown_future_slug')).toBeNull();
	});

	it('returns null for an empty catalog', () => {
		expect(resolveEmojiSlug([], 'thumbs_up')).toBeNull();
	});
});

describe('validateEmojiSlug', () => {
	it('returns the slug when it is in the catalog and enabled', () => {
		expect(validateEmojiSlug(seededCatalog, 'thumbs_up')).toBe('thumbs_up');
		expect(validateEmojiSlug(seededCatalog, 'rocket')).toBe('rocket');
	});

	it('throws on non-string input', () => {
		expect(() => validateEmojiSlug(seededCatalog, 0)).toThrow(/must be a string/);
		expect(() => validateEmojiSlug(seededCatalog, null)).toThrow(/must be a string/);
		expect(() => validateEmojiSlug(seededCatalog, undefined)).toThrow(/must be a string/);
		expect(() => validateEmojiSlug(seededCatalog, {})).toThrow(/must be a string/);
	});

	it('throws on length violations', () => {
		expect(() => validateEmojiSlug(seededCatalog, '')).toThrow(/1\.\./);
		expect(() => validateEmojiSlug(seededCatalog, 'a'.repeat(MAX_EMOJI_SLUG_LEN + 1))).toThrow(
			/1\.\./,
		);
	});

	it('throws on malformed slugs even when length is OK', () => {
		expect(() => validateEmojiSlug(seededCatalog, 'Thumbs_Up')).toThrow(/must match \^\[a-z\]/);
		expect(() => validateEmojiSlug(seededCatalog, 'with-dash')).toThrow(/must match \^\[a-z\]/);
		expect(() => validateEmojiSlug(seededCatalog, '1leading')).toThrow(/must match \^\[a-z\]/);
	});

	it('throws on well-formed but unknown slugs', () => {
		expect(() => validateEmojiSlug(seededCatalog, 'not_in_catalog')).toThrow(/unknown emoji slug/);
	});

	it('throws on disabled slugs (admin disabled them)', () => {
		expect(() => validateEmojiSlug(seededCatalog, 'bulb')).toThrow(/unknown emoji slug/);
	});
});

describe('buildCatalogLookup', () => {
	it('produces a map from every catalog slug to its codepoint or null', () => {
		const map = buildCatalogLookup(seededCatalog);
		expect(map.get('thumbs_up')).toBe('👍');
		expect(map.get('rocket')).toBe('🚀');
		expect(map.get('bulb')).toBeNull();
	});

	it('does not include unknown slugs', () => {
		const map = buildCatalogLookup(seededCatalog);
		expect(map.has('unknown_future_slug')).toBe(false);
	});
});
