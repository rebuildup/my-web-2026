import { ErrorState } from './ErrorState';
import type { ErrorStateProps } from './ErrorState';

/**
 * NotFoundState — the 404 surface.
 *
 * Renders when a route does not match, or when a loader throws
 * `notFound()` (a portfolio project with an unknown slug, a Tool slug
 * that is not in the manifest, …). Bound as
 * `getRouter()#defaultNotFoundComponent` in `src/router.tsx` — NOT on the
 * root route, because `@tanstack/react-router` resolves the not-found
 * component from the route that TRIGGERED it, so a root option never
 * covers a child loader failure. Any unmatched URL therefore lands here
 * instead of the router's default `<p>Not Found</p>` string.
 *
 * The state offers `back` + every public surface as alternatives and
 * deliberately no retry: re-requesting a URL that is known not to
 * exist cannot succeed, and a dead control teaches visitors to ignore
 * controls. Route-specific 404s (e.g. `/tools/$slug`, which names the
 * Tool registry and links back to `/tools`) keep their own component —
 * this is the generic fallback, not a replacement.
 *
 * `backHref` is forwarded; see `ErrorStateProps`. The back anchor is
 * always a real navigation — `history.back()` is not available to a
 * direct entry (external link, fresh tab, crawler) and would leave the
 * control doing nothing at all.
 */
export function NotFoundState(props: Omit<ErrorStateProps, 'kind'>) {
	return <ErrorState kind="not_found" {...props} />;
}
