import { css } from '../../../styled-system/css';
import { Button } from '../../editorial/primitives/Button';
import { Grid } from '../../editorial/primitives/Grid';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import type { PortfolioListPage, PortfolioProject } from '../schema';
import type { PortfolioFacet } from '../schema';
import { DEFAULT_PORTFOLIO_VIEW, type PortfolioView } from '../views';
import { DesignView } from './DesignView';
import { DevelopView } from './DevelopView';
import { PortfolioEmptyState } from './EmptyState';
import { FacetFilter } from './FacetFilter';
import { ProjectCard } from './ProjectCard';
import { VideoView } from './VideoView';
import { ViewSwitcher } from './ViewSwitcher';

/**
 * PortfolioList — `/portfolio` route surface (presentation only).
 *
 * The server-fn call lives in the route file (`src/routes/portfolio/index.tsx`)
 * so client bundles do not pull in `cloudflare:workers` via the
 * portfolio/server-fn path. This component receives the initial
 * page from the route loader and a callback for fetching the next
 * page from the cursor.
 *
 * Reading order:
 *   - Page header (eyebrow / h1 / blurb),
 *   - Facet filter (URL-synced),
 *   - Project list (cards) — or empty state when no entries are
 *     visible. The empty state is selected by `activeFacets`:
 *     a filter applied to a non-empty catalogue renders the
 *     `<output>` "該当する project はありません" branch (Issue
 *     #77); a genuinely empty catalogue (pre-migration from
 *     my-web-2025) renders `<PortfolioEmptyState />` (Issue
 *     #182).
 *   - "Load more" (rendered only while a `nextCursor` is present).
 */
export interface PortfolioListProps {
	initialPage: PortfolioListPage;
	activeFacets: readonly PortfolioFacet[];
	/**
	 * The facet set the catalogue query actually ran with — the
	 * visitor's explicit `?facets=` or, when absent, the view's
	 * implied scope (Issue #1048). The empty-state branch reads this
	 * rather than `activeFacets` so a view-scoped empty result is
	 * reported as "no matching projects", not as an empty catalogue.
	 */
	queryFacets: readonly PortfolioFacet[];
	/**
	 * Exhibition mode (Issue #1048). `all` keeps the card grid this
	 * component shipped with; `develop` / `video` / `design` render
	 * the same filtered project set through the predecessor's three
	 * gallery presentations. Optional so existing callers and tests
	 * that predate the switcher keep compiling — absent means `all`.
	 */
	view?: PortfolioView;
	hasMore: boolean;
	busy: boolean;
	error: string | null;
	onLoadMore: () => void;
	extra: readonly PortfolioProject[];
}

export function PortfolioList({
	initialPage,
	activeFacets,
	queryFacets,
	view = DEFAULT_PORTFOLIO_VIEW,
	hasMore,
	busy,
	error,
	onLoadMore,
	extra,
}: PortfolioListProps) {
	const allProjects: PortfolioProject[] = [...initialPage.projects, ...extra];

	return (
		<>
			<SkipLink href="#portfolio-list" />
			<main id="main">
				<PageSection rhythm="hero" labelledBy="portfolio-heading">
					<header
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '4',
							marginBlockEnd: '10',
						})}
					>
						<span
							className={css({
								fontFamily: 'sans',
								fontSize: 'sm',
								fontWeight: '600',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								color: 'text.muted',
							})}
						>
							Portfolio
						</span>
						<h1
							id="portfolio-heading"
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: '3xl', lg: '4xl' },
								fontWeight: '700',
								color: 'text.default',
								lineHeight: '1.05',
								letterSpacing: '-0.03em',
								maxWidth: '720px',
							})}
						>
							主要な制作物 / Selected projects
						</h1>
						<p
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'md',
								color: 'text.muted',
								lineHeight: '1.6',
								maxWidth: '640px',
							})}
						>
							技術選定・設計・成果・振り返りを、第三者が URL
							を渡されただけで辿れるように整理しています。 facet で絞り込み、各 project
							の詳細ページから repository / release / 解説へ移動できます。
						</p>
					</header>
					<FacetFilter value={activeFacets} />
					<ViewSwitcher value={view} />
				</PageSection>
				<PageSection id="portfolio-list" label="projects">
					{allProjects.length === 0 ? (
						queryFacets.length > 0 ? (
							<output
								className={css({
									display: 'flex',
									flexDirection: 'column',
									gap: '3',
									paddingBlock: '16',
									color: 'text.muted',
								})}
							>
								<h2
									className={css({
										margin: '0',
										fontFamily: 'heading',
										fontSize: 'xl',
										color: 'text.default',
									})}
								>
									該当する project はありません
								</h2>
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										lineHeight: '1.6',
									})}
								>
									別の facet を試すか、filter を外してください。
								</p>
							</output>
						) : (
							<PortfolioEmptyState />
						)
					) : view === 'develop' ? (
						<DevelopView projects={allProjects} />
					) : view === 'video' ? (
						<VideoView projects={allProjects} />
					) : view === 'design' ? (
						<DesignView projects={allProjects} />
					) : (
						// Issue #912 round 2 (owner feedback 2026-11-05): the
						// full-width vertical stack read as stretched-out, so
						// the list is a card grid on the documented pattern —
						// `Grid` preset 5 (1/2/3 columns), the 24px gutter, the
						// 40px row beat and `equalRows`, the measured fix for
						// uneven card heights (design #764).
						<Grid as="ol" columns={5} columnGap="6" rowGap="10" equalRows className={listReset}>
							{allProjects.map((project) => (
								<li key={project.id} className={liStretchClass}>
									<ProjectCard project={project} />
								</li>
							))}
						</Grid>
					)}
					{hasMore ? (
						<div
							className={css({
								display: 'flex',
								justifyContent: 'center',
								marginBlockStart: '10',
							})}
						>
							<Button
								type="button"
								variant="secondary"
								onClick={onLoadMore}
								disabled={busy}
								aria-busy={busy}
								className={css({ height: '10', paddingInline: '6', borderRadius: 'full' })}
							>
								{busy ? 'Loading…' : 'Load more'}
							</Button>
						</div>
					) : null}
					{error ? (
						<p
							role="alert"
							className={css({
								marginBlockStart: '4',
								color: 'text.muted',
								fontFamily: 'sans',
								fontSize: 'sm',
							})}
						>
							{error}
						</p>
					) : null}
				</PageSection>
			</main>
		</>
	);
}

/** List resets for the semantic `<ol>` card grid (display lives in `Grid`). */
const listReset = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

/**
 * Grid item behaviour for one card (same shape as the tools index's
 * `cardItem`): the `<li>` stretches to its row track (`gridAutoRows` on
 * the list) and the card inside fills it, so every card in a row is the
 * same height.
 */
const liStretchClass = css({
	display: 'grid',
	minWidth: '0',
});
