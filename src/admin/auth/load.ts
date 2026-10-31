import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';

/**
 * Server-side session helpers for the admin surface.
 *
 * `auth.api.getSession({ headers })` reads the Better Auth session
 * cookie off the incoming request and returns the resolved session
 * (or `null` when no valid session is present). We forward the
 * incoming request headers verbatim — Better Auth is the source of
 * truth for cookie parsing and session validation.
 *
 * Used by:
 *   - `/admin` route loader → decide between dashboard and login redirect.
 *   - `requireAdmin()` below → gate admin-only server functions.
 *
 * The admin plugin's role field is exposed as `user.role`. The project has
 * no custom roles — only `admin` and `user`. See ADR-0009 §1.
 *
 * Issue #724: the Better Auth instance is resolved with `await import(…)`
 * **inside** each `.handler()` body, never at module level. A module-level
 * import is evaluated when the module loads, so it stays in the graph of
 * every client that imports this file — and the Better Auth server stack
 * (Kysely, Drizzle, the SQLite dialects, the API-key plugin) then ships to
 * every visitor's browser. Inside `.handler()` is the one position the
 * TanStack Start compiler plugin treats as Worker-only: it strips the
 * handler body out of the client build, so the server stack never enters
 * the browser graph at all.
 */
export interface AdminSessionUser {
	id: string;
	email: string;
	name: string;
	role?: string | null;
}

export interface AdminSession {
	user: AdminSessionUser;
	session: { id: string; expiresAt: Date };
}

/**
 * Return the current admin session, or `null` if unauthenticated.
 *
 * Security note: the Better Auth `session.token` is **not** exposed.
 * The token equals the value stored in the `better-auth.session_token`
 * cookie; surfacing it in a server-fn response would let any UI code
 * (including client-bundled reach) impersonate the admin against any
 * endpoint that accepts the cookie. The session's `id` and `expiresAt`
 * are safe metadata; `id` is useful for logging, `expiresAt` for the
 * UI to render "session expires in N days".
 */
export const getCurrentSession = createServerFn({ method: 'GET' }).handler(
	async (): Promise<AdminSession | null> => {
		const headers = getRequestHeaders();
		const { auth } = await import('../../cloudflare/auth/better-auth');
		const session = await auth.api.getSession({ headers });
		if (!session) return null;
		return {
			user: {
				id: String(session.user.id),
				email: session.user.email,
				name: session.user.name,
				role: (session.user as { role?: string | null }).role ?? null,
			},
			session: {
				id: session.session.id,
				expiresAt: session.session.expiresAt,
			},
		};
	},
);

/**
 * Sign out — invalidates the current session server-side and clears
 * the cookie via Better Auth's response handler. Used by the admin
 * dashboard's sign-out form.
 */
export const signOutCurrentSession = createServerFn({ method: 'POST' }).handler(
	async (): Promise<void> => {
		const headers = getRequestHeaders();
		const { auth } = await import('../../cloudflare/auth/better-auth');
		await auth.api.signOut({ headers });
	},
);
