import type { PortfolioListPage, PortfolioProject } from '../schema';
import type { PortfolioFacet } from '../schema';
import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { FacetFilter } from './FacetFilter';
import { ProjectCard } from './ProjectCard';

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
 *   - Project list (cards),
 *   - "Load more" (rendered only while a `nextCursor` is present).
 */
export interface PortfolioListProps {
	initialPage: PortfolioListPage;
	activeFacets: readonly PortfolioFacet[];
	hasMore: boolean;
	busy: boolean;
	error: string | null;
	onLoadMore: () => void;
	extra: readonly PortfolioProject[];
}

export function PortfolioList({
	initialPage,
	activeFacets,
	hasMore,
	busy,
	error,
	onLoadMore,
	extra,
}: PortfolioListProps) {
	const allProjects: PortfolioProject[] = [...initialPage.projects, ...extra];

	return (
		<>
			<a href="#portfolio-list" className={skipLinkStyle}>
				本文へスキップ
			</a>
			<main id="main">
				<section
					aria-labelledby="portfolio-heading"
					className={css({ paddingBlock: { base: '16', lg: '24' } })}
				>
					<Container>
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
					</Container>
				</section>
				<section
					id="portfolio-list"
					aria-label="projects"
					className={css({ paddingBlock: { base: '8', lg: '16' } })}
				>
					<Container>
						{allProjects.length === 0 ? (
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
							<ol
								className={css({
									listStyle: 'none',
									margin: '0',
									padding: '0',
									display: 'flex',
									flexDirection: 'column',
								})}
							>
								{allProjects.map((project) => (
									<li key={project.id}>
										<ProjectCard project={project} />
									</li>
								))}
							</ol>
						)}
						{hasMore ? (
							<div
								className={css({
									display: 'flex',
									justifyContent: 'center',
									marginBlockStart: '10',
								})}
							>
								<button
									type="button"
									onClick={onLoadMore}
									disabled={busy}
									aria-busy={busy}
									className={css({
										h: '10',
										px: '6',
										borderRadius: 'full',
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: 'border.subtle',
										backgroundColor: 'bg.surface',
										color: 'text.default',
										fontFamily: 'sans',
										fontSize: 'md',
										fontWeight: '600',
										cursor: 'pointer',
										_disabled: {
											cursor: 'not-allowed',
											opacity: '0.6',
										},
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
									})}
								>
									{busy ? 'Loading…' : 'Load more'}
								</button>
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
					</Container>
				</section>
			</main>
		</>
	);
}

const skipLinkStyle = css({
	position: 'absolute',
	left: '0',
	top: '0',
	padding: '2',
	backgroundColor: 'bg.canvas',
	color: 'text.default',
	textDecoration: 'none',
	transform: 'translateY(-200%)',
	_focusVisible: {
		transform: 'translateY(0)',
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});
