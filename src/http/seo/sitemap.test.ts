import { describe, expect, it } from 'vitest';
import { PUBLIC_NAV_ITEMS } from '../../editorial/nav/PublicNav';
import { SLUG_REGEX } from '../../portfolio/schema';
import { PORTFOLIO_SEED } from '../../portfolio/seed';
import {
	SITEMAP_DYNAMIC_ROUTES,
	SITEMAP_ENTRIES,
	SITEMAP_EXCLUSIONS,
	SITEMAP_LOCALE,
	SITEMAP_ORIGIN,
	SITEMAP_SEGMENT_PATTERN,
	absoluteUrl,
	buildSitemapUrls,
	escapeXml,
	renderRobotsTxt,
	renderSitemapXml,
	toW3cDateTime,
} from './sitemap';

/**
 * Unit tests for the sitemap document builder (Issue #420).
 *
 * Pure module — no workerd, no D1, no HTTP. The HTTP contract is
 * covered by `./router.test.ts` and the public-visibility boundary by
 * `src/portfolio/load.test.ts`; this file owns the document itself and
 * the two inventories that decide what may appear in it.
 */

const UPDATED_AT = Date.UTC(2026, 0, 2, 3, 4, 5);

describe('sitemap — document shape', () => {
	it('declares the sitemaps.org and xhtml namespaces', () => {
		const xml = renderSitemapXml([]);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
		expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
		expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
		expect(xml.endsWith('</urlset>\n')).toBe(true);
	});

	it('emits one url block per static entry plus one per published project', () => {
		const xml = renderSitemapXml([{ slug: 'aulymo', updatedAt: UPDATED_AT }]);
		const blocks = xml.match(/<url>/g) ?? [];
		expect(blocks).toHaveLength(SITEMAP_ENTRIES.length + 1);
	});

	it('every loc is an absolute canonical-origin URL', () => {
		for (const url of buildSitemapUrls([{ slug: 'tastile', updatedAt: UPDATED_AT }])) {
			expect(url.loc.startsWith(`${SITEMAP_ORIGIN}/`)).toBe(true);
		}
	});

	it('declares exactly one ja alternate per url, pointing at itself', () => {
		for (const url of buildSitemapUrls([{ slug: 'tastile', updatedAt: UPDATED_AT }])) {
			expect(url.alternates).toEqual([{ hreflang: SITEMAP_LOCALE, href: url.loc }]);
		}
		const xml = renderSitemapXml([]);
		expect(xml).toContain(
			'<xhtml:link rel="alternate" hreflang="ja" href="https://rebuildup.dev/about"/>',
		);
	});

	it('never emits a duplicate loc', () => {
		const urls = buildSitemapUrls([
			{ slug: 'tastile', updatedAt: UPDATED_AT },
			{ slug: 'tastile', updatedAt: UPDATED_AT },
		]);
		expect(new Set(urls.map((u) => u.loc)).size).toBe(urls.length);
	});

	it('lastmod is a W3C datetime derived from updated_at', () => {
		const xml = renderSitemapXml([{ slug: 'tastile', updatedAt: UPDATED_AT }]);
		expect(xml).toContain('<lastmod>2026-01-02T03:04:05Z</lastmod>');
	});

	it('omits lastmod when the timestamp is not usable instead of guessing', () => {
		expect(toW3cDateTime(Number.NaN)).toBeUndefined();
		expect(toW3cDateTime(-1)).toBeUndefined();
		expect(toW3cDateTime(Number.POSITIVE_INFINITY)).toBeUndefined();
		const xml = renderSitemapXml([{ slug: 'tastile', updatedAt: Number.NaN }]);
		expect(xml).toContain('<loc>https://rebuildup.dev/portfolio/tastile</loc>');
		expect(xml).not.toContain('<lastmod>');
	});

	it('orders generated entries by most recently updated, slug as tiebreaker', () => {
		const urls = buildSitemapUrls([
			{ slug: 'beta', updatedAt: UPDATED_AT },
			{ slug: 'alpha', updatedAt: UPDATED_AT },
			{ slug: 'newest', updatedAt: UPDATED_AT + 1000 },
		]);
		expect(urls.slice(SITEMAP_ENTRIES.length).map((u) => u.loc)).toEqual([
			'https://rebuildup.dev/portfolio/newest',
			'https://rebuildup.dev/portfolio/alpha',
			'https://rebuildup.dev/portfolio/beta',
		]);
	});
});

describe('sitemap — publication boundary', () => {
	it('drops slugs the route grammar would not resolve (guaranteed 404s)', () => {
		const xml = renderSitemapXml([
			{ slug: '../etc/passwd', updatedAt: UPDATED_AT },
			{ slug: 'Nested/Slug', updatedAt: UPDATED_AT },
			{ slug: 'has space', updatedAt: UPDATED_AT },
			{ slug: '', updatedAt: UPDATED_AT },
			{ slug: '-leading-hyphen', updatedAt: UPDATED_AT },
			{ slug: 'a'.repeat(129), updatedAt: UPDATED_AT },
		]);
		expect(xml).not.toContain('<loc>https://rebuildup.dev/portfolio/');
	});

	it('accepts every slug in the real portfolio seed corpus', () => {
		for (const entry of PORTFOLIO_SEED) {
			expect(SITEMAP_SEGMENT_PATTERN.test(entry.slug)).toBe(true);
		}
	});

	it('uses the same slug grammar as the portfolio schema', () => {
		// Drift here would silently drop real projects from the sitemap
		// (or admit 404s), so the two patterns are pinned together.
		expect(SITEMAP_SEGMENT_PATTERN.source).toBe(SLUG_REGEX.source);
	});

	it('with no published projects the document is the static inventory only', () => {
		const urls = buildSitemapUrls([]);
		expect(urls.map((u) => u.loc)).toEqual(
			SITEMAP_ENTRIES.map((e) => `${SITEMAP_ORIGIN}${e.path}`),
		);
	});

	it('every static entry carries a reviewable reason and a valid priority', () => {
		for (const entry of SITEMAP_ENTRIES) {
			expect(entry.reason.length).toBeGreaterThan(20);
			expect(entry.priority).toBeGreaterThanOrEqual(0);
			expect(entry.priority).toBeLessThanOrEqual(1);
			expect(entry.path.startsWith('/')).toBe(true);
		}
	});

	it('every exclusion carries a reason', () => {
		for (const exclusion of SITEMAP_EXCLUSIONS) {
			expect(exclusion.reason.length).toBeGreaterThan(20);
		}
	});

	it('every route family that is generated rather than listed says so', () => {
		expect(SITEMAP_DYNAMIC_ROUTES.map((r) => r.template)).toContain('/portfolio/$slug');
		for (const route of SITEMAP_DYNAMIC_ROUTES) {
			expect(route.reason.length).toBeGreaterThan(20);
		}
	});
});

describe('sitemap — nav coverage (a new public page cannot be silently absent)', () => {
	it('every public nav destination is advertised', () => {
		const advertised = new Set(SITEMAP_ENTRIES.map((e) => e.path));
		for (const item of PUBLIC_NAV_ITEMS) {
			expect(advertised.has(item.to)).toBe(true);
		}
	});

	it('the sitemap advertises nothing the public nav cannot reach', () => {
		const navTargets = new Set(PUBLIC_NAV_ITEMS.map((i) => i.to));
		for (const entry of SITEMAP_ENTRIES) {
			expect(navTargets.has(entry.path)).toBe(true);
		}
	});
});

describe('sitemap — escaping and url helpers', () => {
	it('escapes the five predefined XML entities', () => {
		expect(escapeXml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&apos;f');
	});

	it('joins origin and path without doubling slashes', () => {
		expect(absoluteUrl('/about')).toBe('https://rebuildup.dev/about');
		expect(absoluteUrl('/about', 'https://rebuildup.dev/')).toBe('https://rebuildup.dev/about');
	});
});

describe('robots.txt', () => {
	it('advertises the sitemap at the canonical origin', () => {
		expect(renderRobotsTxt()).toContain(`Sitemap: ${SITEMAP_ORIGIN}/sitemap.xml`);
	});

	it('does NOT disallow the noindex admin subtree', () => {
		// `/admin` is de-indexed by the `robots: noindex` meta the admin
		// layout declares (Issue #423). A `Disallow` would stop the
		// crawler before it reads that meta, which leaves the URL
		// "Indexed, though blocked by robots.txt" — worse than either
		// pure state. `scripts/check-index-boundary.mjs` enforces this
		// (`noindex-blocked`).
		expect(renderRobotsTxt()).not.toMatch(/^Disallow:/m);
	});

	it('keeps noindex Tool shells crawlable', () => {
		// Disallowing them would stop a crawler from reading the
		// noindex tag the route itself declares.
		expect(renderRobotsTxt()).not.toContain('Disallow: /tools');
	});
});
