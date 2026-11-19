/**
 * Public surface for portfolio UI components.
 *
 * Routes / server-fn handlers consume from this barrel so the
 * underlying files can move without changing import paths.
 */
export { PortfolioMediaFigure } from './PortfolioMedia';
export { PortfolioMarkdown } from './Markdown';
export { FacetFilter } from './FacetFilter';
export { ProjectCard } from './ProjectCard';
export { PortfolioList } from './PortfolioList';
export { PortfolioDetail } from './PortfolioDetail';
export { PortfolioEmptyState } from './EmptyState';
export { ViewSwitcher } from './ViewSwitcher';
export { DevelopView } from './DevelopView';
export { VideoView } from './VideoView';
export { DesignView } from './DesignView';
export { MediaPlaceholder } from './MediaPlaceholder';
