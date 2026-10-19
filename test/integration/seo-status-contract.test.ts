/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_ORIGIN } from '../../scripts/_index-boundary.mjs';
import {
	HTTP_STATUS_EXPECTATIONS,
	evaluateObservation,
	observeResponse,
	robotsStateFromHtml,
	surfaceFromHtml,
} from '../../scripts/_seo-status-contract.mjs';
import { REACTIONS_MIGRATIONS } from '../helpers/reactions-schema';
import { applyPortfolioSchema, seedPortfolioRow } from './fixtures/portfolio-d1';

/**
 * The SEO HTTP status contract, proved through the real Worker (Issue #419).
 *
 * `scripts/check-seo-status-contract.mjs` proves the contract is
 * EXHAUSTIVE and that every row names a proof; this file is that proof
 * for the request classes reachable from the workerd test pool. Each
 * test fetches a URL through `SELF.fetch` (i.e. `src/server.ts` → Hono
 * boundary or TanStack Start SSR → `getRouter()`) and feeds the
 * observation back into `evaluateObservation`, so the expectation is
 * never restated here: a row that stops matching the runtime fails this
 * suite instead of being quietly re-read.
 *
 * What this file adds on top of the suites that already existed
 * ---------------------------------------------------------------
 *   - The PUBLICATION boundary as one matrix. `e2e/portfolio.spec.ts`
 *     proved draft / unlisted / archived 404 in a browser; nothing
 *     proved the same over HTTP together with the robots state and the
 *     rendered surface, and nothing compared them to one written
 *     contract.
 *   - The sitemap, asked the question the acceptance condition states:
 *     with unpublished rows present, does the crawler document advertise
 *     them? (`sitemap-excludes-unpublished`)
 *   - The failure states that are 500 today and should be read as such,
 *     pinned with their `openDecision` reference rather than rounded up
 *     to the `503` label the surface prints.
 *
 * Why workerd and not only Playwright
 * ------------------------------------
 * This suite is part of `validate:fast`, the gate every PR and every
 * release-branch push runs. `e2e/seo-status.spec.ts` proves the same
 * rows in a real browser; the two are not merged because a browser run
 * needs a built `dist/` tree and a bootstrapped local D1, and a gate
 * that needs those cannot stay deterministic.
 *
 * Fixtures
 * --------
 * `applyPortfolioSchema` + the reactions migrations are applied here so
 * the public surfaces can actually render; every seeded row is a test
 * row, written with fixed timestamps from the shared fixture.
 *
 * The loader-failure case drops `portfolio_project` inside its own test:
 * the pool's isolated storage rolls the change back afterwards, so the
 * publication rows other cases rely on are unaffected. That is the only
 * honest way to produce a REAL loader failure — the alternative (a
 * missing schema) would make the 500 an accident of the fixture.
 */

const WORKER = 'https://example.com';

/** Slugs seeded below; each one is a distinct publication state. */
const PUBLISHED_SLUG = 'seo-status-published-row';
const DRAFT_SLUG = 'seo-status-draft-row';
const UNLISTED_SLUG = 'seo-status-unlisted-row';
const ARCHIVED_SLUG = 'seo-status-archived-row';
const UNKNOWN_SLUG = 'seo-status-never-published-row';

/** Grammar-violating slug (`SLUG_REGEX` requires lowercase alnum + `-`). */
const INVALID_SLUG = 'NOT_A_VALID_SLUG';

/** A route the file router does not know. */
const UNMATCHED_PATH = '/this-route-does-not-exist-419';

/** Repeated `facets`: the route's search schema expects one string. */
const INVALID_QUERY_PATH = '/portfolio?facets=a&facets=b';

/** Case under test, resolved from the shared contract by id. */
function contract(id: string) {
	// Imported lazily-by-value at module scope; the lookup keeps a typo in
	// a test name from silently asserting nothing.
	const found = HTTP_STATUS_EXPECTATIONS.find((entry) => entry.id === id);
	if (!found) throw new Error(`no SEO status contract case named "${id}"`);
	return found;
}

/**
 * Fetch a document and compare it to its contract row.
 *
 * The returned violations are surfaced through `expect(...).toEqual([])`
 * with the case id in the message, so a failure names the row, the
 * request and the diff instead of a bare expected/received pair.
 */
async function expectCase(id: string, path: string, init?: RequestInit) {
	const row = contract(id);
	const response = await SELF.fetch(`${WORKER}${path}`, { redirect: 'manual', ...init });
	const html = await response.text();
	const violations = evaluateObservation(row, observeResponse(response, html));
	expect(violations, `case "${id}" (${path})`).toEqual([]);
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, REACTIONS_MIGRATIONS);
	await applyPortfolioSchema(env.DB);
	await seedPortfolioRow(env.DB, PUBLISHED_SLUG);
	await seedPortfolioRow(env.DB, DRAFT_SLUG, { visibility: 'draft' });
	await seedPortfolioRow(env.DB, UNLISTED_SLUG, { visibility: 'unlisted' });
	await seedPortfolioRow(env.DB, ARCHIVED_SLUG, { status: 'archived' });
	// The first SSR request in a Worker instance pays for building the
	// route tree, the manifest and the styles; under a saturated host
	// that alone can exceed the default 5 s per-test budget.
	await SELF.fetch(`${WORKER}/tools`, { redirect: 'manual' });
}, 60_000);

/** Public documents: 200, indexable, and never a failure surface. */
describe('public documents answer 200 and stay indexable (#419)', () => {
	it('public-home', async () => expectCase('public-home', '/'));
	it('public-about', async () => expectCase('public-about', '/about'));
	it('public-contact', async () => expectCase('public-contact', '/contact'));
	it('public-portfolio-index', async () => expectCase('public-portfolio-index', '/portfolio'));
	it('public-tools-index', async () => expectCase('public-tools-index', '/tools'));
	it('public-design-system', async () => expectCase('public-design-system', '/design-system'));
});

/**
 * 200 documents that must not be indexable.
 *
 * These are the two places a `noindex` is the ONLY mechanism that works:
 * a `Disallow`ed URL is never fetched, so it never reads its own
 * noindex (Issue #423).
 */
describe('200 but noindex (#419)', () => {
	it('tool-detail-noindex', async () => expectCase('tool-detail-noindex', '/tools/prototype'));
	it('admin-login-anonymous', async () => expectCase('admin-login-anonymous', '/admin/login'));
});

/**
 * The publication boundary — the acceptance condition 「誤200や未公開
 * コンテンツのindexable応答をfail」.
 *
 * All four invisible rows and the never-published slug must be
 * indistinguishable: same status, same failure surface, no robots meta
 * that would let a crawler keep a cached copy.
 */
describe('unpublished portfolio content is not served and not indexable (#419)', () => {
	it('portfolio-published', async () =>
		expectCase('portfolio-published', `/portfolio/${PUBLISHED_SLUG}`));

	it('portfolio-draft-not-found', async () =>
		expectCase('portfolio-draft-not-found', `/portfolio/${DRAFT_SLUG}`));

	it('portfolio-unlisted-not-found', async () =>
		expectCase('portfolio-unlisted-not-found', `/portfolio/${UNLISTED_SLUG}`));

	it('portfolio-archived-not-found', async () =>
		expectCase('portfolio-archived-not-found', `/portfolio/${ARCHIVED_SLUG}`));

	it('portfolio-unknown-slug-not-found', async () =>
		expectCase('portfolio-unknown-slug-not-found', `/portfolio/${UNKNOWN_SLUG}`));

	it('a withdrawn project disappears from the list surface too', async () => {
		// The 404 is only half the contract: an unpublished row that stayed
		// in `/portfolio` would still be one link away from a crawler.
		const res = await SELF.fetch(`${WORKER}/portfolio`, { redirect: 'manual' });
		const html = await res.text();
		for (const slug of [DRAFT_SLUG, UNLISTED_SLUG, ARCHIVED_SLUG]) {
			expect(html, `${slug} must not be linked from /portfolio`).not.toContain(slug);
		}
		expect(html).toContain(PUBLISHED_SLUG);
	});

	it('sitemap-excludes-unpublished', async () => {
		const row = contract('sitemap-excludes-unpublished');
		const res = await SELF.fetch(`${WORKER}/sitemap.xml`, { redirect: 'manual' });
		const xml = await res.text();
		expect(evaluateObservation(row, observeResponse(res, '')), 'sitemap status').toEqual([]);
		expect(res.headers.get('content-type')).toContain('application/xml');
		// The one row that may be advertised.
		expect(xml).toContain(`<loc>${CANONICAL_ORIGIN}/portfolio/${PUBLISHED_SLUG}</loc>`);
		for (const slug of [DRAFT_SLUG, UNLISTED_SLUG, ARCHIVED_SLUG, UNKNOWN_SLUG]) {
			expect(xml, `${slug} must not appear in sitemap.xml`).not.toContain(slug);
		}
	});
});

/** Failure states: never a 200, never an indexable document. */
describe('failure surfaces answer with their own status (#419)', () => {
	it('unmatched-route-not-found', async () =>
		expectCase('unmatched-route-not-found', UNMATCHED_PATH));

	it('tools-unknown-slug-not-found', async () =>
		expectCase('tools-unknown-slug-not-found', '/tools/no-such-tool-slug-419'));

	it('portfolio-invalid-query-input-failure', async () =>
		expectCase('portfolio-invalid-query-input-failure', INVALID_QUERY_PATH));

	it('admin-invitations-accept-invalid-token', async () =>
		expectCase(
			'admin-invitations-accept-invalid-token',
			'/admin/invitations/accept?token=too-short',
		));

	it('portfolio-invalid-slug-loader-failure', async () =>
		expectCase('portfolio-invalid-slug-loader-failure', `/portfolio/${INVALID_SLUG}`));

	it('portfolio-loader-failure', async () => {
		// A real dependency failure: drop the table this route reads, so the
		// loader throws inside the SSR pipeline. Isolated storage restores
		// the schema when the test ends.
		await env.DB.prepare('DROP TABLE portfolio_project').run();
		await expectCase('portfolio-loader-failure', `/portfolio/${PUBLISHED_SLUG}`);
	});

	it('a valid invitation token still answers 200 on the same route', async () => {
		// The negative control: the row above must not be able to pass by
		// making the whole invitation surface fail.
		const token = 't'.repeat(24);
		const res = await SELF.fetch(`${WORKER}/admin/invitations/accept?token=${token}`, {
			redirect: 'manual',
		});
		expect(res.status).toBe(200);
		// A real view, not a failure surface, and still de-indexed.
		expect(surfaceFromHtml(await res.text())).toBe('page');
	});
});

/** The admin gate: a redirect that names the login page, never a 200. */
describe('anonymous admin requests are refused, not rendered (#419)', () => {
	it('admin-anonymous-redirect', async () => expectCase('admin-anonymous-redirect', '/admin'));
	it('admin-keys-anonymous-redirect', async () =>
		expectCase('admin-keys-anonymous-redirect', '/admin/keys'));
	it('admin-images-anonymous-redirect', async () =>
		expectCase('admin-images-anonymous-redirect', '/admin/images'));
	it('admin-invitations-anonymous-redirect', async () =>
		expectCase('admin-invitations-anonymous-redirect', '/admin/invitations'));
	it('admin-emoji-catalog-anonymous-redirect', async () =>
		expectCase('admin-emoji-catalog-anonymous-redirect', '/admin/emoji-catalog'));

	it('admin-signin-rejected', async () => {
		const row = contract('admin-signin-rejected');
		const response = await SELF.fetch(`${WORKER}/api/v1/auth/sign-in/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: WORKER },
			body: JSON.stringify({ email: 'seo-status-probe@example.com', password: 'not-the-password' }),
		});
		expect(evaluateObservation(row, { status: response.status })).toEqual([]);
		// A refused sign-in must not say WHICH half was wrong (Issue #456).
		const body = await response.text();
		expect(body).not.toContain('seo-status-probe@example.com');
		expect(body.toLowerCase()).not.toContain('user not found');
	});
});
