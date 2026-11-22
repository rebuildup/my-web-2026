import { expect, test } from '@playwright/test';

/**
 * The companion overlay on a narrow viewport (Issue #1162).
 *
 * The contract (`docs/domain/pet-companion.md` §5.2, §5.3.1, §5.4)
 * says three things that only a browser can check:
 *
 *   1. The character draws itself on EVERY viewport. There is no
 *      button to summon it — the contract forbids one (§5.4), and a
 *      fixed button over the reading column is what the L-C review
 *      recorded as F-7.
 *   2. It rests at the BOTTOM-RIGHT, so what it can cover is the
 *      trailing edge of a line rather than its first characters.
 *   3. It is the companion's own footprint — one box, not a
 *      full-screen transparent layer.
 *
 * The unit tests cannot see any of this (the companion mounts after
 * hydration), so the assertions live here.
 */
const SPRITE = '[data-testid="pet-companion"]';

test.describe('companion overlay — narrow viewport (Issue #1162)', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	// Issue #1190 — the analytics-consent banner is ~341 px tall at this
	// width, and the companion's contract is to rest ABOVE it (the
	// sprite's bottom lands ~354 px from the viewport edge, not ~72 px).
	// The position assertions below are about the sprite's own resting
	// inset, so the banner is denied here and collapses to its pill.
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			try {
				localStorage.setItem('my-web-2026:analytics-consent', 'denied');
			} catch {
				// storage may be unavailable; the banner then stays and the
				// position assertions still describe the banner-free case
			}
		});
	});

	test('mounts without any summon control', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator(SPRITE)).toBeVisible();
		// The contract has no button for the companion: nothing may
		// offer to summon or dismiss it.
		await expect(page.getByRole('button', { name: /コンパニオン/ })).toHaveCount(0);
	});

	test('rests at the trailing edge of the viewport', async ({ page }) => {
		await page.goto('/');
		const sprite = page.locator(SPRITE);
		await expect(sprite).toBeVisible();
		const box = await sprite.boundingBox();
		const viewport = page.viewportSize();
		expect(box).not.toBeNull();
		expect(viewport).not.toBeNull();
		if (!box || !viewport) return;
		// Bottom-right: the inline-end inset is 24 px and the resting
		// box is the sprite's own 96 x 104 box.
		expect(box.x + box.width).toBeGreaterThan(viewport.width - 48);
		expect(box.y + box.height).toBeGreaterThan(viewport.height - 160);
	});

	test('does not cover the first characters of a line', async ({ page }) => {
		await page.goto('/');
		const sprite = page.locator(SPRITE);
		await expect(sprite).toBeVisible();
		const box = await sprite.boundingBox();
		const rail = await page.locator('nav[aria-label="Index"] a').first().boundingBox();
		expect(box).not.toBeNull();
		expect(rail).not.toBeNull();
		if (!box || !rail) return;
		// The companion is allowed to sit over the trailing edge; it may
		// never sit over the START of the line, which is what a
		// bottom-left control did.
		const overlapsStart = box.x < rail.x + rail.width && box.x + box.width > rail.x;
		expect(overlapsStart).toBe(false);
	});
});

test.describe('companion overlay — desktop (Issue #1162)', () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test('rests inside the reserved corridor', async ({ page }) => {
		await page.goto('/');
		const sprite = page.locator(SPRITE);
		await expect(sprite).toBeVisible();
		const box = await sprite.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;
		// `inset-inline-end: 24px` — the sprite keeps its own margin
		// from the viewport edge.
		expect(box.x + box.width).toBeLessThanOrEqual(1440 - 24 + 1);
	});
});
