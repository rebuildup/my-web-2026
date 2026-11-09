import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { NAV_ROSTER } from './nav-roster';

/**
 * The shipped Tool manifest, read from disk (Issue #861).
 *
 * The 「準備中」 placeholder only exists while some Tool is still
 * waiting. The manifest is repo-controlled data, so the spec derives
 * the state from it instead of freezing one slug: when the last
 * waiting Tool lands, this surface is gone and the spec says so with
 * a reason instead of failing.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readToolManifest(): Map<string, { kind: string; displayName: string }> {
	const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/tools/manifest.json'), 'utf8')) as {
		tools: Array<{ slug: string; display_name: string; delivery: { kind: string } }>;
	};
	return new Map(
		raw.tools.map((tool) => [
			tool.slug,
			{ kind: tool.delivery.kind, displayName: tool.display_name },
		]),
	);
}

const TOOL_MANIFEST = readToolManifest();

/** The first waiting Tool of the shipped manifest, if any. */
const FIRST_DISABLED_SLUG = [...TOOL_MANIFEST.entries()].find(
	([, tool]) => tool.kind === 'host_disabled',
)?.[0];

/** The manifest's own display name for a slug (the breadcrumb leaf). */
async function readToolDisplayName(slug: string): Promise<string> {
	return TOOL_MANIFEST.get(slug)?.displayName ?? slug;
}

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
 *   - Issue #288 removed the nav (and breadcrumbs) from every Tools
 *     surface (`/tools`, `/tools/<slug>`, and the 404 / disabled
 *     states). Issue #785 restores them — first on the `/tools` index
 *     (owner instruction 2026-11-01: the index had no header and no
 *     breadcrumb trail), then on the DETAIL route and every one of its
 *     states when the owner abolished #288 outright (「`/tools` は
 *     index・詳細とも PublicNav とパンくずを戻す。 #288 を全面廃止する。」).
 *   - Issue #911 (owner instruction 2026-11-05) then narrowed the
 *     detail half of that restoration: 「各ツールはヘッダーなどを
 *     いれず、各ツール全画面でそれぞれ使われるようにする」. The one
 *     state that SHOWS a Tool — the iframe shell — renders no chrome
 *     and gives the frame the whole `100dvh`; the
 *     404 / `host_disabled` / `blocked` states keep the chrome because
 *     a visitor who is not using a Tool still has to be able to leave.
 *     The `/tools` index is a list page, not 「各ツール」, so #785
 *     stands for it.
 *
 * Scopes:
 *   1. `/` does NOT mount the nav (the #199 contract).
 *   2. The nav renders on every remaining opt-in page (`/about`,
 *      `/contact`, `/portfolio`, `/tools`, `/design-system`).
 *   3. The six canonical nav items are present, in order.
 *   4. The active route is announced via `aria-current="page"` on
 *      exactly one link.
 *   5. Home → Tools one click is still possible, via the
 *      capabilities card rather than the nav.
 *   6. The nav does NOT appear on `/admin/*` (admin owns its own
 *      chrome), nor on the `/tools/<slug>` states that show a Tool
 *      (Issue #911). It DOES appear on the Tools 404 and on the
 *      「準備中」 placeholder, which are the states a visitor needs
 *      the site chrome to get out of.
 *   7. The mobile affordance collapses the nav below the `md`
 *      breakpoint.
 */

/**
 * Pages that opt into `PublicNav`. `/portfolio/<slug>` fixtures
 * depend on published D1 rows, so they are not part of this loop.
 * `/tools` opts in since Issue #785; the per-Tool shell deliberately
 * does NOT (Issue #911) and is covered by the Tools describe below.
 */
const NAV_OPT_IN_PAGES: ReadonlyArray<{ path: string; h1: RegExp }> = [
	{ path: '/about', h1: /木村友亮/ },
	{ path: '/contact', h1: /Contact/ },
	{ path: '/tools', h1: /ツール/ },
	{ path: '/portfolio', h1: /主要な制作物/ },
	{ path: '/design-system', h1: /Design System/ },
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

			// The six links are present, in order. The desktop strip is a
			// real list: every entry is an `<li>` holding one `<a>`
			// (Issue #718 — WCAG 2.2 SC 1.3.1), so the selector targets
			// the `<a>` inside each list item.
			const desktopLinks = nav.locator('[data-testid="public-nav-desktop"] > li > a');
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
		// The arrival page's <h1> is the Japanese surface title (Issue
		// #785 rebuilt the index); the English word lives in the eyebrow,
		// not in the heading.
		await expect(page.locator('h1')).toHaveText(/ツール/);
	});
});

test.describe('public nav — Tools surfaces (Issue #911: only the non-Tool states keep chrome)', () => {
	// Issue #288 took the chrome off every Tools surface so the iframe
	// could own the viewport; the owner rejected that (2026-11-01,
	// Issue #785) and put it back everywhere. Issue #911 (2026-11-05)
	// splits the difference the owner drew this time: the states that
	// SHOW a Tool have no chrome and give the frame the viewport, and
	// the states that show no Tool (index, 404, 準備中, blocked) keep it.
	test('is mounted on /tools (Issue #785 keeps the index chrome)', async ({ page }) => {
		const res = await page.goto('/tools');
		expect(res?.status()).toBe(200);
		await expect(page.locator('nav[aria-label="Public"]')).toBeVisible();
		await expect(page.locator('nav[aria-label="パンくず"]')).toBeVisible();
		// The page keeps its own content-level <h1> under the chrome.
		await expect(page.locator('h1').first()).toContainText(/ツール/);
	});

	test('is NOT mounted on /tools/<slug> — the Tool owns the viewport (Issue #911)', async ({
		page,
	}) => {
		const res = await page.goto('/tools/prototype');
		expect(res?.status()).toBe(200);
		// PR #914 removed the consent gate: the iframe mounts directly,
		// and Issue #911 keeps the chrome off that state — the frame is
		// the first thing a visitor sees and it is the Tool's own surface.
		await expect(page.locator('nav[aria-label="Public"]')).toHaveCount(0);
		await expect(page.locator('nav[aria-label="パンくず"]')).toHaveCount(0);
		const frame = page.locator('iframe[title="ProtoType Tool"]');
		await expect(frame).toBeVisible();
		// No chrome half exists to come back: the frame IS the viewport,
		// at the document origin and as tall as the viewport, i.e.
		// `100dvh` with nothing subtracted. Before #911 the frame was
		// `viewport - chrome`, which is exactly the subtraction this
		// assertion would now catch coming back.
		const viewport = page.viewportSize();
		expect(
			viewport,
			'the project must declare a viewport for this geometry to mean anything',
		).not.toBeNull();
		const box = await frame.boundingBox();
		expect(box, 'the frame has no box — it is not laid out at all').not.toBeNull();
		expect(box?.x ?? Number.NaN).toBeLessThan(1);
		expect(box?.y ?? Number.NaN).toBeLessThan(1);
		expect(box?.width ?? 0).toBeGreaterThanOrEqual((viewport?.width ?? 0) - 1);
		expect(box?.height ?? 0).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1);
	});

	test('keeps the chrome on the Tools 404 surface', async ({ page }) => {
		const res = await page.goto('/tools/definitely-not-a-registered-tool');
		expect(res?.status()).toBe(404);
		await expect(page.locator('[data-testid="tools-not-found"]')).toBeVisible();
		// Issue #911 removes the chrome only where a Tool is shown; a
		// visitor who mistyped a slug still gets the nav, and the
		// back-link inside the copy still points at `/tools`.
		await expect(page.locator('nav[aria-label="Public"]')).toHaveCount(1);
		await expect(page.locator('[data-testid="tools-not-found"] a[href="/tools"]')).toBeVisible();
		// NO breadcrumb on this state, and that is the resolver working as
		// designed: `route-labels.ts` drops the `$slug` leaf when the loader
		// threw (`dropOnMissingLoaderData`), and a flat route tree has no
		// other labeled match to fall back on — so `resolveBreadcrumbChain`
		// returns null and the primitive renders nothing. Rendering a stub
		// "Tool" segment for a slug that does not exist is the defect
		// Issue #183 removed; the nav above is what gets the visitor out.
		await expect(page.locator('nav[aria-label="パンくず"]')).toHaveCount(0);
	});

	test('keeps the chrome on the 「準備中」 placeholder', async ({ page }) => {
		if (!FIRST_DISABLED_SLUG) {
			// Issue #861: the shipped manifest holds no waiting Tool, so
			// the placeholder surface does not exist. The contract is
			// covered against a synthetic manifest in
			// `src/tools/registry.test.ts`.
			test.skip(
				true,
				'shipped manifest has no host_disabled Tool — the 「準備中」 surface does not exist; the contract is covered by the synthetic-manifest unit tests (Issue #861)',
			);
		}
		const res = await page.goto(`/tools/${FIRST_DISABLED_SLUG}`);
		expect(res?.status()).toBe(200);
		await expect(page.locator('[data-tool-state="host_disabled"]')).toBeVisible();
		await expect(page.locator('nav[aria-label="Public"]')).toHaveCount(1);
		await expect(page.locator('nav[aria-label="パンくず"]')).toHaveCount(1);
		// The leaf label is the Tool's own name, not the static "Tool"
		// fallback — `route-labels.ts` reads it off the loader's
		// `{ state, tool }` wrapper.
		await expect(page.locator('nav[aria-label="パンくず"] [aria-current="page"]')).toHaveText(
			await readToolDisplayName(FIRST_DISABLED_SLUG),
		);
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
