import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockApp } from './index';
import { resetMockState } from './fixtures';

/**
 * Acceptance tests for the LOCAL_API_MODE=mock design-verification
 * layer (Issue #166).
 *
 * Each sub-router is exercised via `app.request()` against a fresh
 * Hono app built from `createMockApp()`. The `Bindings: Env` type is
 * satisfied with a minimal stub; the mock layer never reads D1 / R2 /
 * rate-limit bindings.
 *
 * Coverage:
 *   - auth.session (signed-in / signed-out branches)
 *   - auth.sign-in/email
 *   - auth.sign-out
 *   - access.count
 *   - access.hit (delta=1 increments; explicit delta also exercised)
 *   - access.principal
 *   - reactions/:slug (known slug returns canned reactions; unknown
 *     slug returns an empty array; malformed slug returns 400)
 *   - reactions/:slug/toggle (bump count; remove decrement; bad body
 *     surfaces as 400; unknown slug starts from empty)
 */

function buildApp() {
	const app = new Hono<{ Bindings: Env }>();
	app.route('/', createMockApp());
	return app;
}

describe('mock layer — auth', () => {
	beforeEach(() => resetMockState());
	const app = buildApp();

	it('GET /api/v1/auth/session returns the canned session', async () => {
		const res = await app.request('/api/v1/auth/session');
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			user: { id: string; email: string; name: string; role: string };
			session: { id: string; expiresAt: string };
		};
		expect(body.user.role).toBe('admin');
		expect(body.user.email).toBe('designer@rebuildup.dev');
		expect(body.session.id).toBeTruthy();
		expect(body.session.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('GET /api/v1/auth/session?as=null returns null (signed-out branch)', async () => {
		const res = await app.request('/api/v1/auth/session?as=null');
		expect(res.status).toBe(200);
		expect(await res.json()).toBeNull();
	});

	it('POST /api/v1/auth/sign-in/email accepts any body and returns session', async () => {
		const res = await app.request('/api/v1/auth/sign-in/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email: 'any@example.com', password: 'irrelevant' }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { user: { email: string } };
		expect(body.user.email).toBe('designer@rebuildup.dev');
	});

	it('POST /api/v1/auth/sign-out returns 200 with success:true', async () => {
		const res = await app.request('/api/v1/auth/sign-out', { method: 'POST' });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { success: boolean };
		expect(body.success).toBe(true);
	});
});

describe('mock layer — access counter', () => {
	beforeEach(() => resetMockState());
	const app = buildApp();

	it('GET /api/v1/access/count returns { count: 1234 } initially', async () => {
		const res = await app.request('/api/v1/access/count');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ count: 1234 });
	});

	it('POST /api/v1/access/hit increments the in-memory counter', async () => {
		const r1 = await app.request('/api/v1/access/hit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key: 'home-page', session_id: 's1' }),
		});
		expect(r1.status).toBe(200);
		const b1 = (await r1.json()) as { count: number; incremented: boolean };
		expect(b1.count).toBe(1235);
		expect(b1.incremented).toBe(true);

		const r2 = await app.request('/api/v1/access/count');
		expect(((await r2.json()) as { count: number }).count).toBe(1235);
	});

	it('POST /api/v1/access/hit?delta=N applies an explicit delta', async () => {
		const res = await app.request('/api/v1/access/hit?delta=10', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { count: number; incremented: boolean };
		expect(body.count).toBe(1244);
		expect(body.incremented).toBe(true);
	});

	it('GET /api/v1/access/principal returns { count: 1 }', async () => {
		const res = await app.request('/api/v1/access/principal');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ count: 1 });
	});
});

describe('mock layer — reactions', () => {
	beforeEach(() => resetMockState());
	const app = buildApp();

	it('GET /api/v1/reactions/home-page returns the canned reactions', async () => {
		const res = await app.request('/api/v1/reactions/home-page');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { reactions: Array<{ emoji: string; count: number }> };
		expect(body.reactions.length).toBeGreaterThan(0);
		expect(body.reactions[0]).toHaveProperty('emoji');
		expect(body.reactions[0]).toHaveProperty('count');
	});

	it('GET /api/v1/reactions/unknown-slug returns an empty array', async () => {
		const res = await app.request('/api/v1/reactions/unknown-slug');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { reactions: unknown[] };
		expect(body.reactions).toEqual([]);
	});

	it('GET /api/v1/reactions/<malformed> returns 400', async () => {
		const res = await app.request('/api/v1/reactions/has spaces');
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe('invalid_slug');
	});

	it('POST /api/v1/reactions/home-page/toggle bumps an existing emoji count', async () => {
		const res = await app.request('/api/v1/reactions/home-page/toggle', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ emoji: '👍', direction: 'add' }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { reactions: Array<{ emoji: string; count: number }> };
		const thumbsUp = body.reactions.find((r) => r.emoji === '👍');
		expect(thumbsUp?.count).toBe(13);
	});

	it('POST .../toggle with direction=remove decrements an existing emoji', async () => {
		const res = await app.request('/api/v1/reactions/home-page/toggle', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ emoji: '👍', direction: 'remove' }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { reactions: Array<{ emoji: string; count: number }> };
		const thumbsUp = body.reactions.find((r) => r.emoji === '👍');
		expect(thumbsUp?.count).toBe(11);
	});

	it('POST .../toggle with invalid body returns 400', async () => {
		const res = await app.request('/api/v1/reactions/home-page/toggle', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe('invalid_body');
	});

	it('POST .../toggle on an unknown slug starts from empty and adds the emoji', async () => {
		const res = await app.request('/api/v1/reactions/new-slug/toggle', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ emoji: '🚀', direction: 'add' }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { reactions: Array<{ emoji: string; count: number }> };
		expect(body.reactions).toEqual([{ emoji: '🚀', count: 1 }]);
	});
});

describe('mock layer — externalBoundary gate', () => {
	beforeEach(() => resetMockState());

	/**
	 * The gate lives in `src/http/hono.ts`; we build a tiny clone
	 * of the gate here so the test exercises the conditional without
	 * having to spin up the entire external boundary. The shape of
	 * the gate (and the fall-through on 404) is what we care about.
	 */
	function buildGateApp() {
		const app = new Hono<{ Bindings: Env }>();
		const mockApp = createMockApp();
		// Real-handler stub at a path the mock does NOT cover, so we
		// can assert the gate routes to it when mock returns 404.
		app.get('/api/v1/portfolio/list', (c) => c.json({ source: 'real' }));
		app.use('/api/v1/*', async (c, next) => {
			if (c.env.LOCAL_API_MODE === 'mock') {
				const mockResponse = await mockApp.fetch(c.req.raw, c.env);
				if (mockResponse.status !== 404) return mockResponse;
			}
			await next();
		});
		return app;
	}

	it('routes to mock when LOCAL_API_MODE=mock and the mock has the route', async () => {
		const app = buildGateApp();
		const res = await app.request('/api/v1/auth/session', undefined, {
			LOCAL_API_MODE: 'mock',
		} as unknown as Env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { user: { role: string } };
		expect(body.user.role).toBe('admin');
	});

	it('falls through to real handler when mock returns 404', async () => {
		const app = buildGateApp();
		const res = await app.request('/api/v1/portfolio/list', undefined, {
			LOCAL_API_MODE: 'mock',
		} as unknown as Env);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { source: string };
		expect(body.source).toBe('real');
	});

	it('skips the mock entirely when env is unset', async () => {
		const app = buildGateApp();
		const res = await app.request('/api/v1/auth/session', undefined, {} as Env);
		// The gate calls next() (env unset), no real handler at this
		// path, parent default 404 — the mock did NOT serve.
		expect(res.status).toBe(404);
	});
});
