import { describe, expect, it } from 'vitest';
import {
	CANONICAL_ORIGIN,
	DEFERRED_SURFACES,
	FALLBACK_CARD,
	FALLBACK_CARD_URL,
	OG_TYPES,
	ROUTE_COVERAGE,
	SITE_LOCALE,
	SITE_NAME,
	composeSocialCard,
	fallbackCardImage,
	resolveCardImage,
} from './index';

/**
 * Composer unit tests (Issue #421).
 *
 * Scope note: these tests assert what the composer DECIDES. The
 * document a crawler actually receives is asserted once more, against
 * real SSR HTML, by `test/integration/ogp-card.test.ts` — because the
 * head merge and the SSR render are exactly the parts a composer unit
 * test cannot see.
 *
 * Every rule below has a negative control, so this file cannot pass by
 * accepting everything.
 */

const CONTENT_IMAGE = {
	url: 'https://media.rebuildup.dev/portfolio/my-web-2026/cover.png',
	alt: '作品詳細画面のカバー',
	width: 1600,
	height: 900,
};

const BASE = {
	title: 'my-web-2026 — Portfolio',
	socialTitle: 'my-web-2026',
	description: 'SEO head gate fixture project. Not real portfolio copy.',
	url: `${CANONICAL_ORIGIN}/portfolio/my-web-2026`,
	ogType: 'article',
} as const;

/** Read a meta descriptor list as a `{ property|name: content }` map. */
function toMap(meta: readonly Record<string, string>[]) {
	const map = new Map<string, string>();
	for (const tag of meta) {
		const key = tag.property ?? tag.name;
		if (key !== undefined) map.set(key, tag.content);
	}
	return map;
}

describe('social card contract (contract.json)', () => {
	it('declares the canonical origin the platform publishes', () => {
		expect(CANONICAL_ORIGIN).toBe('https://rebuildup.dev');
		expect(SITE_NAME.length).toBeGreaterThan(0);
		expect(SITE_LOCALE).toMatch(/^[a-z]{2}_[A-Z]{2}$/);
	});

	it('declares a fetchable fallback card with its own alt and size', () => {
		expect(FALLBACK_CARD.path.startsWith('/')).toBe(true);
		expect(FALLBACK_CARD_URL).toBe(`${CANONICAL_ORIGIN}${FALLBACK_CARD.path}`);
		expect(FALLBACK_CARD.alt.trim().length).toBeGreaterThan(0);
		expect(FALLBACK_CARD.width).toBeGreaterThan(0);
		expect(FALLBACK_CARD.height).toBeGreaterThan(0);
		// A fallback that is not itself a large image would make
		// `summary_large_image` a lie.
		expect(FALLBACK_CARD.width / FALLBACK_CARD.height).toBeGreaterThan(1.5);
		// The reason is part of the contract, not a comment: it is what
		// the verification report prints next to a fallback row.
		expect(FALLBACK_CARD.reason.length).toBeGreaterThan(40);
		expect(FALLBACK_CARD.generator).toBe('scripts/generate-og-fallback-card.mjs');
	});

	it('covers every non-admin route with a note and an allowed og:type', () => {
		const covered = ROUTE_COVERAGE.map((entry) => entry.path).sort();
		expect(covered).toEqual(
			[
				'/',
				'/about',
				'/contact',
				'/design-system',
				'/keyboard',
				'/portfolio/',
				'/portfolio/$slug',
				'/projects/dotfiles',
				'/tools/',
				'/tools/$slug',
			].sort(),
		);
		for (const entry of ROUTE_COVERAGE) {
			expect(entry.note.trim().length, `${entry.path} needs a note`).toBeGreaterThan(20);
			expect(entry.samplePath.startsWith('/'), `${entry.path} samplePath`).toBe(true);
			if (entry.status === 'implemented') {
				expect(OG_TYPES, `${entry.path} og:type`).toContain(entry.ogType);
				expect(entry.cardPolicy, `${entry.path} implements a card`).toBe('content-first');
			} else {
				expect(entry.ogType, `${entry.path} declares no og:type`).toBeUndefined();
				expect(entry.cardPolicy, `${entry.path} publishes no card image`).toBe('none');
			}
		}
	});

	it('declares the article surface as deferred, with a reason', () => {
		// Issue #421 names 記事. The repository has no article route, so
		// the contract must say so explicitly rather than let the gap
		// read as "nothing to check".
		expect(DEFERRED_SURFACES.map((surface) => surface.id)).toEqual(['articles']);
		const articles = ROUTE_COVERAGE.filter((entry) => entry.path.includes('article'));
		expect(articles).toEqual([]);
		const [deferred] = DEFERRED_SURFACES;
		expect(deferred.reason.trim().length).toBeGreaterThan(40);
		expect(deferred.reason).toContain('route tree');
	});
});

describe('resolveCardImage', () => {
	it('accepts an absolute content image with alt text', () => {
		const resolved = resolveCardImage(CONTENT_IMAGE);
		expect(resolved).toEqual({
			url: CONTENT_IMAGE.url,
			source: 'content',
			alt: CONTENT_IMAGE.alt,
			width: 1600,
			height: 900,
		});
	});

	it('rejects a relative URL (a crawler cannot fetch it)', () => {
		expect(resolveCardImage({ url: '/portfolio/my-web-2026/cover.png', alt: 'a' })).toBeNull();
	});

	it('rejects a non-http scheme', () => {
		expect(resolveCardImage({ url: 'data:image/png;base64,AAAA', alt: 'a' })).toBeNull();
		expect(resolveCardImage({ url: 'javascript:alert(1)', alt: 'a' })).toBeNull();
	});

	it('rejects an image with no alt text', () => {
		// The unfurler prints alt text next to a broken image more often
		// than it prints nothing, so a nameless image is worse than the
		// fallback — which does have alt text.
		expect(resolveCardImage({ url: CONTENT_IMAGE.url, alt: '   ' })).toBeNull();
		expect(resolveCardImage({ url: CONTENT_IMAGE.url, alt: null })).toBeNull();
	});

	it('rejects a URL carrying whitespace or markup', () => {
		expect(resolveCardImage({ url: `${CONTENT_IMAGE.url}"><script>`, alt: 'a' })).toBeNull();
	});

	it('treats an absent media row as no image', () => {
		expect(resolveCardImage(null)).toBeNull();
		expect(resolveCardImage(undefined)).toBeNull();
		expect(resolveCardImage({ url: null, alt: 'a' })).toBeNull();
	});

	it('drops a non-positive intrinsic size instead of publishing it', () => {
		const resolved = resolveCardImage({ ...CONTENT_IMAGE, width: 0, height: null });
		expect(resolved?.width).toBeNull();
		expect(resolved?.height).toBeNull();
	});

	it('returns the site card with its own alt and size', () => {
		expect(fallbackCardImage()).toEqual({
			url: FALLBACK_CARD_URL,
			source: 'fallback',
			alt: FALLBACK_CARD.alt,
			width: FALLBACK_CARD.width,
			height: FALLBACK_CARD.height,
		});
	});
});

describe('composeSocialCard', () => {
	it('publishes content as the image and mirrors it to twitter:image', () => {
		const card = composeSocialCard({ ...BASE, image: CONTENT_IMAGE });
		const map = toMap(card.meta);
		expect(card.image?.source).toBe('content');
		expect(map.get('og:image')).toBe(CONTENT_IMAGE.url);
		expect(map.get('og:image:alt')).toBe(CONTENT_IMAGE.alt);
		expect(map.get('og:image:width')).toBe('1600');
		expect(map.get('og:image:height')).toBe('900');
		expect(map.get('twitter:image')).toBe(CONTENT_IMAGE.url);
		expect(map.get('twitter:image:alt')).toBe(CONTENT_IMAGE.alt);
		expect(map.get('twitter:card')).toBe('summary_large_image');
		expect(map.get('og:type')).toBe('article');
		expect(map.get('og:site_name')).toBe(SITE_NAME);
		expect(map.get('og:locale')).toBe(SITE_LOCALE);
		expect(map.get('og:url')).toBe(BASE.url);
		expect(map.get('og:title')).toBe(BASE.socialTitle);
		expect(map.get('og:description')).toBe(BASE.description);
	});

	it('falls back to the site card when the project publishes no media', () => {
		const card = composeSocialCard({ ...BASE, image: null });
		const map = toMap(card.meta);
		expect(card.image?.source).toBe('fallback');
		expect(map.get('og:image')).toBe(FALLBACK_CARD_URL);
		expect(map.get('og:image:alt')).toBe(FALLBACK_CARD.alt);
		expect(map.get('og:image:width')).toBe(String(FALLBACK_CARD.width));
		expect(map.get('og:image:height')).toBe(String(FALLBACK_CARD.height));
		expect(map.get('twitter:image')).toBe(FALLBACK_CARD_URL);
		expect(map.get('twitter:image:alt')).toBe(FALLBACK_CARD.alt);
		expect(map.get('twitter:card')).toBe('summary_large_image');
	});

	it('falls back when the media row has no public URL', () => {
		// This is the unbound R2 custom domain / no media row case: the
		// loader hands the route a null URL.
		const card = composeSocialCard({ ...BASE, image: { ...CONTENT_IMAGE, url: null } });
		expect(card.image?.source).toBe('fallback');
		expect(toMap(card.meta).get('og:image')).toBe(FALLBACK_CARD_URL);
	});

	it('falls back when the media row has no alt text', () => {
		const card = composeSocialCard({ ...BASE, image: { ...CONTENT_IMAGE, alt: '' } });
		expect(card.image?.source).toBe('fallback');
	});

	it('publishes no image at all under the `none` policy', () => {
		const card = composeSocialCard({ ...BASE, image: CONTENT_IMAGE, policy: 'none' });
		const map = toMap(card.meta);
		expect(card.image).toBeNull();
		expect(map.get('og:image')).toBeUndefined();
		expect(map.get('og:image:alt')).toBeUndefined();
		expect(map.get('twitter:image')).toBeUndefined();
		expect(map.get('twitter:image:alt')).toBeUndefined();
		expect(map.get('twitter:card')).toBe('summary');
	});

	it('always publishes the four properties a preview needs', () => {
		for (const image of [CONTENT_IMAGE, null]) {
			const map = toMap(composeSocialCard({ ...BASE, image }).meta);
			for (const key of [
				'og:type',
				'og:site_name',
				'og:locale',
				'og:title',
				'og:description',
				'og:url',
			]) {
				expect(map.get(key), `${key} missing`).toBeTruthy();
			}
		}
	});

	it('normalises an origin-relative url to an absolute one', () => {
		const card = composeSocialCard({ ...BASE, url: '/portfolio/my-web-2026' });
		expect(toMap(card.meta).get('og:url')).toBe(BASE.url);
	});

	it('uses the document title as the social title when none is given', () => {
		const map = toMap(composeSocialCard({ ...BASE, socialTitle: undefined }).meta);
		expect(map.get('og:title')).toBe(BASE.title);
		expect(map.get('twitter:title')).toBe(BASE.title);
	});

	it('never emits a duplicate tag key', () => {
		const keys = composeSocialCard({ ...BASE, image: CONTENT_IMAGE }).meta.map(
			(tag) => tag.property ?? tag.name,
		);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
