import { describe, expect, it } from 'vitest';
import { isPublicMediaKey } from '../cloudflare/media-visibility';
import { composeMediaUrl, isValidR2Key } from './media';

/**
 * `composeMediaUrl` tests (Issue #77, Decision 5).
 *
 *   - Returns `null` when the R2 binding is missing.
 *   - Returns `null` when `MEDIA_PUBLIC_BASE_URL` is missing.
 *   - Returns `https://media.example.com/<key>` when both are
 *     configured.
 *   - Trailing slashes in the base URL are normalised.
 *   - Invalid keys always resolve to `null`.
 *   - Keys outside a declared public namespace resolve to `null`
 *     (#459 — the R2 visibility boundary).
 */

describe('composeMediaUrl — Decision 5 — R2 custom domain', () => {
	it('returns null when MEDIA is unbound', () => {
		const env = { MEDIA: undefined, MEDIA_PUBLIC_BASE_URL: 'https://media.example.com' };
		expect(composeMediaUrl(env, 'portfolio/cover.webp')).toBeNull();
	});

	it('returns null when MEDIA_PUBLIC_BASE_URL is not configured', () => {
		const env = {
			MEDIA: {} as R2Bucket,
			MEDIA_PUBLIC_BASE_URL: undefined,
		};
		expect(composeMediaUrl(env, 'portfolio/cover.webp')).toBeNull();
	});

	it('returns the custom-domain URL when both are configured', () => {
		const env = {
			MEDIA: {} as R2Bucket,
			MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
		};
		expect(composeMediaUrl(env, 'portfolio/cover.webp')).toBe(
			'https://media.example.com/portfolio/cover.webp',
		);
	});

	it('strips trailing slashes from the base URL', () => {
		const env = {
			MEDIA: {} as R2Bucket,
			MEDIA_PUBLIC_BASE_URL: 'https://media.example.com/',
		};
		expect(composeMediaUrl(env, 'portfolio/aulymo/cover.webp')).toBe(
			'https://media.example.com/portfolio/aulymo/cover.webp',
		);
	});

	it('returns null on an invalid R2 key', () => {
		const env = {
			MEDIA: {} as R2Bucket,
			MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
		};
		expect(composeMediaUrl(env, '../etc/passwd')).toBeNull();
		expect(composeMediaUrl(env, '')).toBeNull();
	});

	// Issue #459 — R2 visibility boundary. The custom domain serves
	// every key in the bucket, so composing a URL IS publishing. Only a
	// key under a declared public prefix may become one.
	it.each([
		['private/draft/secret.webp', 'declared private namespace'],
		['draft/cover.webp', 'draft namespace'],
		['staging/wip.webp', 'staging namespace'],
		['wip/aulymo/cover.webp', 'undeclared namespace'],
		['cover.webp', 'namespace-less key'],
	])('returns null for %s (%s)', (key) => {
		const env = {
			MEDIA: {} as R2Bucket,
			MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
		};
		expect(composeMediaUrl(env, key)).toBeNull();
	});

	it('composes the reactions namespace used by reaction images', () => {
		const env = {
			MEDIA: {} as R2Bucket,
			MEDIA_PUBLIC_BASE_URL: 'https://media.example.com',
		};
		expect(composeMediaUrl(env, 'reactions/deadbeef.png')).toBe(
			'https://media.example.com/reactions/deadbeef.png',
		);
	});
});

describe('isValidR2Key', () => {
	it('accepts canonical keys', () => {
		expect(isValidR2Key('portfolio/cover.webp')).toBe(true);
		expect(isValidR2Key('a.webp')).toBe(true);
		expect(isValidR2Key('project-init/cover-1.webp')).toBe(true);
	});

	it('rejects traversal attempts', () => {
		expect(isValidR2Key('../foo')).toBe(false);
		expect(isValidR2Key('a/../b')).toBe(false);
		expect(isValidR2Key('')).toBe(false);
	});

	it('rejects keys with disallowed characters', () => {
		expect(isValidR2Key('foo bar')).toBe(false);
		expect(isValidR2Key('foo?bar')).toBe(false);
		expect(isValidR2Key('/leading-slash')).toBe(false);
	});

	// `isValidR2Key` answers "is this a well-formed key" and is NOT the
	// visibility gate — a private key is a perfectly valid key. The
	// pair is pinned here so nobody swaps one for the other.
	it('does not imply public servability', () => {
		expect(isValidR2Key('private/draft/secret.webp')).toBe(true);
		expect(isPublicMediaKey('private/draft/secret.webp')).toBe(false);
	});
});
