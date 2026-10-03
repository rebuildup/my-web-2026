import { Hono } from 'hono';
import { FIXTURE_SESSION } from './fixtures';

/**
 * Mock auth router (Issue #166 — design-verification only).
 *
 * Endpoints (mounted under `/api/v1/auth/*` by `createMockApp`):
 *   - GET  /api/v1/auth/session          — returns the canned session
 *                                          (or `null` to exercise the
 *                                          signed-out branch).
 *   - POST /api/v1/auth/sign-in/email    — accepts any email/password
 *                                          and returns the canned session.
 *   - POST /api/v1/auth/sign-out         — returns 200 with a stub
 *                                          cookie-clearing payload.
 *
 * Design-verification-only — no Better Auth, no D1, no real session
 * storage. The activation gate is `env.LOCAL_API_MODE === 'mock'` in
 * `src/http/hono.ts`; when the env is unset, this router is never
 * mounted and production auth takes over.
 */

export function createMockAuthRouter(): Hono<{ Bindings: Env }> {
	const router = new Hono<{ Bindings: Env }>();

	// Match `null` query param so designers can preview the signed-out
	// branch without code edits: `?as=null`.
	router.get('/session', (c) => {
		const asParam = c.req.query('as');
		if (asParam === 'null') return c.json(null);
		return c.json(FIXTURE_SESSION);
	});

	router.post('/sign-in/email', async (c) => {
		// Accept any body — designers should not need to type a real
		// password to render the post-sign-in screen. Echoing nothing
		// would be more "honest"; we surface the session body so the
		// UI loader can pick it up directly.
		await c.req.json().catch(() => null);
		return c.json(FIXTURE_SESSION);
	});

	router.post('/sign-out', (c) =>
		c.json({
			success: true,
		}),
	);

	return router;
}
