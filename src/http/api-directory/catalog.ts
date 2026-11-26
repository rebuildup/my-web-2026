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
	{
		path: '/api/v1/github-readme-stats/api',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'400 missing_username; 404 user_not_found; 500 upstream_error; SVG error card always returned on failure',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'max-age=86400, s-maxage=86400, stale-while-revalidate=86400',
		},
		purpose:
			'Public GitHub stats card (total stars, commits, PRs, issues, etc.). Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-readme-stats/api/top-langs/',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'400 missing_username; 404 user_not_found; 500 upstream_error; SVG error card always returned on failure',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'max-age=86400, s-maxage=86400, stale-while-revalidate=86400',
		},
		purpose: 'Public top languages card. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-readme-stats/api/streak',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'400 missing_username; 401 token_not_configured; 404 user_not_found; 500 upstream_error; SVG error card always returned on failure',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'max-age=3600, s-maxage=3600, stale-while-revalidate=3600',
		},
		purpose:
			'Public contribution streak card. Anonymous access but requires server-side GitHub token. Returns SVG.',
	},
	{
		path: '/api/v1/github-readme-stats/api/pin/',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'400 missing_username_or_repo; 404 repo_not_found; 500 upstream_error; SVG error card always returned on failure',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'max-age=604800, s-maxage=604800, stale-while-revalidate=604800',
		},
		purpose: 'Public repository pin card. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/card',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the card always answers 200 — missing / stale / invalid data renders an honest unavailable state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'DEPRECATED (ADR-0025): single-image GitHub profile card for the rebuildup/rebuildup README (Issue #1170). Superseded by /api/v1/github-profile/status + static work images; kept serving unchanged until removal. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/status',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the status strip always answers 200 — missing / stale / invalid data renders an honest unavailable state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Dynamic status strip for the rebuildup/rebuildup profile README "Now" section (Issue #1196): GitHub activity + Discord presence snapshots with observation times, no raster media. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/now',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the strip always answers 200 — failed upstreams render — with an unavailable note inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Unified status strip for the rebuildup/rebuildup profile README (Issue #1205): GitHub contributions / current & longest streak / top language (readme-stats fetchers, hourly upstream cache) plus GitHub activity and Discord presence panels with observation times. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/activity',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the card always answers 200 — missing / stale / invalid snapshot data renders an honest unavailable state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Dynamic activity card for the rebuildup/rebuildup profile README (ADR-0026, Issue #1212): per-repository event bars plus the public feed with JST timestamps and an observation stamp. Private repositories are aggregated anonymously. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/presence',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the chip always answers 200 — missing / stale / mismatched-user presence renders an honest unavailable or stale state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Discord presence chip for the rebuildup/rebuildup profile README (ADR-0026, Issue #1212), served independently from the activity card so the two freshness contracts never share a response or a cache entry. JST observation stamp. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/current',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the card always answers 200 — an empty project set renders an honest empty state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'In-progress projects card for the rebuildup/rebuildup profile README (ADR-0026, Issue #1216): the same currentProjectsLoader composition the site renders — roster declarations plus measured git/GitHub facts — so "what is being worked on" survives the /now retirement. Committed data only; no request-time fetch. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/identity',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the band always answers 200 — missing / stale upstreams render honest unavailable states inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Identity band for the rebuildup/rebuildup profile README (ADR-0026, Issue #1216): avatar, vitals (streak / languages / contributed repos / rank), latest public signals and a Discord-style presence card in one glanceable SVG. Query params: theme=dark|light, layout=mobile. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/stack',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm: '405 method_not_allowed',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=3600, s-maxage=3600',
		},
		purpose:
			'Technology-stack marquee band for the rebuildup/rebuildup profile README (Issue #1216): the committed skill-icons set scrolling horizontally inside one SVG row, replacing the tall vertical icon groups. Query params: theme=dark|light, layout=mobile. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/activity-map',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the band always answers 200 — a missing activity snapshot renders an honest unavailable state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Activity band for the rebuildup/rebuildup profile README (ADR-0026, Issue #1216): 30-day per-repository commit/PR output plus a 72-hour public-event pulse anchored to the snapshot observation time; private repositories aggregate anonymously. Query params: theme=dark|light, layout=mobile. Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/vitals',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the surface always answers 200 — a missing stats snapshot renders honest unavailable states inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Vitals surface for the rebuildup/rebuildup profile README (Issue #1244): the account-figures strip (streak / contributions / stars / commits / PRs / issues) rendered from the github_stats_snapshot D1 row alone — no request-time upstream call. Query params: theme=dark|light, layout=mobile, grid=1 (review overlay). Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/top-languages',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the surface always answers 200 — a missing stats snapshot renders an honest unavailable state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Top-languages surface for the rebuildup/rebuildup profile README (Issue #1244): the owned-scope language share bar and legend rendered from the github_stats_snapshot D1 row alone — no request-time upstream call. Query params: theme=dark|light, layout=mobile, grid=1 (review overlay). Anonymous access. Returns SVG.',
	},
	{
		path: '/api/v1/github-profile/profile',
		method: 'GET',
		authentication: 'anonymous',
		authForm: 'none',
		rateLimitBinding: 'RATE_LIMIT_READ',
		errorForm:
			'405 method_not_allowed; the composition always answers 200 — a missing activity snapshot renders an honest unavailable state inside the SVG',
		responseExample: {
			contentType: 'image/svg+xml',
			cacheControl: 'public, max-age=300, s-maxage=300',
		},
		purpose:
			'Composed profile for the rebuildup/rebuildup profile README (Issue #1235): identity, GitHub activity and technology stack as ONE SVG canvas on the shared layout contract — section heads, common spine, module hierarchy. Query params: theme=dark|light, layout=mobile, grid=1 (review overlay). Anonymous access. Returns SVG.',
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
		method: 'PUT',
		path: '/api/v1/activity/github',
		reason:
			'Operator ingest endpoint (Issues #316 / #319 / #932): the operator-side sync script pushes the anonymised GitHub activity snapshot here. It is a write-only pipeline boundary with a dedicated github_activity:write key, not a public data contract — the public surface reads D1 at SSR time and never calls this route.',
	},
	{
		method: 'PUT',
		path: '/api/v1/stats/github',
		reason:
			'Operator ingest endpoint (Issues #1244 / #1245): the operator-side stats sync pushes the scope×window GitHub stats snapshot here. It is a write-only pipeline boundary with a dedicated github_stats:write key, not a public data contract — the public surface reads D1 at request time and never calls this route.',
	},
	{
		method: 'PUT',
		path: '/api/v1/presence/discord',
		reason:
			'Operator ingest endpoint (Issue #320): the operator-side Discord Gateway script pushes the owner-presence snapshot here. It is a write-only pipeline boundary with a dedicated discord_presence:write key, not a public data contract — the public surface reads D1 at SSR time and never calls this route.',
	},
	{
		method: 'ALL',
		path: '/*',
		reason:
			'Boundary-wide CORS middleware. It runs on the way to every route and answers nothing itself, so it is not a published contract.',
	},
];
