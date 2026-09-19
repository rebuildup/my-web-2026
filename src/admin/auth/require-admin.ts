import { getCurrentSession, type AdminSession } from './load';

/**
 * Admin gate — used by every admin-only server function in the
 * project (invitations, keys, images). Throws a 403-shaped error
 * when the caller is not signed in or has a non-admin role.
 *
 * The throw is caught by TanStack Start's server-fn error boundary
 * and surfaced to the UI as `notFound()` / `redirect()` / etc.
 *
 * Better Auth's admin plugin assigns `role = 'admin'` via the
 * `auth.api.setRole` server call or by the create-admin CLI. There
 * are no custom roles at 0.3.0; the only admin-restricted surfaces
 * are these project-owned CRUD server functions.
 */
export async function requireAdmin(): Promise<AdminSession> {
	const session = await getCurrentSession();
	if (!session) {
		throw new AdminAuthError('not_authenticated');
	}
	if (session.user.role !== 'admin') {
		throw new AdminAuthError('forbidden');
	}
	return session;
}

export class AdminAuthError extends Error {
	constructor(public reason: 'not_authenticated' | 'forbidden') {
		super(reason);
		this.name = 'AdminAuthError';
	}
}
