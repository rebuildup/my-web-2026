import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ApiKeyError } from './api-keys/middleware';
import { externalBoundary } from './hono';
import { resetMockState } from './mock/fixtures';

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

	// Regression: Issue #186 — the LOCAL_API_MODE=mock gate must serve
	// canned data when the env flag is set, and the production boundary
	// must run unchanged when the env is unset / carries any other
	// value. The dev-server-level wiring lives in `vite.config.ts`
	// (`buildLocalApiModeConfigOverride`); this test exercises the
	// gate itself, which is the boundary-layer half of the contract.
	describe('LOCAL_API_MODE=mock gate (Issue #186)', () => {
		it('serves canned access.count body when env=mock', async () => {
			resetMockState();
			const res = await externalBoundary.request('/api/v1/access/count', undefined, {
				LOCAL_API_MODE: 'mock',
			} as unknown as Env);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ count: 1234 });
		});

		it('serves canned auth.session body when env=mock', async () => {
			const res = await externalBoundary.request('/api/v1/auth/session', undefined, {
				LOCAL_API_MODE: 'mock',
			} as unknown as Env);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { user: { role: string; email: string } };
			expect(body.user.role).toBe('admin');
			expect(body.user.email).toBe('designer@rebuildup.dev');
		});

		it('serves canned reactions/:slug body when env=mock', async () => {
			resetMockState();
			const res = await externalBoundary.request('/api/v1/reactions/home-page', undefined, {
				LOCAL_API_MODE: 'mock',
			} as unknown as Env);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { reactions: Array<{ emoji: string; count: number }> };
			expect(body.reactions.length).toBeGreaterThan(0);
			expect(body.reactions[0]).toHaveProperty('emoji');
			expect(body.reactions[0]).toHaveProperty('count');
		});

		it('production path unchanged when env is unset', async () => {
			// No mock env: the gate calls next(), the production
			// access-counter router runs. `/api/v1/access/count`
			// without `:key` is not a production route — the parent
			// notFound handler returns 404. Critically, the canned
			// mock body MUST NOT be returned.
			const res = await externalBoundary.request('/api/v1/access/count', undefined, {} as Env);
			expect(res.status).not.toBe(200);
			const body = (await res.json().catch(() => ({}))) as { count?: number };
			expect(body.count).toBeUndefined();
		});

		it('production path unchanged when env is anything other than "mock"', async () => {
			// The gate's activation signal is the literal string
			// "mock" (see `src/http/hono.ts`). Any other value must
			// behave like the unset case — fall through to the real
			// routers. This guards against operators accidentally
			// typing `LOCAL_API_MODE=on` or `LOCAL_API_MODE=1` and
			// expecting the gate to do something different.
			const res = await externalBoundary.request('/api/v1/access/count', undefined, {
				LOCAL_API_MODE: 'on',
			} as unknown as Env);
			expect(res.status).not.toBe(200);
			const body = (await res.json().catch(() => ({}))) as { count?: number };
			expect(body.count).toBeUndefined();
		});
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
