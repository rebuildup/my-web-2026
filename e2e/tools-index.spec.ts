import { expect, test } from '@playwright/test';

/**
 * Tool Registry — `/tools` index + `<slug>` detail contract
 * (Issue #80, re-scoped by Issue #195).
 *
 * The `/tools` route is the canonical entry surface for Tool
 * discovery. It is populated from `src/tools/manifest.json` via
 * `src/tools/registry.ts` — the registry is the single source of
 * truth.
 *
 * Show-all policy (Issue #195): the index lists **every** manifest
 * entry. Embeddable Tools (`same_origin_static` /
 * `external_exception`) render as links; `host_disabled` Tools
 * render as non-link rows carrying a "Coming soon" badge and their
 * `disabled_reason`.
 *
 * Detail-route contract (Issue #195, on top of #183):
 *
 *   - slug in manifest, embeddable    → iframe shell, HTTP 200
 *   - slug in manifest, host_disabled → "Coming soon" placeholder,
 *                                       HTTP 200 (NOT 404)
 *   - slug absent from manifest       → 404 empty state
 *
 * The pre-#195 spec asserted that `text-counter` (a `host_disabled`
 * entry) 404s. That is exactly the behaviour #195 removed, so the
 * spec now asserts the placeholder contract and covers the genuine
 * unknown-slug 404 separately.
 */

test.describe('Tool Registry — /tools index (Issue #80, #195)', () => {
	test('returns 200 and lists the public Tools', async ({ page }) => {
		const res = await page.goto('/tools');
		expect(res?.status()).toBe(200);

		// ProtoType and readmark are the embeddable Tools.
		await expect(page.locator('[data-tool-slug="prototype"]')).toBeVisible();
		await expect(page.locator('[data-tool-slug="readmark"]')).toBeVisible();
	});

	test('host_disabled Tools are listed as non-link "Coming soon" rows', async ({ page }) => {
		await page.goto('/tools');
		// Issue #195 flipped the index to show-all. `text-counter`
		// is `host_disabled` — it must appear, marked as coming
		// soon, and must NOT link to its detail route.
		const row = page.locator('[data-tool-slug="text-counter"]');
		await expect(row).toBeVisible();
		await expect(row).toHaveAttribute('data-tool-state', 'host_disabled');
		await expect(row.locator('[data-tool-badge="coming-soon"]')).toBeVisible();
		await expect(row.locator('a[href="/tools/text-counter"]')).toHaveCount(0);
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
});

test.describe('Tool Registry — /tools/<slug> detail contract (Issue #195)', () => {
	test('a host_disabled slug renders the placeholder at 200, not 404', async ({ page }) => {
		// `text-counter` is in the manifest with `delivery.kind:
		// 'host_disabled'`. Pre-#195 this route threw notFound().
		const res = await page.goto('/tools/text-counter');
		expect(res?.status()).toBe(200);

		// The placeholder is the observable contract.
		const surface = page.locator('[data-tool-state="host_disabled"]');
		await expect(surface).toBeVisible();
		await expect(surface).toHaveAttribute('data-tool-slug', 'text-counter');
		await expect(surface).toHaveText(/Coming soon/);
		// The manifest's `disabled_reason` is surfaced verbatim.
		await expect(surface.locator('[data-tool-disabled-reason]')).toBeVisible();
		// A back-link to the index so the visitor is not stranded.
		await expect(surface.locator('a[href="/tools"]')).toBeVisible();
	});

	test('a slug absent from the manifest 404s', async ({ page }) => {
		// Schema-valid slug shape (`^[a-z0-9][a-z0-9-]{0,127}$`) that
		// is guaranteed not to be a manifest entry.
		const res = await page.goto('/tools/definitely-not-a-registered-tool');
		expect(res?.status()).toBe(404);

		// Issue #183: the 404 is a designed empty state with site
		// chrome, not TanStack's default string.
		await expect(page.locator('[data-testid="tools-not-found"]')).toBeVisible();
		await expect(page.locator('[data-testid="tools-not-found"]')).toHaveText(
			/ツールが見つかりません/,
		);
		// Issue #288: the 404 surface renders no header chrome —
		// no PublicNav and no breadcrumb header.
		await expect(page.locator('nav[aria-label="Public"]')).toHaveCount(0);
		await expect(page.locator('nav[aria-label="パンくず"]')).toHaveCount(0);
	});
});
