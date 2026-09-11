import { test, expect } from '@playwright/test';

/**
 * Deployed Worker smoke.
 *
 * Same checks work for the local `pnpm dev` server and a real
 * Cloudflare Worker deployment. The only difference is the base
 * URL — see playwright.config.ts#use.baseURL. When PLAYWRIGHT_BASE_URL
 * points at the deployed Worker (post-`pnpm deploy`), these tests
 * are the real-resource smoke that #009 requires.
 *
 * The D1 / R2 endpoints return 200/404 respectively; the test asserts
 * the documented status codes and JSON shapes from src/http/hono.ts.
 */
test.describe('deployed Worker smoke', () => {
	test('GET / responds 200 HTML', async ({ request }) => {
		const res = await request.get('/');
		expect(res.status()).toBe(200);
		const body = await res.text();
		expect(body).toContain('my-web-2026');
	});

	test('GET /api/v1/health responds 200 JSON ping', async ({ request }) => {
		const res = await request.get('/api/v1/health');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	});

	test('GET /api/v1/db/ping responds 200 with one=1', async ({ request }) => {
		const res = await request.get('/api/v1/db/ping');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.one).toBe(1);
	});

	test('GET /api/v1/media/ping responds 404 key_not_found', async ({ request }) => {
		const res = await request.get('/api/v1/media/ping');
		// R2 bucket is reachable but the probe key is intentionally absent.
		expect(res.status()).toBe(404);
		const body = await res.json();
		expect(body.status).toBe('key_not_found');
	});
});
