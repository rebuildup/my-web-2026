/**
 * Public surface for the structured-data module (Issue #422).
 *
 * Structured data is the machine-readable projection of facts a
 * public surface already publishes. It lives under `src/editorial/`
 * next to `nav/` for the same reason `BreadcrumbJsonLd` lives there:
 * the JSON-LD document is chrome the surface owns, not a data source.
 * The fact sources stay with their obligations — `src/about/**` for
 * identity, `src/portfolio/**` for works — and each one maps its own
 * record onto the narrow structural inputs this module accepts, so
 * this module imports neither.
 *
 * Cross-references:
 *   - `contract.json` — canonical origin, route coverage, withheld facts
 *   - `docs/personal/domain.md` §11 / §15 — narrative invariants
 */
export {
	CANONICAL_ORIGIN,
	canonicalUrl,
	KNOWN_STRUCTURED_DATA_TYPES,
	NODE_ID_FRAGMENTS,
	PERSON_UNAPPROVED_PROPERTIES,
	ROUTE_COVERAGE,
} from './contract';
export type { StructuredDataRouteCoverage, StructuredDataRouteStatus } from './contract';
export { buildCreativeWorkNode, buildPersonNode, buildPersonReference } from './nodes';
export { CreativeWorkJsonLd, PersonJsonLd } from './StructuredDataScripts';
export {
	isSchemaDate,
	validateStructuredData,
} from './validate';
export type {
	RichResultsVerdict,
	StructuredDataFinding,
	StructuredDataPolicy,
	StructuredDataValidation,
} from './validate';
export {
	type CreativeWorkFacts,
	type CreativeWorkNode,
	type JsonLdNode,
	type PersonFacts,
	type PersonNode,
	type PersonReferenceNode,
	SCHEMA_ORG_CONTEXT,
} from './types';
