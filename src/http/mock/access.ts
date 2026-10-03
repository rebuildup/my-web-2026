import { Hono } from 'hono';
import { bumpMockAccessCount, getMockAccessCount, getMockAccessPrincipalCount } from './fixtures';

/**
 * Mock access-counter router (Issue #166 — design-verification only).
 *
 * Endpoints (mounted under `/api/v1/access/*` by `createMockApp`):
 *   - GET  /api/v1/access/count            — returns `{ count: <N> }`
 *                                            with N starting at 1234.
 *   - POST /api/v1/access/hit              — increments the in-memory
 *                                            counter and returns the
 *                                            post-increment value.
 *   - GET  /api/v1/access/principal        — returns `{ count: 1 }`
 *                                            (KPI tile preview).
 *
 * Design-verification-only — no D1, no dedup window, no API-key
 * middleware, no rate limit. The activation gate is
 * `env.LOCAL_API_MODE === 'mock'` in `src/http/hono.ts`; when the env
 * is unset, this router is never mounted.
 */

export function createMockAccessRouter(): Hono<{ Bindings: Env }> {
	const router = new Hono<{ Bindings: Env }>();

	router.get('/count', (c) =>
		c.json({
			count: getMockAccessCount(),
		}),
	);

	router.post('/hit', async (c) => {
		// Designer convenience: allow `?delta=N` (default 1) so the
		// visual can be exercised both upward and (rarely) downward
		// without reaching for the dev console.
		const deltaRaw = c.req.query('delta');
		const parsed = deltaRaw ? Number.parseInt(deltaRaw, 10) : 1;
		const delta = Number.isFinite(parsed) ? parsed : 1;
		await c.req.json().catch(() => null);
		const count = bumpMockAccessCount(delta);
		return c.json({
			incremented: delta > 0,
			count,
			first_hit: 1_700_000_000_000,
			last_hit: 1_700_000_000_000,
		});
	});

	router.get('/principal', (c) =>
		c.json({
			count: getMockAccessPrincipalCount(),
		}),
	);

	return router;
}
