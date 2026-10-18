import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { css } from '../../styled-system/css';
import { getCurrentSession } from '../admin/public';
import { ErrorSummary, TextField } from '../editorial/forms';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { classifyRedirectTarget } from '../http/security/redirect';

/**
 * `/admin/login` — Better Auth's email + password sign-in form.
 *
 * Submits as a regular HTML form to `POST /api/v1/auth/sign-in/email`
 * (Better Auth's canonical sign-in endpoint). On success, Better Auth
 * sets the session cookie and redirects; we then land on `/admin`.
 *
 * Better Auth's built-in CSRF middleware (`formCsrfMiddleware`)
 * enforces origin checks, so the form must POST from the same origin
 * — which it does by virtue of being on the same worker.
 *
 * Already-signed-in users are redirected to `/admin` immediately.
 *
 * `?returnTo=` (Issue #454) — where to land after a successful
 * sign-in. The value is untrusted input, so it is classified in the
 * **loader** (server-side, before it can reach the DOM) by
 * `classifyRedirectTarget`; anything that is not an internal
 * `/admin…` path is refused and the page falls back to
 * `DEFAULT_RETURN_TO` with a visible notice. The notice appears only
 * when a target was actually supplied and refused — opening the login
 * page without `?returnTo=` is the ordinary case, not a warning. The
 * accepted value is embedded as the form's `callbackURL`, which the
 * external boundary validates again at
 * `/api/v1/auth/sign-in/email` (Issue #454) before Better Auth ever
 * sees it — the loader decides what the browser is told, the boundary
 * decides what is served.
 *
 * Client-side navigation re-runs the loader through the server
 * function, so the check is not an SSR-only artifact.
 *
 * Field association (Issue #404): the two controls are editorial
 * `TextField`s, so each carries a visible label, an `autoComplete`
 * token (WCAG 2.2 1.3.5 Identify Input Purpose) and a description. A
 * refused `?returnTo=` is rendered as the form's error SUMMARY rather
 * than as a quiet caption: it is a form-level refusal the person has
 * to notice before typing a password into a form that will not go
 * where they asked, and `role="alert"` is what announces it.
 *
 * The sign-in POST itself is Better Auth's and its failure response
 * (HTTP 401 JSON) is outside this file; this page therefore states no
 * password error of its own rather than inventing one.
 */
const DEFAULT_RETURN_TO = '/admin';

/** The login screen may only return inside the admin surface, so a
 *  post-sign-in redirect cannot leave the area the gate protects. */
const RETURN_TO_PREFIXES = ['/admin'] as const;

const LoginSearchSchema = z.object({
	// `z.array` is accepted so a repeated `?returnTo=a&returnTo=b` is a
	// refusal rather than a search-validation error page; the array
	// itself is never a valid target (`classifyRedirectTarget` rejects
	// non-strings).
	returnTo: z.union([z.string(), z.array(z.string())]).optional(),
});

export const Route = createFileRoute('/admin/login')({
	validateSearch: LoginSearchSchema,
	loaderDeps: ({ search }) => ({ returnTo: search.returnTo }),
	loader: async ({ deps }) => {
		const session = await getCurrentSession();
		if (session) {
			throw redirect({ to: '/admin' });
		}
		const decision = classifyRedirectTarget(
			typeof deps.returnTo === 'string' ? deps.returnTo : undefined,
			{ allowedPrefixes: RETURN_TO_PREFIXES },
		);
		return {
			returnTo: decision.ok ? decision.redirect : DEFAULT_RETURN_TO,
			// `missing` means "no target was supplied", which is the
			// ordinary case — the loader still falls back, but saying so
			// to someone who just opened the login page is noise.
			rejectedReason: decision.ok || decision.reason === 'missing' ? null : decision.reason,
		};
	},
	component: LoginRoute,
});

function LoginRoute() {
	const { returnTo, rejectedReason } = Route.useLoaderData();
	const [busy, setBusy] = useState(false);
	return (
		<section
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="00 — Admin"
					title="サインイン / Sign in"
					description="招待された管理者のみ。Sign-up は無効。"
					variant="spread"
				>
					{rejectedReason ? (
						<ErrorSummary
							heading="移動先を確認できませんでした"
							testId="return-to-rejected"
							dataAttributes={{ 'data-reject-reason': rejectedReason }}
							errors={[
								{
									label: '移動先',
									message: `returnTo が安全ではないため、${DEFAULT_RETURN_TO} に移動します。`,
								},
							]}
						/>
					) : null}
					<form
						method="post"
						action="/api/v1/auth/sign-in/email"
						onSubmit={() => setBusy(true)}
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '4',
							maxWidth: '480px',
						})}
					>
						<input type="hidden" name="callbackURL" value={returnTo} />
						<TextField
							name="email"
							label="Email"
							type="email"
							autoComplete="username"
							description="招待された管理者のメールアドレス。"
							required
						/>
						<TextField
							name="password"
							label="Password"
							type="password"
							autoComplete="current-password"
							description="このアカウントのパスワード。"
							required
						/>
						<button
							type="submit"
							disabled={busy}
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
								_disabled: { opacity: '0.5' },
							})}
						>
							{busy ? 'Signing in…' : 'Sign in'}
						</button>
					</form>
				</SectionHeading>
			</Container>
		</section>
	);
}
