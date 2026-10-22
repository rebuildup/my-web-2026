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
 * What `ALL` means, and why it is skipped
 * ---------------------------------------
 * Hono reports two different things under `method: "ALL"`:
 *
 *   - middleware registered with `app.use(path, handler)` — the
 *     boundary's CORS, cache-isolation, request-id and CSRF guards
 *     all show up this way;
 *   - a `.all(path, methodNotAllowed(...))` "method not allowed"
 *     fallback that a sub-router installs after its real handlers.
 *
 * Neither is a public contract of its own. A middleware runs on the
 * way to a contract and answers nothing itself, and a 405 fallback
 * guards a path whose verbs the catalog already lists — the entry
 * for `GET /api/v1/health` documents that route whether or not an
 * `ALL` fallback also exists behind it. Matching them by path would
 * therefore document the boundary's plumbing rather than its
 * published surface, so `ALL` is filtered out before comparison.
 * The routes that carry a real verb are the ones that must line up.
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

function key(method: string, path: string): string {
	return `${method.toUpperCase()} ${path}`;
}

/**
 * Registered routes that neither the catalog nor the scope exclusions
 * account for. A non-empty result means the boundary serves a route
 * the public directory does not describe.
 */
export function undocumentedRoutes(
	routes: readonly RouteRef[],
	catalog: readonly CatalogEntryRef[],
	exclusions: readonly ScopeExclusionRef[],
): RouteRef[] {
	const catalogKeys = new Set(catalog.map((entry) => key(entry.method, entry.path)));
	const exclusionKeys = new Set(exclusions.map((entry) => key(entry.method, entry.path)));

	return routes.filter((route) => {
		const method = route.method.toUpperCase();
		if (method === ALL_METHOD) {
			// Middleware and 405 fallbacks carry no verb of their own,
			// so there is nothing published to match them against.
			return false;
		}
		const routeKey = key(method, route.path);
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
