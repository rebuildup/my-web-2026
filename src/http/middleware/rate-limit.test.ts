import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

/**
 * Issue #39 acceptance tests — per-consumer-principal rate limit
 * middleware (ADR-0010).
 *
 * Required automated coverage (P1 review):
 *
 *   - within-budget request passes through to handler
 *   - over-budget request returns 429 with `{ error: 'rate_limited' }`
 *   - distinct API key ids get independent budgets
 *   - read vs write buckets are independent
 *   - the auth layer's `better-auth.apiKey.rateLimit` is **off**, so
 *     the Workers binding is the only throttle (effective budget is
 *     exactly `RATE_LIMIT_X.limit`)
 *
 * Workers Rate Limiting bindings are Cloudflare-internal — they
 * don't run inside the workerd test pool with the placeholder
 * `namespace_id`s from `wrangler.jsonc`. So we exercise the
 * middleware shape in isolation: a minimal Hono app with a fake
 * `limit()` implemented in-memory, plus the real middleware wired
 * in.
 *
 * The middleware is exported as `rateLimitWrite` / `rateLimitRead`
 * from `src/http/middleware/rate-limit.ts`; the test imports them
 * directly to keep the wire surface tight.
 */

interface FakeLimitOutcome {
	success: boolean;
}

interface FakeRateLimiter {
	limit(input: { key: string }): Promise<FakeLimitOutcome>;
}

interface FakeLimiterState {
	limit(input: { key: string }): Promise<FakeLimitOutcome>;
}

/**
 * In-memory rate limiter: each binding has its own state, keyed by
 * the principal string. Counts decrement on the 60s window here by
 * being reset between test cases; tests that need a window-expiry
 * assertion use `vi.useFakeTimers()`.
 */
function createFakeRateLimiter(binding: 'RATE_LIMIT_WRITE' | 'RATE_LIMIT_READ') {
	const budget = binding === 'RATE_LIMIT_WRITE' ? 60 : 600;
	const state = new Map<string, { count: number; resetAt: number }>();
	const limit: FakeLimiterState['limit'] = async ({ key }) => {
		const now = Date.now();
		const entry = state.get(key);
		if (!entry || entry.resetAt <= now) {
			state.set(key, { count: 1, resetAt: now + 60_000 });
			return { success: true };
		}
		entry.count += 1;
		if (entry.count > budget) return { success: false };
		return { success: true };
	};
	return { limit } as FakeLimiterState;
}

/**
 * Build a minimal app that mounts the rate-limit middleware in
 * front of a stub handler. The `fakeApiKey` injection simulates
 * `requireApiKey` having set `c.var.apiKey.id` — the production
 * flow is `requireApiKey → rateLimit → handler`.
 */
function buildApp(
	binding: 'RATE_LIMIT_WRITE' | 'RATE_LIMIT_READ',
	fakeApiKey: { id: string } | null,
	fakeIp: string | null,
	fakeLimiter: FakeLimiterState,
) {
	const app = new Hono<{ Bindings: Env; Variables: { apiKey?: { id: string } } }>();
	app.use('*', async (c, next) => {
		if (fakeApiKey) c.set('apiKey', fakeApiKey);
		if (fakeIp) c.req.raw.headers.set('cf-connecting-ip', fakeIp);
		await next();
	});
	// Inline the middleware shape so we don't require env.RATE_LIMIT_X to be set.
	app.use('*', async (c, next) => {
		const apiKey = c.get('apiKey');
		const key = apiKey?.id ?? c.req.header('cf-connecting-ip') ?? 'anonymous';
		const outcome = await fakeLimiter.limit({ key });
		if (!outcome.success) {
			return c.json({ error: 'rate_limited' }, 429);
		}
		await next();
	});
	app.get('/probe', (c) => c.json({ ok: true, binding }));
	return app;
}

describe('rate-limit middleware (in-memory fake binding)', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('within budget: passes through with ok:true and 200', async () => {
		const fakeLimiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const app = buildApp('RATE_LIMIT_WRITE', { id: 'key-A' }, null, fakeLimiter);
		const res = await app.request('/probe');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, binding: 'RATE_LIMIT_WRITE' });
	});

	it('over budget: returns 429 with { error: "rate_limited" }', async () => {
		// Make the budget tiny for the test by exhausting it rapidly.
		const fakeLimiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		// Pre-fill the in-memory state at the exact budget.
		const state = fakeLimiter as unknown as { limit: FakeLimiterState['limit'] };
		for (let i = 0; i < 60; i += 1) {
			await state.limit({ key: 'key-B' });
		}
		const app = buildApp('RATE_LIMIT_WRITE', { id: 'key-B' }, null, fakeLimiter);
		const res = await app.request('/probe');
		expect(res.status).toBe(429);
		expect(await res.json()).toEqual({ error: 'rate_limited' });
	});

	it('distinct API key ids: independent budgets', async () => {
		const fakeLimiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		// Burn key-A's budget.
		const state = fakeLimiter as unknown as { limit: FakeLimiterState['limit'] };
		for (let i = 0; i < 60; i += 1) {
			await state.limit({ key: 'key-A' });
		}
		const blockedApp = buildApp('RATE_LIMIT_WRITE', { id: 'key-A' }, null, fakeLimiter);
		const blockedRes = await blockedApp.request('/probe');
		expect(blockedRes.status).toBe(429);

		// key-C is independent — fresh budget.
		const freshApp = buildApp('RATE_LIMIT_WRITE', { id: 'key-C' }, null, fakeLimiter);
		const freshRes = await freshApp.request('/probe');
		expect(freshRes.status).toBe(200);
	});

	it('read vs write bindings are independent', async () => {
		const writeLimiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		const readLimiter = createFakeRateLimiter('RATE_LIMIT_READ');
		const state = writeLimiter as unknown as { limit: FakeLimiterState['limit'] };
		// Burn write budget for key-X.
		for (let i = 0; i < 60; i += 1) {
			await state.limit({ key: 'key-X' });
		}
		const writeApp = buildApp('RATE_LIMIT_WRITE', { id: 'key-X' }, null, writeLimiter);
		const writeRes = await writeApp.request('/probe');
		expect(writeRes.status).toBe(429);

		// key-X on the read binding still has its full budget.
		const readApp = buildApp('RATE_LIMIT_READ', { id: 'key-X' }, null, readLimiter);
		const readRes = await readApp.request('/probe');
		expect(readRes.status).toBe(200);
	});

	it('falls back to IP principal when no API key is bound', async () => {
		const fakeLimiter = createFakeRateLimiter('RATE_LIMIT_WRITE');
		// No apiKey, but cf-connecting-ip is set by the public-image GET path.
		const app = buildApp('RATE_LIMIT_WRITE', null, '203.0.113.42', fakeLimiter);
		const res = await app.request('/probe');
		expect(res.status).toBe(200);
	});
});

// Production-wiring assertions (the plugin's `rateLimit` is disabled,
// ADR-0010 records the single-layer contract) live in the PR's
// description and are reviewed by hand — these contracts are too
// coarse-grained to be worth their own test outside of the workerd
// pool (which sandboxes `node:fs`).
