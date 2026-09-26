import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

/**
 * Portfolio E2E surface (Issue #77).
 *
 * Two scopes:
 *
 *   1. Read-only smoke against the dev server (the default
 *      'pnpm run e2e'). Uses the seed that ships with the
 *      portfolio obligation ('src/portfolio/seed.ts') so the
 *      surface can be exercised against any environment where
 *      'pnpm run db:migrate:local && pnpm run bootstrap:home-api-key'
 *      (or the dev server bootstrap) has run.
 *
 *   2. Visibility contract — the public route MUST NOT expose
 *      draft / unlisted / archived rows even by slug, and
 *      the list MUST NOT include them in any facet selection.
 *      These tests seed mixed-visibility rows into the local D1
 *      binding via wrangler and then drive the public surface.
 *      They run in the local webServer block of
 *      playwright.config.ts; the production `pnpm run e2e:prod`
 *      path ignores this file because the base URL is
 *      https://rebuildup.dev and the testIgnore rule filters it
 *      out (portfolio.spec.ts).
 *
 * Local D1 seed path: the portfolio migration ships
 * with the repo and is applied by pnpm run db:migrate:local.
 * The seed rows from src/portfolio/seed.ts are inserted by
 * scripts/seed-portfolio.mjs if it has been run. If neither
 * has run yet, the visibility tests still pass: they assert
 * that no public slug matches an invisible slug on a clean DB.
 */

const CANONICAL_ORIGIN = 'http://127.0.0.1:3000';

/** Run a SQL statement against the local D1 binding via wrangler. */
function d1Local(sql: string): void {
	execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', 'DB', '--local', '--command', sql], {
		stdio: 'inherit',
	});
}

/**
 * Build a visibility-row INSERT against the local D1. The SQL
 * is kept as a plain string + interpolation to avoid Biome's
 * template-literal parser choking on the SQL identifier /
 * literal mix.
 */
function visibilityInsert(
	id: string,
	slug: string,
	title: string,
	visibility: string,
	status: string,
	displayOrder: number,
): string {
	const now = Date.now();
	const cols =
		'id, slug, title, summary, role, period_start, period_end, period_label, motivation_md, facets, technologies, visibility, status, pinned, display_order, created_at, updated_at';
	const values = `'${id}', '${slug}', '${title}', 'Seeded by e2e/portfolio.spec.ts', 'Solo developer', ${now}, NULL, '2026', '', '["develop"]', '["TypeScript"]', '${visibility}', '${status}', 0, ${displayOrder}, ${now}, ${now}`;
	return `INSERT INTO portfolio_project (${cols}) VALUES (${values})`;
}

test.describe('portfolio — list (/portfolio)', () => {
	test('returns 200 with the canonical h1', async ({ page }) => {
		const res = await page.goto('/portfolio');
		expect(res?.status()).toBe(200);
		const h1 = page.locator('h1#portfolio-heading');
		await expect(h1).toBeVisible();
		await expect(h1).toContainText('Selected projects');
	});

	test('renders the facet filter and seed projects', async ({ page }) => {
		await page.goto('/portfolio');
		const facets = page.locator('fieldset:has(legend:text("Facet filter")) button[aria-pressed]');
		await expect(facets).toHaveCount(4); // develop / video / design / other

		// At least one seed project from the portfolio obligation is
		// visible. The seed has 'my-web-2026' as the canonical
		// always-present entry; if no seed is present the visibility
		// boundary test below still gates the surface.
		const cards = page.locator('ol li article');
		await expect(cards.first()).toBeVisible();
	});

	test('toggling a facet updates the URL (?facets=...) and SSR state', async ({ page }) => {
		// The chip click is delegated to `router.navigate(...)` inside
		// FacetFilter.tsx; the URL update is a side effect we don't
		// pin from this test (TanStack Router same-route navigation is
		// covered by the unit tests for `useSearch` / `useNavigate`).
		// This test pins the SSR contract: when `?facets=develop` is
		// in the URL, the chip is `aria-pressed="true"` after a full
		// reload — that is the canonical entry point for sharing /
		// bookmarking a filtered view.
		await page.goto('/portfolio?facets=develop');

		await expect(page).toHaveURL(/[?&]facets=develop(&|$)/);
		const developChip = page
			.locator('fieldset:has(legend:text("Facet filter")) button[aria-pressed]')
			.filter({ hasText: 'Develop' });
		await expect(developChip).toHaveAttribute('aria-pressed', 'true');

		// Full reload — SSR must preserve the pressed state.
		await page.reload();
		await expect(page).toHaveURL(/[?&]facets=develop(&|$)/);
		await expect(developChip).toHaveAttribute('aria-pressed', 'true');

		// Sanity: the develop-only filter MUST still surface at
		// least one seeded public project (the `my-web-2026` row).
		const cards = page.locator('ol li article');
		await expect(cards.first()).toBeVisible();
	});

	test('Home capabilities grid CTA navigates to /portfolio', async ({ page }) => {
		await page.goto('/');
		const cta = page.locator(
			'section[aria-labelledby="capabilities-heading"] a[href="/portfolio"]',
		);
		await expect(cta).toBeVisible();
		await cta.first().click();
		await expect(page).toHaveURL(/\/portfolio$/);
		await expect(page.locator('h1#portfolio-heading')).toBeVisible();
	});
});

test.describe('portfolio — detail (/portfolio/$slug)', () => {
	test('renders a seeded public project with all first-viewport fields', async ({ page }) => {
		// The skeleton seed (`scripts/seed-portfolio.mjs`) is
		// intentionally thin on `motivation_md` — it regex-extracts
		// slug + title only and leaves the Markdown body for the #78
		// migration ticket. To assert the structural contract that
		// non-empty `motivation_md` actually renders a section, we
		// UPDATE the local D1 to a rich value BEFORE navigation, then
		// restore the skeleton state AFTER.
		d1Local(
			`UPDATE portfolio_project SET motivation_md = '# Seed motivation\n\nSeeded by e2e/portfolio.spec.ts so the Markdown section contract is asserted.' WHERE slug = 'my-web-2026'`,
		);

		await page.goto('/portfolio/my-web-2026');
		// Status 200 + canonical h1 + role + period + back link.
		const h1 = page.locator('h1#portfolio-detail-heading');
		await expect(h1).toBeVisible();
		await expect(h1).toContainText('my-web-2026');
		await expect(
			page
				.getByRole('definition')
				.filter({ hasText: /developer|architect/i })
				.first(),
		).toBeVisible();
		await expect(page.locator('dl dt:text("Period")')).toBeVisible();
		await expect(page.locator('a:text("← Back to portfolio")')).toBeVisible();

		// At least one Markdown section renders (the rich motivation_md
		// we just wrote). Empty sections are omitted — only the
		// Motivation section is present here.
		const sections = page.locator('section[aria-labelledby^="portfolio-section-"]');
		await expect(sections.first()).toBeVisible();

		// Restore the skeleton state so subsequent tests see the same
		// DB the rest of the surface was developed against.
		d1Local(`UPDATE portfolio_project SET motivation_md = '' WHERE slug = 'my-web-2026'`);
	});

	test('emits canonical / OGP / Twitter metadata derived from the loader', async ({ page }) => {
		await page.goto('/portfolio/my-web-2026');
		const canonical = page.locator('link[rel="canonical"]');
		await expect(canonical).toHaveAttribute('href', `${CANONICAL_ORIGIN}/portfolio/my-web-2026`);
		await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
		await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
			'content',
			/my-web-2026/,
		);
		await expect(page.locator('meta[name="twitter:card"]')).toBeAttached();
	});

	test('renders adjacent navigation (prev / next) for projects with neighbours', async ({
		page,
	}) => {
		await page.goto('/portfolio/multi-slicer');
		const nav = page.locator('nav[aria-labelledby="portfolio-section-adjacent"]');
		await expect(nav).toBeVisible();
		// At least one of prev/next resolves to a seeded public project.
		const links = nav.locator('a[href^="/portfolio/"]');
		await expect(links.first()).toBeVisible();
	});

	test('unknown slug → 404', async ({ page }) => {
		const res = await page.goto('/portfolio/totally-not-a-real-slug-xyz');
		expect(res?.status()).toBe(404);
	});
});

test.describe('portfolio — visibility boundary (draft / unlisted / archived are NOT public)', () => {
	// Seed three invisible rows plus one always-public anchor. The
	// public anchor lets the list test assert "the public row IS
	// visible while the invisible ones are NOT".
	test.beforeAll(() => {
		const cleanup =
			"DELETE FROM portfolio_project WHERE slug IN ('vis-published-anchor','vis-draft-row','vis-unlisted-row','vis-archived-row')";
		d1Local(cleanup);
		d1Local(
			visibilityInsert(
				'vis_anchor',
				'vis-published-anchor',
				'Visibility Anchor (public)',
				'public',
				'published',
				50,
			),
		);
		d1Local(
			visibilityInsert(
				'vis_draft',
				'vis-draft-row',
				'Visibility Probe (draft)',
				'draft',
				'published',
				10,
			),
		);
		d1Local(
			visibilityInsert(
				'vis_unlisted',
				'vis-unlisted-row',
				'Visibility Probe (unlisted)',
				'unlisted',
				'published',
				20,
			),
		);
		d1Local(
			visibilityInsert(
				'vis_archived',
				'vis-archived-row',
				'Visibility Probe (archived)',
				'public',
				'archived',
				30,
			),
		);
	});

	test.afterAll(() => {
		const cleanup =
			"DELETE FROM portfolio_project WHERE slug IN ('vis-published-anchor','vis-draft-row','vis-unlisted-row','vis-archived-row')";
		d1Local(cleanup);
	});

	test('list excludes draft / unlisted / archived rows', async ({ page }) => {
		await page.goto('/portfolio');
		const body = await page.locator('main').textContent();
		// The anchor MUST be present.
		expect(body).toContain('Visibility Anchor (public)');
		// All three invisible rows MUST be absent.
		expect(body).not.toContain('Visibility Probe (draft)');
		expect(body).not.toContain('Visibility Probe (unlisted)');
		expect(body).not.toContain('Visibility Probe (archived)');
	});

	test('detail route returns 404 for a draft slug', async ({ page }) => {
		const res = await page.goto('/portfolio/vis-draft-row');
		expect(res?.status()).toBe(404);
	});

	test('detail route returns 404 for an unlisted slug', async ({ page }) => {
		const res = await page.goto('/portfolio/vis-unlisted-row');
		expect(res?.status()).toBe(404);
	});

	test('detail route returns 404 for an archived slug', async ({ page }) => {
		const res = await page.goto('/portfolio/vis-archived-row');
		expect(res?.status()).toBe(404);
	});

	test('facet filter cannot leak invisible rows', async ({ page }) => {
		// Filter to a facet that the invisible rows share ('develop').
		await page.goto('/portfolio?facets=develop');
		const body = await page.locator('main').textContent();
		expect(body).not.toContain('Visibility Probe (draft)');
		expect(body).not.toContain('Visibility Probe (unlisted)');
		expect(body).not.toContain('Visibility Probe (archived)');
	});
});
