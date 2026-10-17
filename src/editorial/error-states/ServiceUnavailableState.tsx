import { ErrorState } from './ErrorState';
import type { ErrorStateProps } from './ErrorState';

/**
 * ServiceUnavailableState — the 503 surface.
 *
 * Renders when the request cannot be answered with a page at all: a
 * loader or the SSR render threw, or the Worker could not serve the
 * document. Wired at the root route as `errorComponent`, so an SSR
 * failure returns a READABLE document instead of a blank page
 * (Issue #501 acceptance condition) — the failure still reaches the
 * visitor as status 500 from the framework's perspective, which
 * `docs/verification/ops/error-state-gallery.md` records honestly as
 * an open decision rather than hiding.
 *
 * `onRetry` should be the router boundary's `reset`, so a retry
 * re-runs the failed request in place; `retryHref` keeps the pre-
 * hydration (plain reload) path pointed at the URL that actually
 * failed. The copy never names a binding: the public surface cannot
 * know which one failed, and guessing would be a fabricated fact.
 */
export function ServiceUnavailableState(props: Omit<ErrorStateProps, 'kind'>) {
	return <ErrorState kind="service_unavailable" {...props} />;
}
