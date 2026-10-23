/**
 * Public API directory — static inventory of the `/api/v1/*` routes
 * registered by the external HTTP boundary (`src/http/hono.ts`).
 *
 * This file is the source of truth for the public contract surface.
 * It does NOT include management / secret / unimplemented endpoints
 * (`/admin*`, internal server functions, mock-only paths, or binding
 * probes that are not a public data contract).
 *
 * Issue #530. Updated only when the boundary contracts change.
 */

import packageJson from '../../../package.json';

export interface ApiEndpoint {
	path: string;
	method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
	authentication: 'anonymous' | 'credentialed';
	authForm?: 'api-key' | 'better-auth-session' | 'none';
	rateLimitBinding?: 'RATE_LIMIT_READ' | 'RATE_LIMIT_WRITE' | 'none';
	errorForm: string; // stable JSON error shape
	responseExample: unknown;
	purpose: string;
}

export const publicApiCatalog: readonly ApiEndpoint[] = [
	{
		path: '/api/v1/health',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'none',
		errorForm: '{ error: "not_found", path: ... } (404); no CORS credentials',
		responseExample: {
			status: 'ok',
			service: 'my-web-2026',
			layer: 'external-boundary',
			// The release version has exactly one source
			// (`package.json#version`, AGENTS.md §1). The health handler
			// answers with it (`src/http/hono.ts`), so a second literal
			// here would be a value that drifts on the next release.
			version: packageJson.version,
		},
		purpose: 'Public health / version probe. Read-only. No auth required.',
	},
	{
		path: '/api/v1/auth/*',
		method: 'GET',
		authentication: 'credentialed',
		authForm: 'better-auth-session',
		rateLimitBinding: 'none',
		errorForm:
			'403 cors_origin_rejected (preflight); 403 INVALID_ORIGIN (Better Auth); 404 not_found',
		responseExample: 'Better Auth session cookie / redirect. Credentialed CORS echo only.',
		purpose:
			'Better Auth session endpoints (login, session, sign-up disabled). Auth handled by Better Auth, not the public API-key contract.',
	},
	{
		path: '/api/v1/auth/*',
		method: 'POST',
		authentication: 'credentialed',
		authForm: 'better-auth-session',
		rateLimitBinding: 'none',
		errorForm:
			'403 cors_origin_rejected (preflight); 403 INVALID_ORIGIN (Better Auth); 404 not_found',
		responseExample: 'Better Auth write response (cookie set). Same CORS rules as GET.',
		purpose: 'Better Auth state-changing operations.',
	},
	{
		path: '/api/v1/reaction-images/:id',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm: '404 not_found (no body); 404 for missing / unapproved image; no CORS credentials',
		responseExample: {
			stream: '<binary>',
			contentType: 'image/webp',
			cacheControl: 'public, max-age=31536000, immutable',
		},
		purpose:
			'Public reaction-image delivery from R2. No API key required. Read-side rate limit applies.',
	},
	{
		path: '/api/v1/reactions',
		method: 'GET',
		authentication: 'credentialed',
		authForm: 'api-key',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'401 missing_authorization / invalid_api_key; 403 missing_scope; 400 invalid_target / invalid_actor_id',
		responseExample: {
			target_key: 'example',
			aggregates: { count: 3, selected: false },
			viewer_reactions: [],
		},
		purpose:
			'Aggregate reactions for a target, scoped to the authenticated API key. Requires reactions:read.',
	},
	{
		path: '/api/v1/reactions',
		method: 'PUT',
		authentication: 'credentialed',
		authForm: 'api-key',
		rateLimitBinding: 'RATE_LIMIT_WRITE',
		errorForm:
			'401 / 403 (same auth contract); 422 image reference rejected; 400 invalid_body; 429 rate_limited',
		responseExample: { created: true, id: 'uuid' },
		purpose:
			'Add or replace a reaction (idempotent by target + actor + image reference). Requires reactions:write.',
	},
	{
		path: '/api/v1/reactions',
		method: 'DELETE',
		authentication: 'credentialed',
		authForm: 'api-key',
		rateLimitBinding: 'RATE_LIMIT_WRITE',
		errorForm: '401 / 403; 400 invalid_body; 429 rate_limited',
		responseExample: { deleted: true },
		purpose: 'Remove a reaction. Requires reactions:write.',
	},
	{
		path: '/api/v1/access/hit',
		method: 'POST',
		authentication: 'credentialed',
		authForm: 'api-key',
		rateLimitBinding: 'RATE_LIMIT_WRITE',
		errorForm: '401 / 403 (scope access_counter:write); 400 invalid_body; 429 rate_limited',
		responseExample: { incremented: true, count: 7, first_hit: '2026-...', last_hit: '2026-...' },
		purpose:
			'Record a page view (idempotent within DEDUP_WINDOW_MS). Requires access_counter:write.',
	},
	{
		path: '/api/v1/access/count/:key',
		method: 'GET',
		authentication: 'credentialed',
		authForm: 'api-key',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm: '401 / 403 (scope access_counter:read); 400 invalid_key; 429 rate_limited',
		responseExample: { key: 'home', count: 42, principal: 'mk_...' },
		purpose: 'Read aggregate access count for a key, scoped to the authenticated principal.',
	},
];

/**
 * Routes that exist in the Hono boundary but are NOT part of the public
 * data contract listed above. They are excluded for explicit reasons:
 *
 * - `/api/v1/db/ping`, `/api/v1/media/ping` — operator binding probes,
 *   not a public data contract (no published schema, no auth contract,
 *   intended for operator diagnostics only).
 * - `/media/*` (via mediaRouter) — binary delivery gate (public key
 *   delivery through R2 approval). It is a delivery boundary, not a
 *   REST API contract; its response is binary, not JSON.
 * - `/sitemap.xml`, `/robots.txt` — crawler documents.
 * - `/.well-known/security.txt` — RFC 9116 document.
 * - Boundary middleware (`app.use(...)`, e.g. CORS / cache isolation /
 *   request id / CSRF) — it runs on the way to a contract and answers
 *   nothing itself. Hono reports it under `ALL`; the drift rule carries
 *   it with an explicit `ALL` exclusion rather than a blanket filter,
 *   so an `.all()` route at a path with no real verb is still reported
 *   (Issue #530 cold review F1).
 * - Mock routes (`LOCAL_API_MODE=mock`) — not a production surface.
 * - Internal server functions (`/_serverFn/*`) — handled by TanStack Start.
 * - Management / secret / admin endpoints — out of scope by design.
 *
 * The exclusion is a DECLARATION, not a description: every entry below
 * is a route the boundary really registers, and every one of them
 * carries the reason it is outside the public contract. The drift test
 * reads this list, so a route that the boundary serves and that nobody
 * catalogued or excluded fails the gate — the list cannot silently
 * absorb a public route.
 */
export interface ApiScopeExclusion {
	method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'ALL';
	path: string;
	reason: string;
}

export const publicApiScopeExclusions: readonly ApiScopeExclusion[] = [
	{
		method: 'GET',
		path: '/api/v1/db/ping',
		reason:
			'Operator binding probe. It answers with the D1 binding state and has no published schema or auth contract.',
	},
	{
		method: 'GET',
		path: '/api/v1/media/ping',
		reason:
			'Operator binding probe. It answers with the R2 binding state and has no published schema or auth contract.',
	},
	{
		method: 'GET',
		path: '/media/:key{.+}',
		reason:
			'Binary delivery gate for approved R2 objects. The response is a byte stream, not a JSON contract.',
	},
	{
		method: 'HEAD',
		path: '/media/:key{.+}',
		reason:
			'Binary delivery gate for approved R2 objects. The response is a byte stream, not a JSON contract.',
	},
	{
		method: 'GET',
		path: '/sitemap.xml',
		reason: 'Crawler document (XML). It is not a request/response data contract.',
	},
	{
		method: 'GET',
		path: '/robots.txt',
		reason: 'Crawler document (plain text). It is not a request/response data contract.',
	},
	{
		method: 'GET',
		path: '/.well-known/security.txt',
		reason: 'RFC 9116 document (plain text). It is not a request/response data contract.',
	},
	{
		method: 'ALL',
		path: '/api/v1/*',
		reason:
			'Boundary middleware mount (cache isolation, request id, CSRF guard, CORS). It runs on the way to a route and answers nothing itself, so it is not a published contract.',
	},
	{
		method: 'ALL',
		path: '/*',
		reason:
			'Boundary-wide CORS middleware. It runs on the way to every route and answers nothing itself, so it is not a published contract.',
	},
];
