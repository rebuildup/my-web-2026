import { useLocation, useRouter } from '@tanstack/react-router';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import type {
	ErrorComponentProps,
	NotFoundRouteProps,
	ParsedLocation,
} from '@tanstack/react-router';
import { NotFoundState, ServiceUnavailableState } from './editorial/error-states';
import { routeTree } from './routeTree.gen';

/**
 * TanStack Start router factory.
 *
 * Named `getRouter` because the start-router-plugin's
 * `route-tree-footer.js` appends
 *
 *   `import type { getRouter } from './router.tsx'`
 *
 * to the generated routeTree.gen.ts. The `@tanstack/start-server-core`
 * runtime then calls `entries.routerEntry.getRouter()` (see
 * `createStartHandler.ts`). Renaming this function breaks the SSR
 * dev server.
 *
 * Do not hand-edit `src/routeTree.gen.ts`; it is regenerated from
 * `src/routes/**` by the TanStack Start Vite plugin.
 *
 * Failure surfaces (Issue #501)
 * -----------------------------
 * The three `default*Component` options are the router-wide answer to
 * "the request cannot be answered with the page the visitor asked for".
 * They belong HERE rather than on `__root.tsx` because of how
 * `@tanstack/react-router` resolves them:
 *
 *   - `Match.tsx` renders `(route.options.errorComponent ?? router.options.defaultErrorComponent)`
 *     for the route whose `match.status` is `error` — i.e. the FAILED
 *     route, not the root. A root-level `errorComponent` therefore never
 *     covers a child loader failure, which is exactly the case that
 *     matters (a D1 read failing inside `/portfolio/$slug`).
 *   - `renderRouteNotFound.tsx` resolves the same way: the route that
 *     triggered the not-found state wins, and `defaultNotFoundComponent`
 *     is the fallback. So a child loader calling `notFound()` falls
 *     through to the router default, not to a root option.
 *
 * Route-level components still win — `/tools/$slug` keeps its
 * `ToolNotFound` (Issue #183), which names the Tool registry and links
 * back to `/tools` — and the framework default `<p>Not Found</p>` /
 * dev-only "Something went wrong!" page is replaced everywhere.
 *
 * The error surface also has to TELL APART two failures that arrive at
 * the same resolution point: a loader that failed (transient — retry
 * can help) and a route's own input validation that failed (permanent
 * — the same URL can never answer). `isPermanentInputFailure` below
 * makes that distinction; without it the second is reported as an
 * outage and offered a retry that cannot work.
 *
 * The contract itself (what is published, what is withheld, which
 * surfaces still answer) lives in `src/editorial/error-states/`; this
 * file only binds it to the framework's three resolution points.
 */
export function getRouter() {
	return createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		context: {},
		defaultNotFoundComponent: RouteNotFoundSurface,
		defaultErrorComponent: RouteFailureSurface,
	});
}

/**
 * Router-wide 404 surface.
 *
 * `NotFoundRouteProps.data` is ignored on purpose: the visitor is told
 * what kind of failure this is and where they can go next, never what the
 * route was trying to load.
 */
function RouteNotFoundSurface(_props: NotFoundRouteProps) {
	return <NotFoundState />;
}

/**
 * Router-wide failure surface (a loader or the SSR render threw).
 *
 * The `error` prop is deliberately not even destructured: this component
 * must not be able to render a throwable's message or stack, and
 * `contract.ts#ERROR_STATE_WITHHELD_INFO` lists that detail as withheld.
 *
 * `retryHref` is the failed URL's pathname plus the router's canonical
 * search string, so the retry keeps the query the visitor arrived with
 * (`?ref=newsletter` round-trips; a repeated param is re-serialised by
 * the framework). It stays a PLAIN anchor: `props.reset` is not wired,
 * because `CatchBoundary#reset` only clears local React state —
 * `MatchInner` then re-reads the same `status: 'error'` match and
 * re-throws it, so a hydrated retry would have done nothing while
 * `preventDefault()` suppressed the navigation that does work. See the
 * module comment of `src/editorial/error-states/ErrorState.tsx` for the
 * full reasoning and the `router.invalidate()` alternative.
 *
 * It also resolves a PERMANENT client-input failure, and answers it
 * with the `not_found` surface instead (see `isPermanentInputFailure`).
 */
function RouteFailureSurface(_props: ErrorComponentProps) {
	const router = useRouter();
	const location = useLocation();
	if (isPermanentInputFailure(router, location)) {
		return <NotFoundState />;
	}
	return <ServiceUnavailableState retryHref={`${location.pathname}${location.searchStr}`} />;
}

/**
 * Whether the location being rendered fails a route's OWN input
 * validation — `validateSearch`, `validateParams` or `loaderDeps`.
 *
 * The framework raises those as the match's error, so they reach
 * `defaultErrorComponent` exactly like a loader failure. They are not
 * one: re-requesting the same URL can never answer, so the 503
 * surface's "try again shortly" is a promise the platform cannot keep,
 * and "part of the system did not respond" is false. The published
 * `not_found` surface answers them instead — its copy already names a
 * mistyped link as a cause, and it offers alternatives rather than a
 * retry that cannot work. No new copy and no new failure kind is
 * introduced; the published contract stays the three kinds
 * `contract.ts` declares.
 *
 * Reachable cases, both measured over the SSR pipeline in
 * `test/integration/error-states.test.ts`:
 *   - `/portfolio?facets=a&facets=b` — a repeated param parses to an
 *     array, `SearchSchema` expects a string.
 *   - `/admin/invitations/accept` without a `token`, or with one
 *     shorter than 20 characters.
 *
 * Derived from the LOCATION, never from `props.error`. The framework's
 * own `SearchParamError` would be the exact discriminator, but the
 * SSR hydration payload reconstructs it as a plain `Error` (the
 * `ShallowErrorPlugin` serialises `{ message }`), so an `instanceof`
 * check would answer differently before and after hydration and force
 * a client-side re-render of the surface. `router.matchRoutes` is a
 * pure read that re-runs the route's own validation against the URL
 * being rendered, so server and client always agree — and this
 * component still never touches the throwable at all.
 *
 * This cannot mask a real outage: the framework validates BEFORE
 * `beforeLoad` and before the loader (`load-server.js`), so a URL that
 * fails validation never reaches the loader that would have failed.
 *
 * Residual, deliberately out of scope: a loader that validates its own
 * input (e.g. `/portfolio/$slug` parses `SlugSchema` inside its
 * loader) is a loader failure from here, so a mistyped slug still
 * renders the 503 surface. Route-owned input validation belongs to the
 * route that owns the input; recorded as an open decision in
 * `docs/verification/ops/error-state-gallery.md` §7.
 */
function isPermanentInputFailure(
	router: ReturnType<typeof useRouter>,
	location: ParsedLocation,
): boolean {
	return router
		.matchRoutes(location)
		.some((match) => match.searchError !== undefined || match.paramsError !== undefined);
}

declare module '@tanstack/react-router' {
	interface Register {
		router: Awaited<ReturnType<typeof getRouter>>;
	}
}
