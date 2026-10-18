import { type BrowserContext, expect, test } from '@playwright/test';
import {
	ADMIN_ROUTE_MATRIX,
	API_EXPECTED,
	API_MATRIX,
	FIXTURE,
	assertFixtureAuthenticates,
	leakedMarkerIds,
	leakedMarkerLabels,
	markerOutcomeMatches,
	seedAdminAuthzFixture,
} from '../scripts/admin-authz-fixture.mjs';

/**
 * @typedef {Awaited<ReturnType<typeof seedAdminAuthzFixture>>} Fixture
 */

/**
 * Admin authorization matrix — browser layer (Issue #441).
 *
 * The workerd contract test (`test/integration/admin-authorization.test.ts`)
 * drives every admin route and every internal API through the real
 * Worker entry `src/server.ts`. This spec covers what only a browser
 * can see: the redirect is FOLLOWED, so the caller lands somewhere
 * real (`/admin/login` for an anonymous visitor, the dashboard for a
 * signed-in non-admin) instead of merely receiving a 3xx, and the
 * RENDERED document of that destination carries none of the private
 * rows only the authorized identity may read.
 *
 * Local only. `seedAdminAuthzFixture()` writes to the `--local`
 * `--persist-to .tmp/d1state` binding that `webServer.command`
 * (`scripts/e2e-local-bootstrap.mjs`) prepared before this server
 * bound, and no fixture value is a real credential: the identities are
 * RFC 2606 `.invalid` addresses, and the two scoped API keys are
 * random per run and hashed exactly the way `@better-auth/api-key`
 * hashes the keys the admin UI mints. The plaintext is compared, never
 * printed.
 *
 * `/admin/keys` is visited LAST in each identity column, and the admin
 * column is the LAST group in the file. Loading that page renders the
 * Better Auth API-key plugin, and after it has rendered the local
 * preview server stops answering later session-authenticated
 * requests; see the PR body for the observed order. Ordering the
 * probes around that keeps the run complete instead of truncating
 * halfway down the table.
 */
test.describe.configure({ mode: 'serial' });

let fixturePromise: Promise<Fixture> | null = null;

/**
 * Seed once per worker. `test.info().project.use.baseURL` is the same
 * value Playwright resolves `page.goto` against, so the fixture never
 * restates it.
 */
function fixture(): Promise<Fixture> {
	const baseURL = test.info().project.use.baseURL as string;
	fixturePromise ??= (async () => {
		const seeded = await seedAdminAuthzFixture();
		// Fail closed: without a working fixture session the "signed in"
		// columns would quietly assert the anonymous behaviour instead.
		await assertFixtureAuthenticates(baseURL, seeded.cookies);
		return seeded;
	})();
	return fixturePromise;
}

/**
 * A browser context carrying one fixture session cookie. The anonymous
 * identity deliberately gets no cookie at all — that is the identity
 * under test.
 *
 * The cookie needs `secure: true`, because the local runtime names it
 * `__Secure-better-auth.session_token` and Chrome refuses to store a
 * `__Secure-`-prefixed cookie without it. `domain` (not `url`) is what
 * lets that `secure` flag survive on an `http://127.0.0.1` preview
 * server; both spellings are registered because the fixture does not
 * need to know which one this runtime picked. Without both, the
 * "signed in" columns would silently degrade into the anonymous one.
 */
async function contextFor(
	browser: import('@playwright/test').Browser,
	cookie: string | null,
	baseURL: string,
): Promise<BrowserContext> {
	const context = await browser.newContext();
	if (cookie) {
		const { hostname } = new URL(baseURL);
		await context.addCookies(
			cookie.split('; ').map((pair) => {
				const [name, ...rest] = pair.split('=');
				return {
					name,
					value: rest.join('='),
					domain: hostname,
					path: '/',
					secure: true,
					httpOnly: true,
				};
			}),
		);
	}
	return context;
}

/** Probe order for one identity: `/admin/keys` last, for the reason above. */
function probeOrder(identity: 'anonymous' | 'member' | 'admin') {
	const rows = ADMIN_ROUTE_MATRIX.filter((r) => r.path !== '/admin/keys');
	const keysRow = ADMIN_ROUTE_MATRIX.find((r) => r.path === '/admin/keys');
	return [...rows, ...(identity === 'anonymous' ? [] : [keysRow])].sort(
		(a, b) => (a.path === '/admin/keys' ? 1 : 0) - (b.path === '/admin/keys' ? 1 : 0),
	);
}

/**
 * Origin of the server under test, as `csrfGuard`
 * (`src/http/middleware/csrf.ts`) computes it: the origin it resolved
 * the request to. Every boundary WRITE below must declare it, exactly
 * as a first-party caller such as `src/home/{access,reactions}/load.ts`
 * does; without it the guard refuses before authentication, and these
 * rows would measure the CSRF contract instead of the API-key scope.
 * The guard's own positive / negative cases live in
 * `e2e/csrf.spec.ts`.
 */
function sameOriginHeaders(): Record<string, string> {
	return { origin: new URL(test.info().project.use.baseURL as string).origin };
}

test.describe('admin UI routes — anonymous', () => {
	test('every admin-only route lands on the sign-in form and shows no private data', async ({
		page,
	}) => {
		const { markers } = await fixture();
		for (const row of ADMIN_ROUTE_MATRIX.filter((r) => r.path !== '/admin/keys')) {
			await page.goto(row.path);
			const expected = row.expected.anonymous;
			expect(new URL(page.url()).pathname, `${row.path} must land on the sign-in form`).toBe(
				expected === 'page' ? row.path : expected.slice('redirect:'.length),
			);
			await expect(page.locator('form[action="/api/v1/auth/sign-in/email"]')).toHaveCount(1);
			expect(
				leakedMarkerLabels(await page.content(), markers),
				`${row.path} leaked private data`,
			).toEqual([]);
		}
	});

	test('the sign-in form itself is reachable without a session', async ({ page }) => {
		await page.goto('/admin/login');
		expect(new URL(page.url()).pathname).toBe('/admin/login');
		await expect(page.locator('input[type="email"]')).toHaveCount(1);
		await expect(page.locator('input[type="password"]')).toHaveCount(1);
	});

	test('the internal APIs answer 401 missing_authorization with no key', async ({ request }) => {
		for (const api of API_MATRIX) {
			const res = await request.fetch(api.path, {
				method: api.method,
				failOnStatusCode: false,
				headers: sameOriginHeaders(),
				...(api.body ? { data: api.body } : {}),
			});
			expect(res.status(), `${api.label} must refuse an anonymous caller`).toBe(
				API_EXPECTED.anonymous,
			);
			expect(await res.json()).toEqual({ error: 'missing_authorization' });
		}
	});
});

test.describe('admin UI routes — signed in without the admin role', () => {
	test('a non-admin is bounced off every admin-only route to the dashboard', async ({
		browser,
		baseURL,
	}) => {
		const { cookies, markers } = await fixture();
		const context = await contextFor(browser, cookies.member, baseURL ?? 'http://127.0.0.1:3000');
		const page = await context.newPage();
		try {
			for (const row of probeOrder('member')) {
				await page.goto(row.path);
				const expected = row.expected.member;
				expect(
					new URL(page.url()).pathname,
					`${row.path} must ${expected === 'page' ? 'render' : 'bounce to the dashboard'}`,
				).toBe(expected === 'page' ? row.path : expected.slice('redirect:'.length));
				expect(
					leakedMarkerLabels(await page.content(), markers),
					`${row.path} leaked admin-only data to a non-admin`,
				).toEqual([]);
			}

			// The dashboard is reachable and identifies the caller. That
			// address is the caller's OWN, which is why it is not one of
			// the markers a non-admin must never see.
			await page.goto('/admin');
			await expect(page.locator('body')).toContainText(FIXTURE.memberEmail);
		} finally {
			await context.close();
		}
	});
});

test.describe('internal APIs — API key scopes', () => {
	test('a key without the scope is refused and a key with it is accepted', async ({ request }) => {
		const { keys, markers } = await fixture();

		for (const api of API_MATRIX) {
			const wrongScope = keys[api.scope === 'access_counter' ? 'reactions' : 'access_counter'];
			const send = (token: string | null) => ({
				method: api.method,
				failOnStatusCode: false,
				headers: token
					? { ...sameOriginHeaders(), authorization: `Bearer ${token}` }
					: sameOriginHeaders(),
				...(api.body ? { data: api.body } : {}),
			});

			const anonymous = await request.fetch(api.path, send(null));
			expect(anonymous.status(), `${api.label} must refuse an anonymous caller`).toBe(
				API_EXPECTED.anonymous,
			);

			const insufficient = await request.fetch(api.path, send(wrongScope));
			expect(
				insufficient.status(),
				`${api.label} must refuse a key without the ${api.scope} scope`,
			).toBe(API_EXPECTED.insufficient);
			expect((await insufficient.json()).error).toBe('missing_scope');

			const authorized = await request.fetch(api.path, send(keys[api.scope]));
			expect(authorized.status(), `${api.label} must accept a ${api.scope}:${api.action} key`).toBe(
				API_EXPECTED.authorized,
			);
			expect(
				leakedMarkerLabels(await authorized.text(), markers),
				`${api.label} leaked private data`,
			).toEqual([]);
		}
	});
});

test.describe('admin UI routes — admin role', () => {
	test('the dashboard and every admin-only route render private rows for an admin', async ({
		browser,
		baseURL,
	}) => {
		const { cookies, markers } = await fixture();
		const context = await contextFor(browser, cookies.admin, baseURL ?? 'http://127.0.0.1:3000');
		const page = await context.newPage();
		try {
			for (const row of probeOrder('admin')) {
				await page.goto(row.path);
				const expected = row.expected.admin;
				expect(
					new URL(page.url()).pathname,
					`${row.path} must ${expected === 'page' ? 'render for an admin' : 'redirect the admin'}`,
				).toBe(expected === 'page' ? row.path : expected.slice('redirect:'.length));
				// The authorized column must show exactly the private rows
				// that route owns. Without this the negative assertions
				// above could pass on an empty page. A row that redirects
				// a signed-in admin is covered by that redirect alone: the
				// document it lands on belongs to the other route.
				if (expected === 'page') {
					expect(
						markerOutcomeMatches(
							'admin',
							row.adminSees,
							leakedMarkerIds(await page.content(), markers),
						),
						`${row.path} must render exactly the private rows an admin owns`,
					).toBe(true);
				}
			}
			// `/admin` is the first row above, so the marker assertion on
			// it already proved the dashboard identifies the signed-in
			// admin instead of rendering an empty shell.
		} finally {
			await context.close();
		}
	});
});
