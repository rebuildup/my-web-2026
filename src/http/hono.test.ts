import { describe, it, expect } from 'vitest';
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
});
