import { expect, test } from '@playwright/test';
import { PAGE_CONTENT_SECTIONS } from '../scripts/prod-smoke-routes.mjs';

/**
 * Deployed Worker smoke.
 *
 * Same checks work for the local `pnpm dev` server and a real
 * Cloudflare Worker deployment. The only difference is the base
 * URL — see playwright.config.ts#use.baseURL. When PLAYWRIGHT_BASE_URL
 * points at the deployed Worker (post-`pnpm deploy`), these tests
 * are the real-resource smoke that #009 requires.
 *
 * The D1 / R2 endpoints return 200/404 respectively; the test asserts
 * the documented status codes and JSON shapes from src/http/hono.ts.
 */
test.describe('deployed Worker smoke', () => {
	test('GET / responds 200 HTML', async ({ request }) => {
		const res = await request.get('/');
		expect(res.status()).toBe(200);
		const body = await res.text();
		expect(body).toContain('my-web-2026');
	});

	test('GET /api/v1/health responds 200 JSON ping', async ({ request }) => {
		const res = await request.get('/api/v1/health');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.status).toBe('ok');
	});

	test('GET /api/v1/db/ping responds 200 with one=1', async ({ request }) => {
		const res = await request.get('/api/v1/db/ping');
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.one).toBe(1);
	});

	test('GET /api/v1/media/ping responds 404 key_not_found', async ({ request }) => {
		const res = await request.get('/api/v1/media/ping');
		// R2 bucket is reachable but the probe key is intentionally absent.
		expect(res.status()).toBe(404);
		const body = await res.json();
		expect(body.status).toBe('key_not_found');
	});

	test('a plaintext origin does not answer with HSTS (Issue #446)', async ({
		baseURL,
		request,
	}, testInfo) => {
		// `pnpm preview` serves `http://127.0.0.1:3000`, so this suite's
		// default base URL is plaintext. RFC 6797 §7.2 requires a user
		// agent to IGNORE an HSTS header received over insecure transport,
		// so a header here would be inert — and, worse, it would read as
		// "HTTPS is configured here" for a response that proves nothing.
		const origin = baseURL ?? testInfo.project.use.baseURL ?? '';
		test.skip(
			!origin,
			'no base URL is configured, so there is no origin to make a statement about',
		);
		test.skip(
			new URL(origin).protocol !== 'http:',
			'an HTTPS base URL was supplied; the positive case is covered by test/integration/hsts-transport-security.test.ts and the production smoke',
		);
		const res = await request.get('/');
		expect(res.headers()['strict-transport-security']).toBeUndefined();
	});
});

/**
 * Home page composition (Issue #21, compressed by Issue #884).
 *
 * Verifies the five named sections (the hero plus four content
 * sections: `current-projects-heading` from Issue #316, and the merged
 * `site-status-heading` that Issue #884 built out of the former
 * status / reactions / counter trio) plus the footer landmark render
 * with the required structure and the single `<h1>` invariant. Skips
 * assertions on exact prose so Japanese / English copy can land in any
 * ticket without breaking this smoke.
 */
test.describe('home page composition', () => {
	test('renders the public preview sections and the canonical h1', async ({ page }) => {
		await page.goto('/');

		// Single h1 invariant.
		const h1 = page.locator('h1');
		await expect(h1).toHaveCount(1);
		// Issue #287 — the h1 subject is the identity mark; its
		// accessible name (visually-hidden text) is the platform name.
		await expect(h1).toHaveText('my-web-2026');
		await expect(h1).toHaveAccessibleName('my-web-2026');

		// Five named sections, in order, all anchored by aria-labelledby.
		//
		// The count alone is not the assertion: every section is also
		// named by the id that labels it, so a section that is removed,
		// reordered or replaced by a different one fails here even when
		// the count still matches.
		//
		// Issue #316 added exactly one — `current-projects-heading`
		// ("現在地 / Where I am now").
		//
		// Epic #928 / Issue #930 added `site-guide-heading` — the site
		// guide. Epic #1104's second pass merged it with the former
		// capabilities grid into ONE explore section: both answered
		// "what exists here and how do I reach it" with the same
		// destinations, so the page carries five top-level sections
		// instead of six. Issue #1110's v11 visual review moved the
		// destination index ahead of the Now records — "what exists
		// here" is the first content claim after the hero.
		//
		// Issue #884 merged the three "is this site working right now"
		// blocks — platform health, reactions, page views — into ONE
		// section named by `site-status-heading`. Those three ids
		// (`status-heading`, `reactions-heading`,
		// `access-counter-heading`) now label `h3` sub-blocks inside it.
		//
		// Issue #1110's v13 visual review added `sponsored-heading` —
		// the labelled sponsored ad zone between the status section
		// and the closing contact CTA — so the page carries six
		// top-level sections.
		//
		// The selector is scoped to the page subtree (Issue #664): the
		// root layout's chrome — including the GA4 consent panel, which
		// is itself a named `<section>` — is rendered outside it and is
		// not a section of this page.
		const sections = page.locator(PAGE_CONTENT_SECTIONS);
		await expect(sections).toHaveCount(6);
		await expect(sections.nth(0)).toHaveAttribute('aria-labelledby', 'hero-title');
		await expect(sections.nth(1)).toHaveAttribute('aria-labelledby', 'site-guide-heading');
		await expect(sections.nth(2)).toHaveAttribute('aria-labelledby', 'current-projects-heading');
		await expect(sections.nth(3)).toHaveAttribute('aria-labelledby', 'site-status-heading');
		await expect(sections.nth(4)).toHaveAttribute('aria-labelledby', 'sponsored-heading');
		await expect(sections.nth(5)).toHaveAttribute('aria-labelledby', 'contact-cta-heading');

		// Issue #925 second pass — the hero is editorial flow content
		// again with a single /about link; the ad units are a separate
		// axis placed around the sections (leaderboard above the hero,
		// link card / search listing / rectangles between sections).
		// /portfolio stays reachable through the capabilities grid
		// and the footer index.
		await expect(
			page.locator('section[aria-labelledby="hero-title"] a[href="/about"]'),
		).toHaveCount(1);
		await expect(page.locator('footer a[href="/portfolio"]')).toHaveCount(1);
		await expect(page.locator('a[href*="yusuke-kim.com"]')).toHaveCount(0);

		// Landmarks: banner / main / contentinfo.
		await expect(page.locator('main#main')).toBeVisible();
		await expect(page.locator('footer')).toBeVisible();

		// Skip-to-content link is rendered before <main>.
		await expect(page.locator('a[href="#main"]')).toHaveCount(1);
	});

	test('explore grid reflects the current domain contract (linked destinations / planned)', async ({
		page,
	}) => {
		// Domain contract after the Epic #1104 merge — the explore grid
		// unifies the former capabilities cards with the site guide:
		//   - Portfolio / Tools / Activity → linked destinations
		//   - Content → planned: NOT a grid card (it is not a
		//     destination); it renders as the quiet `planned` line
		//     under the grid with no link.
		// The test names each card by its title text so it survives any
		// badge or label revision.
		await page.goto('/');
		const section = page.locator('section[aria-labelledby="site-guide-heading"]');

		// Portfolio — linked destination.
		const portfolioCard = section.locator('li').filter({ hasText: 'Portfolio — 作品' });
		await expect(portfolioCard.locator('a[href="/portfolio"]')).toBeVisible();

		// Tools — linked destination.
		const toolsCard = section.locator('li').filter({ hasText: 'Tools — ブラウザで使える小物' });
		await expect(toolsCard.locator('a[href="/tools"]')).toBeVisible();

		// Content — PLANNED: absent from the destination grid, present
		// as the single planned line, and never a link.
		const plannedLine = section.locator('[data-testid="explore-planned"]');
		await expect(plannedLine.locator('text=planned')).toBeVisible();
		await expect(plannedLine).toContainText('Content');
		await expect(section.locator('li').filter({ hasText: 'Content — コンテンツ' })).toHaveCount(0);
		await expect(plannedLine.locator('a')).toHaveCount(0);

		// Activity — linked destination.
		const activityCard = section.locator('li').filter({
			hasText: 'Activity — 公開アクティビティ',
		});
		await expect(activityCard.locator('a[href="/activity"]')).toBeVisible();
	});

	test('renders the system status section with three services', async ({ page }) => {
		await page.goto('/');
		const section = page.locator('section[aria-labelledby="site-status-heading"]');
		const rows = section.locator('dl > div');
		await expect(rows).toHaveCount(3);
		// The observed-at footer line is rendered.
		await expect(section.getByText('observed at')).toBeVisible();

		// Issue #884 — the blocks the merge folded into this
		// section must stay reachable inside it: each keeps its own `h3`
		// and its own id, so the screen-reader outline still names
		// platform health, GitHub activity, reactions, page views and
		// Discord presence separately (Issues #319 / #320). The
		// remaining `h3`s are the known-incident list the status rows
		// own (Issue #502); the presence card's own heading carries
		// `discord-presence-card-heading` (the composer's duplicate
		// `discord-presence-heading` was removed in Epic #1104).
		await expect(section.locator('h3')).toHaveCount(6);
		for (const id of [
			'status-heading',
			'github-activity-heading',
			'reactions-heading',
			'access-counter-heading',
			'discord-presence-card-heading',
		]) {
			const block = section.locator(`h3#${id}`);
			await expect(block).toHaveCount(1);
			await expect(block).toBeVisible();
		}
		// None of the three may have survived as a top-level section:
		// the page's section contract above pins the count at five.
		await expect(page.locator('section[aria-labelledby="reactions-heading"]')).toHaveCount(0);
		await expect(page.locator('section[aria-labelledby="access-counter-heading"]')).toHaveCount(0);
	});
});
