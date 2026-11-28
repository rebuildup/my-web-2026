import { css } from '../../../styled-system/css';
import { Button } from '../../editorial/primitives/Button';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { bodySansMd, eyebrowSans, pageTitleFlush } from '../../editorial/primitives/shared-styles';
import type { PortfolioListPage, PortfolioProject } from '../schema';
import type { PortfolioFacet } from '../schema';
import { resolveSelectedWorks } from '../selected';
import { DEFAULT_PORTFOLIO_VIEW, type PortfolioView } from '../views';
import { DesignView } from './DesignView';
import { DevelopView } from './DevelopView';
import { PortfolioEmptyState } from './EmptyState';
import { FacetFilter } from './FacetFilter';
import { PortfolioArchive } from './PortfolioArchive';
import { SelectedWorks } from './SelectedWorks';
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
 *   - Selected works band (curated exhibition, `all` view only),
 *   - Archive (facet-grouped compact index of every published work)
 *     or the named exhibition views — or the empty state when no
 *     entries are visible. The empty state is selected by
 *     `activeFacets`:
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
	 * Exhibition mode (Issue #1048). `all` renders the archive index
	 * (Issue #1318); `develop` / `video` / `design` render
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
	// Issue #1295 — the editorial band reads the SAME committed
	// selection the home page does (`src/portfolio/selected.ts`), and
	// only on the unfiltered `all` view: a facet-scoped exhibition is
	// answering a narrower question than "what does this site stand
	// behind".
	const selectedWorks = view === 'all' ? resolveSelectedWorks(allProjects) : [];
	// The archive marks — never hides — the works the band exhibits,
	// so the two layers agree on what "selected" means (Issue #1318).
	const selectedSlugs = new Set(selectedWorks.map((work) => work.slug));

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
						<span className={css(eyebrowSans)}>Portfolio</span>
						<h1 id="portfolio-heading" className={css(pageTitleFlush)}>
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
							デザインから実装・公開まで一人で通した制作物を厳選し、
							技術選定・設計・成果・振り返りを第三者が URL
							を渡されただけで辿れるように整理しています。 facet で絞り込み、各 project
							の詳細ページから repository / release / 解説へ移動できます。
						</p>
					</header>
					<FacetFilter value={activeFacets} />
					<ViewSwitcher value={view} />
				</PageSection>
				{selectedWorks.length > 0 ? (
					<PageSection id="portfolio-selected" label="selected works">
						<SectionHeading
							id="portfolio-selected-heading"
							eyebrow="Selected"
							title="選んだ作品"
							titleEn="Selected works"
							description="デザインから実装まで一人で通した制作物を厳選して展示しています。"
						/>
						<SelectedWorks works={selectedWorks} />
					</PageSection>
				) : null}
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
								<p className={css(bodySansMd)}>別の facet を試すか、filter を外してください。</p>
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
						// Issue #1318 — the `all` catalogue is no longer a
						// uniform card grid (audit finding #2/#4: ~74 equal
						// cards was a ~40,000px mobile scroll marathon).
						// It renders as the archive layer: compact rows
						// filed under their primary facet, every published
						// work still server-rendered, band exhibits
						// marked `Selected`.
						<>
							<SectionHeading
								id="portfolio-archive-heading"
								eyebrow="Archive"
								title="作品アーカイブ"
								titleEn="Archive"
								description="公開している全作品を facet ごとにまとめた目録です。上の Selected works は厳選した展示、こちらは網羅のための索引です。"
							/>
							<PortfolioArchive projects={allProjects} selectedSlugs={selectedSlugs} />
						</>
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
				{/* Issue #1318 — audit finding #7: the page used to dead-end
				    on the last archive row. Every public page closes on the
				    shared rhythm's CTA band (site-concept-2026 §5); for a
				    visitor who just browsed the works the honest next step
				    is the commission surface, not another list. */}
				<PageSection
					labelledBy="portfolio-closing-heading"
					rhythm="closing"
					tone="sunken"
					separator
					name="commission"
				>
					<SectionHeading
						id="portfolio-closing-heading"
						eyebrow="Commission"
						title="制作の依頼"
						titleEn="Commission"
						description="Web 開発・アプリケーション開発・映像制作の依頼受付状況と、見積もりに必要な情報をまとめています。"
					>
						<Button as="a" href="/commission" variant="primary">
							<span lang="ja">Commission を見る</span>
							<MaterialSymbol d={ARROW_FORWARD_PATH} size={18} />
						</Button>
					</SectionHeading>
				</PageSection>
			</main>
		</>
	);
}
