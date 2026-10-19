import { useState } from 'react';
import { css } from '../../../styled-system/css';
import { ErrorSummary, TextField } from '../../editorial/forms';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import type { AcceptInvitationResult, InvitationProbe } from './accept';

/**
 * Invitation accept UI — `/admin/invitations/accept?token=...`.
 *
 * Pure UI: takes `probe` + `token` + a `submit` callback that runs
 * the server-side `acceptInvitation` (injected by the route so this
 * file remains free of `@tanstack/react-start/server` imports and
 * can be bundled into client code without leaking server fns).
 *
 * Renders three states based on `probe`:
 *   - `found: false`           → token invalid
 *   - `consumed: true`         → already used
 *   - `expired: true`          → past 7-day TTL
 *   - valid                    → name + password form
 *
 * On submit success the form:
 *   1. calls `acceptInvitation({ token, name, password })` — creates
 *      the user and marks the invitation consumed (server-side).
 *   2. POSTs the same email/password to
 *      `/api/v1/auth/sign-in/email` (Better Auth's canonical sign-in
 *      endpoint) — that endpoint sets the session cookie on the
 *      browser, so we don't need to forward Set-Cookie headers
 *      across the RPC boundary.
 *   3. navigates to `/admin` to land on the dashboard.
 *
 * Better Auth's built-in CSRF middleware (`formCsrfMiddleware`)
 * enforces origin checks; both RPC and Better Auth share the same
 * worker origin, so the sign-in POST is on the same origin.
 *
 * Field association (Issue #404): both controls are editorial
 * `TextField`s, so each carries its label, its requirement and — when
 * the submission is refused — `aria-invalid` plus a sentence reached
 * through `aria-describedby`. The refusal is ALSO summarised at the
 * top of the form: `weak_password` is about the password control, the
 * other failures are about the invitation itself and therefore appear
 * in the summary only. Both copies carry the same words; only the
 * summary is a live region, so the sentence is announced once.
 */
export interface AcceptInvitationViewProps {
	probe: InvitationProbe;
	token: string;
	submit: (input: { name: string; password: string }) => Promise<AcceptInvitationResult>;
}

const FAILURE_COPY: Record<string, string> = {
	token_invalid: '招待トークンが無効です。管理者から再発行を受けてください。',
	token_expired: '招待の有効期限が切れています (7 日)。管理者から再発行を受けてください。',
	token_consumed: 'この招待はすでに使用されています。',
	email_taken: 'このメールアドレスのアカウントは既に存在します。',
	weak_password: 'パスワードが短すぎます (8 文字以上)。',
	sign_in_failed:
		'アカウント作成は成功しましたがサインインに失敗しました。もう一度サインインしてください。',
};

export function AcceptInvitationView({ probe, token, submit }: AcceptInvitationViewProps) {
	return (
		<section
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="Invitation accept"
					title="アカウントを作成 / Accept invitation"
					description="招待メールに記載されたトークンでサインアップします。現在は invitation-only です。"
					variant="spread"
				>
					{!probe.found ? (
						<ErrorPanel message={FAILURE_COPY.token_invalid} />
					) : probe.consumed ? (
						<ErrorPanel message={FAILURE_COPY.token_consumed} />
					) : probe.expired ? (
						<ErrorPanel message={FAILURE_COPY.token_expired} />
					) : (
						<AcceptForm token={token} email={probe.email ?? ''} submit={submit} />
					)}
				</SectionHeading>
			</Container>
		</section>
	);
}

function ErrorPanel({ message }: { message: string }) {
	return (
		<p
			className={css({
				margin: '0',
				paddingBlock: '6',
				paddingInline: '4',
				fontFamily: 'sans',
				fontSize: 'md',
				color: 'text.muted',
				border: '1px solid {colors.border.subtle}',
				borderRadius: '4',
			})}
		>
			{message}
		</p>
	);
}

async function signInAfterAccept(email: string, password: string): Promise<boolean> {
	const body = new URLSearchParams();
	body.set('email', email);
	body.set('password', password);
	const response = await fetch('/api/v1/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
		credentials: 'include',
	});
	return response.ok;
}

function AcceptForm({
	token,
	email,
	submit,
}: {
	token: string;
	email: string;
	submit: AcceptInvitationViewProps['submit'];
}) {
	const [name, setName] = useState('');
	const [password, setPassword] = useState('');
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<FormRefusal | null>(null);

	/**
	 * Which control a refusal sentence belongs to, if any.
	 *
	 * `weak_password` is the one failure whose correction is a value in
	 * a named field; everything else describes the invitation token or
	 * the account as a whole, and pointing a link at the password field
	 * for those would send the person to edit a value that was never
	 * the problem.
	 */
	function refusalFor(reason: string | undefined, message: string): FormRefusal {
		if (reason === 'weak_password') {
			return { field: 'password', label: 'Password', message };
		}
		return { label: 'Account creation', message };
	}

	return (
		<form
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				setFailure(null);
				const result = await submit({ name, password });
				if (!result.ok) {
					setBusy(false);
					setFailure(
						refusalFor(
							result.failure,
							FAILURE_COPY[result.failure ?? 'token_invalid'] ?? FAILURE_COPY.token_invalid,
						),
					);
					void token;
					return;
				}
				const signedIn = await signInAfterAccept(email, password);
				if (!signedIn) {
					setBusy(false);
					setFailure(refusalFor('sign_in_failed', FAILURE_COPY.sign_in_failed));
					void token;
					return;
				}
				// Force a full navigation so the loader on /admin runs
				// fresh with the new session cookie.
				window.location.href = '/admin';
			}}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				maxWidth: '480px',
			})}
		>
			<ErrorSummary heading="アカウントを作成できませんでした" errors={failure ? [failure] : []} />
			<p
				className={css({
					margin: '0',
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				{email}
			</p>
			<TextField
				name="name"
				label="Name"
				type="text"
				autoComplete="name"
				description="アカウントに設定する表示名。"
				value={name}
				onChange={(e) => setName(e.target.value)}
				required
				minLength={1}
				maxLength={120}
			/>
			<TextField
				name="password"
				label="Password"
				type="password"
				autoComplete="new-password"
				description="8 文字以上。16 文字以上のパスフレーズを推奨します。"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				required
				minLength={8}
				maxLength={256}
				error={failure?.field === 'password' ? failure.message : null}
			/>
			<button
				type="submit"
				disabled={busy || name.length === 0 || password.length < 8}
				aria-busy={busy}
				className={css({
					fontFamily: 'sans',
					fontSize: 'md',
					fontWeight: '600',
					color: 'text.inverse',
					background: 'bg.accent',
					border: 'none',
					borderRadius: '4',
					paddingBlock: '3',
					paddingInline: '6',
					cursor: 'pointer',
					_disabled: { opacity: '0.5', cursor: 'not-allowed' },
				})}
			>
				{busy ? 'Creating account…' : 'Create account'}
			</button>
		</form>
	);
}

/** A refused submission, in the shape the editorial summary consumes. */
type FormRefusal = {
	field?: string;
	label: string;
	message: string;
};
