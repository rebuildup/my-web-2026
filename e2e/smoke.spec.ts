import { expect, test } from '@playwright/test';

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
 * Verifies the five content sections plus the footer landmark render
 * with the required structure and the single `<h1>` invariant. Skips assertions on
 * exact prose so Japanese / English copy can land in any ticket
 * without breaking this smoke.
 */
test.describe('home page composition', () => {
	test('renders the public preview sections and the canonical h1', async ({ page }) => {
		await page.goto('/');

		// Single h1 invariant.
		const h1 = page.locator('h1');
		await expect(h1).toHaveCount(1);
		await expect(h1).toHaveText(/木村友亮 \/ samuido/);

		// Six content sections, in order, all anchored by aria-labelledby.
		const sections = page.locator('section[aria-labelledby]');
		await expect(sections).toHaveCount(6);
		await expect(sections.nth(0)).toHaveAttribute('aria-labelledby', 'hero-title');
		await expect(sections.nth(1)).toHaveAttribute('aria-labelledby', 'capabilities-heading');
		await expect(sections.nth(2)).toHaveAttribute('aria-labelledby', 'status-heading');
		await expect(sections.nth(3)).toHaveAttribute('aria-labelledby', 'reactions-heading');
		await expect(sections.nth(4)).toHaveAttribute('aria-labelledby', 'access-counter-heading');
		await expect(sections.nth(5)).toHaveAttribute('aria-labelledby', 'contact-cta-heading');

		// Public-preview transition back to the complete 2025 edition.
		await expect(page.locator('a[href="https://yusuke-kim.com"]')).toHaveCount(2);

		// Landmarks: banner / main / contentinfo.
		await expect(page.locator('main#main')).toBeVisible();
		await expect(page.locator('footer')).toBeVisible();

		// Skip-to-content link is rendered before <main>.
		await expect(page.locator('a[href="#main"]')).toHaveCount(1);
	});

	test('capabilities grid reflects the current domain contract (live+CTA / planned)', async ({
		page,
	}) => {
		// Domain contract as of Issue #168 (PR adds `tools` next to `portfolio`):
		//   - portfolio  → live, with an internal CTA to /portfolio
		//   - tools      → live, with an internal CTA to /tools (Issue #168)
		//   - content    → planned, no internal CTA
		//   - activity   → planned, no internal CTA
		// The test names each capability by its Japanese h3 label so
		// it survives any English-copy revision. The 4-card count is a
		// sanity check on the registry, not an assertion of how many
		// are planned.
		await page.goto('/');
		const section = page.locator('section[aria-labelledby="capabilities-heading"]');
		await expect(section.locator('li')).toHaveCount(4);

		// portfolio — LIVE with an internal CTA to /portfolio.
		const portfolioCard = section.locator('li').filter({ hasText: 'ポートフォリオ' });
		await expect(portfolioCard.locator('text=live')).toBeVisible();
		const portfolioCta = portfolioCard.locator('a[href="/portfolio"]');
		await expect(portfolioCta).toBeVisible();
		await expect(portfolioCta).toHaveAttribute('href', '/portfolio');

		// tools — LIVE with an internal CTA to /tools (Issue #168).
		const toolsCard = section.locator('li').filter({ hasText: 'ツール' });
		await expect(toolsCard.locator('text=live')).toBeVisible();
		const toolsCta = toolsCard.locator('a[href="/tools"]');
		await expect(toolsCta).toBeVisible();
		await expect(toolsCta).toHaveAttribute('href', '/tools');

		// content — PLANNED, no internal CTA.
		const contentCard = section.locator('li').filter({ hasText: 'コンテンツ' });
		await expect(contentCard.locator('text=planned')).toBeVisible();
		await expect(contentCard.locator('a[href^="/"]')).toHaveCount(0);

		// activity — PLANNED, no internal CTA.
		const activityCard = section.locator('li').filter({ hasText: 'アクティビティ' });
		await expect(activityCard.locator('text=planned')).toBeVisible();
		await expect(activityCard.locator('a[href^="/"]')).toHaveCount(0);
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
