import { createFileRoute, redirect } from '@tanstack/react-router';
import { type AdminCapability, AdminDashboard, getCurrentSession } from '../admin/public';

/**
 * `/admin` (index) — admin dashboard.
 *
 * Loader: signed-in check only. Any signed-in user (admin or
 * non-admin role) reaches the dashboard; non-admin role holders see
 * the capability list as read-only and are redirected by each
 * protected child loader (`/admin/keys`, etc.) when they try to
 * open admin-only surfaces.
 *
 * Anonymous requests are redirected to `/admin/login` (Issue #106:
 * the auth guard used to live on the parent `/admin.tsx` loader,
 * which TanStack Router ran before this child loader and caused a
 * 307 self-redirect on the login URL itself).
 */
export const Route = createFileRoute('/admin/')({
	loader: async () => {
		const session = await getCurrentSession();
		if (!session) {
			throw redirect({ to: '/admin/login' });
		}
		return { email: session.user.email, role: session.user.role ?? 'user' };
	},
	component: AdminIndexRoute,
});

function AdminIndexRoute() {
	const { email, role } = Route.useLoaderData();
	const capabilities: readonly AdminCapability[] = [
		{
			id: 'invitations',
			label: 'Invitations',
			labelJa: '招待',
			status: 'live',
			href: '/admin/invitations',
		},
		{
			id: 'keys',
			label: 'API keys',
			labelJa: 'API キー',
			status: 'live',
			href: '/admin/keys',
		},
		{ id: 'images', label: 'Reaction images', labelJa: 'リアクション画像', status: 'planned' },
		{
			id: 'emoji-catalog',
			label: 'Emoji catalog',
			labelJa: '絵文字カタログ',
			status: 'live',
			href: '/admin/emoji-catalog',
		},
	];
	return (
		<AdminDashboard
			email={email}
			role={role}
			signOutForm={
				<form action="/api/v1/auth/sign-out" method="post" style={{ display: 'inline' }}>
					<button
						type="submit"
						style={{
							fontFamily: 'sans',
							fontSize: 'xs',
							fontWeight: 600,
							color: 'var(--colors-text-muted)',
							background: 'transparent',
							border: '1px solid var(--colors-border-subtle)',
							borderRadius: 9999,
							paddingInline: 12,
							paddingBlock: 4,
							cursor: 'pointer',
						}}
					>
						sign out
					</button>
				</form>
			}
			capabilities={capabilities}
		/>
	);
}
