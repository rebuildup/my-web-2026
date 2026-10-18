import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvitationView } from './accept-view';

/**
 * Invitation-accept form error association (Issue #404).
 *
 * The acceptance condition under test: 「空欄/形式違反が視覚と読み上げで
 * 理解できる」 for the account-creation step, which is the one form in
 * the repository a visitor can be refused at more than once — the
 * password rule refuses it, the token refuses it, the sign-in step
 * refuses it.
 *
 * The file under test is deliberately free of server-fn imports (see
 * its own header), so no seam is stubbed here: `submit` is injected by
 * the route, and this suite injects the two refusals it wants to see.
 */

const VALID_PROBE = { found: true, email: 'invited@example.com', expired: false, consumed: false };

// This suite does not run with vitest globals, so Testing Library's
// automatic cleanup hook is not registered; unmount explicitly instead
// of letting two renders share one document.
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

type Submission = { ok: boolean; failure?: string };

function renderForm(submit: (input: { name: string; password: string }) => Promise<Submission>) {
	return render(
		<AcceptInvitationView probe={VALID_PROBE} token="token-under-test" submit={submit as never} />,
	);
}

/** A view whose submission always fails the same way. */
function renderFormFailing(result: Submission) {
	return renderForm(async () => result);
}

/**
 * The visible label carries the required marker (`必須`), which is
 * `aria-hidden` — so a platform announces 「Name」 alone and the query
 * here matches the label text prefix rather than the whole node.
 */
const NAME_LABEL = /^Name/;
const PASSWORD_LABEL = /^Password/;

function fillAndSubmit(name: string, password: string) {
	const nameInput = screen.getByLabelText(NAME_LABEL) as HTMLInputElement;
	const passwordInput = screen.getByLabelText(PASSWORD_LABEL) as HTMLInputElement;
	fireEvent.change(nameInput, { target: { value: name } });
	fireEvent.change(passwordInput, { target: { value: password } });
	fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

/** Every id the rendered document declares. */
function declaredIds(container: HTMLElement): Set<string> {
	return new Set([...container.querySelectorAll('[id]')].map((node) => node.id));
}

describe('AcceptInvitationView — field errors', () => {
	it('starts with no error state and no dangling references', () => {
		const { container } = renderFormFailing({ ok: false, failure: 'token_invalid' });
		const password = screen.getByLabelText(PASSWORD_LABEL);
		// Before a submission there is nothing to announce: no live
		// region, no invalid state, and — the defect this Issue is
		// about — no `aria-describedby` naming an element the document
		// does not contain.
		expect(screen.queryByRole('alert')).toBeNull();
		expect(password.getAttribute('aria-invalid')).toBeNull();
		for (const input of container.querySelectorAll('input')) {
			const describedBy = input.getAttribute('aria-describedby');
			if (describedBy === null) continue;
			for (const id of describedBy.split(' ')) {
				expect(declaredIds(container).has(id)).toBe(true);
			}
		}
	});

	// The control disables submit below eight characters, which is a
	// first line only: the server is authoritative for the password
	// policy, so a refusal is still modelled with a value the client
	// gate lets through.
	it('associates a weak-password refusal with the password control', async () => {
		renderFormFailing({ ok: false, failure: 'weak_password' });
		fillAndSubmit('Ada', 'shortpwd');

		const summary = await screen.findByRole('alert');
		expect(summary.textContent).toContain('アカウントを作成できませんでした');
		expect(summary.textContent).toContain('パスワードが短すぎます (8 文字以上)。');
		// The summary links to the field it is about, so the correction
		// is one keystroke away rather than a hunt.
		const link = summary.querySelector('a');
		expect(link?.getAttribute('href')).toBe('#password');

		const password = screen.getByLabelText(PASSWORD_LABEL);
		expect(password.getAttribute('aria-invalid')).toBe('true');
		expect(password.getAttribute('aria-describedby')).toContain('password-error');
		// The sentence is reachable from the control itself, not only
		// rendered near it.
		const error = document.getElementById('password-error');
		expect(error?.textContent).toContain('パスワードが短すぎます');
		// The name control was not the refusal, so it must not claim to
		// be in an error state.
		expect(screen.getByLabelText(NAME_LABEL).getAttribute('aria-invalid')).toBeNull();
	});

	it('announces a token refusal once, as a form-level error', async () => {
		renderFormFailing({ ok: false, failure: 'token_consumed' });
		fillAndSubmit('Ada', 'a-long-enough-password');

		const summary = await screen.findByRole('alert');
		expect(summary.textContent).toContain('この招待はすでに使用されています。');
		// Nothing in this form was refused, so the summary must not send
		// the person to a control whose value was never the problem.
		expect(summary.querySelector('a')).toBeNull();
		expect(screen.getByLabelText(PASSWORD_LABEL).getAttribute('aria-invalid')).toBeNull();
		await waitFor(() => {
			expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
		});
	});

	it('withdraws the refusal as soon as the next attempt starts', async () => {
		// The second attempt never resolves: what is under test is the
		// state DURING the request, not its outcome. Leaving the old
		// refusal up while a new submission is in flight is what tells a
		// screen-reader user that the value they just corrected is still
		// refused.
		const submit = vi
			.fn<() => Promise<Submission>>()
			.mockResolvedValueOnce({ ok: false, failure: 'weak_password' })
			.mockImplementationOnce(() => new Promise<Submission>(() => {}));
		renderForm(submit);
		fillAndSubmit('Ada', 'shortpwd');
		await screen.findByRole('alert');

		fillAndSubmit('Ada', 'a-long-enough-password');
		await waitFor(() => {
			expect(screen.queryByRole('alert')).toBeNull();
		});
		expect(screen.getByLabelText(PASSWORD_LABEL).getAttribute('aria-invalid')).toBeNull();
		// …and the attempt itself is announced, so the disappearance of
		// the refusal is not silence.
		expect(
			screen.getByRole('button', { name: 'Creating account…' }).getAttribute('aria-busy'),
		).toBe('true');
	});
});
