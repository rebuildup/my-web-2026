/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Inbound embed policy — CSP `frame-ancestors` (Issue #448).
 *
 * What this suite proves
 * ----------------------
 * `frame-ancestors` is the INBOUND policy: "which ancestor may put
 * THIS response inside an iframe". It is deliberately not the Tool
 * embed policy, which is OUTBOUND ("which Tools may this host embed",
 * owned by `src/tools/registry.ts` + the manifest's `delivery.iframe`).
 * The two are asserted separately here, because conflating them is the
 * mistake the issue exists to prevent.
 *
 * The runtime half (every response the Worker generates — TanStack
 * Start documents and Hono boundary responses alike) is asserted
 * through `SELF.fetch`, so these are the real headers the runtime
 * emits. The static half (`/tools/<slug>/app/*`, served by Cloudflare
 * Static Assets out of `public/_headers`) cannot be observed from the
 * workerd pool at all, so it is covered by
 * `scripts/check-frame-ancestors-policy.mjs`.
 *
 * Accepted input (the surface answers as designed) and denied input
 * (the surface rejects the request, or a lookalike path must not
 * inherit a denial) are both reproduced against the local worker, as
 * the issue requires — no production origin is involved.
 */
const CSP = 'content-security-policy';
const NONE = "frame-ancestors 'none'";
const SELF_ONLY = "frame-ancestors 'self'";

async function fetchHeaders(path: string, init?: RequestInit) {
	const res = await SELF.fetch(`https://example.com${path}`, {
		redirect: 'manual',
		...init,
	});
	return {
		status: res.status,
		csp: res.headers.get(CSP),
		contentType: res.headers.get('content-type'),
		body: init?.method ? null : await res.text(),
	};
}

describe('CSP frame-ancestors — public surfaces (Issue #448)', () => {
	it('serves a public document with frame-ancestors self', async () => {
		// `/contact` for the same reason as the cache-policy suite: it is
		// a real 200 HTML document with no D1-backed loader.
		const { status, csp, contentType } = await fetchHeaders('/contact');
		expect(status).toBe(200);
		expect(contentType).toContain('text/html');
		expect(csp).toBe(SELF_ONLY);
	});

	it('lets the Tool shell keep framing its own same-origin artefact', async () => {
		const { status, csp, body } = await fetchHeaders('/tools/prototype');
		expect(status).toBe(200);
		// The shell is a public document: same-origin framing is allowed,
		// third-party framing is not.
		expect(csp).toBe(SELF_ONLY);
		// The Tool embed chain itself is unchanged: the shell still mounts
		// the artefact the static `_headers` rule covers, on the same
		// origin — which is why `frame-ancestors 'self'` (not `'none'`)
		// is the value that keeps existing Tools working.
		expect(body).toContain('/tools/prototype/app/index.html');
		expect(body).toContain('<iframe');
	});

	it('keeps the Tool index document framable by self only', async () => {
		const { status, csp } = await fetchHeaders('/tools');
		expect(status).toBe(200);
		expect(csp).toBe(SELF_ONLY);
	});
});

describe('CSP frame-ancestors — Admin denial (Issue #448)', () => {
	it('denies framing of /admin/login HTML', async () => {
		const { status, csp, contentType } = await fetchHeaders('/admin/login');
		expect(status).toBe(200);
		expect(contentType).toContain('text/html');
		expect(csp).toBe(NONE);
	});

	it('denies framing of the anonymous /admin redirect even with no content-type', async () => {
		const { status, csp, contentType } = await fetchHeaders('/admin');
		// Anonymous /admin is auth-gated (see admin-routing.test.ts), so
		// this is a redirect with no body and no content-type. The policy
		// is decided from the path alone for exactly this shape — a
		// content-type gate would skip the response most worth framing.
		expect(status).toBeGreaterThanOrEqual(300);
		expect(status).toBeLessThan(400);
		expect(contentType ?? '').not.toContain('text/html');
		expect(csp).toBe(NONE);
	});

	it('denies framing of a protected child route', async () => {
		const { status, csp } = await fetchHeaders('/admin/keys');
		expect(status).toBeGreaterThanOrEqual(300);
		expect(status).toBeLessThan(400);
		expect(csp).toBe(NONE);
	});

	it('does not let a lookalike prefix inherit the Admin denial', async () => {
		// Exact-prefix-or-`/`, mirroring the external-boundary matcher:
		// `/administrator` is a public 404, not an Admin surface, and must
		// not be denied by accident.
		const { status, csp } = await fetchHeaders('/administrator');
		expect(status).toBe(404);
		expect(csp).toBe(SELF_ONLY);
	});
});

describe('CSP frame-ancestors — Account surface (Issue #448)', () => {
	it('denies framing of an accepted anonymous session read', async () => {
		const { status, csp } = await fetchHeaders('/api/v1/auth/get-session');
		// Accepted input: the Account surface answers as designed.
		expect(status).toBe(200);
		expect(csp).toBe(NONE);
	});

	it('denies framing of a rejected sign-in, whatever the outcome', async () => {
		// Denied input: credentials that cannot authenticate. The header is
		// decided by path, not by status, so a rejected request can never
		// be framed and an accepted one can never lose the protection.
		const { status, csp } = await fetchHeaders('/api/v1/auth/sign-in/email', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: 'frame-ancestors-probe@example.invalid',
				password: 'not-a-real-password',
			}),
		});
		expect(status).toBe(401);
		expect(csp).toBe(NONE);
	});

	it('does not let a lookalike prefix inherit the Account denial', async () => {
		const { status, csp } = await fetchHeaders('/api/v1/authentication');
		// Not an Account path: the boundary 404s it and the policy stays at
		// the public value.
		expect(status).toBe(404);
		expect(csp).toBe(SELF_ONLY);
	});

	it('keeps non-account boundary responses at the public value', async () => {
		const { status, csp } = await fetchHeaders('/api/v1/health');
		expect(status).toBe(200);
		expect(csp).toBe(SELF_ONLY);
	});
});
