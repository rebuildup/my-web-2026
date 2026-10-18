/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Index boundary, proved through the real Worker (Issue #423).
 *
 * The static half of this boundary is checked by
 * `scripts/check-index-boundary.mjs` (robots.txt / sitemap.xml text).
 * This file asserts the half a text check cannot see: what the SSR
 * pipeline actually EMITS, and — more importantly — that the index
 * boundary did not quietly become the security boundary.
 *
 * Two properties, both load-bearing:
 *
 *   1. `noindex` reaches the document. `src/routes/admin.tsx` declares
 *      one `robots` meta on the admin LAYOUT; TanStack merges
 *      `head().meta` along the matched route chain, so every admin page
 *      must actually render it. A layout-only declaration that never
 *      reaches the HTML would leave the admin URLs indexable while every
 *      gate report still said "OK" — so the rendered markup, not the
 *      source, is what is asserted here.
 *
 *   3. the SERVED `/robots.txt` agrees with the HTML. `/robots.txt` is
 *      an external-boundary route (`src/http/seo/router.ts`, Issue
 *      #420), so the workerd pool can fetch it through `SELF` — and the
 *      one document a crawler reads before every page. If it ever
 *      carried a `Disallow` for the admin subtree, the `noindex` those
 *      pages declare could never be read. (`/robots.txt` itself is NOT
 *      fetched here: the workerd test pool has no Static Assets binding,
 *      so that half is asserted as text by `check-index-boundary.mjs`
 *      against the committed `public/robots.txt`.)
 *
 *   2. robots.txt is NOT access control. A crawler User-Agent gets no
 *      privilege: `/admin` and `/admin/keys` still refuse anonymous
 *      requests, exactly as they do for any other client. This matters
 *      more since the admin subtree was made crawlable (a blocked page
 *      can never deliver its own `noindex`): a well-behaved crawler now
 *      really does fetch `/admin`, and the server-side gate — not
 *      robots.txt — is the only thing between it and the page. If a
 *      future change ever made the index boundary look like the gate —
 *      by letting a crawler UA through, or by serving admin HTML
 *      without a session — these assertions fail.
 *
 * Public pages are asserted to carry NO `robots` meta at all: the
 * "unintended whole-site noindex" failure is silent by nature (nothing
 * errors, traffic just stops arriving), so it needs a positive check.
 */
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

function robotsMeta(html: string): string | null {
	return /<meta[^>]*name="robots"[^>]*>/.exec(html)?.[0] ?? null;
}

describe('index boundary — rendered HTML (Issue #423)', () => {
	it('the admin layout noindex reaches the one anonymously renderable admin page', async () => {
		// `/admin/login` is the only admin URL an anonymous client can
		// render (the rest auth-gate), which makes it the observable
		// proof that the layout's `head()` reaches the matched chain.
		// The gated children's meta is therefore PROVEN here indirectly
		// (same merge, one observable instance) and STATICALLY for all
		// seven in `scripts/check-index-boundary.mjs`.
		const res = await SELF.fetch('https://example.com/admin/login', { redirect: 'manual' });
		expect(res.status).toBe(200);
		const meta = robotsMeta(await res.text());
		expect(meta, '/admin/login must render a robots meta').not.toBeNull();
		expect(meta).toContain('noindex');
		expect(meta).toContain('nofollow');
	});

	it('a public page carries no robots meta at all', async () => {
		const res = await SELF.fetch('https://example.com/contact', { redirect: 'manual' });
		expect(res.status).toBe(200);
		// The whole-site-de-index failure mode: a stray noindex on a
		// public route silently removes the page from search results.
		expect(robotsMeta(await res.text())).toBeNull();
	});

	it('a second public page carries no robots meta either', async () => {
		// One sample is a coincidence, two is a pattern.
		const res = await SELF.fetch('https://example.com/design-system', { redirect: 'manual' });
		expect(res.status).toBe(200);
		expect(robotsMeta(await res.text())).toBeNull();
	});
});

describe('the served robots.txt agrees with the per-page meta', () => {
	it('serves a policy with no Disallow for the noindex admin subtree', async () => {
		// The regression this whole boundary exists to prevent: a
		// `Disallow: /admin` next to `robots: noindex` on the admin
		// pages. A blocked crawler never fetches the document, so it
		// never reads the noindex, and Google keeps the URL as
		// "Indexed, though blocked by robots.txt".
		const res = await SELF.fetch('https://example.com/robots.txt', { redirect: 'manual' });
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('User-agent: *');
		expect(body).not.toMatch(/^Disallow:\s*\/admin/m);
		expect(body).not.toMatch(/^Disallow:\s*\/tools/m);
		// …and the sitemap pointer stays on the canonical origin.
		expect(body).toContain('Sitemap: https://rebuildup.dev/sitemap.xml');
		// A site-wide noindex would silently de-index every public page.
		expect(body).not.toMatch(/^Disallow:\s*\/\s*$/m);
	});

	it('serves a sitemap that advertises only the indexable routes', async () => {
		const res = await SELF.fetch('https://example.com/sitemap.xml', { redirect: 'manual' });
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('<loc>https://rebuildup.dev/</loc>');
		expect(body).toContain('<loc>https://rebuildup.dev/tools</loc>');
		// The gated / the noindex Tool shell must never be advertised.
		expect(body).not.toContain('/admin');
		expect(body).not.toContain('/tools/');
	});
});

describe('index boundary is not access control (Issue #423)', () => {
	it('a crawler User-Agent gets no privilege on /admin', async () => {
		const res = await SELF.fetch('https://example.com/admin', {
			redirect: 'manual',
			headers: { 'user-agent': GOOGLEBOT_UA },
		});
		expect(res.status).toBeGreaterThanOrEqual(300);
		expect(res.status).toBeLessThan(400);
		expect(res.headers.get('location')).toContain('/admin/login');
	});

	it('a crawler User-Agent gets no privilege on /admin/keys', async () => {
		const res = await SELF.fetch('https://example.com/admin/keys', {
			redirect: 'manual',
			headers: { 'user-agent': GOOGLEBOT_UA },
		});
		expect(res.status).toBeGreaterThanOrEqual(300);
		expect(res.status).toBeLessThan(400);
		expect(res.headers.get('location')).toContain('/admin/login');
	});

	it('the machine boundary still requires an API key, robots.txt notwithstanding', async () => {
		// `/api/v1/access/*` is `Disallow`ed in robots.txt purely as crawl
		// hygiene. The 401 is the real gate and must be unchanged.
		const res = await SELF.fetch('https://example.com/api/v1/access/count/home-page', {
			headers: { 'user-agent': GOOGLEBOT_UA },
		});
		expect(res.status).toBe(401);
	});
});
