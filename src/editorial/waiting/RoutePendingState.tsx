import { useLocation } from '@tanstack/react-router';
import { WaitingSurface } from './WaitingState';

/**
 * RoutePendingState — the router-wide binding of `WaitingSurface`
 * (Issue #489).
 *
 * Bound as `getRouter()#defaultPendingComponent` in `src/router.tsx`.
 * Like the two failure surfaces, it belongs on the ROUTER options rather
 * than on `__root.tsx`: `@tanstack/react-router` resolves
 * `pendingComponent` per match — `(route.options.pendingComponent ??
 * router.options.defaultPendingComponent)` — so a root-level option never
 * covers a child route that is the one waiting.
 *
 * The retry href is read from the ROUTER STATE, not from a prop: the
 * framework renders the pending component with no props at all, and the
 * URL a visitor is waiting for is exactly `location.pathname` — the
 * router has already committed the new location when it offers the
 * pending lane, which is why the URL in the address bar changes while
 * the outlet still shows the previous page.
 *
 * `searchStr` is included so a pending navigation to a filtered list
 * (`/portfolio?facets=develop`) retries the same query rather than
 * dropping it. The hash is deliberately not carried: a fragment is a
 * position inside a document that has not rendered yet.
 */
export function RoutePendingState() {
	const location = useLocation();
	return <WaitingSurface retryHref={`${location.pathname}${location.searchStr}`} />;
}
