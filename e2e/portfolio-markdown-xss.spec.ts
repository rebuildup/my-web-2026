import { expect, test } from '@playwright/test';
import { runStatement } from '../scripts/_d1.mjs';
import { BLOCKED_LINK_CLASS } from '../src/portfolio/markdown.lexer';
import {
	blockedLinkFixtures,
	blockedRawHtmlFixtures,
	composeMarkdownFixtureBody,
	executableMarkupFindings,
} from '../src/portfolio/markdown.xss-fixtures';

/**
 * Browser-level XSS boundary for the article renderer (Issue #451).
 *
 * Scope
 * -----
 *   1. `src/portfolio/markdown.security.test.tsx` — renderer level.
 *   2. `test/integration/markdown-xss-ssr.test.ts` — Worker HTTP level.
 *   3. This file — the only layer that can answer "did a payload
 *      actually EXECUTE?", because it is a real browser.
 *
 * The corpus is the shared one (`src/portfolio/markdown.xss-fixtures.ts`),
 * so the three layers cannot drift. It is seeded into the LOCAL D1
 * binding through `scripts/_d1.mjs#runStatement`, which is the same
 * write path (and the same production-write gate) the rest of the E2E
 * suite uses.
 *
 * Every payload in the corpus assigns to `window.__xssFired`. If any
 * of them executes, that global becomes defined and the first assertion
 * fails — this is what turns "the HTML looked escaped" into "nothing
 * ran".
 *
 * Local-only: the fixture row lives in the local D1 file, which a
 * remote Worker cannot read, so `playwright.config.ts` filters this
 * file out of the production path the same way it filters
 * `portfolio.spec.ts`.
 */

const SLUG = 'markdown-xss-fixture';

const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

function d1Local(sql: string): void {
	runStatement(sql, { target: 'local' });
}

function seedFixture(): void {
	const now = Date.UTC(2026, 0, 1);
	const cols = [
		'id',
		'slug',
		'title',
		'summary',
		'role',
		'period_start',
		'period_label',
		'motivation_md',
		'facets',
		'technologies',
		'visibility',
		'status',
		'pinned',
		'display_order',
		'created_at',
		'updated_at',
	].join(', ');
	const values = [
		sqlLiteral('xss_fixture'),
		sqlLiteral(SLUG),
		sqlLiteral('Markdown XSS fixture'),
		sqlLiteral('Local reproduction of the Issue #451 corpus. Not published content.'),
		sqlLiteral('Fixture'),
		String(now),
		sqlLiteral('verification'),
		sqlLiteral(composeMarkdownFixtureBody()),
		sqlLiteral('["develop"]'),
		sqlLiteral('["TypeScript"]'),
		"'public'",
		"'published'",
		'0',
		'900',
		String(now),
		String(now),
	].join(', ');
	// `INSERT OR REPLACE`, not DELETE + INSERT: Playwright runs this
	// file's tests in parallel (`fullyParallel`), so every worker runs
	// this `beforeAll`. A delete-then-insert pair races with itself on
	// the `portfolio_project.slug` UNIQUE index; a single atomic upsert
	// is idempotent under concurrency, the same reason
	// `e2e/portfolio.spec.ts` uses `INSERT OR IGNORE`.
	d1Local(`INSERT OR REPLACE INTO portfolio_project (${cols}) VALUES (${values})`);
}

test.describe('portfolio article — XSS boundary (Issue #451)', () => {
	test.beforeAll(() => {
		seedFixture();
	});

	test.afterAll(() => {
		d1Local(`DELETE FROM portfolio_project WHERE slug = ${sqlLiteral(SLUG)}`);
	});

	test('no fixture payload executes in a real browser', async ({ page }) => {
		const res = await page.goto(`/portfolio/${SLUG}`);
		expect(res?.status()).toBe(200);

		// Let any deferred handler (an <img> error, an inline script at
		// parse time, a queued timer) run before reading the marker.
		await page.waitForLoadState('networkidle');
		const fired = await page.evaluate(() => (window as { __xssFired?: unknown }).__xssFired);
		expect(fired).toBeUndefined();
	});

	test('the article region carries no executable markup', async ({ page }) => {
		await page.goto(`/portfolio/${SLUG}`);
		const article = await page.locator('article#portfolio-detail').innerHTML();
		expect(executableMarkupFindings(article), article.slice(0, 1200)).toEqual([]);
	});

	test('every refused link is visible and inert', async ({ page }) => {
		await page.goto(`/portfolio/${SLUG}`);
		const markers = page.locator(`[data-blocked-reason]`);
		await expect(markers).toHaveCount(blockedLinkFixtures().length);

		// The refusal is a <span>, so there is nothing to click.
		await expect(page.locator(`a:has(.${BLOCKED_LINK_CLASS})`)).toHaveCount(0);
		await expect(page.locator('article#portfolio-detail a[href^="javascript:"]')).toHaveCount(0);

		// Every reason the corpus expects is named on the page.
		const reasons = await markers.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-blocked-reason')),
		);
		for (const reason of ['scheme-not-allowed', 'encoded-scheme', 'control-character']) {
			expect(reasons).toContain(reason);
		}
	});

	test('raw-HTML payloads are visible as escaped text, not as markup', async ({ page }) => {
		await page.goto(`/portfolio/${SLUG}`);
		const article = page.locator('article#portfolio-detail');
		await expect(article).toContainText('<script>');
		await expect(article).toContainText('<svg onload=');
		await expect(article.locator('svg')).toHaveCount(0);
		await expect(article.locator('script')).toHaveCount(0);
		await expect(article.locator('img')).toHaveCount(0);
		// The count is pinned so a corpus edit that drops a payload
		// family fails here instead of quietly shrinking the evidence.
		expect(blockedRawHtmlFixtures().length).toBeGreaterThanOrEqual(4);
	});

	test('accepted content still renders as real elements', async ({ page }) => {
		await page.goto(`/portfolio/${SLUG}`);
		// Scoped to the Motivation section: the article header also owns
		// an `href="/portfolio"` back-link, which is not part of the
		// corpus.
		const motivation = page.locator('section[aria-labelledby="portfolio-section-motivation"]');
		await expect(motivation.locator('a[href="/portfolio"]')).toHaveCount(1);
		await expect(motivation.locator('a[href="https://example.com/docs"]')).toHaveCount(1);
		await expect(motivation.locator('a[href="https://example.com/docs"]')).toHaveAttribute(
			'rel',
			'noopener noreferrer',
		);
		await expect(motivation.locator('strong').first()).toBeVisible();
	});
});
