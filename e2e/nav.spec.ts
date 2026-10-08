import { expect, test } from '@playwright/test';

/**
 * PublicNav — per-page opt-in site chrome (Issue #168, re-scoped by
 * Issue #199).
 *
 * Chrome contract after #199: `PublicNav` / `Breadcrumbs` are NOT
 * auto-mounted from `src/routes/__root.tsx`. Each page imports and
 * places them itself. Two consequences this spec encodes:
 *
 *   - `/` (home) intentionally renders **no** `PublicNav`. The home
 *     surface reaches `/tools` through the capabilities card CTA
 *     instead (`src/home/capabilities/registry.ts`).
 *   - Only the opt-in pages carry the nav. The roster itself is
 *     `PUBLIC_NAV_ITEMS` in `src/editorial/nav/PublicNav.tsx` — six
 *     entries, `/design-system` added by Issue #181.
 *
 * Scopes:
 *   1. `/` does NOT mount the nav (the #199 contract).
 *   2. The nav renders on every opt-in page (`/about`, `/contact`,
 *      `/portfolio`, `/tools`, `/design-system`).
 *   3. The six canonical nav items are present, in order.
 *   4. The active route is announced via `aria-current="page"` on
 *      exactly one link; nested routes keep the parent segment
 *      active (`/tools/prototype` → `/tools`).
 *   5. Home → Tools one click is still possible, via the
 *      capabilities card rather than the nav.
 *   6. The nav does NOT appear on `/admin/*` (admin owns its own
 *      chrome).
 *   7. The mobile affordance collapses the nav below the `md`
 *      breakpoint.
 */

/**
 * Pages that opt into `PublicNav`. `/portfolio/<slug>` and
 * `/tools/<slug>` are covered separately below — their fixtures
 * depend on published D1 rows, so they are not part of this loop.
 */
const NAV_OPT_IN_PAGES: ReadonlyArray<{ path: string; h1: RegExp }> = [
	{ path: '/about', h1: /木村友亮/ },
	{ path: '/contact', h1: /Contact/ },
	{ path: '/portfolio', h1: /主要な制作物/ },
	{ path: '/tools', h1: /Tools/ },
	{ path: '/design-system', h1: /Design System/ },
];

/**
 * Canonical nav roster. Mirrors `PUBLIC_NAV_ITEMS` — order is
 * editorial, not alphabetical. `/design-system` is last because it
 * is a showcase surface, not part of the primary IA.
 */
const NAV_ROSTER: ReadonlyArray<string> = [
	'/',
	'/portfolio',
	'/tools',
	'/about',
	'/contact',
	'/design-system',
];

test.describe('public nav — home exclusion (Issue #199)', () => {
	test('is NOT mounted on / (opt-in convention)', async ({ page }) => {
		const res = await page.goto('/');
		expect(res?.status()).toBe(200);

		// The home surface deliberately renders no site chrome — it
		// is the one public page that does not opt in.
		await expect(page.locator('nav[aria-label="Public"]')).toHaveCount(0);

		// The hero still owns the page's canonical h1 (Issue #287 —
		// accessible name is the platform name, not a person).
		await expect(page.locator('h1').first()).toHaveAccessibleName('my-web-2026');
	});
});

test.describe('public nav — presence on opt-in pages', () => {
	for (const route of NAV_OPT_IN_PAGES) {
		test(`renders the nav on ${route.path}`, async ({ page }) => {
			const res = await page.goto(route.path);
			expect(res?.status()).toBe(200);

			// Single `<nav aria-label="Public">` landmark at the top.
			const nav = page.locator('nav[aria-label="Public"]');
			await expect(nav).toBeVisible();

			// Canonical h1 still renders under the nav — confirms the
			// nav is chrome ABOVE the page body, not a replacement.
			await expect(page.locator('h1').first()).toBeVisible();
			await expect(page.locator('h1').first()).toContainText(route.h1);

			// The six links are present, in order. The desktop strip
			// maps `PUBLIC_NAV_ITEMS` straight onto `<a>` elements —
			// there is no `<li>` wrapper, so the selector targets the
			// `<a>` children directly.
			const desktopLinks = nav.locator('[data-testid="public-nav-desktop"] > a');
			for (const [i, href] of NAV_ROSTER.entries()) {
				await expect(desktopLinks.nth(i)).toHaveAttribute('href', href);
			}
			await expect(desktopLinks).toHaveCount(NAV_ROSTER.length);
		});
	}
});

test.describe('public nav — active-route highlighting', () => {
	test('aria-current="page" marks exactly one item on each opt-in page', async ({ page }) => {
		for (const { path } of NAV_OPT_IN_PAGES) {
			await page.goto(path);
			const nav = page.locator('nav[aria-label="Public"]');
			const activeLinks = nav.locator('[data-testid="public-nav-desktop"] a[aria-current="page"]');
			await expect(activeLinks).toHaveCount(1);
			// Resolve path → expected `to` segment.
			const expected = `/${path.split('/').filter(Boolean)[0] ?? ''}`;
			await expect(activeLinks.first()).toHaveAttribute('href', expected);
		}
	});

	test('the parent segment stays active on a nested route', async ({ page }) => {
		// `/tools/<slug>` must highlight `/tools`, not the leaf.
		await page.goto('/tools/prototype');
		const nav = page.locator('nav[aria-label="Public"]');
		const activeLinks = nav.locator('[data-testid="public-nav-desktop"] a[aria-current="page"]');
		await expect(activeLinks).toHaveCount(1);
		await expect(activeLinks.first()).toHaveAttribute('href', '/tools');
	});

	test('/design-system highlights itself, not a parent', async ({ page }) => {
		await page.goto('/design-system');
		const nav = page.locator('nav[aria-label="Public"]');
		const activeLinks = nav.locator('[data-testid="public-nav-desktop"] a[aria-current="page"]');
		await expect(activeLinks).toHaveCount(1);
		await expect(activeLinks.first()).toHaveAttribute('href', '/design-system');
	});
});

test.describe('public nav — Home → Tools one-click (Issue #168)', () => {
	// Since #199 `/` carries no PublicNav, the one-click path from
	// home runs through the capabilities card CTA instead. The IA
	// requirement (#168) is unchanged; only the affordance moved.
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

	// Runs on `/about` rather than `/` because `/` no longer opts
	// into the nav (#199). `/about` is a stable, data-independent
	// opt-in page.
	test('desktop strip is hidden and the hamburger is visible', async ({ page }) => {
		await page.goto('/about');
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
		// The mobile panel carries the same six links.
		const mobileLinks = panel.locator('a');
		await expect(mobileLinks).toHaveCount(NAV_ROSTER.length);

		// Tapping a link in the panel navigates and closes the
		// menu. We tap `/contact` and verify the URL change.
		await panel.locator('a[href="/contact"]').click();
		await expect(page).toHaveURL(/\/contact$/);
		await expect(button).toHaveAttribute('aria-expanded', 'false');
	});
});
