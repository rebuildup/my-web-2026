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

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { NAV_ROSTER } from '../nav-roster';
import { COMPAT_ROUTES, assertRouteContract, observeRoute } from './contract';

const SCREENSHOT_DIR = join('.tmp', 'compat-screenshots');

/**
 * The verification report renders the roster THIS run executed.
 * Writing it here — rather than keeping a second hand-maintained copy
 * in the report script — is what makes the report's 「未実行route」
 * band meaningful: it compares the claimed roster against the executed
 * rows, so a route cannot silently leave the report by being edited in
 * one place only.
 */
test.beforeAll(() => {
	mkdirSync('.tmp', { recursive: true });
	writeFileSync(
		join('.tmp', 'compat-routes.json'),
		`${JSON.stringify(
			COMPAT_ROUTES,
			(_key, value) => (value instanceof RegExp ? String(value) : value),
			2,
		)}\n`,
	);
});

test.describe('public routes render identically on every engine', () => {
	for (const route of COMPAT_ROUTES) {
		test(`${route.path} satisfies the public display contract`, async ({ page }, testInfo) => {
			const observation = await observeRoute(page, route.path);

			// Capture before judging: a failing route still contributes the
			// visual evidence the matrix report needs.
			//
			// First viewport only, not `fullPage`. The report lays 3 engines
			// side by side per route; a full-page capture of the home
			// surface makes the committed WebP several times larger for
			// detail nobody reads at thumbnail size.
			await page.screenshot({
				path: join(SCREENSHOT_DIR, testInfo.project.name, `${route.slug}.png`),
				fullPage: false,
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

	test('skip-to-content link takes keyboard focus to main', async ({ page, browserName }) => {
		// Environment limitation, recorded rather than hidden (Issue #415:
		// 「OSごとの差異は別検証として記録」). Headless WebKit never moves
		// sequential focus off `BODY` — not for the first Tab, not after
		// clicking, not after 5 stops — on ANY page, on both hosts this
		// repository runs on (ubuntu-latest CI and local macOS), while
		// Chromium and Firefox reach the first link on the first Tab.
		// That is a property of the WebKit build under automation, not a
		// my-web-2026 defect, so the traversal check is skipped there
		// rather than weakened everywhere. The cell renders as SKIP in
		// the matrix, never as a pass, and the skip-link CONTRACT (link
		// present, `#main` resolves) is still asserted on WebKit by
		// `assertRouteContract`.
		test.skip(
			browserName === 'webkit',
			'WebKit headless keeps sequential focus on BODY (no traversal) — see docs/development.md',
		);

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

		// A bounded Tab walk rather than "the very first Tab must land
		// here". Engines differ on where the initial sequential-focus
		// navigation starts (WebKit parks it outside the document until
		// the page has been interacted with), and that difference is not
		// a compatibility defect. What IS the contract is that the skip
		// link is reachable by keyboard, within a few stops, and that
		// focusing it reveals it.
		let reached = false;
		for (let stop = 0; stop < 5 && !reached; stop += 1) {
			await page.keyboard.press('Tab');
			reached = await skip.evaluate((el) => el === document.activeElement);
		}
		expect(reached, 'skip link must be reachable with the keyboard').toBe(true);
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
		await expect(panel.locator('a')).toHaveCount(NAV_ROSTER.length);

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
