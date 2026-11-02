import type { PortfolioFacet } from './schema';

/**
 * The words the portfolio surfaces print for a facet.
 *
 * One table, three surfaces. `ProjectCard`, `PortfolioDetail` and
 * `FacetFilter` each carried their own copy of this mapping, so the
 * same fact was named in three places and a change to one of them
 * could silently disagree with the other two. A vocabulary that
 * exists in three places cannot stay one vocabulary (Issue #813).
 *
 * There is NO label for a kind of work here, and that absence is the
 * decision, not an omission. The `role` column of the portfolio
 * schema mixes two different claims: a person's role ("Tool
 * developer", "Intern") and a kind of work ("Development", "Video
 * production"). The second one is a restatement of `facets`, which
 * the card and the detail already show as the eyebrow word and as the
 * facet pills, so the public surface projects it nowhere and has no
 * label for it. The label that does exist — `Role` — is the person's
 * role, and it is printed only when a role is recorded.
 *
 * The reasoning, the measurements and the three-state data contract
 * live in `docs/domain/portfolio-vocabulary.md`.
 *
 * `about/` keeps its own words on purpose: it is a peer obligation,
 * and `about -> portfolio` is not a declared value edge
 * (AGENTS.md §3).
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
