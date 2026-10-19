import { expect, test } from '@playwright/test';
import { runStatement } from '../scripts/_d1.mjs';
import { BLOCKED_LINK_CLASS } from '../src/portfolio/markdown.lexer';
import {
	MARKDOWN_XSS_FIXTURE_COLUMNS,
	MARKDOWN_XSS_FIXTURE_SLUG,
	blockedLinkFixtures,
	blockedRawHtmlFixtures,
	executableMarkupFindings,
	markdownXssFixtureRowValues,
} from '../test/fixtures/markdown-xss-fixtures';

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
 * The corpus is the shared one (`test/fixtures/markdown-xss-fixtures.ts`),
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
 * Local-only, twice over. The fixture row lives in the local D1
 * file (`.tmp/d1state`), which a remote Worker cannot read, so this
 * file is meaningless — and actively misleading — against a deployed
 * origin. Two mechanisms keep it local:
 *
 *   1. `playwright.config.ts` lists this file in the non-local
 *      `testIgnore`, next to `portfolio.spec.ts`, so a full
 *      `PLAYWRIGHT_BASE_URL=https://rebuildup.dev pnpm exec playwright
 *      test` never collects it.
 *   2. The `test.skip` below repeats the check in-file, because an
 *      explicitly named file (`playwright test <file>`, the form the
 *      production scripts use) is not protected by `testIgnore`, and
 *      because a skip is louder than a silently missing test. It is a
 *      describe-level modifier, which Playwright evaluates in the
 *      `beforeAll` phase *before* the suite's own `beforeAll` hook, so
 *      the non-local run never seeds anything either.
 *
 * The guard must not be replaced by pointing the seed at a remote
 * database: this file is the only E2E spec that writes a
 * `portfolio_project` row, and production data is not its fixture.
 */

const SLUG = MARKDOWN_XSS_FIXTURE_SLUG;

// Same condition as `playwright.config.ts`: the local preview server.
// `PLAYWRIGHT_BASE_URL` defaults to `http://127.0.0.1:<port>`.
const LOCAL_BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.startsWith('http://127.0.0.1') ?? true;

const sqlLiteral = (value: string | number | null) =>
	value === null
		? 'NULL'
		: typeof value === 'number'
			? String(value)
			: `'${String(value).replaceAll("'", "''")}'`;

function d1Local(sql: string): void {
	runStatement(sql, { target: 'local' });
}

function seedFixture(): void {
	const columns = MARKDOWN_XSS_FIXTURE_COLUMNS.join(', ');
	const values = markdownXssFixtureRowValues().map(sqlLiteral).join(', ');
	// `INSERT OR REPLACE`, not DELETE + INSERT: Playwright runs this
	// file's tests in parallel (`fullyParallel`), so every worker runs
	// this `beforeAll`. A delete-then-insert pair races with itself on
	// the `portfolio_project.slug` UNIQUE index; a single atomic upsert
	// is idempotent under concurrency, the same reason
	// `e2e/portfolio.spec.ts` uses `INSERT OR IGNORE`.
	d1Local(`INSERT OR REPLACE INTO portfolio_project (${columns}) VALUES (${values})`);
}

test.describe('portfolio article — XSS boundary (Issue #451)', () => {
	// Serial on purpose. Every test in this file reads the SAME row out
	// of the local D1 file, and `afterAll` deletes it. Under
	// `fullyParallel` each worker gets its own `beforeAll`/`afterAll`,
	// so the first worker to finish deletes the row the others are
	// still asserting on — a 404 that has nothing to do with the
	// security boundary. Serial keeps one worker, so the seed and the
	// cleanup each run exactly once.
	test.describe.configure({ mode: 'serial' });

	test.skip(
		!LOCAL_BASE_URL,
		'local-only spec: the fixture row is seeded into the local D1 file, which a deployed origin cannot read',
	);

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
		const markers = page.locator('[data-blocked-reason]');
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

		// The refused target stays readable for the author, and the DOM
		// reads it back as an inert attribute value — never as a link.
		const recorded = await markers.evaluateAll((nodes) =>
			nodes.map((node) => node.getAttribute('data-blocked-href') ?? ''),
		);
		for (const fixture of blockedLinkFixtures()) {
			const raw = fixture.input.slice(fixture.input.indexOf('](') + 2);
			// The lexer stops at the FIRST `)` (see `findLinkCloseParen`),
			// so what the DOM records is a prefix of the raw href — with
			// `vbscript:msgbox(1` as a concrete example. Asserting the
			// prefix relation keeps this test honest about the rule
			// instead of re-implementing it.
			expect(
				recorded.some((value) => value.length > 0 && raw.startsWith(value)),
				`no marker recorded a prefix of ${raw}`,
			).toBe(true);
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
