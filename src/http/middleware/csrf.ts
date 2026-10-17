import { createMiddleware } from 'hono/factory';

/**
 * Cross-site request forgery guard for the Hono external boundary
 * (Issue #440).
 *
 * Ownership
 * ---------
 * ADR-0002 splits traffic in two, and each layer owns its own CSRF
 * decision:
 *
 *   - TanStack Start server functions (`/_serverFn/*`) are covered by
 *     the framework's **default CSRF middleware**, which is only
 *     installed while `src/start.ts` (a custom `startInstance`) is
 *     absent. That default covers the internal mutation surface.
 *   - Everything the Hono boundary answers (`/api/v1/*`,
 *     `/webhooks/*`, `/oauth/*`, `/integrations/*`) is OUTSIDE that
 *     middleware: the Worker entry dispatches to Hono **before** the
 *     Start handler runs. ADR-0002 assigns "their own authentication
 *     and origin checks" to those handlers, and this module is that
 *     check for the write methods.
 *
 * Why the decision order is copied from the framework
 * ---------------------------------------------------
 * `createStartHandler` installs
 * `createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })`
 * with the library defaults:
 *
 *   1. `Sec-Fetch-Site` present  -> must equal `same-origin`
 *   2. else `Origin` present     -> must equal the request origin
 *   3. else `Referer` present    -> must be same-origin
 *   4. else                      -> reject (`allowRequestsWithoutOriginCheck`
 *                                    defaults to `false`)
 *
 * Reproducing that order verbatim means the two layers reject exactly
 * the same requests, so "which layer refused this POST?" has one
 * answer that does not depend on which URL prefix the caller used.
 * If TanStack Start ever changes its defaults, this module must be
 * re-read in the same change (ADR-0002 re-evaluation trigger).
 *
 * Scope rules (deliberate, not accidental)
 * ----------------------------------------
 *   - **Safe methods are never checked.** `GET` / `HEAD` / `OPTIONS`
 *     answer no write; the boundary exposes no state-changing GET, and
 *     `test/integration/csrf-contract.test.ts` pins that with a
 *     before/after D1 read. A safe method that is rejected would break
 *     legitimate readers, so the guard runs on unsafe methods only.
 *   - **No credential-based exemption.** The boundary's writes are
 *     authenticated with `Authorization: Bearer <api key>`, which a
 *     browser cannot attach cross-site by itself, so classic CSRF does
 *     not apply to them. Exempting them anyway would have made this
 *     guard untestable for the very requests that matter, so instead
 *     the in-repo first-party callers declare their own origin: the
 *     Home self-call (`src/home/{access,reactions}/load.ts`) sends
 *     `Origin: <the origin it is calling>`. An operator driving the
 *     API from a script must send the same header; that is a
 *     documented cost, not an accident.
 *   - **`/api/v1/auth/*` is owned by Better Auth.** It validates the
 *     `Origin` header of any **cookie-carrying** write against
 *     `trustedOrigins` (configured from `BETTER_AUTH_URL`,
 *     `src/cloudflare/auth/better-auth.ts`) and blocks cross-site
 *     *navigation* login submissions through its form-CSRF middleware.
 *     A second, weaker check in front of it would reject legitimate
 *     first-party sign-in POSTs that carry no browser fetch-metadata
 *     (server-side clients, curl, the integration tests) while adding
 *     no protection Better Auth does not already have.
 *   - **The local mock gate sits in front of this middleware.** When
 *     `LOCAL_API_MODE=mock`, `src/http/hono.ts` answers from
 *     in-memory canned data before any security middleware runs. The
 *     mock has no D1 / R2 side effects, so it has no state for a
 *     cross-site request to corrupt.
 *
 * Rejection is fail-closed and does not echo anything the caller sent:
 * the response body carries a stable `error` code plus a `reason`
 * naming **which header** was missing or mismatched, never its value.
 */

/** Methods that must present a same-origin signal. */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Path prefixes this guard does not own, each with the owner that
 * does. Fail-open on this list is a deliberate, reviewable decision —
 * every entry has to name its replacement check.
 */
export const CSRF_EXEMPT_PREFIXES: readonly string[] = ['/api/v1/auth'];

/** Stable `reason` codes. Values only; nothing caller-supplied is echoed. */
export type CsrfRejectionReason =
	| 'cross_site_fetch_metadata'
	| 'origin_mismatch'
	| 'referer_mismatch'
	| 'origin_check_missing';

export interface CsrfDecision {
	allowed: boolean;
	/** Why the request was allowed. Present on every allow, absent on a refusal. */
	accepted_as?: 'safe_method' | 'exempt_prefix' | 'same_origin';
	/** Why the request was refused. Present only on a refusal. */
	reason?: CsrfRejectionReason;
}

/** Error code returned to the caller on a refusal. */
export const CSRF_REJECTED_ERROR = 'csrf_rejected';

/** HTTP status used for every refusal. */
export const CSRF_REJECTED_STATUS = 403;

export function isSafeMethod(method: string): boolean {
	return SAFE_METHODS.has(method.toUpperCase());
}

/** Exact-prefix-or-`/` match, mirroring `src/server.ts`. */
function matchesPrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isCsrfExemptPath(pathname: string): boolean {
	return CSRF_EXEMPT_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

/**
 * Same-origin `Referer` check.
 *
 * String-prefix comparison plus an explicit delimiter check, so
 * `https://rebuildup.dev.evil.example` cannot satisfy a
 * `https://rebuildup.dev` referer. Same rule as the framework's
 * `isRefererSameOrigin`.
 */
function isRefererSameOrigin(referer: string, requestOrigin: string): boolean {
	if (referer === requestOrigin) return true;
	if (!referer.startsWith(requestOrigin)) return false;
	const delimiter = referer.charCodeAt(requestOrigin.length);
	return delimiter === 47 /* "/" */ || delimiter === 63 /* "?" */ || delimiter === 35; /* "#" */
}

/**
 * Pure decision function so the unit test can cover the matrix without
 * a Worker, and so the middleware body stays a transport wrapper.
 */
export function evaluateCsrf(
	request: Request,
	pathname = new URL(request.url).pathname,
): CsrfDecision {
	if (isSafeMethod(request.method)) return { allowed: true, accepted_as: 'safe_method' };
	if (isCsrfExemptPath(pathname)) return { allowed: true, accepted_as: 'exempt_prefix' };

	const requestOrigin = new URL(request.url).origin;

	const fetchSite = request.headers.get('Sec-Fetch-Site');
	if (fetchSite !== null) {
		return fetchSite === 'same-origin'
			? { allowed: true, accepted_as: 'same_origin' }
			: { allowed: false, reason: 'cross_site_fetch_metadata' };
	}

	const origin = request.headers.get('Origin');
	if (origin !== null) {
		// `Origin: null` is what a sandboxed iframe / `file:` document
		// sends; it is never same-origin.
		return origin === requestOrigin
			? { allowed: true, accepted_as: 'same_origin' }
			: { allowed: false, reason: 'origin_mismatch' };
	}

	const referer = request.headers.get('Referer');
	if (referer !== null) {
		let refererOrigin: string | null = null;
		try {
			refererOrigin = new URL(referer).origin;
		} catch {
			refererOrigin = null;
		}
		return refererOrigin !== null && isRefererSameOrigin(referer, requestOrigin)
			? { allowed: true, accepted_as: 'same_origin' }
			: { allowed: false, reason: 'referer_mismatch' };
	}

	// Fail closed: a write with no origin evidence at all is exactly
	// the request shape a cross-site `no-cors` form POST produces.
	return { allowed: false, reason: 'origin_check_missing' };
}

/**
 * Hono middleware wrapper around {@link evaluateCsrf}.
 *
 * Mounted on `/api/v1/*` in `src/http/hono.ts`, after the request-id
 * middleware so a refusal still carries the correlation header.
 */
export const csrfGuard = createMiddleware<{ Bindings: Env }>(async (c, next) => {
	const decision = evaluateCsrf(c.req.raw, c.req.path);
	if (!decision.allowed) {
		return c.json({ error: CSRF_REJECTED_ERROR, reason: decision.reason }, CSRF_REJECTED_STATUS);
	}
	await next();
	return undefined;
});
