import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
	AUTH_REQUEST_HEADERS,
	PRIVATE_NO_STORE,
	isExplicitlySharedCacheable,
	mergeVary,
	sharedCacheIsolation,
} from './cache-policy';

/**
 * Shared-cache isolation policy (Issue #460) — unit contract.
 *
 * The end-to-end proof that two auth contexts cannot share a cached
 * body lives in `test/integration/cache-isolation.test.ts`. This file
 * pins the decision functions themselves, because the end-to-end test
 * can only observe the cases it happens to exercise: a policy that
 * silently stopped parsing `s-maxage`, or that started duplicating an
 * existing `Vary` value on every request, would not show up there.
 */

describe('isExplicitlySharedCacheable (Issue #460)', () => {
	it('accepts only an explicit public + positive freshness opt-in', () => {
		expect(isExplicitlySharedCacheable('public, max-age=31536000, immutable')).toBe(true);
		expect(isExplicitlySharedCacheable('public, s-maxage=600')).toBe(true);
		expect(isExplicitlySharedCacheable('PUBLIC; MAX-AGE=60, S-MAXAGE=60')).toBe(true);
	});

	it('denies everything a shared cache must not hold', () => {
		// No header at all — the state every `/api/v1/*` response was
		// in before Issue #460.
		expect(isExplicitlySharedCacheable(null)).toBe(false);
		expect(isExplicitlySharedCacheable('')).toBe(false);
		// Freshness without `public` is a browser-cache statement.
		expect(isExplicitlySharedCacheable('max-age=60')).toBe(false);
		// Zero lifetime means "revalidate / do not serve", not "share".
		expect(isExplicitlySharedCacheable('public, max-age=0')).toBe(false);
		expect(isExplicitlySharedCacheable('public, s-maxage=0, max-age=600')).toBe(false);
		// Explicit isolation wins over any other directive.
		expect(isExplicitlySharedCacheable('private, no-store')).toBe(false);
		expect(isExplicitlySharedCacheable('public, private, max-age=600')).toBe(false);
		expect(isExplicitlySharedCacheable('public, max-age=600, no-store')).toBe(false);
		expect(isExplicitlySharedCacheable('public, no-cache')).toBe(false);
	});
});

describe('mergeVary (Issue #460)', () => {
	it('adds both auth-context headers when none are present', () => {
		expect(mergeVary(null)).toBe('Cookie, Authorization');
		expect(mergeVary('')).toBe('Cookie, Authorization');
	});

	it('preserves existing fields and their order, without duplicates', () => {
		expect(mergeVary('Accept-Encoding')).toBe('Accept-Encoding, Cookie, Authorization');
		expect(mergeVary('cookie')).toBe('cookie, Authorization');
		expect(mergeVary('Cookie, Authorization')).toBe('Cookie, Authorization');
		expect(mergeVary('Origin, cookie, Accept')).toBe('Origin, cookie, Accept, Authorization');
	});

	it('leaves the wildcard alone', () => {
		expect(mergeVary('*')).toBe('*');
	});

	it('accepts an explicit addition list', () => {
		expect(mergeVary('Accept', ['Cookie'])).toBe('Accept, Cookie');
		expect(AUTH_REQUEST_HEADERS).toEqual(['Cookie', 'Authorization']);
	});
});

/**
 * The middleware behaviour, driven through a miniature boundary that
 * mirrors the shapes the real `/api/v1/*` boundary produces.
 */
function probeApp(): Hono<{ Bindings: Env }> {
	const app = new Hono<{ Bindings: Env }>();
	app.use('/api/v1/*', sharedCacheIsolation);

	app.get('/api/v1/json', (c) => c.json({ ok: true }));

	// The one genuinely public payload on the boundary:
	// content-addressed, immutable reaction images.
	app.get('/api/v1/public-image', (c) => {
		c.header('Cache-Control', 'public, max-age=31536000, immutable');
		return c.body('bytes', 200);
	});

	// A handler that already decided isolation itself (Better Auth does
	// exactly this on session responses).
	app.get('/api/v1/session', (c) => {
		c.header('Cache-Control', 'no-store');
		return c.json({ user: null });
	});

	// A handler that speaks for the Vary field it already varies on.
	app.get('/api/v1/varying', (c) => {
		c.header('Vary', 'Accept-Encoding');
		return c.json({ ok: true });
	});

	// Sealed headers — `Response.redirect()` installs an immutable
	// guard, so the header write throws.
	app.get('/api/v1/redirect', () => Response.redirect('https://example.com/api/v1/login', 307));

	return app;
}

describe('sharedCacheIsolation middleware (Issue #460)', () => {
	const app = probeApp();

	it('isolates a response that carries no policy of its own', async () => {
		const res = await app.request('/api/v1/json');
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe(PRIVATE_NO_STORE);
		expect(res.headers.get('vary')).toBe('Cookie, Authorization');
	});

	it('leaves an explicit public opt-in completely untouched', async () => {
		const res = await app.request('/api/v1/public-image');
		// Not even `Vary`: fragmenting a public immutable asset per
		// cookie would cost cache hits and change nothing.
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(res.headers.get('vary')).toBeNull();
	});

	it('strengthens a handler-declared no-store and adds Vary', async () => {
		const res = await app.request('/api/v1/session');
		// `private, no-store` keeps `no-store`, so the handler's policy
		// is preserved and only tightened.
		expect(res.headers.get('cache-control')).toBe(PRIVATE_NO_STORE);
		expect(res.headers.get('vary')).toBe('Cookie, Authorization');
	});

	it('merges into an existing Vary instead of replacing it', async () => {
		const res = await app.request('/api/v1/varying');
		expect(res.headers.get('vary')).toBe('Accept-Encoding, Cookie, Authorization');
	});

	it('never lets a sealed response turn into a 500', async () => {
		const res = await app.request('/api/v1/redirect');
		// The response survives untouched; the policy simply could not
		// be attached. Documented availability-over-hygiene trade.
		expect(res.status).toBe(307);
		expect(res.headers.get('location')).toBe('https://example.com/api/v1/login');
	});
});
