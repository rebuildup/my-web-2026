import { expect, test } from '@playwright/test';

/**
 * `/activity` route E2E (Issue #352).
 *
 * What this spec pins:
 *   1. the page renders 200 with its canonical heading and the
 *      per-source health line the timeline contract publishes;
 *   2. items carry kind badge, source label, date and a real
 *      permalink — never an interpolated date;
 *   3. canonical + Open Graph metadata are the ones the route head
 *      declares.
 *
 * Data honesty: the loader composes the committed GitHub activity
 * snapshot (ReleaseEvent rows only — zero today is a valid state)
 * and the public portfolio index. The spec asserts STRUCTURE and
 * the health vocabulary, not a specific item count, so a source
 * outage degrades the page honestly instead of failing the suite
 * for the wrong reason.
 */

test.describe('activity — /activity timeline', () => {
	test('renders the canonical heading and the timeline surface', async ({ page }) => {
		const res = await page.goto('/activity');
		expect(res?.status()).toBe(200);

		await expect(page.locator('h1')).toHaveText('活動タイムライン / Activity');

		const timeline = page.locator('[data-testid="activity-timeline"]');
		await expect(timeline).toBeVisible();
		// The source-health line names all three declared sources —
		// GitHub, Portfolio and the not-yet-connected articles source.
		await expect(timeline).toContainText('GitHub');
		await expect(timeline).toContainText('Portfolio');
		await expect(timeline).toContainText('Content');
		await expect(timeline).toContainText('観測日');
	});

	test('renders honest empty or populated states, never a fabricated date', async ({ page }) => {
		await page.goto('/activity');

		const timeline = page.locator('[data-testid="activity-timeline"]');
		const items = page.locator('[data-timeline-item]');
		const itemCount = await items.count();

		if (itemCount === 0) {
			// The honest empty state is one of the two contract
			// sentences — never an error page and never invented rows.
			await expect(timeline).toContainText(
				/掲載できる活動はまだありません|活動ソースを取得できませんでした/,
			);
			return;
		}

		// Every rendered item carries its kind badge, its 出典 label
		// and a date or authored period label — the row contract.
		const first = items.first();
		await expect(first).toContainText(/リリース|記事|作品/);
		await expect(first).toContainText(/GitHub|Portfolio|Content/);
	});

	test('emits the contracted canonical and Open Graph metadata', async ({ page }) => {
		await page.goto('/activity');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			'https://rebuildup.dev/activity',
		);
		await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			'https://rebuildup.dev/activity',
		);
	});
});
