import { expect, test } from '@playwright/test';

/**
 * `/admin/login` redirect-target contract (Issue #454).
 *
 * The open-redirect classifier is covered exhaustively by
 * `src/http/security/redirect.test.ts` (pure) and
 * `src/http/security/redirect-guard.test.ts` (real Worker + Better
 * Auth). This spec covers the one thing neither can: what the rendered
 * screen actually tells the browser.
 *
 *   1. An internal admin path survives into the sign-in POST's
 *      `callbackURL`.
 *   2. An off-origin target is refused, the notice is visible, and the
 *      form falls back to `/admin` — the "what the user is told" half
 *      of the contract.
 *   3. The canonical sign-in endpoint is unchanged (the
 *      `prod-smoke.spec.ts` gate on `action="/api/v1/auth/sign-in/email"`
 *      has a local counterpart here).
 *
 * No credential is typed and no sign-in is performed.
 */

test.describe('/admin/login — returnTo', () => {
	test('carries an internal admin path into the sign-in POST', async ({ page }) => {
		await page.goto('/admin/login?returnTo=%2Fadmin%2Finvitations');

		await expect(page.locator('[data-testid="return-to-rejected"]')).toHaveCount(0);
		await expect(page.locator('form[action="/api/v1/auth/sign-in/email"]')).toHaveCount(1);
		// Percent-encoded in the URL, decoded to the internal path the
		// handler will receive.
		await expect(page.locator('input[name="callbackURL"]')).toHaveValue('/admin/invitations');
	});

	test('refuses an off-origin target and falls back to /admin', async ({ page }) => {
		await page.goto('/admin/login?returnTo=https%3A%2F%2Fevil.example%2Fadmin');

		const notice = page.locator('[data-testid="return-to-rejected"]');
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAttribute('data-reject-reason', 'external_origin');
		// The hostile value is never rendered back into the DOM.
		await expect(page.locator('input[name="callbackURL"]')).toHaveValue('/admin');
		await expect(page.locator('body')).not.toContainText('evil.example');
	});

	test('refuses a scheme-relative authority', async ({ page }) => {
		await page.goto('/admin/login?returnTo=%2F%2Fevil.example%2Fadmin');

		await expect(page.locator('[data-testid="return-to-rejected"]')).toHaveAttribute(
			'data-reject-reason',
			'protocol_relative',
		);
		await expect(page.locator('input[name="callbackURL"]')).toHaveValue('/admin');
	});

	test('defaults to /admin when no target is supplied', async ({ page }) => {
		await page.goto('/admin/login');

		await expect(page.locator('[data-testid="return-to-rejected"]')).toHaveCount(0);
		await expect(page.locator('input[name="callbackURL"]')).toHaveValue('/admin');
	});
});
