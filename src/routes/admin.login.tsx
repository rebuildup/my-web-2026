import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { css } from '../../styled-system/css';
import { getCurrentSession } from '../admin/public';
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
 * `DEFAULT_RETURN_TO`. The accepted value is embedded as the form's
 * `callbackURL`, which the external boundary validates again at
 * `/api/v1/auth/sign-in/email` (Issue #454) before Better Auth ever
 * sees it — the loader decides what the browser is told, the boundary
 * decides what is served.
 *
 * Client-side navigation re-runs the loader through the server
 * function, so the check is not an SSR-only artifact.
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
			rejectedReason: decision.ok ? null : decision.reason,
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
						<output
							data-testid="return-to-rejected"
							data-reject-reason={rejectedReason}
							className={css({
								display: 'block',
								margin: '0',
								paddingBlock: '3',
								paddingInline: '4',
								maxWidth: '480px',
								fontFamily: 'sans',
								fontSize: 'sm',
								color: 'text.muted',
								border: '1px solid {colors.border.subtle}',
								borderRadius: '4',
							})}
						>
							{`returnTo が安全ではないため、${DEFAULT_RETURN_TO} に移動します。`}
						</output>
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
						<label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
							<span className={css({ fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}>
								Email
							</span>
							<input
								type="email"
								name="email"
								required
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
								required
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
						<button
							type="submit"
							disabled={busy}
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
