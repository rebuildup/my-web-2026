export type {
	PortfolioFacet,
	PortfolioLink,
	PortfolioLinkKind,
	PortfolioMedia,
	PortfolioProject,
	PortfolioStatus,
	PortfolioVisibility,
	ListPortfolioProjectsOptions,
} from './schema';

export {
	parseFacetArray,
	parseTechnologyArray,
	rowToLink,
	rowToMedia,
	rowToProject,
	SlugSchema,
	FacetSchema,
	VisibilitySchema,
	StatusSchema,
	LinkKindSchema,
	PORTFOLIO_FACETS,
	PORTFOLIO_LINK_KINDS,
	PORTFOLIO_STATUSES,
	PORTFOLIO_VISIBILITIES,
	SLUG_REGEX,
} from './schema';

export type { PortfolioLoader, PortfolioEnv } from './contract';

export { isValidR2Key, composeMediaUrl } from './media';

export { createD1PortfolioLoader } from './load';
export { intersectsAny } from './load';

/**
 * Server functions. Consumers must only import this module
 * inside server-only contexts (route loader / createServerFn
 * handler). The `.handler()` body is the recognised server
 * boundary per TanStack Start's import-protection plugin.
 */
export { loadPortfolioProject, listPortfolioProjects } from './public';

export { PORTFOLIO_SEED, type PortfolioSeedEntry } from './seed';

export {
	PortfolioMediaFigure,
	PortfolioMarkdown,
	FacetFilter,
	ProjectCard,
	PortfolioList,
	PortfolioDetail,
} from './components';
