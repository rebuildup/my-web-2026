/**
 * Drift comparison between the boundary's registered routes and the
 * public API directory — Issue #530.
 *
 * The comparison is PURE: it takes the registered route list, the
 * catalog and the scope exclusions and returns what does not line up.
 * Nothing here reads a binding, imports the boundary, or writes a
 * file. The test owns the wiring; this module owns the rule.
 *
 * Why the rule is split into two directions
 * -----------------------------------------
 * A one-directional check ("every catalog entry exists on the boundary")
 * passes when a public route is DROPPED from the catalog: the remaining
 * entries still exist. That is the direction that actually breaks the
 * directory, because the catalog is the published inventory — a route
 * the boundary serves but the catalog does not mention is a route no
 * reader can find.
 *
 * So both directions are checked:
 *
 *   - catalog → boundary: every catalog entry is registered (an entry
 *     for a route that no longer exists is an orphaned claim).
 *   - boundary → catalog: every registered route is either catalogued
 *     or explicitly excluded from the public scope, with a reason.
 *
 * What `ALL` means, and why it is NOT skipped wholesale
 * -----------------------------------------------------
 * Hono reports two different things under `method: "ALL"`:
 *
 *   - a `.all(path, methodNotAllowed(...))` "method not allowed"
 *     fallback that a sub-router installs after its real handlers.
 *     Its path already carries real verbs, and those are the
 *     catalogued contract — the entry for `GET /api/v1/health`
 *     documents the route whether or not an `ALL` fallback also
 *     exists behind it. Such an entry is ignored because the SAME
 *     path has at least one non-`ALL` registration.
 *   - middleware registered with `app.use(path, handler)` — the
 *     boundary's CORS, cache-isolation, request-id and CSRF guards.
 *     A middleware answers nothing itself, so it is carried by an
 *     explicit `ALL <path>` scope exclusion with a reason rather
 *     than by a blanket method filter.
 *
 * `ALL` cannot be filtered out wholesale, because `.all()` registers a
 * LIVE handler: a sub-router (or the boundary itself) can publish a
 * route with `.all(path, handler)` at a path that carries no real
 * verb. Ignoring every `ALL` entry would let that route be served
 * while the catalog never asks anyone to describe it. So an `ALL`
 * entry is ignored only when its path has a real verb (the 405
 * fallback case) or when it is an explicit scope exclusion; otherwise
 * it is reported as undocumented.
 */

export interface RouteRef {
	method: string;
	path: string;
}

export interface CatalogEntryRef {
	method: string;
	path: string;
}

export interface ScopeExclusionRef {
	method: string;
	path: string;
}

/** The method Hono reports for middleware and 405 fallbacks. */
const ALL_METHOD = 'ALL';

/**
 * The set of paths that carry at least one non-`ALL` registration.
 *
 * An `ALL` entry at one of these paths is the 405 fallback behind the
 * real verbs, not a route of its own.
 */
function pathsWithRealVerb(routes: readonly RouteRef[]): Set<string> {
	return new Set(
		routes.filter((route) => route.method.toUpperCase() !== ALL_METHOD).map((route) => route.path),
	);
}

function key(method: string, path: string): string {
	return `${method.toUpperCase()} ${path}`;
}

/**
 * Registered routes that neither the catalog nor the scope exclusions
 * account for. A non-empty result means the boundary serves a route
 * the public directory does not describe.
 *
 * `ALL` entries are judged rather than filtered (see the module doc):
 * an `ALL` entry at a path that also carries a real verb is the 405
 * fallback, and an `ALL` entry that an exclusion names explicitly is
 * boundary middleware. Any other `ALL` entry is an undocumented route,
 * because `.all()` can register a live handler.
 */
export function undocumentedRoutes(
	routes: readonly RouteRef[],
	catalog: readonly CatalogEntryRef[],
	exclusions: readonly ScopeExclusionRef[],
): RouteRef[] {
	const catalogKeys = new Set(catalog.map((entry) => key(entry.method, entry.path)));
	const exclusionKeys = new Set(exclusions.map((entry) => key(entry.method, entry.path)));
	const realVerbPaths = pathsWithRealVerb(routes);

	return routes.filter((route) => {
		const method = route.method.toUpperCase();
		const routeKey = key(method, route.path);
		if (method === ALL_METHOD) {
			// A 405 fallback rides behind real verbs already documented
			// by the catalog, so it adds no route of its own. Middleware
			// must be named by an explicit exclusion; anything else under
			// `ALL` is a live route nobody catalogued.
			if (realVerbPaths.has(route.path)) return false;
			return !exclusionKeys.has(routeKey);
		}
		return !catalogKeys.has(routeKey) && !exclusionKeys.has(routeKey);
	});
}

/**
 * Catalog entries the boundary does not register. An empty result means
 * the catalog claims a route the boundary does not serve.
 */
export function orphanedCatalogEntries(
	catalog: readonly CatalogEntryRef[],
	routes: readonly RouteRef[],
): CatalogEntryRef[] {
	const registered = new Set(routes.map((route) => key(route.method, route.path)));
	return catalog.filter((entry) => !registered.has(key(entry.method, entry.path)));
}

/**
 * Scope exclusions that duplicate a catalogued route. An exclusion that
 * shadows a catalog entry makes the public scope ambiguous: the same
 * route would be both published and unpublished.
 */
export function shadowingExclusions(
	catalog: readonly CatalogEntryRef[],
	exclusions: readonly ScopeExclusionRef[],
): ScopeExclusionRef[] {
	const catalogKeys = new Set(catalog.map((entry) => key(entry.method, entry.path)));
	return exclusions.filter((entry) => catalogKeys.has(key(entry.method, entry.path)));
}
