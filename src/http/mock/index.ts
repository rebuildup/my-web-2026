import { Hono } from 'hono';
import { createMockAccessRouter } from './access';
import { createMockAuthRouter } from './auth';
import { createMockReactionsRouter } from './reactions';

/**
 * Local API mock layer (Issue #166).
 *
 * When the dev server runs with `LOCAL_API_MODE=mock` in `.dev.vars`,
 * the Hono external boundary mounts this sub-app and serves canned
 * responses for a small set of `/api/v1/*` endpoints — see
 * `src/http/hono.ts` for the activation gate.
 *
 * Design-verification-only:
 *   - No D1 / R2 access.
 *   - No API-key middleware, no rate-limit middleware, no CSRF
 *     middleware — the mock exists to render UI against canned data,
 *     not to exercise the production security boundary.
 *   - State is module-level mutable in-memory storage (see
 *     `./fixtures.ts`); resets on dev server restart only.
 *
 * Mounting shape: `createMockApp` returns a Hono app whose routes are
 * already at the production `/api/v1/*` prefixes, so the parent
 * boundary can either route the request into it or fall through to the
 * real handlers (the route-not-matched case in Hono naturally falls
 * through to the next `app.route` call on the parent).
 *
 * @example
 *   if (c.env.LOCAL_API_MODE === 'mock') {
 *     return createMockApp().fetch(c.req.raw, c.env);
 *   }
 */
export function createMockApp(): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();
	app.route('/api/v1/auth', createMockAuthRouter());
	app.route('/api/v1/access', createMockAccessRouter());
	app.route('/api/v1/reactions', createMockReactionsRouter());
	return app;
}
