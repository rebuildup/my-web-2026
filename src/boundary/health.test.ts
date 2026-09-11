import { describe, it, expect } from 'vitest';
import { externalBoundary } from './index';

/**
 * Smoke test for the external HTTP boundary. Uses a minimal fake `Env` to
 * exercise the Hono routing without touching real Cloudflare bindings.
 */
describe('externalBoundary', () => {
	it('returns ok from /api/v1/health', async () => {
		const res = await externalBoundary.request(
			'/api/v1/health',
			{
				method: 'GET',
			},
			{
				ASSETS: {} as Fetcher,
			} as unknown as Env,
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; layer: string };
		expect(body.status).toBe('ok');
		expect(body.layer).toBe('external-boundary');
	});

	it('returns 404 for unknown paths', async () => {
		const res = await externalBoundary.request(
			'/api/v1/missing',
			{
				method: 'GET',
			},
			{
				ASSETS: {} as Fetcher,
			} as unknown as Env,
		);

		expect(res.status).toBe(404);
	});
});
