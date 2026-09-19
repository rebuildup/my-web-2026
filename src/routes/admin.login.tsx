import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { css } from '../../styled-system/css';
import { getCurrentSession } from '../admin/public';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';

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
 */
export const Route = createFileRoute('/admin/login')({
	loader: async () => {
		const session = await getCurrentSession();
		if (session) {
			throw redirect({ to: '/admin' });
		}
		return null;
	},
	component: LoginRoute,
});

function LoginRoute() {
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
