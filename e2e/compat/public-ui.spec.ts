/**
 * Cross-engine public UI smoke (Issue #415).
 *
 * Runs the SAME assertions under the three Playwright engines
 * (Chromium / Firefox / WebKit) via `playwright.compat.config.ts`.
 * The chromium-only suite in `e2e/*.spec.ts` answers "does the public
 * surface work?"; this one answers "does it work identically in the
 * engines a visitor might actually be using?".
 *
 * What is deliberately NOT here
 * -----------------------------
 *   - No vendor sniffing, no engine-specific branches. A per-engine
 *     `if` would turn a regression into a documented exception, which
 *     is the silent-pass failure mode the Issue forbids.
 *   - No assertion on font metrics, animation timing, or anything that
 *     legitimately differs per engine. Those belong to a visual-diff
 *     gate, not to a smoke.
 *   - No admin surface, no authenticated flow, no production origin.
 *     `/admin/*` is out of the public-UI contract and would couple this
 *     gate to features that are still in flight (AGENTS.md §11).
 *
 * Screenshots are captured on EVERY route assertion (not only on
 * failure) so `scripts/make-compat-matrix-report.mjs` can build the
 * side-by-side browser matrix the Issue requires. They are written to
 * `.tmp/` (gitignored) and are never a pass/fail signal on their own.
 */

import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { COMPAT_ROUTES, assertRouteContract, observeRoute } from './contract';

const SCREENSHOT_DIR = join('.tmp', 'compat-screenshots');

test.describe('public routes render identically on every engine', () => {
	for (const route of COMPAT_ROUTES) {
		test(`${route.path} satisfies the public display contract`, async ({ page }, testInfo) => {
			const observation = await observeRoute(page, route.path);

			// Capture before judging: a failing route still contributes the
			// visual evidence the matrix report needs.
			await page.screenshot({
				path: join(SCREENSHOT_DIR, testInfo.project.name, `${route.slug}.png`),
				fullPage: true,
			});

			assertRouteContract(route, observation);
		});
	}
});

test.describe('basic operations', () => {
	test('desktop nav carries /about to /contact in one click', async ({ page }) => {
		await page.goto('/about', { waitUntil: 'load' });
		const nav = page.locator('nav[aria-label="Public"]');
		const contact = nav.locator('[data-testid="public-nav-desktop"] a[href="/contact"]');
		await expect(contact).toBeVisible();

		// `toPass` retries the whole click, which is also the hydration
		// guard: a click that lands before React attaches its handlers
		// navigates nowhere, and a bare one-shot `click()` would fail on
		// whichever engine is slowest to hydrate.
		await expect(async () => {
			await contact.click();
			await expect(page).toHaveURL(/\/contact$/, { timeout: 1_500 });
		}).toPass({ timeout: 15_000 });

		await expect(page.locator('h1')).toHaveText('Contact');
		// The arrival page marks itself, exactly one item, in the roster.
		await expect(
			page.locator('[data-testid="public-nav-desktop"] a[aria-current="page"]'),
		).toHaveCount(1);
	});

	test('browser history restores the previous public page', async ({ page }) => {
		await page.goto('/', { waitUntil: 'load' });
		await page.goto('/tools', { waitUntil: 'load' });
		await expect(page.locator('h1').first()).toContainText('Tools');

		await page.goBack({ waitUntil: 'load' });

		// WebKit's back-forward cache makes this the most engine-divergent
		// step in the whole gate: the document may come back from cache
		// rather than from the network, so assert the rendered contract,
		// not the response.
		await expect(page).toHaveURL(/\/$/);
		await expect(page.locator('h1')).toHaveAccessibleName('my-web-2026');
		await expect(page.locator('main#main')).toBeVisible();
	});

	test('skip-to-content link takes keyboard focus to main', async ({ page }) => {
		await page.goto('/', { waitUntil: 'load' });

		const skip = page.locator('a[href="#main"]');
		await expect(skip).toHaveCount(1);

		// The link is parked off-screen with `translateY(-200%)` and is
		// revealed by `:focus-visible`. Playwright calls a transformed
		// element "visible", so the focus path is proven geometrically
		// instead: the parked box sits ABOVE the viewport (negative y)
		// and the focused box is inside it.
		const parked = await skip.boundingBox();
		expect(parked, 'skip link must be laid out before focus').not.toBeNull();
		expect(parked?.y ?? 0).toBeLessThan(0);

		await page.keyboard.press('Tab');
		await expect(skip).toBeFocused();

		const revealed = await skip.boundingBox();
		expect(revealed?.y ?? -1).toBeGreaterThanOrEqual(0);

		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/#main$/);
		await expect(page.locator('main#main')).toBeVisible();
	});
});

test.describe('basic operations — mobile viewport', () => {
	test.use({ viewport: { width: 600, height: 800 } });

	test('hamburger opens the panel, navigates, and closes', async ({ page }) => {
		await page.goto('/about', { waitUntil: 'load' });

		const nav = page.locator('nav[aria-label="Public"]');
		const button = nav.locator('button[aria-controls]');
		await expect(nav.locator('[data-testid="public-nav-desktop"]')).toBeHidden();
		await expect(button).toBeVisible();
		await expect(button).toHaveAttribute('aria-expanded', 'false');

		await expect(async () => {
			await button.click();
			await expect(button).toHaveAttribute('aria-expanded', 'true', { timeout: 1_500 });
		}).toPass({ timeout: 15_000 });

		const panel = nav.locator('[data-testid="public-nav-mobile-panel"]');
		await expect(panel).toBeVisible();
		await expect(panel.locator('a')).toHaveCount(6);

		await expect(async () => {
			await panel.locator('a[href="/contact"]').click();
			await expect(page).toHaveURL(/\/contact$/, { timeout: 1_500 });
		}).toPass({ timeout: 15_000 });

		// The panel closes itself on navigation (PublicNav effect) — the
		// state must not leak across routes.
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		await expect(panel).toBeHidden();
	});

	test('Escape closes the mobile panel without navigating', async ({ page }) => {
		await page.goto('/about', { waitUntil: 'load' });

		const nav = page.locator('nav[aria-label="Public"]');
		const button = nav.locator('button[aria-controls]');
		const panel = nav.locator('[data-testid="public-nav-mobile-panel"]');

		await expect(async () => {
			await button.click();
			await expect(panel).toBeVisible({ timeout: 1_500 });
		}).toPass({ timeout: 15_000 });

		await page.keyboard.press('Escape');
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		await expect(panel).toBeHidden();
		await expect(page).toHaveURL(/\/about$/);
	});
});
