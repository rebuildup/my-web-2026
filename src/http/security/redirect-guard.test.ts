import { SELF } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { redirectTargetGuard } from './redirect-guard';

/**
 * Acceptance tests for the open-redirect guard (Issue #454) as it is
 * actually wired, not as a unit.
 *
 * Two levels on purpose:
 *
 * 1. `SELF.fetch` against `/api/v1/auth/*` — the real Worker entry →
 *    `externalBoundary` → `authRouter` → guard → Better Auth. This is
 *    the proof that the guard is *mounted in front of* the handler and
 *    that it refuses the request before Better Auth runs.
 * 2. A bare Hono app carrying the same middleware — content-type and
 *    streaming behaviour that is awkward to reach through the auth
 *    surface (multipart, oversized bodies, unread streams).
 *
 * No DB fixtures: every refused request is refused before any query,
 * and the "still passes" cases assert the *absence* of the guard's own
 * 400 rather than a successful sign-in.
 *
 * The workerd pool deliberately leaves `BETTER_AUTH_URL` unbound (see
 * the note in `vitest.config.ts`), which is exactly the fail-closed
 * case worth pinning: with no trusted origin, an absolute redirect URL
 * is refused instead of being waved through.
 */

const ORIGIN = 'https://example.com';

async function postJson(body: unknown): Promise<Response> {
	return SELF.fetch(`${ORIGIN}/api/v1/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function postForm(fields: Record<string, string>): Promise<Response> {
	return SELF.fetch(`${ORIGIN}/api/v1/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields).toString(),
	});
}

interface GuardBody {
	error?: string;
	param?: string;
	reason?: string;
	source?: string;
}

async function expectRefused(res: Response, reason: string, param = 'callbackURL') {
	expect(res.status).toBe(400);
	const body = (await res.json()) as GuardBody;
	expect(body.error).toBe('invalid_redirect_target');
	expect(body.param).toBe(param);
	expect(body.reason).toBe(reason);
	expect(body.source).toBeDefined();
	// The guard sits inside the composed boundary, so the correlation
	// header assigned upstream is still on the response.
	expect(res.headers.get('x-request-id')).toBeTruthy();
	// The refused value is never reflected back — the body is safe to
	// log and cannot be used as a reflector.
	expect(JSON.stringify(body)).not.toContain('evil.example');
}

describe('redirect guard — refused targets never reach Better Auth', () => {
	it.each([
		['https://evil.example/', 'external_origin'],
		['http://evil.example/admin', 'external_origin'],
		['//evil.example/admin', 'protocol_relative'],
		['/%5Cevil.example', 'backslash'],
		['javascript:alert(1)', 'scheme_not_allowed'],
		['data:text/html,<script>alert(1)</script>', 'scheme_not_allowed'],
		['%2F%2Fevil.example', 'protocol_relative'],
		['%252F%252Fevil.example', 'protocol_relative'],
		['admin/keys', 'missing_leading_slash'],
	])('refuses a JSON body callbackURL %j (%s)', async (callbackURL, reason) => {
		await expectRefused(
			await postJson({ email: 'admin@test.local', password: 'x', callbackURL }),
			reason,
		);
	});

	it('refuses the same shapes in a urlencoded body (the login form encoding)', async () => {
		await expectRefused(
			await postForm({
				email: 'admin@test.local',
				password: 'x',
				callbackURL: 'https://evil.example',
			}),
			'external_origin',
		);
	});

	it('refuses every redirect-shaped body field, not just callbackURL', async () => {
		await expectRefused(
			await postJson({ email: 'a@b.test', password: 'x', returnTo: '//evil.example' }),
			'protocol_relative',
			'returnTo',
		);
		await expectRefused(
			await postJson({ email: 'a@b.test', password: 'x', redirectTo: '//evil.example' }),
			'protocol_relative',
			'redirectTo',
		);
		await expectRefused(
			await postJson({ email: 'a@b.test', password: 'x', next: '//evil.example' }),
			'protocol_relative',
			'next',
		);
	});

	it('refuses a hostile redirect target in the query string', async () => {
		// The GET path is where phishing links live; Better Auth skips
		// its own body-level origin check for GET requests.
		const res = await SELF.fetch(
			`${ORIGIN}/api/v1/auth/get-session?callbackURL=https://evil.example`,
		);
		await expectRefused(res, 'external_origin');
	});

	it('refuses when only a repeated parameter carries the hostile value', async () => {
		const res = await SELF.fetch(
			`${ORIGIN}/api/v1/auth/get-session?returnTo=%2Fadmin&returnTo=%2F%2Fevil.example`,
		);
		await expectRefused(res, 'protocol_relative', 'returnTo');
	});

	it('fails closed when BETTER_AUTH_URL is unbound (the test pool leaves it unset)', async () => {
		// Same-origin in the request, yet refused: the trusted list is
		// project-owned, so a missing binding narrows the allow-list
		// instead of inferring trust from the request.
		await expectRefused(
			await postJson({ email: 'a@b.test', password: 'x', callbackURL: `${ORIGIN}/admin` }),
			'external_origin',
		);
	});
});

describe('redirect guard — legitimate traffic is untouched', () => {
	it('passes a relative callbackURL through to Better Auth (401, not 400)', async () => {
		// The credentials are wrong on purpose: reaching Better Auth's
		// own 401 proves the guard both allowed the request AND left
		// the body readable (a middleware that consumed the body would
		// fail this assertion differently).
		const res = await postJson({
			email: 'nobody@test.local',
			password: 'wrong-password',
			callbackURL: '/admin/keys',
		});
		expect(res.status).toBe(401);
		expect(((await res.json()) as { code?: string }).code).not.toBe('INVALID_CALLBACK_URL');
	});

	it('passes the form-encoded sign-in the login screen actually submits', async () => {
		const res = await postForm({
			email: 'nobody@test.local',
			password: 'wrong-password',
			callbackURL: '/admin',
		});
		expect(res.status).toBe(401);
	});

	it('leaves a request without any redirect target alone', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/get-session`);
		expect(res.status).toBe(200);
		// Better Auth answers an unauthenticated session probe with a
		// literal `null` body.
		expect(await res.json()).toBeNull();
	});

	it('leaves the public health endpoint alone', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/v1/health`);
		expect(res.status).toBe(200);
	});
});

describe('redirect guard — middleware behaviour independent of the auth surface', () => {
	function app(options: Parameters<typeof redirectTargetGuard>[0] = {}) {
		const guarded = new Hono<{ Bindings: Env }>();
		guarded.use('/echo/*', redirectTargetGuard(options));
		guarded.all('/echo/*', (c) => c.json({ ok: true, body: c.req.header('content-type') }));
		return guarded;
	}

	/** Same guard, but the handler actually reads the body — proves the
	 *  guard's `clone()` read leaves the original stream intact. */
	function echoBodyApp() {
		const guarded = new Hono<{ Bindings: Env }>();
		guarded.use('/echo/*', redirectTargetGuard());
		guarded.all('/echo/*', async (c) => c.json({ length: (await c.req.text()).length }));
		return guarded;
	}

	it('downgrades a trusted absolute URL to an internal path instead of refusing it', async () => {
		const res = await app({ trustedOrigins: ['https://rebuildup.dev'] }).request(
			'https://rebuildup.dev/echo?callbackURL=https%3A%2F%2Frebuildup.dev%2Fadmin%2Fkeys',
		);
		expect(res.status).toBe(200);
	});

	it('does not read a body whose content type carries no redirect field', async () => {
		// multipart and unknown types are not parsed; a refusal would
		// mean the guard guessed at an encoding the project never uses.
		for (const contentType of [
			'multipart/form-data; boundary=x',
			'application/xml',
			'text/plain',
		]) {
			const res = await app().request('https://rebuildup.dev/echo/x', {
				method: 'POST',
				headers: { 'Content-Type': contentType },
				body: 'callbackURL=https://evil.example',
			});
			expect(res.status).toBe(200);
		}
	});

	it('does not buffer an oversized body', async () => {
		const padding = new Array(20_000).fill('a').join('');
		const body = `{"callbackURL":"${padding}"}`;
		const res = await app().request('https://rebuildup.dev/echo/x', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': String(body.length),
			},
			body,
		});
		// The endpoint that owns the body reports the oversize; the
		// guard stays out of the way rather than buffering it.
		expect(res.status).toBe(200);
	});

	it('stops at the scan budget on a body that declares no length, and the handler still reads it', async () => {
		// Chunked: no `Content-Length`, so the cap has to hold during the
		// read itself. The handler reading the whole body afterwards is
		// the proof that the guard's `clone()` did not consume it.
		const body = `{"callbackURL":"${'a'.repeat(20_000)}","email":"demo@example.test"}`;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode(body));
				controller.close();
			},
		});
		const res = await echoBodyApp().request('https://rebuildup.dev/echo/x', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: stream,
			// @ts-expect-error undici requires `duplex` for a stream body.
			duplex: 'half',
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { length: number }).length).toBe(body.length);
	});

	it('enforces allowedPrefixes when the surface scopes its targets', async () => {
		const scoped = app({ allowedPrefixes: ['/admin'] });
		const ok = await scoped.request('https://rebuildup.dev/echo?returnTo=%2Fadmin%2Fkeys');
		expect(ok.status).toBe(200);
		const refused = await scoped.request('https://rebuildup.dev/echo?returnTo=%2Fabout');
		expect(refused.status).toBe(400);
	});
});
