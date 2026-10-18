import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
	CSRF_EXEMPT_PREFIXES,
	CSRF_REJECTED_ERROR,
	csrfGuard,
	evaluateCsrf,
	isCsrfExemptPath,
	isSafeMethod,
} from './csrf';

/**
 * Issue #440 acceptance tests — cross-site request forgery guard for
 * the Hono external boundary.
 *
 * Two things are pinned here:
 *
 *   1. The **decision matrix** (`evaluateCsrf`) — same shape as
 *      TanStack Start's default CSRF middleware, which is the other
 *      half of the two-layer contract. Both layers must refuse the
 *      same request shapes, otherwise "which layer rejected this?"
 *      depends on the URL prefix the caller happened to use.
 *   2. The **middleware surface** — a refused unsafe method never
 *      reaches the handler, and the response body is the stable
 *      `{ error: 'csrf_rejected', reason }` pair with no caller-supplied
 *      value echoed back.
 *
 * The end-to-end behaviour through the real Worker (including "a
 * refused write leaves no row in D1") lives in
 * `test/integration/csrf-contract.test.ts`; this file is the fast
 * Node-environment half.
 */

const REQUEST_ORIGIN = 'https://rebuildup.dev';

function buildApp() {
	const app = new Hono<{ Bindings: Env }>();
	app.use('/api/v1/*', csrfGuard);
	app.all('/api/v1/probe', (c) => c.json({ reached: true }));
	return app;
}

describe('isSafeMethod', () => {
	it('treats GET / HEAD / OPTIONS as safe', () => {
		expect(isSafeMethod('GET')).toBe(true);
		expect(isSafeMethod('head')).toBe(true);
		expect(isSafeMethod('Options')).toBe(true);
	});

	it('treats every write method as unsafe', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(isSafeMethod(method)).toBe(false);
		}
	});
});

describe('isCsrfExemptPath', () => {
	it('exempts the Better Auth surface, which owns its own origin check', () => {
		expect(isCsrfExemptPath('/api/v1/auth/sign-in/email')).toBe(true);
		expect(isCsrfExemptPath('/api/v1/auth')).toBe(true);
	});

	it('does not exempt a lookalike prefix', () => {
		// A prefix list that matched by `startsWith('/api/v1/auth')`
		// without the `/` boundary would silently exempt
		// `/api/v1/authoritative-things`.
		expect(isCsrfExemptPath('/api/v1/authoritative')).toBe(false);
		expect(isCsrfExemptPath('/api/v1/reactions')).toBe(false);
	});

	it('names every exempt prefix it ships', () => {
		expect(CSRF_EXEMPT_PREFIXES).toEqual(['/api/v1/auth']);
	});
});

describe('evaluateCsrf', () => {
	const req = (method: string, headers: Record<string, string>) =>
		new Request(`${REQUEST_ORIGIN}/api/v1/reactions`, { method, headers });

	it('allows a same-origin Sec-Fetch-Site write (positive case)', () => {
		const decision = evaluateCsrf(req('POST', { 'sec-fetch-site': 'same-origin' }));
		expect(decision).toEqual({ allowed: true, accepted_as: 'same_origin' });
	});

	it('allows a matching Origin header when fetch metadata is absent', () => {
		const decision = evaluateCsrf(req('POST', { origin: REQUEST_ORIGIN }));
		expect(decision.allowed).toBe(true);
	});

	it('allows a same-origin Referer when Origin is absent', () => {
		const decision = evaluateCsrf(req('POST', { referer: `${REQUEST_ORIGIN}/about` }));
		expect(decision.allowed).toBe(true);
	});

	it('refuses a cross-site Sec-Fetch-Site write (negative case)', () => {
		const decision = evaluateCsrf(req('POST', { 'sec-fetch-site': 'cross-site' }));
		expect(decision).toEqual({ allowed: false, reason: 'cross_site_fetch_metadata' });
	});

	it('refuses same-site, none, and any other fetch-metadata value', () => {
		// `same-site` is a different origin for our purposes: a
		// sibling subdomain is a separate deployment as far as this
		// Worker is concerned, and nothing today needs it.
		expect(evaluateCsrf(req('POST', { 'sec-fetch-site': 'same-site' })).allowed).toBe(false);
		expect(evaluateCsrf(req('POST', { 'sec-fetch-site': 'none' })).allowed).toBe(false);
	});

	it('refuses a mismatched Origin', () => {
		const decision = evaluateCsrf(req('PUT', { origin: 'https://evil.example' }));
		expect(decision).toEqual({ allowed: false, reason: 'origin_mismatch' });
	});

	it('refuses a sandboxed `Origin: null`', () => {
		const decision = evaluateCsrf(req('POST', { origin: 'null' }));
		expect(decision).toEqual({ allowed: false, reason: 'origin_mismatch' });
	});

	it('refuses a cross-origin Referer, including a prefix lookalike', () => {
		expect(evaluateCsrf(req('POST', { referer: 'https://evil.example/x' })).reason).toBe(
			'referer_mismatch',
		);
		// `https://rebuildup.dev.evil.example` shares a string prefix
		// with the request origin but is a different host.
		expect(
			evaluateCsrf(req('POST', { referer: 'https://rebuildup.dev.evil.example/x' })).reason,
		).toBe('referer_mismatch');
	});

	it('refuses a write with no origin evidence at all', () => {
		// The shape a cross-site `no-cors` form POST produces.
		const decision = evaluateCsrf(
			req('POST', { 'content-type': 'application/x-www-form-urlencoded' }),
		);
		expect(decision).toEqual({ allowed: false, reason: 'origin_check_missing' });
	});

	it('does not check safe methods, cross-site or not', () => {
		const decision = evaluateCsrf(req('GET', { 'sec-fetch-site': 'cross-site' }));
		expect(decision).toEqual({ allowed: true, accepted_as: 'safe_method' });
	});

	it('does not check the Better Auth surface', () => {
		const request = new Request(`${REQUEST_ORIGIN}/api/v1/auth/sign-in/email`, {
			method: 'POST',
		});
		expect(evaluateCsrf(request)).toEqual({ allowed: true, accepted_as: 'exempt_prefix' });
	});
});

describe('csrfGuard middleware', () => {
	const app = buildApp();

	it('passes a same-origin write through to the handler', async () => {
		const res = await app.request('/api/v1/probe', {
			method: 'POST',
			headers: { 'sec-fetch-site': 'same-origin' },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ reached: true });
	});

	it('answers 403 csrf_rejected and never reaches the handler', async () => {
		const res = await app.request('/api/v1/probe', {
			method: 'POST',
			headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			error: CSRF_REJECTED_ERROR,
			reason: 'cross_site_fetch_metadata',
		});
	});

	it('does not echo the rejected origin back to the caller', async () => {
		const res = await app.request('/api/v1/probe', {
			method: 'POST',
			headers: { origin: 'https://evil.example/?leak=1' },
		});
		const body = await res.text();
		expect(body).not.toContain('evil.example');
		expect(body).not.toContain('leak=1');
	});

	it('leaves safe reads untouched', async () => {
		const res = await app.request('/api/v1/probe', { method: 'GET' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ reached: true });
	});
});
