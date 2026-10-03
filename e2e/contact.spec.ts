import { expect, test } from '@playwright/test';

/**
 * `/contact` route E2E (Issue #103).
 *
 * Two scopes:
 *
 *   1. Smoke — page loads, hero h1 + canonical section heading
 *      + channel list (or empty-state) render correctly.
 *   2. Channel-list contract — each rendered channel row carries
 *      label / purpose / verified-relative label / external link.
 *      No row may omit the purpose field; this enforces the
 *      "用途を明示" requirement from the Issue scope.
 *
 * The channel data layer is `src/contact/channels.json` (repo-
 * controlled). The local webServer / production origin both read
 * the same JSON, so the contract holds in both modes. This spec
 * does NOT seed any state — it relies on whatever the bundled
 * channels.json produces after the freshness gate.
 *
 * Local D1 / R2 / Channels are not required for this spec to run.
 */

const EXPECTED_PURPOSES = [
	'採用のお問い合わせ',
	'技術的な議論',
	'配布・公開について',
	'制作依頼の受け付け',
	'その他',
] as const;

test.describe('/contact page composition', () => {
	test('renders the canonical hero and section landmarks', async ({ page }) => {
		await page.goto('/contact');

		// Single h1.
		const h1 = page.locator('h1');
		await expect(h1).toHaveCount(1);
		await expect(h1).toHaveText('Contact');

		// Two sections anchored by aria-labelledby.
		const sections = page.locator('section[aria-labelledby]');
		await expect(sections).toHaveCount(2);
		await expect(sections.nth(0)).toHaveAttribute('aria-labelledby', 'contact-hero-title');
		await expect(sections.nth(1)).toHaveAttribute('aria-labelledby', 'channels-heading');

		// Skip-to-content + main landmark.
		await expect(page.locator('a[href="#main"]')).toHaveCount(1);
		await expect(page.locator('main#main')).toBeVisible();
	});

	test('does NOT expose pricing / commission / shop affordance', async ({ page }) => {
		await page.goto('/contact');
		// The decision doc and Issue #103 explicitly drop these.
		// We assert their absence in the page text.
		const body = await page.locator('body').innerText();
		expect(body).not.toMatch(/料金|price|pricing|commission fee|shop/i);
		// Contact form input is out of scope.
		expect(await page.locator('form').count()).toBe(0);
	});

	test('channel list honors the verified_at + active gate (fail-closed)', async ({ page }) => {
		await page.goto('/contact');

		// Either a populated list or the explicit empty-state.
		const list = page.locator('[data-testid="contact-channels"]');
		const empty = page.locator('[data-testid="contact-empty"]');
		const populated = (await list.count()) > 0;
		const emptyRendered = (await empty.count()) > 0;
		expect(populated || emptyRendered).toBe(true);
		expect(populated && emptyRendered).toBe(false);

		if (!populated) return; // empty-state already validated

		// Every channel row carries label / labelEn / purpose / url / verified.
		const rows = list.locator('li[data-channel-id]');
		const count = await rows.count();
		expect(count).toBeGreaterThan(0);

		for (let i = 0; i < count; i++) {
			const row = rows.nth(i);
			const id = await row.getAttribute('data-channel-id');
			expect(id).toBeTruthy();
			// Purpose label — must be one of the canonical purposes.
			const rowText = await row.innerText();
			const matchedPurpose = EXPECTED_PURPOSES.some((p) => rowText.includes(p));
			expect(matchedPurpose, `row ${id} must expose a purpose label`).toBe(true);
			// External link with safe rel attrs.
			const link = row.locator('a[data-testid="contact-channel-link"]');
			await expect(link).toHaveCount(1);
			const href = await link.getAttribute('href');
			expect(href).toMatch(/^https:\/\//);
			await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
			await expect(link).toHaveAttribute('target', '_blank');
			// Verified-relative label.
			expect(rowText).toMatch(/verified|検証/);
		}
	});
});

test.describe('home -> /contact CTA', () => {
	test('home page links to /contact', async ({ page }) => {
		await page.goto('/');
		const link = page.locator('a[data-testid="home-contact-link"][href="/contact"]');
		await expect(link).toBeVisible();
		// Click-through — actually navigate to /contact.
		await link.click();
		await expect(page).toHaveURL(/\/contact$/);
		await expect(page.locator('h1')).toHaveText('Contact');
	});
});
