import { useState } from 'react';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { css } from '../../../styled-system/css';
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
					description="招待メールに記載されたトークンでサインアップします。0.3.0 は invitation-only。"
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
	const [failure, setFailure] = useState<string | null>(null);

	return (
		<form
			onSubmit={async (e) => {
				e.preventDefault();
				setBusy(true);
				setFailure(null);
				const result = await submit({ name, password });
				if (!result.ok) {
					setBusy(false);
					setFailure(FAILURE_COPY[result.failure ?? 'token_invalid'] ?? FAILURE_COPY.token_invalid);
					void token;
					return;
				}
				const signedIn = await signInAfterAccept(email, password);
				if (!signedIn) {
					setBusy(false);
					setFailure(FAILURE_COPY.sign_in_failed);
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
			<label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
				<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
					Name
				</span>
				<input
					type="text"
					name="name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
					minLength={1}
					maxLength={120}
					className={css({
						fontFamily: 'sans',
						fontSize: 'md',
						paddingInline: '3',
						paddingBlock: '2',
						border: '1px solid {colors.border.subtle}',
						borderRadius: '4',
						background: 'bg.surface',
						color: 'text.default',
					})}
				/>
			</label>
			<label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
				<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
					Password
				</span>
				<input
					type="password"
					name="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					required
					minLength={8}
					maxLength={256}
					className={css({
						fontFamily: 'sans',
						fontSize: 'md',
						paddingInline: '3',
						paddingBlock: '2',
						border: '1px solid {colors.border.subtle}',
						borderRadius: '4',
						background: 'bg.surface',
						color: 'text.default',
					})}
				/>
			</label>
			{failure && (
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{failure}
				</p>
			)}
			<button
				type="submit"
				disabled={busy || name.length === 0 || password.length < 8}
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
