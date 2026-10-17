import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, RATE_LIMIT_BINDING } from '../../../scripts/_cloudflare-contract.mjs';
import { RATE_LIMIT_RETRY_AFTER_SECONDS, rateLimitRead, rateLimitWrite } from './rate-limit';

/**
 * Rate-limit middleware unit tests (ADR-0010; Issue #456 extended the
 * Retry contract).
 *
 * These mount the **real** middleware (`rateLimitWrite` /
 * `rateLimitRead`) on a minimal Hono app and inject a fake binding
 * through the env argument, so the assertions cover the shipped
 * middleware body — principal selection, budget check, 429 body, and
 * the `Retry-After` header — rather than a copy of it. The binding
 * itself is Cloudflare-internal: the *real* budget is proven by
 * `test/integration/write-rate-limit.test.ts`, which drives the
 * production routers inside the local workerd pool against the
 * Miniflare rate-limit binding declared in `vitest.config.ts`.
 *
 * Required automated coverage:
 *
 *   - within-budget request passes through to handler
 *   - over-budget request returns 429 with `{ error: 'rate_limited' }`
 *     and `Retry-After`
 *   - distinct API key ids get independent budgets
 *   - read vs write buckets are independent
 *   - the IP fallback is used when no API key is bound
 *   - `Retry-After` matches the configured fixed window (no drift)
 */

interface FakeLimitOutcome {
	success: boolean;
}

interface FakeRateLimiter {
	limit(input: { key: string }): Promise<FakeLimitOutcome>;
}

/**
 * In-memory rate limiter with the same budgets the Cloudflare binding
 * is configured with (`RATE_LIMITS` in `scripts/_cloudflare-contract.mjs`).
 * Counts decrement by refilling the window, which is modelled here as a
 * per-key counter — the integration suite covers the real windowing.
 */
function createFakeRateLimiter(
	binding: 'RATE_LIMIT_WRITE' | 'RATE_LIMIT_READ',
): FakeRateLimiter & { calls: string[] } {
	const budget = RATE_LIMITS[binding].limit;
	const state = new Map<string, number>();
	const calls: string[] = [];
	return {
		calls,
		limit: async ({ key }) => {
			calls.push(key);
			const next = (state.get(key) ?? 0) + 1;
			state.set(key, next);
			return { success: next <= budget };
		},
	};
}

/**
 * Minimal app that runs `requireApiKey`-shaped principal injection in
 * front of the real rate-limit middleware. The production flow is
 * `requireApiKey → rateLimit → handler`; the injected `apiKey`
 * simulates the verified key context without standing up Better Auth.
 */
function buildApp(
	middleware: typeof rateLimitWrite,
	binding: 'RATE_LIMIT_WRITE' | 'RATE_LIMIT_READ',
	options: { apiKeyId: string | null; ip: string | null },
	limiter: FakeRateLimiter,
) {
	const app = new Hono<{ Bindings: Env; Variables: { apiKey?: { id: string } } }>();
	app.use('*', async (c, next) => {
		if (options.apiKeyId) c.set('apiKey', { id: options.apiKeyId });
		if (options.ip) c.req.raw.headers.set('cf-connecting-ip', options.ip);
		await next();
	});
	app.use('*', middleware);
	app.get('/probe', (c) => c.json({ ok: true, binding }));
	return app;
}

function fakeEnv(binding: 'RATE_LIMIT_WRITE' | 'RATE_LIMIT_READ', limiter: FakeRateLimiter): Env {
	return { [binding]: limiter } as unknown as Env;
}

describe('rate-limit middleware (in-memory fake binding)', () => {
	it('within budget: passes through with ok:true and 200', async () => {
		const limiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const app = buildApp(
			rateLimitWrite,
			'RATE_LIMIT_WRITE',
			{ apiKeyId: 'key-A', ip: null },
			limiter,
		);
		const res = await app.request('/probe', undefined, fakeEnv('RATE_LIMIT_WRITE', limiter));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, binding: 'RATE_LIMIT_WRITE' });
		// The API key id is the principal — the request IP is not used.
		expect(limiter.calls).toEqual(['key-A']);
	});

	it('over budget: returns 429 with { error: "rate_limited" } and Retry-After', async () => {
		const limiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const app = buildApp(
			rateLimitWrite,
			'RATE_LIMIT_WRITE',
			{ apiKeyId: 'key-B', ip: null },
			limiter,
		);
		const env = fakeEnv('RATE_LIMIT_WRITE', limiter);
		for (let i = 0; i < RATE_LIMITS.RATE_LIMIT_WRITE.limit; i += 1) {
			const ok = await app.request('/probe', undefined, env);
			expect(ok.status).toBe(200);
		}
		const res = await app.request('/probe', undefined, env);
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ error: 'rate_limited' });
		expect(res.headers.get('Retry-After')).toBe(
			String(RATE_LIMIT_RETRY_AFTER_SECONDS.RATE_LIMIT_WRITE),
		);
	});

	it('does not advertise Retry-After on an accepted request', async () => {
		const limiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const app = buildApp(
			rateLimitWrite,
			'RATE_LIMIT_WRITE',
			{ apiKeyId: 'key-C', ip: null },
			limiter,
		);
		const res = await app.request('/probe', undefined, fakeEnv('RATE_LIMIT_WRITE', limiter));
		expect(res.status).toBe(200);
		expect(res.headers.get('Retry-After')).toBeNull();
	});

	it('distinct API key ids: independent budgets', async () => {
		const limiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const env = fakeEnv('RATE_LIMIT_WRITE', limiter);
		const burn = async (keyId: string) => {
			const app = buildApp(
				rateLimitWrite,
				'RATE_LIMIT_WRITE',
				{ apiKeyId: keyId, ip: null },
				limiter,
			);
			for (let i = 0; i < RATE_LIMITS.RATE_LIMIT_WRITE.limit; i += 1) {
				await app.request('/probe', undefined, env);
			}
			return app.request('/probe', undefined, env);
		};
		expect((await burn('key-A')).status).toBe(429);

		// key-D is independent — fresh budget.
		const fresh = buildApp(
			rateLimitWrite,
			'RATE_LIMIT_WRITE',
			{ apiKeyId: 'key-D', ip: null },
			limiter,
		);
		expect((await fresh.request('/probe', undefined, env)).status).toBe(200);
	});

	it('read vs write bindings are independent', async () => {
		const writeLimiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const readLimiter = createFakeRateLimiter('RATE_LIMIT_READ');
		const writeEnv = fakeEnv('RATE_LIMIT_WRITE', writeLimiter);
		const readEnv = fakeEnv('RATE_LIMIT_READ', readLimiter);
		const writeApp = buildApp(
			rateLimitWrite,
			'RATE_LIMIT_WRITE',
			{ apiKeyId: 'key-X', ip: null },
			writeLimiter,
		);
		for (let i = 0; i < RATE_LIMITS.RATE_LIMIT_WRITE.limit; i += 1) {
			await writeApp.request('/probe', undefined, writeEnv);
		}
		expect((await writeApp.request('/probe', undefined, writeEnv)).status).toBe(429);

		// key-X on the read binding still has its full budget.
		const readApp = buildApp(
			rateLimitRead,
			'RATE_LIMIT_READ',
			{ apiKeyId: 'key-X', ip: null },
			readLimiter,
		);
		expect((await readApp.request('/probe', undefined, readEnv)).status).toBe(200);
	});

	it('falls back to IP principal when no API key is bound', async () => {
		const limiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const app = buildApp(
			rateLimitWrite,
			'RATE_LIMIT_WRITE',
			{ apiKeyId: null, ip: '203.0.113.42' },
			limiter,
		);
		const res = await app.request('/probe', undefined, fakeEnv('RATE_LIMIT_WRITE', limiter));
		expect(res.status).toBe(200);
		expect(limiter.calls).toEqual(['203.0.113.42']);
	});

	it('falls back to the anonymous principal when neither key nor IP is present', async () => {
		const limiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const app = buildApp(rateLimitWrite, 'RATE_LIMIT_WRITE', { apiKeyId: null, ip: null }, limiter);
		const res = await app.request('/probe', undefined, fakeEnv('RATE_LIMIT_WRITE', limiter));
		expect(res.status).toBe(200);
		expect(limiter.calls).toEqual(['anonymous']);
	});
});

describe('Retry-After contract', () => {
	// Drift guard: the advertised retry window is the binding's fixed
	// window. If `RATE_LIMITS` in `scripts/_cloudflare-contract.mjs`
	// changes, this fails and the constant moves with it.
	for (const binding of [RATE_LIMIT_BINDING.WRITE, RATE_LIMIT_BINDING.READ] as const) {
		it(`Retry-After for ${binding} matches the configured window`, () => {
			expect(RATE_LIMIT_RETRY_AFTER_SECONDS[binding]).toBe(RATE_LIMITS[binding].period);
		});
	}
});
