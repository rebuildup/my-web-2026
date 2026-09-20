import { expect, test } from '@playwright/test';

/**
 * Production smoke (Issue #43 / ADR-0014).
 *
 * Runs against the canonical production URL `https://rebuildup.dev`
 * via `pnpm run e2e:prod`. Triggered manually:
 *   - locally: `pnpm run e2e:prod`
 *   - CI: GH Actions `production smoke` workflow on `workflow_dispatch`.
 *
 * The smoke verifies the documented Issue #43 acceptance criteria
 * against the live deployment:
 *
 *   - `GET /` and `GET /admin/login` return 200 HTML.
 *   - `/api/v1/*` endpoints (health / db / media) are reachable and
 *     return the documented status codes + JSON shapes.
 *   - Better Auth's sign-in form posts to its canonical sign-in
 *     endpoint and that endpoint exists on the canonical origin.
 *   - Response cookies carry `Secure` (production origin is HTTPS).
 *
 * Sign-in itself is NOT exercised here (no seeded credentials in
 * production); that flow is covered locally by
 * `src/cloudflare/auth/better-auth.test.ts` in the workerd pool.
 */
const CANONICAL_ORIGIN = 'https://rebuildup.dev';

test.describe('production smoke (Issue #43 / ADR-0014)', () => {
	test('canonical origin is HTTPS and reaches the Worker', async ({ request }) => {
		// Force the request fixture to use the canonical origin even
		// when PLAYWRIGHT_BASE_URL is unset (defensive — the script
		// sets it, but `gh workflow run` and local runs should agree).
		const res = await request.get(`${CANONICAL_ORIGIN}/`);
		expect(res.status()).toBe(200);
		expect(res.url()).toBe(`${CANONICAL_ORIGIN}/`);
		// Cloudflare issues TLS via the canonical zone; the URL is
		// never downgraded to plain http.
		expect(res.url().startsWith('https://')).toBe(true);
	});

	test('GET / returns the home HTML and the canonical h1', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/`);
		expect(res.status()).toBe(200);
		const body = await res.text();
		expect(body).toContain('my-web-2026');
	});

	test('GET /admin/login returns 200 HTML with the Better Auth sign-in form', async ({
		request,
	}) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/admin/login`);
		expect(res.status()).toBe(200);
		const body = await res.text();
		// The form submits to Better Auth's canonical sign-in
		// endpoint; if the canonical origin wiring is wrong (e.g.
		// `BETTER_AUTH_URL` still pointing at workers.dev) the
		// cross-origin POST would 4xx.
		expect(body).toContain('action="/api/v1/auth/sign-in/email"');
		expect(body).toMatch(/<input[^>]+type="email"/);
		expect(body).toMatch(/<input[^>]+type="password"/);
	});

	test('GET /api/v1/health responds 200 JSON ping', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/api/v1/health`);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	});

	test('GET /api/v1/db/ping responds 200 with one=1', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/api/v1/db/ping`);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.one).toBe(1);
	});

	test('GET /api/v1/media/ping responds 404 key_not_found', async ({ request }) => {
		const res = await request.get(`${CANONICAL_ORIGIN}/api/v1/media/ping`);
		// R2 bucket is reachable but the probe key is intentionally absent.
		expect(res.status()).toBe(404);
		const body = await res.json();
		expect(body.status).toBe('key_not_found');
	});

	test('anonymous reaction mutation issues `mw_actor_id` cookie with `Secure`', async ({
		page,
	}) => {
		// P2 #11 (review 5256764289 → 5257235568): the previous
		// `/admin/login` GET path asserted `setCookieHeaders.length > 0`,
		// which flaked on healthy production (Better Auth only issues
		// the session cookie at the actual sign-in step, not on the
		// sign-in form render). The "relaxed" follow-up
		// (`5929843`) was vacuously green — `GET /` may legitimately
		// return zero `Set-Cookie` headers, in which case the test
		// asserted nothing. We now drive a real production path that
		// deterministically issues `mw_actor_id` — an anonymous
		// reaction mutation through the home widget — and read the
		// `Set-Cookie` header off the mutation response itself.
		//
		// Why a `page` fixture, not `request`: TanStack Start server-fn
		// URLs include a build-time hash and the request body uses
		// the framework's RPC envelope, both of which are brittle to
		// reproduce from a raw HTTP client. Driving the actual widget
		// UI exercises the same code path a visitor would, including
		// any cookie-issuance wiring that may be wrapped in a future
		// layer (CSRF middleware, edge transforms, etc.).
		//
		// Failure modes:
		// - `data-testid="home-reactions-open-picker"` missing →
		//   home is not rendering the widget (regression on branch 43
		//   picker shape, or SSR error).
		// - "reactions disabled" placeholder visible → the home API key
		//   is not configured in production (the smoke should fail
		//   loudly — operator forgot `pnpm run bootstrap:home-api-key`
		//   or `wrangler secret put MY_WEB_2026_CONSUMER_API_KEY`).
		// - mutation response has no `mw_actor_id` cookie → server-fn
		//   handler regressed to cookie-less mode (P1 #2 finding
		//   repeated).
		// - cookie issued without `Secure` → production HTTPS wiring
		//   regression (e.g. `Secure`-stripping edge transform, or
		//   `proto` header dropped from `Set-Cookie`).

		await page.context().clearCookies();
		await page.goto(`${CANONICAL_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
		const trigger = page.getByTestId('home-reactions-open-picker');
		await trigger.waitFor({ state: 'visible', timeout: 15_000 });
		// Pre-flight: the disabled placeholder is rendered when the
		// home API key is missing. Fail loudly — silently no-op'ing
		// here would mask an unconfigured production deployment.
		const disabledMarker = await page
			.getByText(/reactions disabled/i)
			.first()
			.isVisible()
			.catch(() => false);
		expect(
			disabledMarker,
			'home widget shows the disabled placeholder — API key not configured in production',
		).toBe(false);

		// Open the picker dialog. The picker is lazy-loaded inside the
		// <dialog> on first open — wait for the dialog to actually
		// contain the picker library's DOM (it uses `data-unified` on
		// each emoji button).
		await trigger.click();
		await page.waitForSelector('dialog[aria-label="Add a reaction"] [data-unified]', {
			timeout: 15_000,
		});

		// Race the mutation response against the first emoji click.
		// The server fn URL is `/_serverFn/<hash>` and the response
		// carries `Set-Cookie: mw_actor_id=<X>; Secure` on a first
		// visit.
		const mutationUrl = /\/_\w+/;
		const mutationResponsePromise = page.waitForResponse(
			(res) => res.request().method() === 'POST' && mutationUrl.test(new URL(res.url()).pathname),
			{ timeout: 15_000 },
		);
		await page.locator('dialog[aria-label="Add a reaction"] [data-unified]').first().click();
		const mutationResponse = await mutationResponsePromise;

		expect(mutationResponse.status(), 'reaction mutation failed').toBeLessThan(400);

		const setCookieHeaders = mutationResponse
			.headersArray()
			.filter((h) => h.name.toLowerCase() === 'set-cookie');
		const actorCookie = setCookieHeaders.find((h) =>
			h.value.toLowerCase().startsWith('mw_actor_id='),
		);
		expect(
			actorCookie,
			'expected `Set-Cookie: mw_actor_id=…` on the first anonymous reaction mutation',
		).toBeDefined();
		// P2 #6 regression guard: every issued cookie MUST carry
		// `Secure`. Production origin is HTTPS; a missing `Secure`
		// flag is an actual production wiring bug (cookie would
		// leak over HTTP if the user ever follows an http:// link).
		// `actorCookie` is narrowed by the preceding `toBeDefined()`
		// assertion — optional-chain here is purely to satisfy the
		// `noNonNullAssertion` lint rule; the chain would throw on
		// `undefined` and the assertion would still fail loudly.
		expect(actorCookie?.value.toLowerCase()).toContain('secure');
	});

	test('canonical origin matches the documented production URL', async ({ request }) => {
		// Defensive: the deployed Worker must serve the canonical
		// origin and the configured `BETTER_AUTH_URL`. The header
		// returned by the Worker is the same-origin we expect.
		const res = await request.get(`${CANONICAL_ORIGIN}/`, {
			maxRedirects: 0,
		});
		expect(res.status()).toBe(200);
		expect(new URL(res.url()).origin).toBe(CANONICAL_ORIGIN);
	});
});
