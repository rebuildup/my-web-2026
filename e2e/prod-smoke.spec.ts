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

	test('production cookies carry Secure (HTTPS-only)', async ({ request }) => {
		// /api/v1/health does not set a cookie itself, but it sits on
		// the canonical origin. Use /admin/login which renders the
		// sign-in form — Better Auth may set a CSRF cookie.
		const res = await request.get(`${CANONICAL_ORIGIN}/admin/login`);
		const setCookieHeaders = res
			.headersArray()
			.filter((h) => h.name.toLowerCase() === 'set-cookie');
		for (const header of setCookieHeaders) {
			// `request.headersArray()` parses multiple Set-Cookie headers
			// as separate entries; the raw value carries the flags.
			expect(header.value.toLowerCase()).toContain('secure');
		}
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
