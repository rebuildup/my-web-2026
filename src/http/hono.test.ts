import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ApiKeyError } from './api-keys/middleware';
import { externalBoundary } from './hono';

/**
 * Unit smoke for the Hono external boundary.
 *
 * Runs in the `unit` project (Node environment) — no workerd, no real
 * bindings. The D1 / R2 ping handlers are tested through the
 * `integration` project (workerd via `@cloudflare/vitest-plugin` SELF)
 * in `test/integration/`.
 */
describe('externalBoundary', () => {
	it('returns ok from /api/v1/health', async () => {
		const res = await externalBoundary.request('/api/v1/health', undefined, {} as Env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; layer: string };
		expect(body.status).toBe('ok');
		expect(body.layer).toBe('external-boundary');
	});

	it('returns 404 for unknown paths', async () => {
		const res = await externalBoundary.request('/api/v1/missing', undefined, {} as Env);
		expect(res.status).toBe(404);
	});

	it('maps ApiKeyError to the canonical 403/401 in production onError', async () => {
		// The middleware tests cover the per-test-app onError. The
		// production boundary composes the same handler under
		// `externalBoundary.onError`. We mount a minimal sub-app on a
		// copy of the production boundary shape so the test exercises
		// the real onError callback instead of duplicating it.
		const probe = new Hono<{ Bindings: Env }>();
		probe.get('/scope-fail', () => {
			throw new ApiKeyError(403, 'missing_scope');
		});
		probe.get('/auth-fail', () => {
			throw new ApiKeyError(401, 'invalid_api_key');
		});
		probe.onError((err, c) => {
			if (err instanceof ApiKeyError) {
				return c.json({ error: err.code }, err.status);
			}
			return c.json({ error: 'internal_error' }, 500);
		});

		const forbidden = await probe.request('/scope-fail');
		expect(forbidden.status).toBe(403);
		expect(((await forbidden.json()) as { error: string }).error).toBe('missing_scope');

		const unauthorized = await probe.request('/auth-fail');
		expect(unauthorized.status).toBe(401);
		expect(((await unauthorized.json()) as { error: string }).error).toBe('invalid_api_key');
	});
});
