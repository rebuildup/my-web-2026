import { expect, test } from '@playwright/test';

/**
 * `/commission` route E2E (Issue #390; status contract per #368 /
 * #369).
 *
 * What this spec pins:
 *   1. the page renders 200 with its canonical heading;
 *   2. the intake status notice is the FIRST content claim — the
 *      commission mode is parked, so 休止中 must be visible and no
 *      request affordance (form, price list, "apply now" CTA) may
 *      exist;
 *   3. the informational sections the 2025 site published (service
 *      groups, request flow, estimate requirements, software) are
 *      present;
 *   4. canonical + Open Graph metadata are the ones the route head
 *      declares.
 */

test.describe('commission — /commission status surface', () => {
	test('renders the canonical heading and the paused status first', async ({ page }) => {
		const res = await page.goto('/commission');
		expect(res?.status()).toBe(200);

		await expect(page.locator('h1')).toHaveText('制作依頼 / Commission');

		const status = page.locator('[data-testid="commission-status"]');
		await expect(status).toBeVisible();
		await expect(status).toContainText('現在、制作依頼の受付は休止しています');
	});

	test('exposes no intake affordance: no form, no price, no CTA', async ({ page }) => {
		await page.goto('/commission');
		expect(await page.locator('form').count()).toBe(0);
		expect(await page.locator('input, textarea, select').count()).toBe(0);

		const body = await page.locator('body').innerText();
		// No published price figures (¥ / 円 amounts) and no estimate
		// calculator — pricing stays owner-gated per #369.
		expect(body).not.toMatch(/[¥￥]\s?[\d,]+/);
		expect(body).not.toMatch(/\d+円/);
		// The status notice itself says pricing is not published.
		await expect(page.locator('body')).toContainText('料金は公開していません');
	});

	test('renders the migrated informational sections', async ({ page }) => {
		await page.goto('/commission');

		await expect(page.getByRole('heading', { name: /依頼できる内容/ })).toBeVisible();
		// exact: the inquiry-form example also contains 「MV 制作」
		// inside a longer hint string, so a substring match is ambiguous.
		await expect(page.getByText('MV 制作', { exact: true })).toBeVisible();
		// Issue #1323 — #1298 added the same three domain names as hero
		// badges, so the bare text now resolves twice. The services
		// grid lives inside `#main`; the badges sit in the hero
		// PageSection above it.
		await expect(page.locator('#main').getByText('Web 開発', { exact: true })).toBeVisible();

		await expect(page.getByRole('heading', { name: /依頼の流れ/ })).toBeVisible();
		await expect(page.getByText('お問い合わせ', { exact: true }).first()).toBeVisible();
		await expect(page.getByText('納品', { exact: true }).first()).toBeVisible();

		await expect(page.getByRole('heading', { name: /見積もりに必要な情報/ })).toBeVisible();
		await expect(page.getByText(/希望する納期/)).toBeVisible();

		await expect(page.getByRole('heading', { name: /使用ソフトウェア/ })).toBeVisible();
		await expect(page.getByText('AfterEffects').first()).toBeVisible();

		// Contact path is /contact, never a raw address.
		await expect(page.locator('a[href="/contact"]').first()).toBeVisible();
	});

	test('emits the contracted canonical and Open Graph metadata', async ({ page }) => {
		await page.goto('/commission');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			'https://rebuildup.dev/commission',
		);
		await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			'https://rebuildup.dev/commission',
		);
	});
});
