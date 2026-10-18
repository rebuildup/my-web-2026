import CONTRACT from './contract.json';

/**
 * Structured-data contract (Issue #422).
 *
 * This module is the typed view over `contract.json`. The JSON file
 * — not this TypeScript wrapper — is the single source of truth,
 * because two different runtimes have to read it:
 *
 *   - the Worker / test bundle (`src/**`, Vitest workerd pool) reads
 *     it as a module, and
 *   - the report generator + coverage gate (`scripts/*.mjs`, plain
 *     Node) read the same file with `fs`, because the report has to
 *     be reproducible outside the Worker.
 *
 * A duplicated constant would let the screenshot in the PR body drift
 * away from what CI actually validates, which is exactly the failure
 * mode this Issue is about.
 *
 * Cross-references:
 *   - `docs/personal/domain.md` §11 / §15 (narrative invariants,
 *     what must not be inferred)
 *   - `docs/personal/knowledge-model.md` (temporal semantics, date
 *     precision)
 *   - `docs/personal/owner.md` (authority: agents may not invent
 *     career / activity facts)
 */

/** Canonical production origin (ADR-0014). */
export const CANONICAL_ORIGIN = CONTRACT.canonicalOrigin;

/** schema.org types this repository is allowed to emit. */
export const KNOWN_STRUCTURED_DATA_TYPES = CONTRACT.knownTypes;

/** `@id` fragment per type — `<canonical url>#<fragment>`. */
export const NODE_ID_FRAGMENTS = CONTRACT.nodeIdFragments;

/**
 * Person properties that must NOT appear in the emitted graph
 * until a machine-checkable record backs them, each with the reason
 * it is withheld. `validateStructuredData` treats any of these keys
 * as an error, so the omission is an enforced decision rather than
 * an oversight (Issue #422 acceptance criterion 1).
 */
export const PERSON_UNAPPROVED_PROPERTIES = CONTRACT.person.unapprovedProperties;

/** Coverage status a public route may declare. */
export type StructuredDataRouteStatus = 'implemented' | 'not-implemented' | 'out-of-scope';

/** One entry of the route coverage matrix. */
export interface StructuredDataRouteCoverage {
	/** Route path in registry form (`/portfolio/[slug]`). */
	readonly path: string;
	/** Whether the surface is visitor-facing (admin is not). */
	readonly public: boolean;
	readonly status: StructuredDataRouteStatus;
	/** `@type` values the SSR HTML must contain, in this document order. */
	readonly expectedTypes: readonly string[];
	/** Concrete URL the integration suite fetches, or `null` when unsampled. */
	readonly samplePath: string | null;
	readonly note: string;
}

/**
 * Every visitor-facing route and what it emits today. The coverage
 * gate (`scripts/check-structured-data-coverage.mjs`) proves this
 * list has no gap against `src/routes/**`, and the integration suite
 * proves each entry against the real SSR output — so "not
 * implemented" is a visible state, never a silent pass.
 */
export const ROUTE_COVERAGE: readonly StructuredDataRouteCoverage[] =
	CONTRACT.routes as StructuredDataRouteCoverage[];

/** Build an absolute URL against the canonical origin. */
export function canonicalUrl(path: string): string {
	return `${CANONICAL_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}
