import { expect, test } from '@playwright/test';
import { runStatement } from '../scripts/_d1.mjs';
import {
	HTTP_STATUS_EXPECTATIONS,
	evaluateObservation,
	robotsStateFromHtml,
	surfaceFromHtml,
} from '../scripts/_seo-status-contract.mjs';

/**
 * The SEO HTTP status contract, proved in a real browser (Issue #419).
 *
 * `test/integration/seo-status-contract.test.ts` proves every row over
 * the real SSR pipeline inside workerd. This file proves the half a
 * headless HTTP assertion cannot see: what the browser actually
 * RENDERS for those responses — the failure surface a visitor reads,
 * the `robots` meta as the DOM exposes it, and the redirect a crawler
 * follows.
 *
 * Both suites read the same written contract
 * (`scripts/_seo-status-contract.mjs`) and feed their observation back
 * into the same evaluator, so the browser proof cannot quietly assert
 * less than the HTTP proof, and `scripts/check-seo-status-contract.mjs`
 * fails if a row stops citing this file.
 *
 * Scope: LOCAL origin only. The rows proved here need a seeded D1
 * (`portfolio_project`), which exists in `.tmp/d1state` and not on a
 * deployed Worker, so two mechanisms keep this spec local:
 * `playwright.config.ts` ignores it for any non-local
 * `PLAYWRIGHT_BASE_URL`, and the describe-level `test.skip` below
 * repeats the check in-file, because an explicitly named file
 * (`playwright test <file>`, the form the production scripts use) is
 * not protected by `testIgnore`. Nothing here touches production.
 *
 * What a screenshot cannot prove
 * ------------------------------
 * The committed capture for this Issue
 * (`docs/verification/seo/404-and-500-state.webp`) is the SAME two
 * responses rendered by the SAME routes. The assertions below are the
 * reproduction command the Issue asks for:
 *
 *   pnpm run build && pnpm exec playwright test e2e/seo-status.spec.ts
 */

const ORIGIN_ROWS = [
	{
		id: 'portfolio-published',
		slug: 'seo-status-browser-published',
		insert: { visibility: 'public', status: 'published' },
	},
	{
		id: 'portfolio-draft-not-found',
		slug: 'seo-status-browser-draft',
		insert: { visibility: 'draft', status: 'published' },
	},
	{
		id: 'portfolio-unlisted-not-found',
		slug: 'seo-status-browser-unlisted',
		insert: { visibility: 'unlisted', status: 'published' },
	},
];

const PUBLISHED_SLUG = 'seo-status-browser-published';
const DRAFT_SLUG = 'seo-status-browser-draft';
const UNLISTED_SLUG = 'seo-status-browser-unlisted';

// Same condition as `playwright.config.ts`: the local preview server.
// `PLAYWRIGHT_BASE_URL` defaults to `http://127.0.0.1:<port>`.
const LOCAL_BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.startsWith('http://127.0.0.1') ?? true;

/** Repeated `facets` — rejected by the route's own search schema. */
const INVALID_QUERY_PATH = '/portfolio?facets=a&facets=b';

/** A path the file router does not know. */
const UNMATCHED_PATH = '/this-route-does-not-exist-419';

function contract(id: string) {
	const found = HTTP_STATUS_EXPECTATIONS.find((entry) => entry.id === id);
	if (!found) throw new Error(`no SEO status contract case named "${id}"`);
	return found;
}

/** Insert one probe row into the local D1 (idempotent). */
function seedVisibilityRow(slug: string, visibility: string, status: string): void {
	const now = Date.now();
	const cols =
		'id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at';
	const values = `'seo_status_${slug}', '${slug}', 'SEO status probe', 'Seeded by e2e/seo-status.spec.ts', 'Solo developer', ${now}, NULL, '2026', '', '["develop"]', '["TypeScript"]', '${visibility}', '${status}', 0, 900, ${now}, ${now}`;
	runStatement(`INSERT OR IGNORE INTO portfolio_project (${cols}) VALUES (${values})`, {
		target: 'local',
	});
}

/** Assert a navigated page against its contract row, from the served HTML. */
function expectServed(id: string, status: number, html: string) {
	const violations = evaluateObservation(contract(id), { status, html });
	expect(violations, `case "${id}"`).toEqual([]);
}

test.describe('seo status contract — browser rendering (#419)', () => {
	// Serial on purpose. The probe rows are seeded into the SAME local
	// D1 file, and `afterAll` deletes them. Under `fullyParallel` each
	// worker runs its own `beforeAll` / `afterAll`, so the first worker
	// to finish deletes the rows the others are still asserting on — a
	// 404 on `portfolio-published` that has nothing to do with the
	// contract. Serial keeps the seed and the cleanup exactly once.
	test.describe.configure({ mode: 'serial' });

	test.skip(
		!LOCAL_BASE_URL,
		'local-only spec: the fixture rows are seeded into the local D1 file, which a deployed origin cannot read',
	);

	test.beforeAll(() => {
		for (const row of ORIGIN_ROWS) {
			seedVisibilityRow(row.slug, row.insert.visibility, row.insert.status);
		}
	});

	test.afterAll(() => {
		const slugs = ORIGIN_ROWS.map((row) => `'${row.slug}'`).join(', ');
		runStatement(`DELETE FROM portfolio_project WHERE slug IN (${slugs})`, { target: 'local' });
	});

	test('public-home renders as a normal page', async ({ page }) => {
		const response = await page.goto('/');
		expect(response?.status()).toBe(200);
		expectServed('public-home', 200, await page.content());
	});

	test('portfolio-published renders the project, and nothing else does', async ({ page }) => {
		const response = await page.goto(`/portfolio/${PUBLISHED_SLUG}`);
		expect(response?.status()).toBe(200);
		const html = await page.content();
		expectServed('portfolio-published', 200, html);
		await expect(page.locator('h1')).toBeVisible();
	});

	test('portfolio-draft-not-found renders the 404 state, never the project', async ({ page }) => {
		const response = await page.goto(`/portfolio/${DRAFT_SLUG}`);
		expect(response?.status()).toBe(404);
		const html = await page.content();
		expectServed('portfolio-draft-not-found', 404, html);
		// The visitor-facing half: a readable bilingual 404, not a blank
		// shell, and no trace of the seeded row.
		await expect(page.locator('[data-error-state="not_found"]')).toBeVisible();
		await expect(page.locator('h1')).toContainText('ページが見つかりません');
		expect(html).not.toContain('SEO status probe');
	});

	test('portfolio-unlisted-not-found is refused the same way as a draft', async ({ page }) => {
		const response = await page.goto(`/portfolio/${UNLISTED_SLUG}`);
		expect(response?.status()).toBe(404);
		const html = await page.content();
		expectServed('portfolio-unlisted-not-found', 404, html);
		await expect(page.locator('[data-error-state="not_found"]')).toBeVisible();
	});

	test('public-about renders as a normal page', async ({ page }) => {
		const response = await page.goto('/about');
		expect(response?.status()).toBe(200);
		expectServed('public-about', 200, await page.content());
	});

	test('public-contact renders as a normal page', async ({ page }) => {
		const response = await page.goto('/contact');
		expect(response?.status()).toBe(200);
		expectServed('public-contact', 200, await page.content());
	});

	test('public-projects-dotfiles renders the committed introduction', async ({ page }) => {
		const response = await page.goto('/projects/dotfiles');
		expect(response?.status()).toBe(200);
		const html = await page.content();
		expectServed('public-projects-dotfiles', 200, html);
		await expect(page.locator('h1')).toContainText('dotfiles');
		await expect(page.getByRole('heading', { name: '設計原則' })).toBeVisible();
	});

	test('public-portfolio-index renders as a normal page', async ({ page }) => {
		const response = await page.goto('/portfolio');
		expect(response?.status()).toBe(200);
		const html = await page.content();
		expectServed('public-portfolio-index', 200, html);
		await expect(page.locator('h1#portfolio-heading')).toBeVisible();
	});

	test('public-tools-index renders as a normal page', async ({ page }) => {
		const response = await page.goto('/tools');
		expect(response?.status()).toBe(200);
		expectServed('public-tools-index', 200, await page.content());
	});

	test('unmatched-route-not-found renders the shared 404 state', async ({ page }) => {
		const response = await page.goto(UNMATCHED_PATH);
		expect(response?.status()).toBe(404);
		expectServed('unmatched-route-not-found', 404, await page.content());
		await expect(page.locator('[data-error-state="not_found"]')).toBeVisible();
	});

	test('portfolio-invalid-query-input-failure renders the 404 state on a 500 response', async ({
		page,
	}) => {
		// The browser half of the recorded gap: the SERVED STATUS is the
		// framework's 500 while the document is the not_found surface with
		// no retry control. Both halves are asserted, and the row's
		// `openDecision` in `scripts/_seo-status-contract.mjs` is why the
		// 500 is written down instead of rounded up to the 503 label.
		const response = await page.goto(INVALID_QUERY_PATH);
		expect(response?.status()).toBe(500);
		const html = await page.content();
		expectServed('portfolio-invalid-query-input-failure', 500, html);
		await expect(page.locator('[data-error-state="not_found"]')).toBeVisible();
		await expect(page.locator('[data-error-action="retry"]')).toHaveCount(0);
	});

	test('tool-detail-noindex exposes the noindex meta in the DOM', async ({ page }) => {
		const response = await page.goto('/tools/prototype');
		expect(response?.status()).toBe(200);
		const html = await page.content();
		expectServed('tool-detail-noindex', 200, html);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});

	test('admin-login-anonymous renders a 200 document that stays noindex', async ({ page }) => {
		const response = await page.goto('/admin/login');
		expect(response?.status()).toBe(200);
		const html = await page.content();
		expectServed('admin-login-anonymous', 200, html);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});

	test('admin-anonymous-redirect refuses the document and names the login page', async ({
		request,
	}) => {
		// `maxRedirects: 0` so the observation is the GATE's answer, not the
		// login page a browser would end up on.
		const response = await request.get('/admin', { maxRedirects: 0 });
		const html = await response.text();
		const violations = evaluateObservation(contract('admin-anonymous-redirect'), {
			status: response.status(),
			location: response.headers().location ?? null,
			html,
		});
		expect(violations).toEqual([]);
	});

	test('a public page must not grow a robots meta', async ({ page }) => {
		// The silent failure direction: nothing errors when a public page
		// starts answering noindex, traffic just stops arriving.
		await page.goto('/portfolio');
		expect(robotsStateFromHtml(await page.content())).toBe('absent');
		expect(surfaceFromHtml(await page.content())).toBe('page');
	});
});
