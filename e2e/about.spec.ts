import { expect, test } from '@playwright/test';

/**
 * About — `/about` route surface (Issue #102).
 *
 * Scope:
 *   1. The page renders with status 200 and the canonical h1
 *      (name + handle cluster).
 *   2. The five narrative sections (identity / interests /
 *      experience / current / future) all render with their
 *      canonical `aria-labelledby` anchors, in order.
 *   3. The experience subset renders — at least one card with a
 *      link to `/portfolio/<slug>` is present (the experience
 *      section must surface a real public project).
 *   4. The "finds me elsewhere" footer renders external handles
 *      with absolute hrefs.
 *   5. The dropped surfaces (`/about/_AI`, `/about/links`,
 *      `/about/card/*`) MUST NOT resolve to a working route —
 *      each must 404. This pins the decision §「Why not bring
 *      back /about/_AI or /links」 anti-resurrection rule.
 *   6. The Home → About CTA is present and points at `/about`.
 *
 * Local env note: Playwright may fail locally if Chromium system
 * libs (`libnspr4.so` etc.) are absent. CI runs with the full
 * install (`pnpm run e2e:install`); local `pnpm run e2e` is
 * best-effort.
 */

test.describe('about — /about page', () => {
	test('renders 200 with the canonical h1 (identity cluster)', async ({ page }) => {
		const res = await page.goto('/about');
		expect(res?.status()).toBe(200);

		// The h1 carries the identity cluster (name + handle).
		const h1 = page.locator('h1#about-hero-title');
		await expect(h1).toBeVisible();
		// Identity fields rendered — exact strings come from
		// src/about/data.ts. The test pins the structural fact
		// (h1 + name + handle) without coupling to the exact
		// wording, so copy revisions do not break this test.
		const body = await page.locator('main').first().textContent();
		expect(body).toContain('samuido');
	});

	test('renders the five narrative sections in editorial order', async ({ page }) => {
		await page.goto('/about');
		// All five sections anchored by aria-labelledby, in order.
		const sections = page.locator('section[aria-labelledby^="about-section-"]');
		await expect(sections).toHaveCount(5);
		await expect(sections.nth(0)).toHaveAttribute('aria-labelledby', 'about-section-identity');
		await expect(sections.nth(1)).toHaveAttribute('aria-labelledby', 'about-section-interests');
		await expect(sections.nth(2)).toHaveAttribute('aria-labelledby', 'about-section-experience');
		await expect(sections.nth(3)).toHaveAttribute('aria-labelledby', 'about-section-current');
		await expect(sections.nth(4)).toHaveAttribute('aria-labelledby', 'about-section-future');
	});

	test('experience subset renders at least one portfolio card', async ({ page }) => {
		await page.goto('/about');
		const section = page.locator('section[aria-labelledby="about-section-experience"]');
		await expect(section).toBeVisible();
		// At least one link to a /portfolio/<slug> detail page
		// renders. The narrative subset is curated in
		// src/about/data.ts; on a clean seed at least one slug
		// resolves to a public project.
		const links = section.locator('a[href^="/portfolio/"]');
		await expect(links.first()).toBeVisible();
	});

	test('emits canonical + OGP + profile metadata derived from the loader', async ({ page }) => {
		await page.goto('/about');
		const canonical = page.locator('link[rel="canonical"]');
		await expect(canonical).toHaveAttribute('href', 'https://rebuildup.dev/about');
		await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'profile');
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', /About/);
		await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
			'content',
			'https://rebuildup.dev/about',
		);
	});

	test('renders the "finds me elsewhere" footer with absolute hrefs', async ({ page }) => {
		await page.goto('/about');
		const footer = page.locator('footer[aria-labelledby="about-footer-heading"]');
		await expect(footer).toBeVisible();
		// The footer contains external handle links — every link
		// must be absolute (no `/links`-style hub route).
		const links = footer.locator('a[href^="https://"]');
		expect(await links.count()).toBeGreaterThan(0);
	});
});

test.describe('about — Home → About CTA (priority loop)', () => {
	test('Home hero renders an "About me" CTA pointing at /about', async ({ page }) => {
		await page.goto('/');
		const cta = page.locator('section[aria-labelledby="hero-title"] a[href="/about"]');
		await expect(cta).toBeVisible();
		await expect(cta).toHaveAttribute('href', '/about');
	});

	test('clicking the Home CTA navigates to /about', async ({ page }) => {
		await page.goto('/');
		const cta = page.locator('section[aria-labelledby="hero-title"] a[href="/about"]').first();
		await cta.click();
		await expect(page).toHaveURL(/\/about$/);
		await expect(page.locator('h1#about-hero-title')).toBeVisible();
	});
});

test.describe('about — anti-resurrection guard (decision §Why)', () => {
	// The decision §「Why not bring back /about/_AI or /links」
	// explicitly forbids these as siblings of `/about`. The
	// following routes MUST 404 — they are not part of this release
	// contract and must never silently render.
	test('/about/_AI → 404', async ({ page }) => {
		const res = await page.goto('/about/_AI');
		expect(res?.status()).toBe(404);
	});

	test('/about/links → 404', async ({ page }) => {
		const res = await page.goto('/about/links');
		expect(res?.status()).toBe(404);
	});

	test('/about/card/real → 404', async ({ page }) => {
		const res = await page.goto('/about/card/real');
		expect(res?.status()).toBe(404);
	});

	test('/about/profile/handle → 404', async ({ page }) => {
		const res = await page.goto('/about/profile/handle');
		expect(res?.status()).toBe(404);
	});

	test('/about/commission/video → 404', async ({ page }) => {
		const res = await page.goto('/about/commission/video');
		expect(res?.status()).toBe(404);
	});
});
