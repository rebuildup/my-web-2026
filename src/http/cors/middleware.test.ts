import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { corsMiddleware } from './middleware';

/**
 * Wire-level tests for the CORS middleware (Issue #455).
 *
 * `policy.test.ts` proves the decision; this file proves the rendering:
 * a refusal is a real `403` JSON body, an answered preflight is a real
 * `204` with the headers, and a pass-through keeps the handler's own
 * response. A tiny throwaway app stands in for the routers so a failure
 * points at the middleware rather than at D1.
 */

const CANONICAL = 'https://rebuildup.dev';

function app(env: Record<string, unknown> = {}) {
	const test = new Hono<{ Bindings: Env }>();
	test.use('*', corsMiddleware);
	test.get('/api/v1/health', (c) => c.json({ status: 'ok' }));
	test.post('/api/v1/access/hit', (c) => c.json({ incremented: true }));
	test.put('/api/v1/reactions', (c) => c.json({ created: true }));
	test.post('/api/v1/auth/sign-in/email', (c) => c.json({ ok: true }));
	test.get('/api/v1/reaction-images/abc', (c) => c.body('img', 200));
	test.get('/api/v1/db/ping', (c) => c.json({ status: 'ok' }));
	test.notFound((c) => c.json({ error: 'not_found' }, 404));
	return { test, env: env as unknown as Env };
}

/**
 * The two handler shapes that do NOT go through `c.json()`.
 *
 * `src/http/auth/router.ts` hands `c.req.raw` to Better Auth and
 * returns its `Response` verbatim; `src/http/hono.ts`'s
 * `LOCAL_API_MODE=mock` gate returns `mockApp.fetch(...)`. Both replace
 * `context.res` wholesale, which is the case where a `c.header()` call
 * made *before* `next()` is silently dropped — so they are reproduced
 * here instead of being assumed away.
 */
function rawResponseApp(env: Record<string, unknown> = {}) {
	const authRouter = new Hono<{ Bindings: Env }>();
	authRouter.on(
		['GET', 'POST'],
		'/api/v1/auth/*',
		() =>
			// A `Set-Cookie` the middleware must not drop when it renders the
			// decision onto the finalized response.
			new Response(JSON.stringify({ session: null }), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					'set-cookie': 'better-auth.session_token=x',
				},
			}),
	);

	const mockApp = new Hono<{ Bindings: Env }>();
	mockApp.get('/api/v1/auth/session', (c) => c.json({ user: 'fixture' }));

	const test = new Hono<{ Bindings: Env }>();
	test.use('*', corsMiddleware);
	// The mock gate, in the order `src/http/hono.ts` mounts it.
	test.use('/api/v1/*', async (c, next) => {
		if (c.env.LOCAL_API_MODE === 'mock') {
			const mockResponse = await mockApp.fetch(c.req.raw, c.env);
			if (mockResponse.status !== 404) return mockResponse;
		}
		await next();
	});
	test.route('/', authRouter);
	test.notFound((c) => c.json({ error: 'not_found' }, 404));
	return { test, env: env as unknown as Env };
}

describe('corsMiddleware', () => {
	it('answers an allowed preflight with 204 and the policy headers', async () => {
		// The harness serves on `http://localhost`, so the canonical
		// production origin is allowed here through `env.BETTER_AUTH_URL`
		// — the same knob Better Auth's `trustedOrigins` reads.
		const { test, env } = app({ BETTER_AUTH_URL: CANONICAL });
		const res = await test.request(
			'/api/v1/reactions',
			{
				method: 'OPTIONS',
				headers: {
					Origin: CANONICAL,
					'Access-Control-Request-Method': 'PUT',
					'Access-Control-Request-Headers': 'authorization, content-type',
				},
			},
			env,
		);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe(CANONICAL);
		expect(res.headers.get('access-control-allow-credentials')).toBe('true');
		expect(res.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
		expect(res.headers.get('access-control-allow-methods')).toBe('GET, HEAD, PUT, DELETE');
		expect(res.headers.get('vary')).toContain('Origin');
	});

	it('refuses a foreign-origin preflight on a credentialed route', async () => {
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/reactions',
			{
				method: 'OPTIONS',
				headers: {
					Origin: 'https://evil.example',
					'Access-Control-Request-Method': 'PUT',
				},
			},
			env,
		);
		expect(res.status).toBe(403);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(res.headers.get('access-control-allow-credentials')).toBeNull();
		expect(await res.json()).toEqual({ error: 'cors_origin_rejected', class: 'credentialed' });
	});

	it('refuses the opaque `null` origin on the Better Auth router', async () => {
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/auth/sign-in/email',
			{
				method: 'POST',
				headers: { Origin: 'null', 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: 'a@b.c' }),
			},
			env,
		);
		expect(res.status).toBe(403);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('refuses an actual cross-origin request on a credentialed route', async () => {
		// A `text/plain` POST is a CORS-safelisted request: the browser
		// sends it without a preflight. Refusing here is what stops it
		// from reaching the handler at all.
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/access/hit',
			{
				method: 'POST',
				headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
				body: 'key=home-page',
			},
			env,
		);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'cors_origin_rejected', class: 'credentialed' });
	});

	it('lets an allow-listed origin through to the handler', async () => {
		const { test, env } = app({ BETTER_AUTH_URL: CANONICAL });
		const res = await test.request(
			'/api/v1/access/hit',
			{
				method: 'POST',
				headers: { Origin: CANONICAL, 'Content-Type': 'application/json' },
				body: '{}',
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ incremented: true });
		expect(res.headers.get('access-control-allow-origin')).toBe(CANONICAL);
	});

	it('uses env.BETTER_AUTH_URL as the second allow-list source', async () => {
		const { test, env } = app({ BETTER_AUTH_URL: CANONICAL });
		const preflight = await test.request(
			'/api/v1/auth/sign-in/email',
			{
				method: 'OPTIONS',
				headers: {
					Origin: CANONICAL,
					'Access-Control-Request-Method': 'POST',
					'Access-Control-Request-Headers': 'content-type',
				},
			},
			env,
		);
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get('access-control-allow-origin')).toBe(CANONICAL);

		// Unset env: only the request origin stays allowed.
		const unset = app();
		const refused = await unset.test.request(
			'/api/v1/auth/sign-in/email',
			{
				method: 'OPTIONS',
				headers: { Origin: CANONICAL, 'Access-Control-Request-Method': 'POST' },
			},
			unset.env,
		);
		expect(refused.status).toBe(403);
	});

	it('answers a public-read preflight with the wildcard and no credentials', async () => {
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/reaction-images/abc',
			{
				method: 'OPTIONS',
				headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
			},
			env,
		);
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		expect(res.headers.get('access-control-allow-credentials')).toBeNull();
	});

	it('marks a public-read response with the wildcard on a real GET', async () => {
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/health',
			{
				headers: { Origin: 'https://evil.example' },
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		expect(res.headers.get('access-control-allow-credentials')).toBeNull();
	});

	it('leaves an unclassified path completely untouched', async () => {
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/db/ping',
			{
				headers: { Origin: 'https://evil.example' },
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(res.headers.get('vary')).toBeNull();
	});

	it('leaves OPTIONS on an unclassified path to the notFound handler', async () => {
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/db/ping',
			{
				method: 'OPTIONS',
				headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
			},
			env,
		);
		expect(res.status).toBe(404);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
	});

	it('does not answer an OPTIONS request that is not a preflight', async () => {
		// No `Access-Control-Request-Method` means this is not a browser
		// preflight (curl, a health probe, an old client). The policy
		// stays out of the way and the route's own 404 answer wins.
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/health',
			{
				method: 'OPTIONS',
				headers: { Origin: 'https://evil.example' },
			},
			env,
		);
		expect(res.status).toBe(404);
	});

	it('leaves a request with no Origin header working (SSR self-call, curl)', async () => {
		const { test, env } = app();
		const res = await test.request(
			'/api/v1/reactions',
			{
				method: 'PUT',
				headers: { Authorization: 'Bearer mk_home_test' },
			},
			env,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('access-control-allow-origin')).toBeNull();
		expect(res.headers.get('vary')).toBe('Origin');
	});

	// The regression the middleware ordering caused: with `c.header()`
	// before `next()`, a handler that returns a raw `Response` replaced
	// the context response and the `credentialed` echo never reached the
	// wire, so an allow-listed origin got no CORS header at all on
	// `/api/v1/auth/*`. These three cases pin the wire bytes for the two
	// handler shapes that take that path.
	describe('handlers that return a raw Response', () => {
		it('echoes the allow-listed origin on the Better Auth route', async () => {
			const { test, env } = rawResponseApp({ BETTER_AUTH_URL: CANONICAL });
			const res = await test.request(
				'/api/v1/auth/get-session',
				{ headers: { Origin: CANONICAL } },
				env,
			);
			expect(res.status).toBe(200);
			expect(res.headers.get('access-control-allow-origin')).toBe(CANONICAL);
			expect(res.headers.get('access-control-allow-credentials')).toBe('true');
			expect(res.headers.get('vary')).toBe('Origin');
			// Still a credentialed echo: never the wildcard.
			expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
			// Preflight-only headers stay off an actual response.
			expect(res.headers.get('access-control-allow-methods')).toBeNull();
			expect(res.headers.get('access-control-max-age')).toBeNull();
		});

		it('keeps the handler response body and cookies intact', async () => {
			const { test, env } = rawResponseApp({ BETTER_AUTH_URL: CANONICAL });
			const res = await test.request(
				'/api/v1/auth/sign-in/email',
				{
					method: 'POST',
					headers: { Origin: CANONICAL, 'Content-Type': 'application/json' },
					body: '{}',
				},
				env,
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ session: null });
			expect(res.headers.get('set-cookie')).toBe('better-auth.session_token=x');
			expect(res.headers.get('access-control-allow-credentials')).toBe('true');
		});

		it('refuses a foreign origin on the same route', async () => {
			const { test, env } = rawResponseApp({ BETTER_AUTH_URL: CANONICAL });
			const res = await test.request(
				'/api/v1/auth/get-session',
				{ headers: { Origin: 'https://evil.example' } },
				env,
			);
			expect(res.status).toBe(403);
			expect(res.headers.get('access-control-allow-origin')).toBeNull();
			expect(res.headers.get('access-control-allow-credentials')).toBeNull();
		});

		it('gives the LOCAL_API_MODE=mock gate the same CORS surface', async () => {
			const mock = rawResponseApp({ BETTER_AUTH_URL: CANONICAL, LOCAL_API_MODE: 'mock' });
			const res = await mock.test.request(
				'/api/v1/auth/session',
				{ headers: { Origin: CANONICAL } },
				mock.env,
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ user: 'fixture' });
			expect(res.headers.get('access-control-allow-origin')).toBe(CANONICAL);
			expect(res.headers.get('access-control-allow-credentials')).toBe('true');

			const refused = await mock.test.request(
				'/api/v1/auth/session',
				{ headers: { Origin: 'https://evil.example' } },
				mock.env,
			);
			expect(refused.status).toBe(403);
			expect(refused.headers.get('access-control-allow-origin')).toBeNull();
		});
	});
});
