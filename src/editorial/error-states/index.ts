/**
 * Public surface for the error-state components (Issue #501).
 *
 * `editorial` owns the visual language every failure surface speaks,
 * so routes import the three per-kind components from this barrel and
 * never reach into the contract module directly. The contract itself
 * is exported because the audit-facing declarations
 * (`ERROR_STATE_PUBLISHED_INFO`, `ERROR_STATE_WITHHELD_INFO`,
 * `ERROR_STATE_EXTERNAL_COMMUNICATIONS`) are read by the verification
 * report and by the tests.
 */
export { ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';
export { NotFoundState } from './NotFoundState';
export { ServiceUnavailableState } from './ServiceUnavailableState';
export { DependencyFailureState } from './DependencyFailureState';
export {
	DEPENDENCY_FREE_SURFACES,
	ERROR_STATE_DEFINITIONS,
	ERROR_STATE_EXTERNAL_COMMUNICATIONS,
	ERROR_STATE_KINDS,
	ERROR_STATE_PUBLICATION_EXCEPTIONS,
	ERROR_STATE_PUBLISHED_INFO,
	ERROR_STATE_WITHHELD_INFO,
	PUBLIC_SURFACE_DEPENDENCIES,
	PUBLIC_SURFACE_LABELS,
	alternativesFor,
	errorStateDefinition,
	withheldDetailNeedles,
} from './contract';
export type {
	ErrorStateAlternative,
	ErrorStateDefinition,
	ErrorStateDependency,
	ErrorStateKind,
	ErrorStateRecoveryAction,
} from './contract';
