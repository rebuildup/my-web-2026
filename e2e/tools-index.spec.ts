import { expect, test } from '@playwright/test';

/**
 * Tool Registry — `/tools` index page (Issue #80).
 *
 * The `/tools` route is the canonical entry surface for Tool
 * discovery. It is populated by `listPublicTools()` from
 * `src/tools/registry.ts` — the registry is the single source of
 * truth. The host_disabled / needs_tool_side_fix / not_integrable_yet
 * Tools are intentionally excluded (the brief forbids showing Tools
 * that are not actually integrated).
 *
 * The spec verifies:
 *
 *   1. `/tools` returns 200 HTML and renders the index.
 *   2. Exactly the public Tools (same_origin_static +
 *      external_exception) appear — host_disabled Tools do not.
 *   3. Each public Tool card links to `/tools/<slug>`.
 *   4. The page links into the ProtoType iframe shell route.
 *   5. A host_disabled slug (`text-counter`) returns 404 at
 *      `/tools/text-counter` (the route throws notFound() for
 *      non-public Tools).
 */

test.describe('Tool Registry — /tools index (Issue #80)', () => {
	test('returns 200 and lists the public Tools', async ({ page }) => {
		const res = await page.goto('/tools');
		expect(res?.status()).toBe(200);

		// The ProtoType pilot is the only public Tool at the end of #81.
		await expect(page.locator('[data-tool-slug="prototype"]')).toBeVisible();
	});

	test('excludes host_disabled Tools from the list', async ({ page }) => {
		await page.goto('/tools');
		// text-counter is host_disabled at end of #80.
		await expect(page.locator('[data-tool-slug="text-counter"]')).toHaveCount(0);
	});

	test('card link points at /tools/<slug>', async ({ page }) => {
		await page.goto('/tools');
		const link = page.locator('[data-tool-slug="prototype"] a');
		await expect(link).toHaveAttribute('href', '/tools/prototype');
	});

	test('clicking a card navigates to the iframe shell route', async ({ page }) => {
		await page.goto('/tools');
		await page.locator('[data-tool-slug="prototype"] a').click();
		await page.waitForURL('/tools/prototype');
		await expect(page.locator('iframe[title="ProtoType Tool"]')).toBeVisible();
	});

	test('a host_disabled slug 404s at /tools/<slug>', async ({ page }) => {
		const res = await page.goto('/tools/text-counter');
		expect(res?.status()).toBe(404);
	});
});
