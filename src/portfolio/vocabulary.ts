import type { PortfolioFacet } from './schema';

/**
 * The words the portfolio surfaces print for a facet, and the label a
 * facet-derived value carries.
 *
 * One table, three surfaces. `ProjectCard`, `PortfolioDetail` and
 * `FacetFilter` each carried their own copy of this mapping, so the
 * same fact was named three ways on one page: the card said
 * "Develop", the detail page said "Develop" beside a record whose
 * value said "Development". A vocabulary that exists in four places
 * cannot stay one vocabulary (Issue #813).
 *
 * `about/` keeps its own facet word on purpose: it is a peer
 * obligation, and `about -> portfolio` is not a declared value edge
 * (AGENTS.md §3). The boundary note lives in
 * `docs/domain/portfolio-vocabulary.md`.
 *
 * Why the label is `Kind`, not `Role`
 * -----------------------------------
 * The value this label introduces is derived from a facet
 * (`scripts/audit-legacy-portfolio.mjs#LEGACY_FACET_ROLES`), and a
 * facet describes the PROJECT: "Development" answers "what kind of
 * work is this", not "what position did this person hold". `Role`
 * claimed the second, so a reader could not tell which claim the
 * writer meant. The weaker, true word wins.
 *
 * `Type` is not available either: the card already uses that word for
 * the facet beside the state mark, and introducing a second label for
 * one fact is the defect this module removes rather than moves.
 *
 * The value vocabulary is kind-of-work nouns — "Development", "Video
 * production", "Design", "Production" — never agent nouns such as
 * "Developer". An owner-recorded value stays distinguishable in the
 * migration ledger (`role_source: "owner-recorded"`), not on the
 * public surface.
 */

/** The visible word for a facet. Fixed: these are printed, not derived. */
export const FACET_LABEL = {
	develop: 'Develop',
	video: 'Video',
	design: 'Design',
	other: 'Other',
} as const satisfies Record<PortfolioFacet, string>;

/** The Japanese word for a facet, used by the filter chips (Issue #433). */
export const FACET_LABEL_JA = {
	develop: '開発',
	video: '映像',
	design: 'デザイン',
	other: 'その他',
} as const satisfies Record<PortfolioFacet, string>;

/** The label for a facet-derived kind-of-work value. Never `Role`. */
export const KIND_LABEL = 'Kind';
