import type { PortfolioFacet } from './schema';

/**
 * The kind-of-work words the legacy migration derived into `role`
 * (Issue #766 ledger, decided by Issue #813 —
 * `docs/domain/portfolio-vocabulary.md`).
 *
 * These are NOT person roles: `develop` is "Development", not
 * "Developer". The migration ledger keeps the provenance
 * (`role_source: "facet-derived"`); this table is the reader-side
 * guard for records that carry the derived word without provenance —
 * the committed Notion snapshot's `Role` property holds exactly those
 * words for the migrated rows (Issue #1008). A public projection must
 * never print one under `Role`.
 *
 * This is deliberately NOT `FACET_LABEL` (`vocabulary.ts`): that table
 * holds the words surfaces PRINT for a facet; this one holds the words
 * that must never be printed as a role. The two vocabularies overlap
 * on `Design` by accident of history, which is why they are separate
 * tables with separate jobs.
 *
 * `import type` only, so `scripts/**` operator tooling can load this
 * module under Node's type stripping without pulling in the schema
 * module's runtime graph.
 */
export const FACET_KIND_LABEL = Object.freeze({
	develop: 'Development',
	video: 'Video production',
	design: 'Design',
	other: 'Production',
} as const satisfies Record<PortfolioFacet, string>);

const KIND_LABELS: ReadonlySet<string> = new Set(Object.values(FACET_KIND_LABEL));

/**
 * Is `role` one of the derived kind-of-work words? Membership in the
 * closed label set — not equality with this record's own facet
 * derivation — is the test, because the ledger's five "contradiction"
 * rows carried a derived word for a DIFFERENT facet than `facets[0]`
 * and are just as much not-roles (portfolio-vocabulary.md §2.4).
 */
export function isFacetDerivedRole(role: string): boolean {
	return KIND_LABELS.has(role);
}
