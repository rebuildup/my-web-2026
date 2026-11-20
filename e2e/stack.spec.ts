import { expect, test } from '@playwright/test';

/**
 * `/stack` route E2E (Issue #381).
 *
 * What this spec pins:
 *   1. the page renders 200 with its canonical heading and the
 *      committed stack sections;
 *   2. every item carries at least one evidence link that opens
 *      externally with `rel="noopener noreferrer"`;
 *   3. the undetermined contract holds — the GitHub Actions entry
 *      renders 「未確定」 rather than a guessed version;
 *   4. canonical + Open Graph metadata are the ones the route head
 *      declares.
 */

test.describe('stack — /stack reference', () => {
	test('renders the canonical heading and the committed sections', async ({ page }) => {
		const res = await page.goto('/stack');
		expect(res?.status()).toBe(200);

		await expect(page.locator('h1')).toHaveText('開発スタック / Stack');

		for (const section of ['runtime', 'data', 'styling', 'quality', 'biome']) {
			const list = page.locator(`[data-testid="stack-items-${section}"]`);
			await expect(list).toBeVisible();
			expect(await list.locator('li').count()).toBeGreaterThan(0);
		}

		// Spot-check committed entries.
		await expect(page.locator('[data-testid="stack-item-cloudflare-workers"]')).toContainText(
			'Cloudflare Workers',
		);
		await expect(page.locator('[data-testid="stack-item-biome"]')).toContainText('Biome');
	});

	test('renders the Biome settings table from biome.json and the code samples (Issue #382)', async ({
		page,
	}) => {
		await page.goto('/stack');

		// The settings table is resolved from the committed biome.json
		// at request time — the values the file declares must appear.
		const settings = page.locator('[data-testid="stack-settings-biome-config"]');
		await expect(settings).toBeVisible();
		await expect(settings).toContainText('formatter.lineWidth');
		await expect(settings).toContainText('100');
		await expect(settings).toContainText('javascript.formatter.trailingCommas');
		await expect(settings).toContainText('linter.rules.recommended');

		// The before/after pair and the compression comparison render
		// as labelled code blocks.
		const samples = page.locator('[data-testid="stack-samples-biome-format-sample"]');
		await expect(samples).toContainText('変換前');
		await expect(samples).toContainText('Biome 適用後');
		await expect(samples.locator('[data-code-block]')).toHaveCount(2);

		const comparison = page.locator('[data-testid="stack-samples-biome-compression-decision"]');
		await expect(comparison).toContainText('1行圧縮案');
		await expect(comparison.locator('[data-code-block]')).toHaveCount(2);
	});

	test('every evidence link opens externally and safely', async ({ page }) => {
		await page.goto('/stack');

		const evidenceLinks = page.locator('a[target="_blank"]');
		expect(await evidenceLinks.count()).toBeGreaterThan(0);
		for (const el of await evidenceLinks.all()) {
			await expect(el).toHaveAttribute('rel', 'noopener noreferrer');
			await expect(el).toHaveAttribute('href', /^https:\/\//);
		}
	});

	test('renders undetermined items as 未確定, never a guess', async ({ page }) => {
		await page.goto('/stack');

		const gha = page.locator('[data-testid="stack-item-github-actions"]');
		await expect(gha).toContainText('未確定');
	});

	test('emits the contracted canonical and Open Graph metadata', async ({ page }) => {
		await page.goto('/stack');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			'https://rebuildup.dev/stack',
		);
		await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			'https://rebuildup.dev/stack',
		);
	});
});
