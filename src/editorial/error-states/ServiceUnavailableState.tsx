import { ErrorState } from './ErrorState';
import type { ErrorStateProps } from './ErrorState';

/**
 * ServiceUnavailableState — the 503 surface.
 *
 * Renders when the request cannot be answered with a page at all: a
 * loader or the SSR render threw, or the Worker could not serve the
 * document. Bound as `getRouter()#defaultErrorComponent` in
 * `src/router.tsx` — NOT on the root route, because
 * `@tanstack/react-router` renders the error component of the route
 * whose match IS the error, so a root `errorComponent` never covers a
 * child loader failure. That is what makes an SSR failure return a
 * READABLE document instead of a blank page (Issue #501 acceptance
 * condition) — the failure still reaches the visitor as status 500 from
 * the framework's perspective, which
 * `docs/verification/ops/error-state-gallery.md` records honestly as
 * an open decision rather than hiding.
 *
 * `retryHref` is forwarded and is a plain navigation to the URL that
 * failed — no click handler is wired, because the framework's
 * `CatchBoundary#reset` cannot re-run a loader (see
 * `ErrorState.tsx`). The copy never names a binding: the public surface
 * cannot know which one failed, and guessing would be a fabricated fact.
 */
export function ServiceUnavailableState(props: Omit<ErrorStateProps, 'kind'>) {
	return <ErrorState kind="service_unavailable" {...props} />;
}
