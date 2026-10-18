export type {
	PortfolioAdjacent,
	PortfolioAdjacentRef,
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

/**
 * Input-boundary surface (Issue #451).
 *
 * `classifyHref` is the single href oracle: scheme allow-list,
 * control-character refusal, entity decoding, protocol-relative
 * resolution. `safeHref` / `isExternalHref` are the compatibility
 * shapes for callers that only need the old string / boolean.
 *
 * `sanitizeNotionHtml` is the adapter for Notion-derived HTML. It is
 * NOT wired to an ingest path yet — it lands first so that whichever
 * migration introduces Notion HTML inherits one sanitiser instead of
 * writing a second one. See `docs/security.md`.
 */
export {
	BLOCKED_HREF_REASONS,
	BLOCKED_LINK_CLASS,
	type BlockedHrefReason,
	classifyHref,
	decodeHtmlEntities,
	escapeInline,
	isExternalHref,
	type MarkdownHrefVerdict,
	parseMarkdown,
	safeHref,
} from './markdown.lexer';

export {
	NOTION_DROP_REASONS,
	type NotionDropReason,
	type NotionSanitizeOptions,
	type NotionSanitizeResult,
	sanitizeNotionHtml,
} from './markdown.notion';

export { createD1PortfolioLoader } from './load';
export { intersectsAny } from './load';

/**
 * Server functions. Consumers must only import this module
 * inside server-only contexts (route loader / createServerFn
 * handler). The `.handler()` body is the recognised server
 * boundary per TanStack Start's import-protection plugin.
 */
export { loadPortfolioProject, loadPortfolioAdjacent, listPortfolioProjects } from './public';

export { PORTFOLIO_SEED, type PortfolioSeedEntry } from './seed';

export {
	PortfolioMediaFigure,
	PortfolioMarkdown,
	FacetFilter,
	ProjectCard,
	PortfolioList,
	PortfolioDetail,
} from './components';
