import { createFileRoute, redirect } from '@tanstack/react-router';
import { type AdminCapability, AdminDashboard, getCurrentSession } from '../admin/public';

/**
 * `/admin` — the admin dashboard.
 *
 * Loader: redirects unauthenticated users to `/admin/login`; renders
 * the dashboard for any signed-in user. Role display is read-only
 * for 0.3.0 — non-admin users see the dashboard with the
 * role badge but cannot reach invitation / key / image surfaces
 * (the server functions reject them).
 */
export const Route = createFileRoute('/admin')({
	loader: async () => {
		const session = await getCurrentSession();
		if (!session) {
			throw redirect({ to: '/admin/login' });
		}
		return { email: session.user.email, role: session.user.role ?? 'user' };
	},
	component: AdminRoute,
});

function AdminRoute() {
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
