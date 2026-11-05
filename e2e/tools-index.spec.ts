import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 *
 * Issue #861 — deriving the state from the manifest instead of
 * freezing one slug:
 *
 *   The spec used to name `text-counter` as "the" `host_disabled`
 *   entry, so it went red when #817 graduated that Tool, and it would
 *   go red again when the last waiting Tool lands. The manifest is
 *   repo-controlled data, so the spec now READS it and branches:
 *
 *     - a waiting Tool exists → the placeholder contract is asserted
 *       on the FIRST waiting slug of the manifest;
 *     - no waiting Tool exists → the index must carry NO coming-soon
 *       badge and every card must link to its detail route, and the
 *       placeholder-surface test is skipped WITH A REASON (the surface
 *       does not exist; the contract itself is verified against a
 *       synthetic manifest in `src/tools/registry.test.ts`).
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The shipped Tool manifest, read from disk.
 *
 * The same file the registry reads, so the spec's state can never
 * drift from the shipped data.
 */
function readToolManifest(): {
	slugs: string[];
	disabledSlugs: string[];
} {
	const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'src/tools/manifest.json'), 'utf8')) as {
		tools: Array<{ slug: string; delivery: { kind: string } }>;
	};
	return {
		slugs: raw.tools.map((tool) => tool.slug),
		disabledSlugs: raw.tools
			.filter((tool) => tool.delivery.kind === 'host_disabled')
			.map((tool) => tool.slug),
	};
}

const TOOL_MANIFEST = readToolManifest();

/** The first waiting Tool of the shipped manifest, if any. */
const FIRST_DISABLED_SLUG = TOOL_MANIFEST.disabledSlugs[0];

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
		if (!FIRST_DISABLED_SLUG) {
			// Issue #861: no Tool is waiting any more. The index must not
			// keep a coming-soon row, and every card must be a link to
			// its detail route.
			await expect(page.locator('[data-tool-badge="coming-soon"]')).toHaveCount(0);
			for (const slug of TOOL_MANIFEST.slugs) {
				await expect(
					page.locator(`[data-tool-slug="${slug}"] a[href="/tools/${slug}"]`),
				).toHaveCount(1);
			}
			return;
		}
		// Issue #195 flipped the index to show-all. The first waiting
		// Tool of the manifest must appear, marked as coming soon, and
		// must NOT link to its detail route.
		const row = page.locator(`[data-tool-slug="${FIRST_DISABLED_SLUG}"]`);
		await expect(row).toBeVisible();
		await expect(row).toHaveAttribute('data-tool-state', 'host_disabled');
		await expect(row.locator('[data-tool-badge="coming-soon"]')).toBeVisible();
		await expect(row.locator(`a[href="/tools/${FIRST_DISABLED_SLUG}"]`)).toHaveCount(0);
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
		// Issue #498: ProtoType declares third-party contacts, so the
		// shell opens with the consent notice and no frame. Reaching the
		// Tool is two steps now — the notice, then the load — and the
		// gate itself is asserted in e2e/tools-prototype.spec.ts.
		await expect(page.getByTestId('tool-embed-consent')).toBeVisible();
		// The notice is server-rendered: the button exists before React
		// attaches the handler, so a click that lands before hydration is
		// swallowed. Re-click until the frame appears (bounded), the same
		// pattern the prototype spec uses.
		const frame = page.locator('iframe[title="ProtoType Tool"]');
		let mounted = false;
		for (let attempt = 0; attempt < 5 && !mounted; attempt++) {
			await page
				.getByTestId('tool-embed-consent-activate')
				.click({ timeout: 2_000 })
				.catch(() => undefined);
			mounted = await frame
				.waitFor({ state: 'attached', timeout: 2_000 })
				.then(() => true)
				.catch(() => false);
		}
		expect(
			mounted,
			'the consent gate never mounted the frame after repeated clicks — hydration or the gate is broken',
		).toBe(true);
		await expect(page.locator('iframe[title="ProtoType Tool"]')).toBeVisible();
	});
});

test.describe('Tool Registry — /tools/<slug> detail contract (Issue #195)', () => {
	test('a host_disabled slug renders the placeholder at 200, not 404', async ({ page }) => {
		if (!FIRST_DISABLED_SLUG) {
			// Issue #861: the shipped manifest holds no waiting Tool, so
			// the placeholder surface does not exist to be asserted here.
			// The CONTRACT itself is verified against a synthetic manifest
			// in `src/tools/registry.test.ts` (a waiting Tool is in
			// listAllTools(), out of listPublicTools(), and carries a
			// non-empty disabled_reason).
			test.skip(
				true,
				'shipped manifest has no host_disabled Tool — the placeholder surface does not exist; the contract is covered by the synthetic-manifest unit tests (Issue #861)',
			);
		}
		// The first waiting Tool of the manifest is in it with
		// `delivery.kind: 'host_disabled'`. Pre-#195 this route threw
		// notFound().
		const res = await page.goto(`/tools/${FIRST_DISABLED_SLUG}`);
		expect(res?.status()).toBe(200);

		// The placeholder is the observable contract.
		const surface = page.locator('[data-tool-state="host_disabled"]');
		await expect(surface).toBeVisible();
		await expect(surface).toHaveAttribute('data-tool-slug', FIRST_DISABLED_SLUG);
		await expect(surface).toHaveText(/Coming soon/);
		// Issue #836 removed `disabled_reason` from this surface: it names
		// build / repo facts a visitor cannot act on. The placeholder must
		// not grow it back, so the absence is the assertion.
		await expect(surface.locator('[data-tool-disabled-reason]')).toHaveCount(0);
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
		// Issue #785 abolishes Issue #288: the 404 surface carries the
		// public nav, so a visitor who mistyped a slug can leave without
		// using the browser's back button. (Reversed assertion — it used
		// to require count 0.) Issue #911 (2026-11-05) keeps that: the
		// chrome removal applies only to states that SHOW a Tool.
		await expect(page.locator('nav[aria-label="Public"]')).toHaveCount(1);
		await expect(page.locator('[data-testid="tools-not-found"] a[href="/tools"]')).toBeVisible();
		// No breadcrumb here: the only labeled match for this URL is the
		// `$slug` leaf, which `route-labels.ts` drops when the loader
		// threw, so the chain resolves to nothing. Pinned so a future
		// "empty breadcrumb band" regression is visible rather than
		// silently accepted.
		await expect(page.locator('nav[aria-label="パンくず"]')).toHaveCount(0);
	});
});
