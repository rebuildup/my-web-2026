import { expect, test } from '@playwright/test';

/**
 * `/links` route E2E (Issue #390).
 *
 * What this spec pins:
 *   1. the page renders 200 with its canonical heading and the
 *      committed link groups;
 *   2. every external row carries `target="_blank"` +
 *      `rel="noopener noreferrer"`, internal rows do not;
 *   3. the page carries NO e-mail address and NO contact form —
 *      private channels stay owned by `/contact` (Issue #390);
 *   4. canonical + Open Graph metadata are the ones the route head
 *      declares.
 */

test.describe('links — /links inventory', () => {
	test('renders the canonical heading and the committed groups', async ({ page }) => {
		const res = await page.goto('/links');
		expect(res?.status()).toBe(200);

		await expect(page.locator('h1')).toHaveText('リンク集 / Links');

		// Every declared group renders its rows.
		for (const group of ['site', 'accounts', 'development', 'games']) {
			const list = page.locator(`[data-testid="links-group-${group}"]`);
			await expect(list).toBeVisible();
			expect(await list.locator('li').count()).toBeGreaterThan(0);
		}

		// Spot-check migrated entries. The row renders the account
		// title as text and the anchor carries the URL, so the
		// destination href — not the link's accessible name — is the
		// stable assertion.
		await expect(page.locator('a[href="https://github.com/rebuildup"]')).toBeVisible();
		await expect(page.locator('a[href="https://github.com/rebuildup"]')).toHaveAttribute(
			'rel',
			'noopener noreferrer',
		);
	});

	test('external rows open safely; internal rows stay on-site', async ({ page }) => {
		await page.goto('/links');

		const external = page.locator('a[target="_blank"]');
		expect(await external.count()).toBeGreaterThan(0);
		for (const el of await external.all()) {
			await expect(el).toHaveAttribute('rel', 'noopener noreferrer');
		}

		// Internal links exist and carry no target=_blank.
		const portfolio = page.locator('a[href="/portfolio"]').first();
		await expect(portfolio).toBeVisible();
		await expect(portfolio).not.toHaveAttribute('target', '_blank');
	});

	test('publishes no e-mail address and no form', async ({ page }) => {
		await page.goto('/links');
		const body = await page.locator('body').innerText();
		expect(body).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
		expect(await page.locator('form').count()).toBe(0);
		// Contact-shaped requests route to /contact, not to an address.
		await expect(page.locator('a[href="/contact"]').first()).toBeVisible();
	});

	test('emits the contracted canonical and Open Graph metadata', async ({ page }) => {
		await page.goto('/links');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			'https://rebuildup.dev/links',
		);
		await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			'https://rebuildup.dev/links',
		);
	});
});
