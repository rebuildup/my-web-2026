/**
 * Structured-data node types (Issue #422).
 *
 * The shapes here are the repo's own projection of schema.org, not
 * a copy of the vocabulary. schema.org is open-ended by design —
 * a node may legally carry any property — so "valid" in this module
 * always means "valid against the contract the repository declares",
 * never "valid according to everything schema.org permits".
 *
 * Types:
 *   - `Person` — the person identity, built from the approved
 *     `/about` snapshot (src/about/structured-data.ts).
 *   - `CreativeWork` — one published portfolio project, built from a
 *     `public + published` row (src/portfolio/structured-data.ts).
 *   - `BreadcrumbList` — owned by `src/editorial/nav/Breadcrumbs.tsx`.
 *     It is declared here because the validator has to understand it,
 *     not because this module emits it.
 *
 * Cross-references:
 *   - `contract.json` — canonical origin / coverage / withheld facts
 *   - `validate.ts` — the validator that reads these shapes
 *   - `docs/personal/owner.md` — why no property is invented here
 */

/** The only `@context` this repository emits. */
export const SCHEMA_ORG_CONTEXT = 'https://schema.org' as const;

/** A JSON object node with its reserved keys typed. */
export interface JsonLdNode {
	'@context'?: string;
	'@type'?: unknown;
	'@id'?: unknown;
	[key: string]: unknown;
}

/**
 * Narrow input for the `Person` builder. Deliberately structural —
 * this module never imports `src/about/**`, so the fact source stays
 * on the side that owns it and the builder stays reusable.
 */
export interface PersonFacts {
	/** Approved display identity (real name / romanised name as one string). */
	readonly name: string;
	/** Other approved names for the same person (currently the primary handle). */
	readonly alternateName?: readonly string[];
	/** Self-description copy. Never a CV claim. */
	readonly description?: string;
	/** Canonical URL of the surface describing this person. */
	readonly url: string;
	/** Approved `sameAs` profile URLs (externalHandles hrefs). */
	readonly sameAs: readonly string[];
}

/**
 * Narrow input for the `CreativeWork` builder. The caller maps a
 * `PortfolioProject` onto this shape; this module never imports
 * `src/portfolio/**`.
 */
export interface CreativeWorkFacts {
	readonly name: string;
	readonly description: string;
	/** Canonical URL of the project surface (must be under `/portfolio/`). */
	readonly url: string;
	/**
	 * Start of the work, at the precision the source actually
	 * records: `YYYY`, `YYYY-MM`, `YYYY-MM-DD` or a full UTC
	 * date-time. Precision is never widened — see
	 * `docs/personal/knowledge-model.md`.
	 */
	readonly dateCreated?: string;
	/** Last update timestamp, ISO-8601 UTC. */
	readonly dateModified?: string;
	/** Absolute cover URL, or `null` when the row has no usable media. */
	readonly imageUrl?: string | null;
}

/** Emitted `Person` node. */
export interface PersonNode extends JsonLdNode {
	'@context': typeof SCHEMA_ORG_CONTEXT;
	'@type': 'Person';
	'@id': string;
	name: string;
	url: string;
	alternateName?: string[];
	description?: string;
	sameAs: string[];
}

/** Nested author reference inside a `CreativeWork` node. */
export interface PersonReferenceNode extends JsonLdNode {
	'@type': 'Person';
	'@id': string;
	name: string;
	url: string;
}

/** Emitted `CreativeWork` node. */
export interface CreativeWorkNode extends JsonLdNode {
	'@context': typeof SCHEMA_ORG_CONTEXT;
	'@type': 'CreativeWork';
	'@id': string;
	name: string;
	description: string;
	url: string;
	author: PersonReferenceNode;
	dateCreated?: string;
	dateModified?: string;
	image?: string;
}
