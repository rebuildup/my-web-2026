/**
 * The platform's request-path reading contract (Issue #700).
 *
 * What this module owns
 * ----------------------
 * ONE rule: **how a request path is READ**. Three surfaces have to
 * answer the same question about the same request — "which document
 * is this URL?" — and they used to carry their own copies of the
 * answer:
 *
 *   - `src/server.ts#applyHtmlCachePolicy` decides an Admin document's
 *     `Cache-Control` from the path alone;
 *   - `classifySurface` in the anomaly monitor counts Admin traffic
 *     under the watched `admin` surface;
 *   - `isAnalyticsMountPath` in `src/editorial/analytics/consent.ts`
 *     decides whether the GA4 tag may mount on this document.
 *
 * A copy that reads the path differently from the ROUTER answers
 * differently for the same request, and the difference lands on a
 * privacy boundary: `/%61dmin/keys` renders the admin screen, so a
 * reader that does not percent-decode calls it a public page and lets
 * the analytics tag mount on the operator's own surface.
 *
 * Why this obligation owns it
 * ---------------------------
 * Reading a request path is **URL text policy** — the same family of
 * rule this obligation already owns for display text and URL slugs
 * (ADR-0017): which byte sequences denote the same published URL, and
 * which of them the platform is allowed to treat as one word. It is a
 * LEAF obligation (no repository import), so the HTTP boundary and
 * the editorial surface can both depend on it without depending on
 * each other — which they must, because `editorial` may not import
 * `http` (AGENTS.md §3). A rule both of them need, and neither may
 * own, is what a leaf obligation is for.
 *
 * The rule TanStack Router applies
 * ---------------------------------
 * `src/router.tsx` does not set `caseSensitive`, and the router
 * default is `false`: static segments are compared case-insensitively.
 * The request pathname also arrives percent-decoded before matching —
 * h3's `H3Event` constructor decodes it (`decodePathname`, which keeps
 * `%25` by doubling it), and router-core's `decodePath` decodes it
 * again per segment — so `/%61dmin/keys` reaches `/admin/keys` too.
 *
 * This module mirrors both steps:
 *
 *   decodeURI(pathname) -> toLowerCase() -> exact '<namespace>' or '<namespace>/…'
 *
 * `decodeURI` — not `decodeURIComponent` — is the matching primitive:
 * it leaves reserved separators (`%2F`, `%23`, `%3F`) encoded, which is
 * why `/admin%2Fkeys` is NOT the Admin surface. The route tree answers
 * that path 404, and classifying it as Admin would put an ordinary miss
 * under the admin cache rule.
 *
 * A malformed escape makes `decodeURI` throw. In the request path that
 * 400 does NOT come from route matching: the `H3Event` constructor's
 * `decodePathname` throws `URIError`, and
 * `@tanstack/start-server-core` converts it to a 400 before the route
 * tree is consulted (router-core's `decodePath` itself tolerates
 * malformed input and preserves `%25` / `%5C`). The Worker entry must
 * reach that 400 rather than crash on a classifier, so the fallback
 * uses the raw pathname — which cannot be an Admin path, because the
 * escaped prefix it would need is exactly what failed to decode.
 *
 * Exact-prefix-or-`/` is deliberate, for the same reason
 * `matchesExternalBoundary` guards `/api/v10`: `/administration`,
 * `/adminish` and `//admin` are not the Admin surface.
 */

/**
 * The request-path namespace the operator surface owns.
 *
 * The route tree owns the ROUTES; this value is the namespace those
 * routes live in, and it is published here because two obligations
 * have to recognise it (the HTTP boundary's Admin classifiers and the
 * analytics mount gate) and neither may import the other.
 *
 * `test/integration/analytics-admin-path-parity.test.ts` pins it
 * against the router's own route tree, so a renamed or moved Admin
 * surface fails a test instead of silently changing what the cache
 * policy, the anomaly monitor and the analytics gate exclude.
 */
export const ADMIN_SURFACE_NAMESPACE = '/admin';

/**
 * The two transformations the router applies before matching, in the
 * router's order (decode, then case-fold). A malformed escape degrades
 * to the raw pathname instead of throwing.
 */
export function normaliseRouterPathname(pathname: string): string {
	try {
		return decodeURI(pathname).toLowerCase();
	} catch {
		return pathname.toLowerCase();
	}
}

/**
 * Does this request path resolve inside the namespace, as the router
 * reads it?
 *
 * The namespace is matched EXACTLY or as a `/`-delimited descendant —
 * never as a bare prefix, so a future public route such as
 * `/administration` is not swallowed by the operator surface.
 */
export function isPathInNamespace(pathname: string, namespace: string): boolean {
	const normalised = normaliseRouterPathname(pathname);
	return normalised === namespace || normalised.startsWith(`${namespace}/`);
}
