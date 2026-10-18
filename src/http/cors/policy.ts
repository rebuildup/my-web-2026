/**
 * CORS policy for the external HTTP boundary (Issue #455).
 *
 * The boundary serves two structurally different kinds of endpoint, and
 * conflating them is the failure this module exists to prevent:
 *
 *   - `credentialed` — anything that answers to a cookie, a session, or
 *     an `Authorization: Bearer <api key>` header. Today that is
 *     `/api/v1/auth/*` (Better Auth sessions),
 *     `/api/v1/access/*` and `/api/v1/reactions` (API key + scope).
 *     These routes get an **explicit origin allow-list**: the response
 *     echoes one concrete origin and adds
 *     `Access-Control-Allow-Credentials: true`. A wildcard is never
 *     emitted here, because the Fetch standard makes
 *     `Access-Control-Allow-Origin: *` + credentials unusable, and a
 *     future "fix" that replaced the echo with `*` would silently
 *     re-open cross-site credential access.
 *   - `public-read` — unauthenticated, read-only, public data. Today
 *     `/api/v1/health` and `/api/v1/reaction-images/:id`. These get
 *     `Access-Control-Allow-Origin: *` and **never**
 *     `Access-Control-Allow-Credentials`, because there is no secret
 *     behind them to protect.
 *   - `none` — the default for every other path, including the
 *     unimplemented `/webhooks/*`, `/oauth/*` and `/integrations/*`
 *     prefixes. No CORS header is emitted at all, so a browser treats
 *     the response as opaque to script.
 *
 * Everything else is **refusal**. A cross-origin preflight, or an
 * actual cross-origin write, that carries an origin outside the
 * allow-list, asks for a method the route does not serve, or asks for a
 * request header outside the fixed allow-list, is answered `403` with a
 * stable error code and **no CORS header at all**. Failing closed is
 * observable (`403 cors_origin_rejected` in a log, a request id to
 * correlate) instead of the silent `204` a permissive preflight handler
 * would produce.
 *
 * The one exception is an actual (non-preflight) `GET`/`HEAD` from an
 * origin outside the allow-list: it reaches the handler with no
 * `Access-Control-Allow-Origin`, so a browser still cannot read the
 * body, but a cross-site read stays non-destructive. Issue #440's CSRF
 * contract records `GET`/`HEAD` as unaffected by the origin check, and
 * refusing them here would turn a CORS concern into a server-side read
 * outage for non-browser clients that set `Origin`.
 *
 * Origin allow-list sources (in resolution order, all of them runtime
 * inputs — this module holds no origin literal):
 *
 *   1. the origin the request itself arrived on (same-origin). This is
 *      what keeps local dev (`http://localhost:3000`), preview
 *      deployments and every per-PR Worker URL working without any
 *      configuration.
 *   2. `env.BETTER_AUTH_URL`, the same value Better Auth feeds into its
 *      own `trustedOrigins` (`src/cloudflare/auth/better-auth.ts`) and
 *      the same value `wrangler.production.jsonc` pins to
 *      `https://rebuildup.dev`. One knob for both surfaces, so the two
 *      cannot drift.
 *
 * The literal string `null` (the opaque origin a sandboxed Tool iframe
 * such as `/tools/<slug>/app/*` produces) is never allowed on a
 * `credentialed` route.
 *
 * Pure module: no Hono, no `Env`, no I/O. `middleware.ts` is the only
 * caller, and it exists purely to read headers off the Hono context and
 * render the decision. Keeping the decision pure is what lets the
 * workerd suite assert the header matrix directly.
 */

export type CorsClass = 'credentialed' | 'public-read' | 'none';

export type CorsRefusalCode =
	| 'cors_origin_rejected'
	| 'cors_method_rejected'
	| 'cors_header_rejected';

/** One classified boundary route. */
export interface CorsRoute {
	/**
	 * Exact path, or a path prefix matched as `path === match` /
	 * `path.startsWith(`${match}/`)`. The `/`-anchored form is what
	 * keeps `/api/v1/reaction-images` (public) from being classified by
	 * the `/api/v1/reactions` (credentialed) entry, and what keeps
	 * `/api/v1/reactionsv2` from inheriting either.
	 */
	readonly path: string;
	readonly klass: CorsClass;
	/** Methods this route advertises, `OPTIONS` included. */
	readonly methods: readonly string[];
}

/**
 * The classified inventory. `test/integration/cors.test.ts` asserts
 * every route registered on `externalBoundary` appears here, so a new
 * endpoint cannot ship without a CORS decision.
 */
export const CORS_ROUTES: readonly CorsRoute[] = Object.freeze([
	{
		path: '/api/v1/auth',
		klass: 'credentialed',
		// `authRouter.on(['GET', 'POST'], '/api/v1/auth/*', ...)`.
		methods: Object.freeze(['GET', 'HEAD', 'POST', 'OPTIONS']),
	},
	{
		path: '/api/v1/access',
		klass: 'credentialed',
		// `POST /hit`, `GET /count/:key`.
		methods: Object.freeze(['GET', 'HEAD', 'POST', 'OPTIONS']),
	},
	{
		path: '/api/v1/reactions',
		klass: 'credentialed',
		// `PUT /`, `DELETE /`, `GET /?target=`.
		methods: Object.freeze(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']),
	},
	{
		path: '/api/v1/reaction-images',
		klass: 'public-read',
		// `GET /:id`, public by design (see `reactionsRouter`).
		methods: Object.freeze(['GET', 'HEAD', 'OPTIONS']),
	},
	{
		path: '/api/v1/health',
		klass: 'public-read',
		methods: Object.freeze(['GET', 'HEAD', 'OPTIONS']),
	},
	// `/api/v1/db/ping` and `/api/v1/media/ping` are deliberately
	// ABSENT. They are operator diagnostics, not public data: a
	// wildcard would hand any site a scriptable liveness probe of the
	// production bindings. They stay `none` (no CORS header, browser
	// treats the body as opaque).
] as CorsRoute[]);

/**
 * Request headers a cross-origin caller may ask for in a preflight.
 *
 * `authorization` (API key) and `content-type` (JSON bodies) are the
 * only non-safelisted headers the boundary accepts. Anything else is
 * refused rather than echoed, so the allow-list cannot be widened by a
 * caller naming a header the operators never reviewed.
 */
export const CORS_REQUEST_HEADERS: readonly string[] = Object.freeze([
	'authorization',
	'content-type',
]);

/**
 * Preflight cache lifetime. Ten minutes: long enough that a page load
 * issues one preflight per route, short enough that revoking an origin
 * from the allow-list takes effect without a redeploy.
 */
export const CORS_MAX_AGE_SECONDS = 600;

/** Stable path prefix used for every refusal body. */
export const CORS_REFUSAL_STATUS = 403;

export interface CorsDecisionInput {
	/**
	 * For a preflight, the method the caller wants to use
	 * (`Access-Control-Request-Method`), so a `DELETE` preflight against
	 * a read-only route is classified against `DELETE` and not against
	 * the literal `OPTIONS` on the wire.
	 */
	readonly method: string;
	readonly path: string;
	/** `Origin` header value, or `null` when the header is absent. */
	readonly origin: string | null;
	/** Origin of the request URL itself (always same-origin by definition). */
	readonly requestOrigin: string;
	/** Extra origins from runtime configuration (`env.BETTER_AUTH_URL`). */
	readonly extraAllowedOrigins: readonly string[];
	/** `Access-Control-Request-Headers`, preflight only. */
	readonly requestedHeaders?: readonly string[];
	readonly preflight: boolean;
}

export type CorsDecision =
	| {
			readonly kind: 'passthrough';
			readonly klass: CorsClass;
			readonly headers: Readonly<Record<string, string>>;
	  }
	| {
			readonly kind: 'preflight';
			readonly klass: CorsClass;
			readonly headers: Readonly<Record<string, string>>;
	  }
	| {
			readonly kind: 'refuse';
			readonly klass: CorsClass;
			readonly code: CorsRefusalCode;
			readonly headers: Readonly<Record<string, string>>;
	  };

function matchesPrefix(path: string, prefix: string): boolean {
	return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Resolve the CORS class for a request.
 *
 * Returns the route whose path matches (even when the method is not one
 * it serves, so the caller can refuse with `cors_method_rejected` rather
 * than degrading to an unclassified path), or `null` when no CORS
 * decision exists for the path — that is the `none` class.
 */
export function classifyRoute(method: string, path: string): CorsRoute | null {
	const wanted = method.toUpperCase();
	let pathMatch: CorsRoute | null = null;
	for (const route of CORS_ROUTES) {
		if (!matchesPrefix(path, route.path)) continue;
		if (pathMatch === null) pathMatch = route;
		if (route.methods.includes(wanted)) return route;
	}
	return pathMatch;
}

/**
 * Normalize an origin for comparison, or `null` when it is not a usable
 * `http(s)` origin.
 *
 * `null` (the sandboxed-iframe opaque origin) and any non-`http(s)`
 * scheme are rejected here rather than at each call site, so no
 * comparison can ever be tricked into accepting them.
 */
export function normalizeOrigin(value: string): string | null {
	const candidate = value.trim();
	if (candidate === '' || candidate.toLowerCase() === 'null') return null;
	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
	// `origin` on a URL is already `scheme://host[:port]` with the
	// default port dropped, which is exactly the `Origin` header form.
	return url.origin;
}

/**
 * Exact-match origin comparison. Substring / suffix / `startsWith`
 * matching is the classic CORS allow-list bug
 * (`https://rebuildup.dev.evil.example`, `https://evilrebuildup.dev`,
 * a different port on the same host), so the only accepted form is a
 * normalized string equality.
 */
export function isAllowedOrigin(origin: string, allowed: readonly string[]): boolean {
	const candidate = normalizeOrigin(origin);
	if (candidate === null) return false;
	return allowed.some((entry) => normalizeOrigin(entry) === candidate);
}

function parseRequestedHeaders(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value.length > 0);
}

/** Methods advertised for a route, minus `OPTIONS`, as a header value. */
function advertisedMethods(route: CorsRoute): string {
	return route.methods.filter((method) => method !== 'OPTIONS').join(', ');
}

/**
 * Does a preflight asking for `method` name something the route serves?
 *
 * `OPTIONS` is listed on every route because the route HAS to answer
 * the preflight itself, but it is never a method a preflight may ask
 * for: a route advertises `GET, HEAD, PUT, DELETE`, so accepting a
 * requested `OPTIONS` would answer `204` with a method list that does
 * not contain the method that was asked for. `OPTIONS` is CORS-
 * safelisted, so no browser sends one — the point is that the answer
 * stays internally consistent rather than silently widening.
 */
function servesRequestedMethod(route: CorsRoute, method: string): boolean {
	const wanted = method.toUpperCase();
	if (wanted === 'OPTIONS') return false;
	return route.methods.includes(wanted);
}

/**
 * Is this an actual (non-preflight) request whose method carries no
 * state change? `GET`/`HEAD` are the only methods Issue #440 treats as
 * unconditionally safe, and they are the only ones that may proceed
 * without a CORS echo.
 */
function isSafeReadMethod(method: string): boolean {
	const wanted = method.toUpperCase();
	return wanted === 'GET' || wanted === 'HEAD';
}

function refuse(
	route: CorsRoute,
	code: CorsRefusalCode,
	headers: Record<string, string>,
): CorsDecision {
	return { kind: 'refuse', klass: route.klass, code, headers };
}

/**
 * The whole policy: classify, verify the origin, verify the method and
 * header allow-lists, then either pass through, answer the preflight, or
 * refuse.
 */
export function decideCors(input: CorsDecisionInput): CorsDecision {
	const route = classifyRoute(input.method, input.path);
	if (route === null) {
		return { kind: 'passthrough', klass: 'none', headers: {} };
	}

	// `Vary: Origin` accompanies every outcome that DEPENDS ON the
	// request's origin — the credentialed echo, and (for the same
	// reason) the credentialed refusals: a refusal is a decision ABOUT
	// an origin, so a shared cache must never serve one origin's
	// refusal to another. It is emitted whether or not the request
	// carried an `Origin` header, because a response that echoed a
	// concrete origin must never be replayed to a request that carries
	// none (or the other way round).
	//
	// The `public-read` class deliberately carries NO `Vary`. Its
	// answer is `Access-Control-Allow-Origin: *`, which is byte-identical
	// for every origin — a wildcard does not vary on `Origin` — so the
	// header would buy no correctness and would fragment the public
	// immutable reaction-image payload across shared caches for no
	// reason. Issue #460's cache-isolation contract requires that
	// payload to stay free of a `Vary` dimension
	// (`test/integration/cache-isolation.test.ts`).
	const base: Record<string, string> = route.klass === 'credentialed' ? { Vary: 'Origin' } : {};

	if (input.origin === null) {
		// No `Origin`: not a cross-origin browser request. The SSR
		// loaders (`src/home/{access,reactions}/load.ts`), curl and the
		// E2E suite all land here and must keep working unchanged.
		return { kind: 'passthrough', klass: route.klass, headers: base };
	}

	const allowed = input.preflight ? servesRequestedMethod(route, input.method) : true;

	if (route.klass === 'credentialed') {
		if (!isAllowedOrigin(input.origin, [input.requestOrigin, ...input.extraAllowedOrigins])) {
			// A safe read from a foreign origin still reaches the handler
			// (`Vary: Origin`, no allow-origin pair), so the browser
			// cannot read it but Issue #440's "cross-site reads stay
			// readable" contract and non-browser clients that set an
			// `Origin` header keep working. Preflights and every
			// state-changing method still fail closed.
			if (!input.preflight && isSafeReadMethod(input.method)) {
				return { kind: 'passthrough', klass: route.klass, headers: base };
			}
			return refuse(route, 'cors_origin_rejected', base);
		}
		if (!allowed) {
			return refuse(route, 'cors_method_rejected', base);
		}
		const requested = input.requestedHeaders ?? [];
		const rejected = requested.find((header) => !CORS_REQUEST_HEADERS.includes(header));
		if (rejected !== undefined) {
			return refuse(route, 'cors_header_rejected', base);
		}
		const headers: Record<string, string> = {
			...base,
			// Echo ONE concrete origin. Never `*`, never `null`.
			'Access-Control-Allow-Origin': input.origin,
			'Access-Control-Allow-Credentials': 'true',
		};
		// Preflight-only headers. On an actual response a browser reads
		// `Access-Control-Allow-Origin` + `-Credentials` and ignores the
		// rest, so emitting them there would be surface nobody consumes.
		if (input.preflight) {
			headers['Access-Control-Allow-Methods'] = advertisedMethods(route);
			headers['Access-Control-Max-Age'] = String(CORS_MAX_AGE_SECONDS);
			if (requested.length > 0) {
				headers['Access-Control-Allow-Headers'] = requested.join(', ');
			}
		}
		if (input.preflight) return { kind: 'preflight', klass: route.klass, headers };
		return { kind: 'passthrough', klass: route.klass, headers };
	}

	// `public-read`: wildcard, never credentials.
	const requested = input.requestedHeaders ?? [];
	if (requested.length > 0) {
		// A preflight that names a request header is a credentialed
		// request (`Authorization`) — it does not belong on a route
		// whose contract is "public, no credentials".
		return refuse(route, 'cors_header_rejected', base);
	}
	if (input.preflight && !allowed) {
		return refuse(route, 'cors_method_rejected', base);
	}
	const headers: Record<string, string> = {
		...base,
		'Access-Control-Allow-Origin': '*',
	};
	// Preflight-only, for the same reason as the credentialed branch.
	if (input.preflight) {
		headers['Access-Control-Allow-Methods'] = advertisedMethods(route);
		headers['Access-Control-Max-Age'] = String(CORS_MAX_AGE_SECONDS);
	}
	if (input.preflight) return { kind: 'preflight', klass: route.klass, headers };
	return { kind: 'passthrough', klass: route.klass, headers };
}

/**
 * The invariant this whole Issue is about, expressed as code so it is
 * checked by the test suite instead of by review: a response may only
 * carry `Access-Control-Allow-Credentials` when its
 * `Access-Control-Allow-Origin` is a single concrete origin.
 *
 * Returns `null` when the header set is sound, or a description of the
 * violation when it is not.
 */
export function credentialWildcardViolation(
	headers: Readonly<Record<string, string>>,
): string | null {
	if (headers['Access-Control-Allow-Credentials'] === undefined) return null;
	const allowOrigin = headers['Access-Control-Allow-Origin'];
	if (allowOrigin === undefined) return 'Access-Control-Allow-Credentials without Allow-Origin';
	if (allowOrigin === '*') return 'Access-Control-Allow-Credentials with a wildcard origin';
	if (allowOrigin.toLowerCase() === 'null')
		return 'Access-Control-Allow-Credentials with null origin';
	return null;
}
