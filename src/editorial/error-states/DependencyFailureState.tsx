import { ErrorState } from './ErrorState';
import type { ErrorStateProps } from './ErrorState';

/**
 * DependencyFailureState — the upstream data-failure surface.
 *
 * Distinct from `ServiceUnavailableState` in what it promises: the
 * document DID render, but one of the data sources the page depends
 * on did not deliver. That is why its alternatives are the
 * dependency-free public surfaces (`/tools`, `/contact` — build-time
 * JSON imports, no binding read at render time, see
 * `./contract#PUBLIC_SURFACE_DEPENDENCIES`) and why the copy tells the
 * visitor to check their connection before retrying.
 *
 * Call site status (Issue #501): no server-side outbound integration
 * is promoted in this codebase (`docs/domain/integrations.md`), so
 * today there is no route that reports an upstream failure at the page
 * level — the component is shipped as the contract + Storybook + test
 * surface a future integration binds to, rather than being wired to a
 * fabricated failure path. `docs/verification/ops/error-state-gallery.md`
 * records this as the one unmet wiring item.
 */
export function DependencyFailureState(props: Omit<ErrorStateProps, 'kind'>) {
	return <ErrorState kind="dependency_failure" {...props} />;
}
