/**
 * Admin path classification (Issue #654).
 *
 * Why this module exists
 * ----------------------
 * Two request-path decisions must agree with the router:
 *
 *   - `src/server.ts#applyHtmlCachePolicy` answers an Admin document
 *     with `no-store`, from the path alone;
 *   - `classifySurface` in the anomaly monitor counts Admin traffic
 *     under the watched `admin` surface.
 *
 * They used to compare the raw pathname case-sensitively, each with
 * its own copy of the rule. `/ADMIN/KEYS` then rendered the admin
 * screen while receiving the generic HTML cache policy and being
 * counted as unclassified. One owner for the rule is what makes those
 * two answers impossible to drift apart.
 *
 * The rule TanStack Router applies
 * --------------------------------
 * `src/router.tsx` does not set `caseSensitive`, and the router default
 * is `false`: static segments are compared case-insensitively. Before
 * matching, the router also percent-decodes the request pathname
 * (`decodePath` calls `decodeURI` per segment), so `/%61dmin/keys`
 * reaches `/admin/keys` as well.
 *
 * This module mirrors both steps:
 *
 *   decodeURI(pathname) -> toLowerCase() -> exact '/admin' or '/admin/…'
 *
 * `decodeURI` — not `decodeURIComponent` — is the matching primitive:
 * it leaves reserved separators (`%2F`, `%23`, `%3F`) encoded, which is
 * why `/admin%2Fkeys` is NOT the Admin surface. The router answers that
 * path 404, and classifying it as Admin would put an ordinary miss
 * under the admin cache rule.
 *
 * A malformed escape makes `decodeURI` throw. The router answers those
 * requests 400 and the Worker entry must reach that answer rather than
 * crash on a classifier, so the fallback uses the raw pathname — which
 * cannot be an Admin path, because the escaped prefix it would need is
 * exactly what failed to decode.
 *
 * Exact-prefix-or-`/` is deliberate, for the same reason
 * `matchesExternalBoundary` guards `/api/v10`: `/administration`,
 * `/adminish` and `//admin` are not the Admin surface.
 */

const ADMIN_PATH = '/admin';

/**
 * Does this request path resolve to the Admin surface?
 *
 * Accepts the raw pathname (`new URL(request.url).pathname`), i.e. the
 * value both call sites already hold.
 */
export function isAdminPath(pathname: string): boolean {
	const normalised = normaliseRouterPathname(pathname);
	return normalised === ADMIN_PATH || normalised.startsWith(`${ADMIN_PATH}/`);
}

/**
 * The two transformations the router applies before matching, in the
 * router's order (decode, then case-fold). A malformed escape degrades
 * to the raw pathname instead of throwing.
 */
function normaliseRouterPathname(pathname: string): string {
	try {
		return decodeURI(pathname).toLowerCase();
	} catch {
		return pathname.toLowerCase();
	}
}
