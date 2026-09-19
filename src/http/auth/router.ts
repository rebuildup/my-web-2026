import { Hono } from 'hono';
import { auth } from '../../cloudflare/auth/better-auth';

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

authRouter.on(['GET', 'POST'], '/api/v1/auth/*', (c) => auth.handler(c.req.raw));
