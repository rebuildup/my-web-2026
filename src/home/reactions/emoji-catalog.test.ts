import { describe, expect, it } from 'vitest';
import {
	EMOJI_CATALOG,
	EMOJI_SLUG_REGEX,
	EMOJI_SLUGS,
	isKnownEmojiSlug,
	MAX_EMOJI_SLUG_LEN,
	resolveEmojiSlug,
	validateEmojiSlug,
} from './emoji-catalog';

/**
 * Emoji slug catalog — unit tests.
 *
 * These tests pin the slug grammar and the hard-coded catalog. The
 * catalog is replaced by the DB-backed catalog in Ticket G (branch
 * 39); at that point these tests continue to assert the **shape** of
 * the contract (slug grammar, public surface area) but the source of
 * the slug→glyph map moves to D1.
 */

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

describe('EMOJI_CATALOG', () => {
	it('has at least the documented first-pass vocabulary', () => {
		expect(EMOJI_CATALOG).toHaveProperty('thumbs_up', '👍');
		expect(EMOJI_CATALOG).toHaveProperty('tada', '🎉');
		expect(EMOJI_CATALOG).toHaveProperty('fire', '🔥');
		expect(EMOJI_CATALOG).toHaveProperty('rocket', '🚀');
	});

	it('every key passes EMOJI_SLUG_REGEX', () => {
		for (const key of Object.keys(EMOJI_CATALOG)) {
			expect(key).toMatch(EMOJI_SLUG_REGEX);
			expect(key.length).toBeLessThanOrEqual(MAX_EMOJI_SLUG_LEN);
		}
	});

	it('EMOJI_SLUGS is sorted and matches catalog keys', () => {
		const sortedKeys = [...Object.keys(EMOJI_CATALOG)].sort();
		expect(EMOJI_SLUGS).toEqual(sortedKeys);
	});
});

describe('isKnownEmojiSlug', () => {
	it('returns true for catalog slugs', () => {
		expect(isKnownEmojiSlug('thumbs_up')).toBe(true);
		expect(isKnownEmojiSlug('rocket')).toBe(true);
	});

	it('returns false for unknown slugs (even if they match the grammar)', () => {
		expect(isKnownEmojiSlug('unknown_future_slug')).toBe(false);
	});
});

describe('resolveEmojiSlug', () => {
	it('returns the catalog codepoint for known slugs', () => {
		expect(resolveEmojiSlug('thumbs_up')).toBe('👍');
		expect(resolveEmojiSlug('rocket')).toBe('🚀');
	});

	it('returns null for unknown slugs so callers can render a placeholder', () => {
		expect(resolveEmojiSlug('unknown_future_slug')).toBeNull();
	});
});

describe('validateEmojiSlug', () => {
	it('returns the slug when it is in the catalog', () => {
		expect(validateEmojiSlug('thumbs_up')).toBe('thumbs_up');
		expect(validateEmojiSlug('rocket')).toBe('rocket');
	});

	it('throws on non-string input', () => {
		expect(() => validateEmojiSlug(0)).toThrow(/must be a string/);
		expect(() => validateEmojiSlug(null)).toThrow(/must be a string/);
		expect(() => validateEmojiSlug(undefined)).toThrow(/must be a string/);
		expect(() => validateEmojiSlug({})).toThrow(/must be a string/);
	});

	it('throws on length violations', () => {
		expect(() => validateEmojiSlug('')).toThrow(/1\.\./);
		expect(() => validateEmojiSlug('a'.repeat(MAX_EMOJI_SLUG_LEN + 1))).toThrow(/1\.\./);
	});

	it('throws on malformed slugs even when length is OK', () => {
		expect(() => validateEmojiSlug('Thumbs_Up')).toThrow(/must match \^\[a-z\]/);
		expect(() => validateEmojiSlug('with-dash')).toThrow(/must match \^\[a-z\]/);
		expect(() => validateEmojiSlug('1leading')).toThrow(/must match \^\[a-z\]/);
	});

	it('throws on well-formed but unknown slugs', () => {
		expect(() => validateEmojiSlug('not_in_catalog')).toThrow(/unknown emoji slug/);
	});
});
