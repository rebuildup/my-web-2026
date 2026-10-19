import { expect, test } from '@playwright/test';

/**
 * Form-field association on the sign-in screen (Issue #404).
 *
 * `/admin/login` is the only form of the four this Issue converted that
 * a visitor can reach without a session, so it is the one where a
 * regression is observable outside the admin area. The other three
 * (`/admin/invitations`, `/admin/invitations/accept`,
 * `/admin/images`) are covered by the DOM suites
 * (`accept-view.client.test.tsx`, `images.client.test.tsx`) and by the
 * SSR markup contract (`forms.test.tsx`); this spec checks the half a
 * unit test cannot: what a real browser computes for the accessible
 * name of a shipped control, and what it renders on a refused load.
 *
 * No credential is typed and no sign-in is performed.
 */

test.describe('/admin/login — field association (Issue #404)', () => {
	test('names each control and states what it accepts', async ({ page }) => {
		await page.goto('/admin/login');

		// Ids are the contract's: the name derives them, and the summary
		// links to them.
		const email = page.locator('#email');
		await expect(email).toBeVisible();
		await expect(email).toHaveAttribute('autocomplete', 'username');
		await expect(email).toHaveAttribute('aria-describedby', 'email-description');
		await expect(page.locator('#email-description')).toHaveText(
			'招待された管理者のメールアドレス。',
		);

		const password = page.locator('#password');
		await expect(password).toHaveAttribute('autocomplete', 'current-password');
		await expect(password).toHaveAttribute('aria-describedby', 'password-description');
		await expect(page.locator('#password-description')).toHaveText('このアカウントのパスワード。');

		// An untouched form is not an error state: announcing
		// 「this value is wrong」 before anyone typed anything would be a
		// false status message (WCAG 2.2 4.1.3).
		await expect(page.locator('[aria-invalid]')).toHaveCount(0);
		await expect(page.locator('[role="alert"]')).toHaveCount(0);
	});

	test('keeps the required marker out of the accessible name', async ({ page }) => {
		await page.goto('/admin/login');
		// The browser's own accessible name is 「Email」, not 「Email必須」:
		// the marker is `aria-hidden` and the requirement is carried by
		// `required` on the control.
		await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveCount(1);
		await expect(page.getByRole('textbox', { name: /必須/ })).toHaveCount(0);
	});

	test('announces a refused redirect target once, as a summary', async ({ page }) => {
		await page.goto('/admin/login?returnTo=https%3A%2F%2Fevil.example%2Fadmin');

		const summary = page.getByRole('alert');
		await expect(summary).toBeVisible();
		await expect(summary).toContainText('移動先を確認できませんでした');
		// The refusal is about the request, not about a control: it must
		// not send the person to edit a value that was never the problem.
		await expect(summary.locator('a')).toHaveCount(0);
		await expect(page.locator('[aria-invalid]')).toHaveCount(0);
		// The sign-in POST still targets the canonical endpoint and falls
		// back inside the admin surface (Issue #454).
		await expect(page.locator('form[action="/api/v1/auth/sign-in/email"]')).toHaveCount(1);
		await expect(page.locator('input[name="callbackURL"]')).toHaveValue('/admin');
		// The hostile value is never rendered back into the DOM.
		await expect(page.locator('body')).not.toContainText('evil.example');
	});
});
