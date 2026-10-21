import { expect, test } from '@playwright/test';

/**
 * Keyboard reference — `/keyboard` (Issue #620).
 *
 * What this spec pins:
 *   1. the page renders 200 with its canonical heading;
 *   2. the committed snapshot is visible (macOS 12 layers, Windows 3);
 *   3. platform and layer switching work with both pointer and keyboard
 *      (roving tabindex / Arrow keys);
 *   4. selecting a key exposes the raw Kanata form and the separated
 *      tap / hold branches;
 *   5. at phone width the document does not scroll horizontally and
 *      the diagram's own scroll region is the only overflow;
 *   6. provenance is on the page — repository, pinned ref and the
 *      pc-setup adoption status;
 *   7. canonical + Open Graph metadata are the ones the contract lists.
 */

test.describe('keyboard — /keyboard reference', () => {
	test('renders the canonical heading and the committed snapshot', async ({ page }) => {
		const res = await page.goto('/keyboard');
		expect(res?.status()).toBe(200);

		await expect(page.locator('h1')).toHaveText('キーボード配列');
		await expect(page.getByText('現在、配列を表示できません')).toHaveCount(0);

		const platforms = page.getByRole('tablist', { name: 'プラットフォーム' });
		await expect(platforms.getByRole('tab', { name: /macOS/ })).toHaveAttribute(
			'aria-selected',
			'true',
		);
		await expect(platforms.getByRole('tab', { name: /Windows/ })).toBeVisible();

		await expect(
			page.getByRole('tablist', { name: 'macOS のレイヤー' }).getByRole('tab'),
		).toHaveCount(12);
		await expect(
			page.getByRole('tablist', { name: 'Windows のレイヤー' }).getByRole('tab'),
		).toHaveCount(0);
	});

	test('switches platform and layer with pointer', async ({ page }) => {
		await page.goto('/keyboard');

		await page.getByRole('tab', { name: /Windows/ }).click();
		await expect(
			page.getByRole('tablist', { name: 'Windows のレイヤー' }).getByRole('tab'),
		).toHaveCount(3);
		await expect(page.locator('button[data-keyboard-key="無変換"]')).toBeVisible();

		await page.getByRole('tab', { name: /^大西配列/ }).click();
		await expect(page.locator('button[data-keyboard-key="Space"]')).toBeVisible();
	});

	test('switches platform and layer with Arrow keys', async ({ page }) => {
		await page.goto('/keyboard');

		const macTab = page.getByRole('tab', { name: /macOS/ });
		await macTab.focus();
		await macTab.press('ArrowRight');
		await expect(page.getByRole('tab', { name: /Windows/ })).toHaveAttribute(
			'aria-selected',
			'true',
		);

		await page.getByRole('tab', { name: /macOS/ }).click();
		const onishiTab = page.getByRole('tab', { name: /^大西配列/ });
		await onishiTab.focus();
		await onishiTab.press('ArrowRight');
		await expect(page.getByRole('tab', { name: /^QWERTY/ })).toHaveAttribute(
			'aria-selected',
			'true',
		);
	});

	test('shows raw form plus separated tap / hold branches', async ({ page }) => {
		await page.goto('/keyboard');
		await page.locator('button[data-keyboard-key="Space"]').click();

		const detail = page.locator('[data-keyboard-detail]');
		await expect(detail).toBeVisible();
		await expect(detail.getByText('tap', { exact: true })).toBeVisible();
		await expect(detail.getByText('hold', { exact: true })).toBeVisible();
		await expect(detail).toContainText('tap 170ms / hold 180ms');
		await expect(detail.locator('code').first()).toContainText('@spco');
		await expect(detail).toContainText('tap-hold');
	});

	test('is readable at phone width without page-level horizontal scroll', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/keyboard');
		await expect(page.locator('h1')).toBeVisible();

		const overflow = await page.evaluate(() => ({
			document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
			diagram: (() => {
				const region = document.querySelector('[role="group"][aria-label*="キー配置"]');
				return region ? region.scrollWidth - region.clientWidth : 0;
			})(),
		}));
		expect(overflow.document).toBeLessThanOrEqual(1);
		expect(overflow.diagram).toBeGreaterThan(0);
	});

	test('records provenance and the pc-setup adoption status', async ({ page }) => {
		await page.goto('/keyboard');
		const sources = page.locator('section[aria-labelledby$="-sources"]');
		await expect(sources).toContainText('key-map-kanata');
		await expect(sources).toContainText('pc-setup');
		await expect(sources).toContainText('0c02df504029');
		await expect(sources).toContainText('mac/kanata-us.kbd');
	});

	test('emits the contracted canonical and Open Graph metadata', async ({ page }) => {
		await page.goto('/keyboard');
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			'https://rebuildup.dev/keyboard',
		);
		await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			'https://rebuildup.dev/keyboard',
		);
		await expect(page.locator('meta[property="og:title"]')).toContainText('キーボード配列');
	});
});
