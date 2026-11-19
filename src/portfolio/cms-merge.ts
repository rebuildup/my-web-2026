import type { PortfolioProject } from './schema';

/**
 * The authoring-field merge between a D1 row and the CMS record of the
 * same slug (Issue #913, extended by Issue #1008; ADR-0018 §2.11).
 *
 * ADR-0018 §2.7 / ADR-0019 §2.6 own the collision rule and it is
 * unchanged: one slug = one URL = one card, and the row's IDENTITY —
 * id, ordering keys, visibility, status, evidence status — stays
 * D1's. What the CMS record supplies is AUTHORING: the six section
 * bodies, the recorded role, the links, and media the ingest uploaded
 * without a D1 row. The transitional text migration wrote empty
 * section bodies into every legacy D1 row, so "D1 wins" used to render
 * the lossy copy and the authoring content never reached the page.
 *
 * Field rules (each mirrors "CMS non-empty wins, an empty CMS value
 * never erases a stored one"):
 *
 *   - the six section bodies: the CMS value when it is non-empty,
 *     else the D1 value.
 *   - `role`: the CMS value when it is non-empty, else the D1 value.
 *     The CMS side arrives already projected by `publish.ts#toProject`,
 *     which maps a facet-kind label to `null` (Issue #813 /
 *     `kind-labels.ts`), so only a RECORDED role can win here. A
 *     `null`/empty CMS role leaves the D1 value untouched.
 *   - `links`: the CMS list when it is non-empty, else the D1 list.
 *     Links are authoring content in Notion (bookmark / link blocks),
 *     not a D1-only curation surface; a D1 row whose link migration
 *     came out empty is filled from the record of the same slug
 *     (Issue #1008). When both are empty the project genuinely has no
 *     links — no store can supply one.
 *   - media: a UNION keyed by `r2Key`, D1 rows first. The two stores
 *     mostly name the same objects; the CMS-only keys
 *     (`portfolio/notion/*`) are exactly the images the ingest
 *     uploaded without a D1 row. The cover stays whatever D1 curated;
 *     a D1 row with no cover takes the CMS cover through the union's
 *     `isCover` flag.
 *
 * This module is deliberately free of `env` and binding types so the
 * operator verifier (`scripts/verify-portfolio.mjs`) can run the SAME
 * merge the Worker runs instead of restating it.
 */
export function mergeCmsAuthoring(d1: PortfolioProject, cms: PortfolioProject): PortfolioProject {
	const d1Keys = new Set(d1.media.map((media) => media.r2Key));
	const cmsOnlyMedia = cms.media.filter((media) => !d1Keys.has(media.r2Key));
	return {
		...d1,
		motivationMd: cms.motivationMd || d1.motivationMd,
		architectureMd: cms.architectureMd || d1.architectureMd,
		constraintsMd: cms.constraintsMd || d1.constraintsMd,
		implementationMd: cms.implementationMd || d1.implementationMd,
		evidenceMd: cms.evidenceMd || d1.evidenceMd,
		retrospectiveMd: cms.retrospectiveMd || d1.retrospectiveMd,
		role: cms.role || d1.role,
		links: cms.links.length > 0 ? cms.links : d1.links,
		media: [...d1.media, ...cmsOnlyMedia],
	};
}
