/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll } from 'vitest';
import {
	CORS_REQUEST_HEADERS,
	type CorsClass,
	classifyRoute,
	credentialWildcardViolation,
} from '../../src/http/cors/policy';
import { externalBoundary } from '../../src/http/hono';
import { createMockApp } from '../../src/http/mock';

/**
 * CORS policy over the real Worker (Issue #455).
 *
 * Everything here goes through `SELF.fetch`, so the request enters
 * `src/server.ts`, is dispatched to the Hono boundary by path prefix,
 * and is answered by the production middleware — the same path a
 * browser on `https://rebuildup.dev` takes. The unit suites cover the
 * decision function and the Hono rendering; this file covers the wiring
 * (dispatch prefix, middleware order relative to the mock gate and
 * `requireApiKey`, real header bytes on the wire).
 *
 * The request URL host is `https://rebuildup.dev` — the canonical
 * production origin (ADR-0014) — so the "allowed" rows are a real
 * same-origin browser request against the canonical origin, not a
 * synthetic host. `env.BETTER_AUTH_URL` is deliberately not bound in
 * this pool (see `vitest.config.ts`), so the second allow-list source is
 * covered by `src/http/cors/middleware.test.ts` instead.
 *
 * The suite also prints one `CORS_PREFLIGHT_MEASUREMENT <json>` line for
 * `scripts/cors-preflight-report.mjs`, so the Issue's screenshot is
 * generated from these measurements rather than transcribed.
 */

const ORIGIN = 'https://rebuildup.dev';
const EVIL = 'https://evil.example';
const ABSENT = '(absent)';

/**
 * Routes the boundary registers that are deliberately left in the `none`
 * class. Listing them is the point: an unclassified route that appears
 * here without a reason is a new public surface nobody decided on, and
 * the inventory test below fails until it is either classified or
 * acknowledged.
 */
const INTENTIONALLY_UNCLASSIFIED: Readonly<Record<string, string>> = Object.freeze({
	'GET /api/v1/db/ping':
		'operator diagnostic — a wildcard would expose binding liveness to any site',
	'GET /api/v1/media/ping': 'operator diagnostic — same reasoning as db/ping',
	'GET /robots.txt':
		'crawler-facing text document (Issue #420) — read by crawlers, which do not read CORS headers, and same-origin by construction',
	'GET /sitemap.xml':
		'crawler-facing XML document (Issue #420) — a wildcard read would hand the whole site map to any origin, and no consumer needs it cross-origin',
	'GET /.well-known/security.txt':
		'RFC 9116 vulnerability-reporting document (Issue #468) — the same reasoning as robots.txt: a machine-readable document read by scanners, and a wildcard read would hand the reporting posture of the origin to any site',
	'GET /media/:key{.+}':
		'public media delivery (Issue #634) — an image/video subresource consumed same-origin; a wildcard read would let any origin pull the bytes as a CORS-enabled fetch, and no consumer needs that',
	'HEAD /media/:key{.+}':
		'public media delivery (Issue #634) — HEAD of the same route, so it carries the same decision',
});

interface Probe {
	readonly label: string;
	readonly meaning: string;
	readonly method: string;
	readonly path: string;
	readonly origin: string | null;
	readonly requestMethod?: string;
	readonly requestHeaders?: string;
	expectClass: CorsClass;
	readonly expectStatus: number;
	readonly expectAllowOrigin: string;
	readonly expectCredentials: string;
	/**
	 * Run the row through the real `externalBoundary` with
	 * `LOCAL_API_MODE=mock` instead of `SELF.fetch`. `SELF` is the
	 * production Worker and the pool does not bind the dev-only mock
	 * var, so the mock gate is exercised by calling the boundary app
	 * directly with that var — still the real middleware, the real
	 * composition order and the real mock sub-app.
	 */
	readonly mockMode?: boolean;
}

const PROBES: readonly Probe[] = [
	{
		label: 'public-read GET from a foreign origin',
		meaning: 'allowed: no secret behind the response, so the wildcard is correct here',
		method: 'GET',
		path: '/api/v1/health',
		origin: EVIL,
		expectClass: 'public-read',
		expectStatus: 200,
		expectAllowOrigin: '*',
		expectCredentials: ABSENT,
	},
	{
		label: 'public-read preflight from a foreign origin',
		meaning: 'allowed: image reads stay usable from any origin (canvas / getImageData)',
		method: 'OPTIONS',
		path: '/api/v1/reaction-images/demo',
		origin: EVIL,
		requestMethod: 'GET',
		expectClass: 'public-read',
		expectStatus: 204,
		expectAllowOrigin: '*',
		expectCredentials: ABSENT,
	},
	{
		label: 'public-read preflight asking for Authorization',
		meaning:
			'refused: a request header means a credentialed request, which this route never serves',
		method: 'OPTIONS',
		path: '/api/v1/reaction-images/demo',
		origin: EVIL,
		requestMethod: 'GET',
		requestHeaders: 'authorization',
		expectClass: 'public-read',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'public-read preflight for a method the route does not serve',
		meaning: 'refused: the requested method, not the wire method, drives the decision',
		method: 'OPTIONS',
		path: '/api/v1/health',
		origin: EVIL,
		requestMethod: 'DELETE',
		expectClass: 'public-read',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'credentialed preflight from the canonical origin',
		meaning: 'allowed: one concrete origin is echoed with credentials enabled',
		method: 'OPTIONS',
		path: '/api/v1/reactions',
		origin: ORIGIN,
		requestMethod: 'PUT',
		requestHeaders: CORS_REQUEST_HEADERS.join(','),
		expectClass: 'credentialed',
		expectStatus: 204,
		expectAllowOrigin: ORIGIN,
		expectCredentials: 'true',
	},
	{
		// The regression this row exists for: the Better Auth handler
		// returns a RAW `Response` (`auth.handler(c.req.raw)`), which
		// replaces `context.res` wholesale. A `c.header()` call made
		// before `next()` was dropped on exactly this shape, so the
		// credentialed echo never reached the wire here.
		label: 'Better Auth session read from the canonical origin',
		meaning:
			'allowed: the echo survives a raw-Response handler — this is the allow branch on the wire',
		method: 'GET',
		path: '/api/v1/auth/get-session',
		origin: ORIGIN,
		expectClass: 'credentialed',
		expectStatus: 200,
		expectAllowOrigin: ORIGIN,
		expectCredentials: 'true',
	},
	{
		label: 'Better Auth session read (POST) from the canonical origin',
		meaning:
			'same echo on the other verb for this path — and on its 405 error answer, which is where a header set before the handler would have been lost',
		method: 'POST',
		path: '/api/v1/auth/get-session',
		origin: ORIGIN,
		expectClass: 'credentialed',
		expectStatus: 405,
		expectAllowOrigin: ORIGIN,
		expectCredentials: 'true',
	},
	{
		// The mock gate returns `mockApp.fetch(...)` — another raw
		// `Response`, so it needed the same fix. `docs/security/api-cors.md`
		// §6 and `src/http/hono.ts` both claim the mock has the same
		// CORS surface as production; this row is what makes that
		// claim checkable instead of aspirational.
		label: 'mock-mode auth read from the canonical origin',
		meaning: 'same CORS surface under LOCAL_API_MODE=mock — the mock cannot become a bypass',
		method: 'GET',
		path: '/api/v1/auth/session',
		origin: ORIGIN,
		mockMode: true,
		expectClass: 'credentialed',
		expectStatus: 200,
		expectAllowOrigin: ORIGIN,
		expectCredentials: 'true',
	},
	{
		label: 'mock-mode auth read from a foreign origin',
		meaning:
			'same surface under the mock: the safe read reaches the handler, but no CORS echo is added (Issue #440 keeps reads reachable)',
		method: 'GET',
		path: '/api/v1/auth/session',
		origin: EVIL,
		mockMode: true,
		expectClass: 'credentialed',
		expectStatus: 200,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'credentialed preflight from a foreign origin',
		meaning: 'refused: this is the acceptance criterion — no wildcard, no credentials, no handler',
		method: 'OPTIONS',
		path: '/api/v1/reactions',
		origin: EVIL,
		requestMethod: 'PUT',
		requestHeaders: CORS_REQUEST_HEADERS.join(','),
		expectClass: 'credentialed',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'Better Auth sign-in preflight from a foreign origin',
		meaning: 'refused: the auth router gets exactly the same treatment as the API-key routes',
		method: 'OPTIONS',
		path: '/api/v1/auth/sign-in/email',
		origin: EVIL,
		requestMethod: 'POST',
		requestHeaders: 'content-type',
		expectClass: 'credentialed',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'access-counter read preflight from a foreign origin',
		meaning: 'refused: a read is still credentialed — the API key is the credential',
		method: 'OPTIONS',
		path: '/api/v1/access/count/home-page',
		origin: EVIL,
		requestMethod: 'GET',
		expectClass: 'credentialed',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'credentialed preflight naming an unreviewed request header',
		meaning: 'refused: the request-header allow-list is fixed, not caller-widened',
		method: 'OPTIONS',
		path: '/api/v1/reactions',
		origin: ORIGIN,
		requestMethod: 'PUT',
		requestHeaders: 'authorization, x-tenant-secret',
		expectClass: 'credentialed',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'safelisted cross-origin POST (no preflight in the browser)',
		meaning: 'refused before the handler: the request never reaches D1',
		method: 'POST',
		path: '/api/v1/access/hit',
		origin: EVIL,
		expectClass: 'credentialed',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'sandboxed Tool iframe (Origin: null) on the auth route',
		meaning:
			'refused: the opaque origin of /tools/<slug>/app/* is never allow-listed; Better Auth owns this actual-request refusal',
		method: 'POST',
		path: '/api/v1/auth/sign-in/email',
		origin: 'null',
		expectClass: 'credentialed',
		expectStatus: 403,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'same-origin API-key read (allowed past CORS, stopped by auth)',
		meaning: 'allowed by CORS, then 401: the policy must not shadow the API-key boundary',
		method: 'GET',
		path: '/api/v1/reactions?target=home-page',
		origin: ORIGIN,
		expectClass: 'credentialed',
		expectStatus: 401,
		expectAllowOrigin: ORIGIN,
		expectCredentials: 'true',
	},
	{
		label: 'foreign-origin safe read (GET)',
		meaning:
			'reaches the handler but carries no CORS echo: Issue #440 keeps cross-site GET/HEAD readable, while the browser still cannot read the body',
		method: 'GET',
		path: '/api/v1/access/count/home-page',
		origin: EVIL,
		expectClass: 'credentialed',
		expectStatus: 401,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'operator diagnostic from a foreign origin',
		meaning: 'no CORS header at all: not public data, so the body stays opaque to script',
		method: 'GET',
		path: '/api/v1/db/ping',
		origin: EVIL,
		expectClass: 'none',
		expectStatus: 200,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'preflight on an unclassified path',
		meaning: 'no decision, so the route’s own answer stands (404 here)',
		method: 'OPTIONS',
		path: '/api/v1/db/ping',
		origin: EVIL,
		requestMethod: 'GET',
		expectClass: 'none',
		expectStatus: 404,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
	{
		label: 'server-side self-call (SSR loader / curl, no Origin)',
		meaning: 'unchanged: no Origin header means not a cross-origin browser request',
		method: 'GET',
		path: '/api/v1/health',
		origin: null,
		expectClass: 'public-read',
		expectStatus: 200,
		expectAllowOrigin: ABSENT,
		expectCredentials: ABSENT,
	},
];

async function runProbe(probe: Probe): Promise<Record<string, unknown>> {
	const headers: Record<string, string> = {};
	if (probe.origin !== null) headers.Origin = probe.origin;
	if (probe.requestMethod) headers['Access-Control-Request-Method'] = probe.requestMethod;
	if (probe.requestHeaders) headers['Access-Control-Request-Headers'] = probe.requestHeaders;
	const init: RequestInit = { method: probe.method, headers };
	if (probe.method === 'POST') {
		// `/api/v1/auth/*` writes are delegated to Better Auth (Issue
		// #444), which rejects a non-JSON media type with `415` before
		// its origin check. Send the shape a real sign-in form posts so
		// the row measures the origin contract rather than that guard.
		const authWrite = probe.path.startsWith('/api/v1/auth/');
		headers['Content-Type'] = authWrite ? 'application/json' : 'text/plain';
		init.body = probe.path.endsWith('/sign-in/email')
			? JSON.stringify({ email: 'probe@invalid.example', password: 'not-a-real-password' })
			: authWrite
				? '{}'
				: 'key=home-page';
	}
	const res = probe.mockMode
		? await externalBoundary.fetch(new Request(`${ORIGIN}${probe.path}`, init), {
				LOCAL_API_MODE: 'mock',
			} as unknown as Env)
		: await SELF.fetch(`${ORIGIN}${probe.path}`, init);
	return {
		label: probe.label,
		meaning: probe.meaning,
		method: probe.method,
		path: probe.path,
		mode: probe.mockMode === true ? 'mock' : 'self',
		origin: probe.origin ?? '(none)',
		requestMethod: probe.requestMethod ?? '',
		requestHeaders: probe.requestHeaders ?? '',
		status: res.status,
		allowOrigin: res.headers.get('access-control-allow-origin') ?? ABSENT,
		allowCredentials: res.headers.get('access-control-allow-credentials') ?? ABSENT,
		allowMethods: res.headers.get('access-control-allow-methods') ?? ABSENT,
		allowHeaders: res.headers.get('access-control-allow-headers') ?? ABSENT,
		vary: res.headers.get('vary') ?? ABSENT,
	};
}

describe('boundary CORS policy (Issue #455)', () => {
	// Issue #261: warm-up the workerd pool so the first SELF.fetch
	// cold-start (~2.3-2.6s SSR bundle render) does not fall inside
	// a timed test budget (5000ms).
	beforeAll(async () => {
		await SELF.fetch('https://example.com/api/v1/health', { redirect: 'manual' });
	});

	it('answers every probe in the matrix as the policy demands', async () => {
		const measured: Array<Record<string, unknown>> = [];
		for (const probe of PROBES) {
			const row = await runProbe(probe);
			measured.push(row);
			expect(row.status, `${probe.label} -> status`).toBe(probe.expectStatus);
			expect(row.allowOrigin, `${probe.label} -> allow-origin`).toBe(probe.expectAllowOrigin);
			expect(row.allowCredentials, `${probe.label} -> allow-credentials`).toBe(
				probe.expectCredentials,
			);
			// The Issue's criterion as a hard assertion on every row: a
			// credentialed route never answers with a wildcard.
			if (probe.expectClass === 'credentialed') {
				expect(row.allowOrigin, `${probe.label} -> wildcard on a credentialed route`).not.toBe('*');
			}
		}
		console.log(`CORS_PREFLIGHT_MEASUREMENT ${JSON.stringify(measured)}`);
		expect(measured).toHaveLength(PROBES.length);
	});

	it('classifies every route the boundary actually registers', () => {
		// The inventory gate. A new router added to `src/http/hono.ts`
		// without a CORS decision fails here until it is either
		// classified in `CORS_ROUTES` or acknowledged in
		// `INTENTIONALLY_UNCLASSIFIED` with a reason.
		//
		// `createMockApp()` is a SECOND Hono app that the boundary mounts
		// behind the `LOCAL_API_MODE=mock` gate, so `externalBoundary.
		// routes` alone cannot see its routes. Both inventories are
		// checked: a mock route is as much a reachable surface as a real
		// one, and it must not be able to sit under a classified prefix
		// by accident.
		const registered = [...externalBoundary.routes, ...createMockApp().routes].filter(
			(route) => route.method !== 'ALL',
		);
		const unclassified = registered
			.filter((route) => classifyRoute(route.method, route.path) === null)
			.map((route) => `${route.method} ${route.path}`);
		expect(registered.length).toBeGreaterThan(0);
		// Exact set equality in both directions: a new unclassified route
		// is not in the acknowledged list (fail), and an acknowledged
		// route that no longer exists is stale (fail).
		expect([...unclassified].sort()).toEqual(Object.keys(INTENTIONALLY_UNCLASSIFIED).sort());
		for (const [route, reason] of Object.entries(INTENTIONALLY_UNCLASSIFIED)) {
			expect(reason.length, `${route} needs a recorded reason`).toBeGreaterThan(0);
		}
	});

	it('never pairs credentials with a wildcard origin', async () => {
		// Belt-and-braces over the real wire responses, not the pure
		// decision function: read every CORS header the Worker emitted
		// above and run the invariant against the actual bytes.
		for (const probe of PROBES) {
			await runProbe(probe);
			const headers: Record<string, string> = {};
			if (probe.origin !== null) headers.Origin = probe.origin;
			if (probe.requestMethod) headers['Access-Control-Request-Method'] = probe.requestMethod;
			if (probe.requestHeaders) headers['Access-Control-Request-Headers'] = probe.requestHeaders;
			const init: RequestInit = { method: probe.method, headers };
			if (probe.method === 'POST') {
				headers['Content-Type'] = 'text/plain';
				init.body = 'key=home-page';
			}
			const res = probe.mockMode
				? await externalBoundary.fetch(new Request(`${ORIGIN}${probe.path}`, init), {
						LOCAL_API_MODE: 'mock',
					} as unknown as Env)
				: await SELF.fetch(`${ORIGIN}${probe.path}`, init);
			const violation = credentialWildcardViolation({
				...(res.headers.has('access-control-allow-credentials')
					? {
							'Access-Control-Allow-Credentials':
								res.headers.get('access-control-allow-credentials') ?? '',
						}
					: {}),
				...(res.headers.has('access-control-allow-origin')
					? { 'Access-Control-Allow-Origin': res.headers.get('access-control-allow-origin') ?? '' }
					: {}),
			});
			expect(violation, `${probe.label} -> ${violation ?? 'ok'}`).toBeNull();
		}
	});

	// A generous explicit timeout, and not paranoia: the first `/`
	// request in a cold workerd pool has to evaluate the whole TanStack
	// Start module graph, measured at 4.5–6.6 s on this repo, which is
	// over vitest's 5 s default and produced real flakes under load. The
	// assertions here are about header bytes, not render latency.
	it(
		'leaves the SSR surfaces free of API CORS headers',
		{
			timeout: 60_000,
		},
		async () => {
			// The UI is same-origin with the API by construction
			// (ADR-0014), so nothing outside `/api/v1/*`, `/webhooks/*`,
			// `/oauth/*` and `/integrations/*` may grow an allow-origin
			// header as a side effect of mounting the middleware.
			for (const path of ['/', '/contact', '/admin/login']) {
				const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Origin: EVIL } });
				expect(res.headers.get('access-control-allow-origin'), path).toBeNull();
				expect(res.headers.get('access-control-allow-credentials'), path).toBeNull();
			}
		},
	);
});
