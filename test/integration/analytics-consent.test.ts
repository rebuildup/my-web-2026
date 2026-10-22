/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyPortfolioSchema } from './fixtures/portfolio-d1';
import { applyReactionsSchema } from './fixtures/reactions-d1';

/**
 * The pre-consent guarantee at the request level (Issue #495).
 *
 * The unit and client suites prove the decision rules and the browser
 * behaviour. This suite proves the half a server can observe: the HTML
 * a request receives carries no analytics markup at all — not the
 * loader, not the inline `config`, not the consent test ids — because
 * the gate renders in a mount effect and the control renders nothing
 * until hydration. A crawler, a visitor with JavaScript disabled, and
 * a first-time visitor therefore all receive the same document.
 *
 * It is deliberately a REQUEST-level claim and nothing more: workerd
 * has no `localStorage`, so nothing here can claim to observe a grant.
 * The client suite owns that path. What matters here is that no
 * server-side input — header, query, cookie — can turn measurement on.
 *
 * `/about` and `/contact` are scanned here; `/` is covered by
 * `privacy-projection.test.ts`, whose SSR assertion applies the same
 * rule to the Home document. Both suites create the schema their
 * loaders read in `beforeAll` — workerd cannot see
 * `migrations/*.sql`.
 */
beforeAll(async () => {
	await applyReactionsSchema(env.DB);
	await applyPortfolioSchema(env.DB);
});

describe('no analytics markup before a consent decision', () => {
	const PUBLIC_PATHS = ['/about', '/contact'];

	it.each(PUBLIC_PATHS)(
		'GET %s carries no loader and no inline gtag',
		async (path) => {
			const res = await SELF.fetch(`https://example.com${path}`);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).not.toContain('googletagmanager.com');
			expect(html).not.toContain('gtag(');
			expect(html).not.toContain('data-testid="analytics-consent');
		},
		30_000,
	);

	it('a query string cannot arm measurement', async () => {
		// The gate never reads a request parameter; this pins the absence
		// of any such shortcut rather than a parser's behaviour.
		const res = await SELF.fetch('https://example.com/about?analytics=granted&consent=granted');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).not.toContain('googletagmanager.com');
		expect(html).not.toContain('gtag(');
	}, 30_000);

	it('a stored-looking cookie cannot arm measurement', async () => {
		// The decision lives in `localStorage`; a cookie with a plausible
		// name must not be read by any server path.
		const res = await SELF.fetch('https://example.com/about', {
			headers: {
				cookie: 'my-web-2026:analytics-consent=granted; analytics_consent=granted',
			},
		});
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).not.toContain('googletagmanager.com');
		expect(html).not.toContain('gtag(');
	}, 30_000);

	it('the admin login surface has no consent prompt', async () => {
		// `/admin/*` mounts neither the gate nor the control: asking the
		// operator to answer a question whose answer is fixed would be a
		// prompt the surface cannot honour.
		const res = await SELF.fetch('https://example.com/admin/login');
		const html = await res.text();
		expect(html).not.toContain('googletagmanager.com');
		expect(html).not.toContain('data-testid="analytics-consent');
	}, 30_000);
});
