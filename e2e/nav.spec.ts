import { expect, test } from '@playwright/test';

/**
 * PublicNav — site-wide navigation chrome (Issue #168).
 *
 * Scopes:
 *   1. The nav renders on every public route (`/`, `/about`,
 *      `/contact`, `/portfolio`, `/portfolio/<slug>`, `/tools`,
 *      `/tools/<slug>`).
 *   2. The five canonical nav items are present, in order, and
 *      labelled with the bilingual `ja / en` pair.
 *   3. The active route is announced via `aria-current="page"` on
 *      the matching `<a>`.
 *   4. The nav is reachable from `/` to `/tools` in one click —
 *      the IA gap that motivated #168.
 *   5. The nav does NOT appear on `/admin/*` (admin owns its own
 *      chrome).
 *   6. The mobile affordance collapses the nav below the `md`
 *      breakpoint (Playwright drives a 600px-wide context here so
 *      the test stays close to the documented `≤600px` rule).
 */

const PUBLIC_ROUTES: ReadonlyArray<{ path: string; h1: RegExp }> = [
	{ path: '/', h1: /木村友亮 \/ samuido/ },
	{ path: '/about', h1: /木村友亮/ },
	{ path: '/contact', h1: /Contact/ },
	{ path: '/portfolio', h1: /主要な制作物/ },
	{ path: '/tools', h1: /Tools/ },
];

test.describe('public nav — presence on every public route', () => {
	for (const route of PUBLIC_ROUTES) {
		test(`renders the nav on ${route.path}`, async ({ page }) => {
			const res = await page.goto(route.path);
			expect(res?.status()).toBe(200);

			// Single `<nav aria-label="Public">` landmark at the top.
			const nav = page.locator('nav[aria-label="Public"]');
			await expect(nav).toBeVisible();

			// Canonical h1 still renders under the nav — confirms
			// the nav is chrome ABOVE the page body, not a
			// replacement for it.
			await expect(page.locator('h1').first()).toBeVisible();
			await expect(page.locator('h1').first()).toContainText(route.h1);

			// The five links are present, in order.
			const desktopLinks = nav.locator('[data-testid="public-nav-desktop"] > li > a');
			const expectedOrder = ['/', '/portfolio', '/tools', '/about', '/contact'];
			for (const [i, href] of expectedOrder.entries()) {
				await expect(desktopLinks.nth(i)).toHaveAttribute('href', href);
			}
		});
	}
});

test.describe('public nav — active-route highlighting', () => {
	test('aria-current="page" on the active item only', async ({ page }) => {
		for (const { path } of PUBLIC_ROUTES) {
			await page.goto(path);
			const nav = page.locator('nav[aria-label="Public"]');
			const activeLinks = nav.locator('[data-testid="public-nav-desktop"] a[aria-current="page"]');
			await expect(activeLinks).toHaveCount(1);
			// Resolve path → expected `to` segment.
			const expected = path === '/' ? '/' : `/${path.split('/').filter(Boolean)[0] ?? ''}`;
			await expect(activeLinks.first()).toHaveAttribute('href', expected);
		}
	});

	test('aria-current matches the tool slug under /tools/<slug>', async ({ page }) => {
		// /tools/<slug> pages don't enumerate here because the
		// public-tools set is short at this release; ProtoType is
		// the only public Tool at the end of #81. The contract is
		// that the parent segment ("/tools") stays active.
		await page.goto('/tools/prototype');
		const nav = page.locator('nav[aria-label="Public"]');
		const activeLinks = nav.locator('[data-testid="public-nav-desktop"] a[aria-current="page"]');
		await expect(activeLinks).toHaveCount(1);
		await expect(activeLinks.first()).toHaveAttribute('href', '/tools');
	});
});

test.describe('public nav — Home → Tools one-click (Issue #168)', () => {
	test('home capabilities card links to /tools', async ({ page }) => {
		await page.goto('/');
		const section = page.locator('section[aria-labelledby="capabilities-heading"]');
		const toolsCta = section
			.locator('li')
			.filter({ hasText: 'ツール' })
			.locator('a[href="/tools"]');
		await expect(toolsCta).toBeVisible();
	});

	test('clicking the home capabilities card navigates to /tools', async ({ page }) => {
		await page.goto('/');
		const section = page.locator('section[aria-labelledby="capabilities-heading"]');
		const toolsCta = section
			.locator('li')
			.filter({ hasText: 'ツール' })
			.locator('a[href="/tools"]');
		await toolsCta.click();
		await expect(page).toHaveURL(/\/tools$/);
		await expect(page.locator('h1')).toHaveText(/Tools/);
	});

	test('clicking the nav Tools link from / also navigates to /tools', async ({ page }) => {
		await page.goto('/');
		const navToolsLink = page.locator(
			'nav[aria-label="Public"] [data-testid="public-nav-desktop"] a[href="/tools"]',
		);
		await navToolsLink.click();
		await expect(page).toHaveURL(/\/tools$/);
	});
});

test.describe('public nav — admin chrome exclusion', () => {
	test('does NOT mount on /admin/login', async ({ page }) => {
		// /admin/login is the public admin entry; it must NOT show
		// the site nav because admin owns its own chrome.
		await page.goto('/admin/login');
		await expect(page.locator('nav[aria-label="Public"]')).toHaveCount(0);
	});
});

test.describe('public nav — mobile collapse (≤600px)', () => {
	test.use({ viewport: { width: 600, height: 800 } });

	test('desktop strip is hidden and the hamburger is visible', async ({ page }) => {
		await page.goto('/');
		const nav = page.locator('nav[aria-label="Public"]');
		const desktop = nav.locator('[data-testid="public-nav-desktop"]');
		const button = nav.locator('button[aria-controls]');

		// The desktop strip is in the DOM but not visible — the
		// `display: none` media-query hides it. The hamburger
		// button is visible and has `aria-expanded="false"`.
		await expect(desktop).toBeHidden();
		await expect(button).toBeVisible();
		await expect(button).toHaveAttribute('aria-expanded', 'false');

		// Open the menu — the panel is revealed, `aria-expanded`
		// flips to `true`.
		await button.click();
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		const panel = nav.locator('[data-testid="public-nav-mobile-panel"]');
		await expect(panel).toBeVisible();
		// The mobile panel carries the same five links.
		const mobileLinks = panel.locator('a');
		await expect(mobileLinks).toHaveCount(5);

		// Tapping a link in the panel navigates and closes the
		// menu. We tap `/about` and verify the URL change.
		await panel.locator('a[href="/about"]').click();
		await expect(page).toHaveURL(/\/about$/);
		await expect(button).toHaveAttribute('aria-expanded', 'false');
	});
});
