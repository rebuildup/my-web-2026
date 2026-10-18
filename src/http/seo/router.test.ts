import { describe, expect, it } from 'vitest';
import type { PortfolioProjectIndexEntry } from '../../portfolio/schema';
import { createSeoRouter } from './router';
import { SITEMAP_ORIGIN } from './sitemap';

/**
 * HTTP contract for the crawler-facing SEO routes (Issue #420).
 *
 * The project source is injected (the DI seam of `./router.ts`), so
 * this file asserts what the ROUTE does with the index — status,
 * content type, cache policy, rendering, degradation — while the
 * public-visibility filter itself is proven against real D1 in
 * `src/portfolio/load.test.ts` (`listPublishedProjectIndex`).
 *
 * Using a fixture here instead of the shared `portfolio_project`
 * tables is deliberate: `src/portfolio/load.test.ts` truncates those
 * tables in `beforeEach`, and two suites writing the same table would
 * be a flaky-test generator.
 */

const UPDATED_AT = Date.UTC(2026, 0, 2, 3, 4, 5);

const PUBLISHED: readonly PortfolioProjectIndexEntry[] = [
	{ slug: 'tastile', updatedAt: UPDATED_AT },
	{ slug: 'aulymo', updatedAt: UPDATED_AT - 1000 },
];

function routerWithProjects(projects: readonly PortfolioProjectIndexEntry[]) {
	return createSeoRouter(async () => projects);
}

function routerThatFails() {
	return createSeoRouter(async () => {
		throw new Error('d1 unavailable');
	});
}

describe('GET /sitemap.xml', () => {
	it('answers 200 with an XML body', async () => {
		const res = await routerWithProjects(PUBLISHED).request('/sitemap.xml', undefined, {} as Env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, must-revalidate');
		const body = await res.text();
		expect(body.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
	});

	it('lists the canonical static surface and every published project', async () => {
		const res = await routerWithProjects(PUBLISHED).request('/sitemap.xml', undefined, {} as Env);
		const body = await res.text();
		expect(body).toContain(`<loc>${SITEMAP_ORIGIN}/</loc>`);
		expect(body).toContain(`<loc>${SITEMAP_ORIGIN}/about</loc>`);
		expect(body).toContain(`<loc>${SITEMAP_ORIGIN}/portfolio</loc>`);
		expect(body).toContain(`<loc>${SITEMAP_ORIGIN}/portfolio/tastile</loc>`);
		expect(body).toContain(`<loc>${SITEMAP_ORIGIN}/portfolio/aulymo</loc>`);
	});

	it('never advertises the admin surface or the noindex Tool shells', async () => {
		const res = await routerWithProjects(PUBLISHED).request('/sitemap.xml', undefined, {} as Env);
		const body = await res.text();
		expect(body).not.toContain('/admin');
		expect(body).not.toContain('/tools/prototype');
		expect(body).not.toContain('<loc>https://rebuildup.dev/tools/');
	});

	it('degrades to the static inventory when the project source fails', async () => {
		const res = await routerThatFails().request('/sitemap.xml', undefined, {} as Env);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain(`<loc>${SITEMAP_ORIGIN}/about</loc>`);
		expect(body).not.toContain('/portfolio/');
	});
});

describe('GET /robots.txt', () => {
	it('answers 200 as plain text with the sitemap pointer', async () => {
		const res = await routerWithProjects([]).request('/robots.txt', undefined, {} as Env);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
		const body = await res.text();
		expect(body).toContain('User-agent: *');
		// No `Disallow:` directive at all: /admin is de-indexed by its own
		// `noindex` meta, which a blocked crawler could never read
		// (Issue #423).
		expect(body).not.toMatch(/^Disallow:/m);
		expect(body).toContain(`Sitemap: ${SITEMAP_ORIGIN}/sitemap.xml`);
	});
});

describe('seo routes on the external boundary', () => {
	it('is mounted so /sitemap.xml and /robots.txt resolve', async () => {
		const { externalBoundary } = await import('../hono');
		const sitemap = await externalBoundary.request('/sitemap.xml', undefined, {} as Env);
		const robots = await externalBoundary.request('/robots.txt', undefined, {} as Env);
		expect(sitemap.status).toBe(200);
		expect(robots.status).toBe(200);
	});
});
