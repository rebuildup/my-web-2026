import { useLocation } from '@tanstack/react-router';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import type { ErrorComponentProps, NotFoundRouteProps } from '@tanstack/react-router';
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
 * `error` is never destructured: the component must not be able to render
 * a throwable's message or stack, and `contract.ts#ERROR_STATE_WITHHELD_INFO`
 * lists that detail as withheld. `reset` is the framework's re-run hook —
 * wired as `onRetry` so a hydrated retry re-executes the failed request,
 * while `retryHref` keeps the pre-hydration click a plain reload of the
 * URL that actually failed. `Match.tsx` passes `reset: undefined` while
 * streaming on the server, so `onRetry` is left unwired there and the
 * anchor stays a normal navigation.
 */
function RouteFailureSurface({ reset }: ErrorComponentProps) {
	const { pathname } = useLocation();
	return (
		<ServiceUnavailableState
			onRetry={
				reset
					? () => {
							void reset();
						}
					: undefined
			}
			retryHref={pathname}
			onBack={() => window.history.back()}
		/>
	);
}

declare module '@tanstack/react-router' {
	interface Register {
		router: Awaited<ReturnType<typeof getRouter>>;
	}
}
