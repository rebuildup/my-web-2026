import { describe, expect, it } from 'vitest';
import {
	CORS_REQUEST_HEADERS,
	CORS_ROUTES,
	classifyRoute,
	credentialWildcardViolation,
	decideCors,
	isAllowedOrigin,
	normalizeOrigin,
} from './policy';

/**
 * Unit tests for the CORS decision function (Issue #455).
 *
 * These run without workerd: `policy.ts` is a pure module, so every
 * branch of the allow-list can be asserted directly instead of being
 * inferred from a response. The wire-level behaviour is asserted
 * separately by `middleware.test.ts` (Hono) and
 * `test/integration/cors.test.ts` (the real Worker through `SELF`).
 */

const REQUEST_ORIGIN = 'https://rebuildup.dev';
const CANONICAL = 'https://rebuildup.dev';
const EVIL = 'https://evil.example';

function decide(overrides: Partial<Parameters<typeof decideCors>[0]> = {}) {
	return decideCors({
		method: 'GET',
		path: '/api/v1/health',
		origin: EVIL,
		requestOrigin: REQUEST_ORIGIN,
		extraAllowedOrigins: [],
		preflight: false,
		...overrides,
	});
}

describe('route classification', () => {
	it('classifies the shipped boundary routes', () => {
		expect(classifyRoute('POST', '/api/v1/auth/sign-in/email')?.klass).toBe('credentialed');
		expect(classifyRoute('GET', '/api/v1/auth/get-session')?.klass).toBe('credentialed');
		expect(classifyRoute('POST', '/api/v1/access/hit')?.klass).toBe('credentialed');
		expect(classifyRoute('GET', '/api/v1/access/count/home-page')?.klass).toBe('credentialed');
		expect(classifyRoute('PUT', '/api/v1/reactions')?.klass).toBe('credentialed');
		expect(classifyRoute('DELETE', '/api/v1/reactions')?.klass).toBe('credentialed');
		expect(classifyRoute('GET', '/api/v1/reactions')?.klass).toBe('credentialed');
		expect(classifyRoute('GET', '/api/v1/reaction-images/abc')?.klass).toBe('public-read');
		expect(classifyRoute('GET', '/api/v1/health')?.klass).toBe('public-read');
	});

	it('leaves the operator diagnostics and the unimplemented prefixes unclassified', () => {
		// `/api/v1/db/ping` and `/api/v1/media/ping` are diagnostics, not
		// public data: a wildcard would hand any site a scriptable
		// liveness probe. `/webhooks/*`, `/oauth/*` and `/integrations/*`
		// have no router yet and get no CORS header by default.
		expect(classifyRoute('GET', '/api/v1/db/ping')).toBeNull();
		expect(classifyRoute('GET', '/api/v1/media/ping')).toBeNull();
		expect(classifyRoute('POST', '/webhooks/example')).toBeNull();
		expect(classifyRoute('GET', '/oauth/callback')).toBeNull();
		expect(classifyRoute('GET', '/integrations/example')).toBeNull();
		expect(classifyRoute('GET', '/')).toBeNull();
	});

	it('anchors prefix matching so neighbours cannot shadow each other', () => {
		// `path === prefix || path.startsWith(`${prefix}/`)` is what keeps
		// the public `/api/v1/reaction-images` from inheriting the
		// credentialed `/api/v1/reactions` entry, and keeps a future
		// `/api/v1/reactionsv2` from inheriting either: it is a different
		// resource, so it gets no CORS decision until it is classified.
		expect(CORS_ROUTES.map((route) => route.path)).toContain('/api/v1/reactions');
		expect(classifyRoute('GET', '/api/v1/reactionsv2')).toBeNull();
		expect(classifyRoute('GET', '/api/v1/reactionsv2/abc')).toBeNull();
		expect(classifyRoute('GET', '/api/v1/reaction-images/abc')?.klass).toBe('public-read');
		// A sub-resource of the credentialed prefix stays credentialed.
		expect(classifyRoute('GET', '/api/v1/reactions/anything')?.klass).toBe('credentialed');
	});

	it('returns the path match for a method the route does not serve', () => {
		// The caller refuses with `cors_method_rejected` instead of
		// degrading to an unclassified path.
		const route = classifyRoute('DELETE', '/api/v1/health');
		expect(route?.klass).toBe('public-read');
		expect(route?.methods).not.toContain('DELETE');
	});
});

describe('origin allow-list', () => {
	it('accepts the exact allow-listed origin only', () => {
		expect(isAllowedOrigin(CANONICAL, [CANONICAL])).toBe(true);
		expect(isAllowedOrigin(EVIL, [CANONICAL])).toBe(false);
	});

	it('rejects the look-alike origins a substring match would allow', () => {
		const allowed = ['https://rebuildup.dev'];
		expect(isAllowedOrigin('https://rebuildup.dev.evil.example', allowed)).toBe(false);
		expect(isAllowedOrigin('https://evilrebuildup.dev', allowed)).toBe(false);
		expect(isAllowedOrigin('https://rebuildup.dev@evil.example', allowed)).toBe(false);
		expect(isAllowedOrigin('https://evil.example/rebuildup.dev', allowed)).toBe(false);
		expect(isAllowedOrigin('https://sub.rebuildup.dev', allowed)).toBe(false);
		expect(isAllowedOrigin('http://rebuildup.dev', allowed)).toBe(false);
		expect(isAllowedOrigin('https://rebuildup.dev:8443', allowed)).toBe(false);
	});

	it('normalizes the default port and rejects unusable origins', () => {
		expect(normalizeOrigin('https://rebuildup.dev:443')).toBe('https://rebuildup.dev');
		expect(normalizeOrigin('http://localhost:3000')).toBe('http://localhost:3000');
		expect(normalizeOrigin(' null ')).toBeNull();
		expect(normalizeOrigin('')).toBeNull();
		expect(normalizeOrigin('rebuildup.dev')).toBeNull();
		expect(normalizeOrigin('file:///tmp/x')).toBeNull();
	});

	it('never accepts the opaque `null` origin of a sandboxed iframe', () => {
		expect(isAllowedOrigin('null', [CANONICAL])).toBe(false);
		// Even if an operator misconfigured the allow-list with the
		// literal string, the normalizer refuses it.
		expect(isAllowedOrigin('null', ['null'])).toBe(false);
	});
});

describe('credentialed routes', () => {
	it('echoes the allow-listed origin with credentials', () => {
		const decision = decide({
			path: '/api/v1/reactions',
			method: 'GET',
			origin: CANONICAL,
			requestOrigin: 'https://preview.example',
			extraAllowedOrigins: [CANONICAL],
		});
		expect(decision.kind).toBe('passthrough');
		if (decision.kind !== 'passthrough') throw new Error('unreachable');
		expect(decision.headers['Access-Control-Allow-Origin']).toBe(CANONICAL);
		expect(decision.headers['Access-Control-Allow-Credentials']).toBe('true');
		expect(decision.headers['Access-Control-Allow-Origin']).not.toBe('*');
		expect(decision.headers.Vary).toBe('Origin');
	});

	it('always treats the request origin as allowed (same-origin)', () => {
		const decision = decide({
			path: '/api/v1/access/count/home-page',
			method: 'GET',
			origin: 'http://localhost:3000',
			requestOrigin: 'http://localhost:3000',
		});
		if (decision.kind !== 'passthrough') throw new Error('expected passthrough');
		expect(decision.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
	});

	it('refuses an origin outside the allow-list with no CORS header', () => {
		const decision = decide({ path: '/api/v1/reactions', method: 'PUT', origin: EVIL });
		expect(decision.kind).toBe('refuse');
		if (decision.kind !== 'refuse') throw new Error('unreachable');
		expect(decision.code).toBe('cors_origin_rejected');
		expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
		expect(decision.headers['Access-Control-Allow-Credentials']).toBeUndefined();
	});

	it('lets a foreign-origin safe read reach the handler without a CORS echo', () => {
		for (const method of ['GET', 'HEAD']) {
			const decision = decide({ path: '/api/v1/reactions', method, origin: EVIL });
			expect(decision.kind).toBe('passthrough');
			if (decision.kind !== 'passthrough') throw new Error('unreachable');
			expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
			expect(decision.headers['Access-Control-Allow-Credentials']).toBeUndefined();
			expect(decision.headers.Vary).toBe('Origin');
		}
	});

	it('still refuses a foreign-origin preflight that asks for GET', () => {
		const decision = decide({
			path: '/api/v1/access/count/home-page',
			method: 'GET',
			origin: EVIL,
			preflight: true,
		});
		expect(decision.kind).toBe('refuse');
		if (decision.kind !== 'refuse') throw new Error('unreachable');
		expect(decision.code).toBe('cors_origin_rejected');
	});

	it('refuses the opaque `null` origin', () => {
		const decision = decide({ path: '/api/v1/auth/sign-in/email', method: 'POST', origin: 'null' });
		expect(decision.kind).toBe('refuse');
		if (decision.kind !== 'refuse') throw new Error('unreachable');
		expect(decision.code).toBe('cors_origin_rejected');
	});

	it('refuses a preflight whose requested header is outside the allow-list', () => {
		const allowed = decide({
			path: '/api/v1/reactions',
			method: 'PUT',
			origin: CANONICAL,
			preflight: true,
			requestedHeaders: [...CORS_REQUEST_HEADERS],
		});
		expect(allowed.kind).toBe('preflight');

		const rejected = decide({
			path: '/api/v1/reactions',
			method: 'PUT',
			origin: CANONICAL,
			preflight: true,
			requestedHeaders: ['authorization', 'x-tenant-secret'],
		});
		expect(rejected.kind).toBe('refuse');
		if (rejected.kind !== 'refuse') throw new Error('unreachable');
		expect(rejected.code).toBe('cors_header_rejected');
	});

	it('refuses a preflight for a method the route does not serve', () => {
		const decision = decide({
			path: '/api/v1/auth/get-session',
			method: 'DELETE',
			origin: CANONICAL,
			preflight: true,
		});
		expect(decision.kind).toBe('refuse');
		if (decision.kind !== 'refuse') throw new Error('unreachable');
		expect(decision.code).toBe('cors_method_rejected');
	});

	it('refuses a preflight that asks for OPTIONS itself', () => {
		// `OPTIONS` is on every route because the route must ANSWER the
		// preflight, but it is never in the advertised method list, so
		// accepting it would answer 204 with a list that does not contain
		// the requested method. Not reachable from a browser (OPTIONS is
		// CORS-safelisted); asserted so the 204 stays self-consistent.
		for (const path of ['/api/v1/auth/get-session', '/api/v1/health']) {
			const decision = decide({ path, method: 'OPTIONS', origin: CANONICAL, preflight: true });
			expect(decision.kind).toBe('refuse');
			if (decision.kind !== 'refuse') throw new Error('unreachable');
			expect(decision.code).toBe('cors_method_rejected');
		}
	});

	it('keeps the preflight-only headers off an actual response', () => {
		// A browser reads only `Access-Control-Allow-Origin` and
		// `-Credentials` on a non-preflight response; the rest is surface
		// nobody consumes, so the policy does not emit it.
		const credentialed = decide({
			path: '/api/v1/auth/get-session',
			method: 'GET',
			origin: CANONICAL,
		});
		if (credentialed.kind !== 'passthrough') throw new Error('unreachable');
		expect(credentialed.headers['Access-Control-Allow-Origin']).toBe(CANONICAL);
		expect(credentialed.headers['Access-Control-Allow-Credentials']).toBe('true');
		expect(credentialed.headers['Access-Control-Allow-Methods']).toBeUndefined();
		expect(credentialed.headers['Access-Control-Max-Age']).toBeUndefined();
		expect(credentialed.headers['Access-Control-Allow-Headers']).toBeUndefined();

		const publicRead = decide({ path: '/api/v1/health', method: 'GET', origin: EVIL });
		if (publicRead.kind !== 'passthrough') throw new Error('unreachable');
		expect(publicRead.headers['Access-Control-Allow-Origin']).toBe('*');
		expect(publicRead.headers['Access-Control-Allow-Methods']).toBeUndefined();
		expect(publicRead.headers['Access-Control-Max-Age']).toBeUndefined();
	});

	it('still advertises the methods and cache lifetime on a preflight', () => {
		const decision = decide({
			path: '/api/v1/reactions',
			method: 'PUT',
			origin: CANONICAL,
			preflight: true,
			requestedHeaders: ['authorization'],
		});
		if (decision.kind !== 'preflight') throw new Error('unreachable');
		expect(decision.headers['Access-Control-Allow-Methods']).toBe('GET, HEAD, PUT, DELETE');
		expect(decision.headers['Access-Control-Max-Age']).toBe('600');
		expect(decision.headers['Access-Control-Allow-Headers']).toBe('authorization');
	});

	it('classifies a preflight by the requested method, not by OPTIONS', () => {
		// `DELETE /api/v1/health` is a public-read route with no DELETE
		// handler. Classifying by the wire method (`OPTIONS`, which is
		// advertised) would have answered `204` with a wildcard; the
		// requested method must drive the decision.
		const decision = decide({
			path: '/api/v1/health',
			method: 'DELETE',
			origin: EVIL,
			preflight: true,
		});
		expect(decision.kind).toBe('refuse');
		if (decision.kind !== 'refuse') throw new Error('unreachable');
		expect(decision.code).toBe('cors_method_rejected');
	});
});

describe('public-read routes', () => {
	it('answers with a wildcard and never with credentials', () => {
		const decision = decide({ path: '/api/v1/health', method: 'GET', origin: EVIL });
		if (decision.kind !== 'passthrough') throw new Error('unreachable');
		expect(decision.headers['Access-Control-Allow-Origin']).toBe('*');
		expect(decision.headers['Access-Control-Allow-Credentials']).toBeUndefined();
	});

	it('carries no Vary: Origin, because `*` does not vary on Origin', () => {
		// Issue #460 requires the public immutable reaction-image payload
		// to stay free of a `Vary` dimension. A wildcard answer is the
		// same byte-for-byte for every origin, so `Vary: Origin` would
		// only cost shared-cache hits. The credentialed echo, which DOES
		// vary on Origin, keeps the header (asserted above).
		for (const probe of [
			{ origin: EVIL, preflight: false },
			{ origin: null, preflight: false },
			{ origin: EVIL, preflight: true },
		]) {
			const decision = decide({
				path: '/api/v1/reaction-images/abc',
				method: 'GET',
				origin: probe.origin,
				preflight: probe.preflight,
			});
			expect(decision.headers.Vary, JSON.stringify(probe)).toBeUndefined();
		}
	});

	it('refuses a preflight that names a request header (credentialed request)', () => {
		const decision = decide({
			path: '/api/v1/reaction-images/abc',
			method: 'GET',
			origin: EVIL,
			preflight: true,
			requestedHeaders: ['authorization'],
		});
		expect(decision.kind).toBe('refuse');
		if (decision.kind !== 'refuse') throw new Error('unreachable');
		expect(decision.code).toBe('cors_header_rejected');
	});

	it('answers a plain GET preflight with the wildcard', () => {
		const decision = decide({
			path: '/api/v1/reaction-images/abc',
			method: 'GET',
			origin: EVIL,
			preflight: true,
		});
		if (decision.kind !== 'preflight') throw new Error('unreachable');
		expect(decision.headers['Access-Control-Allow-Origin']).toBe('*');
		expect(decision.headers['Access-Control-Allow-Credentials']).toBeUndefined();
	});
});

describe('unclassified paths and non-browser callers', () => {
	it('emits no CORS header for an unclassified path', () => {
		const decision = decide({ path: '/api/v1/db/ping', method: 'GET', origin: EVIL });
		expect(decision.kind).toBe('passthrough');
		if (decision.kind !== 'passthrough') throw new Error('unreachable');
		expect(decision.klass).toBe('none');
		expect(decision.headers).toEqual({});
	});

	it('emits no CORS header and refuses nothing without an Origin header', () => {
		// The SSR self-calls, curl and the E2E suite send no `Origin`.
		// They must reach the handlers exactly as before; on the
		// credentialed routes only `Vary` is added so a shared cache
		// cannot mix an echoed origin with an origin-less request.
		for (const path of ['/api/v1/reactions', '/api/v1/access/hit']) {
			const decision = decide({ path, method: 'POST', origin: null });
			expect(decision.kind).toBe('passthrough');
			if (decision.kind !== 'passthrough') throw new Error('unreachable');
			expect(decision.headers).toEqual({ Vary: 'Origin' });
		}
		// `public-read` is origin-independent (`*`), so a same-origin /
		// origin-less self-call must not even grow a `Vary`.
		const health = decide({ path: '/api/v1/health', method: 'POST', origin: null });
		if (health.kind !== 'passthrough') throw new Error('unreachable');
		expect(health.headers).toEqual({});
	});
});

describe('the wildcard / credentials invariant', () => {
	it('holds for every route x origin x method combination', () => {
		const origins = [
			CANONICAL,
			EVIL,
			'null',
			'http://localhost:3000',
			'https://rebuildup.dev.evil.example',
		];
		const methods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'];
		const paths = [
			'/api/v1/auth/sign-in/email',
			'/api/v1/access/hit',
			'/api/v1/access/count/home-page',
			'/api/v1/reactions',
			'/api/v1/reaction-images/abc',
			'/api/v1/health',
			'/api/v1/db/ping',
			'/webhooks/example',
		];
		let checked = 0;
		for (const path of paths) {
			for (const method of methods) {
				for (const origin of origins) {
					for (const preflight of [false, true]) {
						const decision = decideCors({
							method,
							path,
							origin,
							requestOrigin: REQUEST_ORIGIN,
							extraAllowedOrigins: [CANONICAL],
							requestedHeaders: preflight ? ['authorization'] : [],
							preflight,
						});
						expect(credentialWildcardViolation(decision.headers)).toBeNull();
						if (
							decision.kind !== 'refuse' &&
							classifyRoute(method, path)?.klass === 'credentialed'
						) {
							// The Issue's acceptance criterion, asserted
							// over the whole matrix rather than one row:
							// a credentialed route never answers with `*`.
							expect(decision.headers['Access-Control-Allow-Origin']).not.toBe('*');
						}
						checked += 1;
					}
				}
			}
		}
		expect(checked).toBe(paths.length * methods.length * origins.length * 2);
	});

	it('detects the violation it exists to prevent', () => {
		expect(
			credentialWildcardViolation({
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Credentials': 'true',
			}),
		).toContain('wildcard');
		expect(
			credentialWildcardViolation({
				'Access-Control-Allow-Origin': 'null',
				'Access-Control-Allow-Credentials': 'true',
			}),
		).toContain('null');
		expect(credentialWildcardViolation({ 'Access-Control-Allow-Origin': '*' })).toBeNull();
	});
});
