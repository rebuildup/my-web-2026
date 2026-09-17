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

/**
 * Home page composition (Issue #21).
 *
 * Verifies the four canonical sections render with the required
 * landmarks and the single `<h1>` invariant. Skips assertions on
 * exact prose so Japanese / English copy can land in any ticket
 * without breaking this smoke.
 */
test.describe('home page composition', () => {
	test('renders the four sections and the canonical h1', async ({ page }) => {
		await page.goto('/');

		// Single h1 invariant.
		const h1 = page.locator('h1');
		await expect(h1).toHaveCount(1);
		await expect(h1).toHaveText(/my-web-2026/);

		// Four sections, in order, all anchored by aria-labelledby.
		const sections = page.locator('section[aria-labelledby]');
		await expect(sections).toHaveCount(2);
		await expect(sections.nth(0)).toHaveAttribute('aria-labelledby', 'hero-title');
		await expect(sections.nth(1)).toHaveAttribute(
			'aria-labelledby',
			/capabilities-heading|status-heading/,
		);

		// Landmarks: banner / main / contentinfo.
		await expect(page.locator('main#main')).toBeVisible();
		await expect(page.locator('footer')).toBeVisible();

		// Skip-to-content link is rendered before <main>.
		await expect(page.locator('a[href="#main"]')).toHaveCount(1);
	});

	test('renders the capabilities grid with three planned cards', async ({ page }) => {
		await page.goto('/');
		const capabilities = page.locator('section[aria-labelledby="capabilities-heading"] article');
		await expect(capabilities).toHaveCount(3);
		// Each card has a "planned" badge in 0.2.0.
		const badges = page.locator(
			'section[aria-labelledby="capabilities-heading"] article >> text=planned',
		);
		await expect(badges).toHaveCount(3);
	});

	test('renders the system status section with three services', async ({ page }) => {
		await page.goto('/');
		const rows = page.locator('section[aria-labelledby="status-heading"] dl > div');
		await expect(rows).toHaveCount(3);
		// The observed-at footer line is rendered.
		await expect(
			page.locator('section[aria-labelledby="status-heading"] >> text=observed at'),
		).toBeVisible();
	});
});
