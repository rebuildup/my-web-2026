import { Hono } from 'hono';
import { auth } from '../../cloudflare/auth/better-auth';
import { redirectTargetGuard } from '../security/redirect-guard';

/**
 * Better Auth handler mounted at `/api/v1/auth/*`.
 *
 * Better Auth's `auth.handler` is a standard Web `Request -> Response`
 * function. Hono forwards via `c.req.raw` and writes the response
 * directly back so that Better Auth controls cookies, status codes,
 * and redirects end-to-end.
 *
 * Sign-up is disabled in the auth config (`emailAndPassword.disableSignUp`).
 * The invitation accept flow at `/admin/invitations/accept` is a
 * TanStack Start server function that calls `auth.api.createUser`
 * through the admin plugin — it does not need this router.
 *
 * Mounted from `src/http/hono.ts` under the existing
 * `/api/v1/*` prefix. Internal request-id and rate-limit middleware
 * (Ticket C) compose around this router.
 */
export const authRouter = new Hono<{ Bindings: Env }>();

/**
 * Open-redirect guard (Issue #454) — mounted in front of the Better
 * Auth handler, not inside it.
 *
 * Better Auth already validates `callbackURL` / `redirectTo` /
 * `errorCallbackURL` / `newUserCallbackURL` against `trustedOrigins`,
 * but that list is derived from the `BETTER_AUTH_URL` binding
 * (`src/cloudflare/auth/better-auth.ts`). If that binding is absent —
 * a mis-provisioned deploy, or any environment that forgets to set it
 * — the effective trust decision stops being project-owned. The guard
 * below reads the same binding, resolves the request's redirect
 * targets to internal paths, and refuses the request with
 * `400 invalid_redirect_target` before any handler sees it.
 *
 * `trustedOrigins` is resolved per request from `c.env` so it follows
 * the deployed binding rather than a module-load snapshot; the cast is
 * the same documented escape hatch `better-auth.ts` uses, because the
 * top-level `vars` block deliberately omits `BETTER_AUTH_URL` (see
 * ADR-0014).
 */
authRouter.use(
	'/api/v1/auth/*',
	redirectTargetGuard({
		trustedOrigins: (c) => {
			const url = (c.env as unknown as { BETTER_AUTH_URL?: string }).BETTER_AUTH_URL;
			return url ? [url] : [];
		},
	}),
);

authRouter.on(['GET', 'POST'], '/api/v1/auth/*', (c) => auth.handler(c.req.raw));
