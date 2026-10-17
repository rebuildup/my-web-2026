/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
	CORS_REQUEST_HEADERS,
	type CorsClass,
	classifyRoute,
	credentialWildcardViolation,
} from '../../src/http/cors/policy';
import { externalBoundary } from '../../src/http/hono';

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
		meaning: 'refused: the opaque origin of /tools/<slug>/app/* is never allow-listed',
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
		headers['Content-Type'] = 'text/plain';
		init.body = 'key=home-page';
	}
	const res = await SELF.fetch(`${ORIGIN}${probe.path}`, init);
	return {
		label: probe.label,
		meaning: probe.meaning,
		method: probe.method,
		path: probe.path,
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
		const registered = externalBoundary.routes.filter((route) => route.method !== 'ALL');
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
			const headers: Record<string, string> = {};
			if (probe.origin !== null) headers.Origin = probe.origin;
			if (probe.requestMethod) headers['Access-Control-Request-Method'] = probe.requestMethod;
			if (probe.requestHeaders) headers['Access-Control-Request-Headers'] = probe.requestHeaders;
			const res = await SELF.fetch(`${ORIGIN}${probe.path}`, {
				method: probe.method,
				headers,
				...(probe.method === 'POST' ? { body: 'key=home-page' } : {}),
			});
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

	it('leaves the SSR surfaces free of API CORS headers', async () => {
		// The UI is same-origin with the API by construction
		// (ADR-0014), so nothing outside `/api/v1/*`, `/webhooks/*`,
		// `/oauth/*` and `/integrations/*` may grow an allow-origin
		// header as a side effect of mounting the middleware.
		for (const path of ['/', '/contact', '/admin/login']) {
			const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { Origin: EVIL } });
			expect(res.headers.get('access-control-allow-origin'), path).toBeNull();
			expect(res.headers.get('access-control-allow-credentials'), path).toBeNull();
		}
	});
});
