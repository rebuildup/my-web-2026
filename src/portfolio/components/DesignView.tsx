import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { focusRingMedia } from '../../editorial/primitives/shared-styles';
import type { PortfolioProject } from '../schema';
import { designTileFrameRatio, designTileSpan, hasPeriodLabel, projectCover } from '../views';
import { FACET_LABEL } from '../vocabulary';
import { MediaPlaceholder } from './MediaPlaceholder';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * DesignView — the `?view=design` exhibition mode (Issue #1048).
 *
 * The successor of my-web-2025's `video&design` gallery
 * (`GalleryGridSection` + `GridItemComponentV2`): a dense three-column
 * tile grid where covers bleed to the tile edge and the title rides
 * beneath as a caption strip. What makes it "variable" is the tile
 * SPAN, not random sizing — see `designTileSpan` in `views.ts` for the
 * deterministic rule (pinned → two columns, wide cover → two columns)
 * that replaces the predecessor's client-side `Math.random` weights,
 * which could never survive SSR.
 *
 * Differences from the predecessor, deliberate:
 *
 *   - tiles link to `/portfolio/<slug>` detail pages; the 2026 detail
 *     surface owns the full record, so the in-grid hover panel is
 *     gone;
 *   - the caption is a real text strip under the image rather than an
 *     overlay on it — the editorial language separates planes by fill
 *     and gutter, not by text floating on imagery (the same posture
 *     `ProjectCard` took in Issue #912 round 2);
 *   - a project with no cover renders `MediaPlaceholder` inside the
 *     same span — an honest labelled frame, never a fake thumbnail;
 *   - `gridAutoFlow: dense` lets a two-column tile pull a later
 *     one-column tile up beside it, which is what keeps the grid
 *     irregular without any measurement pass.
 */
export interface DesignViewProps {
	projects: readonly PortfolioProject[];
}

export function DesignView({ projects }: DesignViewProps) {
	return (
		<ol
			className={css({
				listStyle: 'none',
				margin: '0',
				padding: '0',
				display: 'grid',
				gridTemplateColumns: {
					base: '1fr',
					md: 'repeat(2, minmax(0, 1fr))',
					lg: 'repeat(3, minmax(0, 1fr))',
				},
				gridAutoFlow: 'dense',
				// `minmax` floor mirrors the predecessor's 200px tile
				// minimum; rows still size to content above it.
				gridAutoRows: 'minmax(180px, auto)',
				columnGap: { base: '0', md: '4' },
				rowGap: '8',
			})}
		>
			{projects.map((project) => (
				<DesignTile key={project.id} project={project} />
			))}
		</ol>
	);
}

function DesignTile({ project }: { project: PortfolioProject }) {
	const cover = projectCover(project);
	const span = designTileSpan(project);
	const frameRatio = designTileFrameRatio(span);
	const detailHref = `/portfolio/${project.slug}`;
	const firstFacet = project.facets[0];
	const hasPeriod = hasPeriodLabel(project);
	// Column spans apply from `md` up only: the base layout is a single
	// column, where "span 2" is meaningless and would overflow.
	return (
		<li
			className={css({
				display: 'grid',
				minWidth: '0',
				gridColumn: span.columnSpan === 2 ? { base: 'auto', md: 'span 2' } : undefined,
			})}
		>
			<a
				href={detailHref}
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '2',
					height: '100%',
					minWidth: '0',
					textDecoration: 'none',
					_focusVisible: focusRingMedia,
				})}
			>
				{cover ? (
					<PortfolioMediaFigure media={cover} loading="lazy" frameAspectRatio={frameRatio} />
				) : (
					<MediaPlaceholder ratio={frameRatio} />
				)}
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '1',
						minWidth: '0',
						marginBlockStart: 'auto',
						paddingBlockStart: '1',
					})}
				>
					<h3
						className={css({
							margin: '0',
							fontFamily: 'heading',
							fontSize: 'md',
							fontWeight: '700',
							color: 'text.default',
							lineHeight: '1.3',
							letterSpacing: '-0.01em',
						})}
					>
						<span
							className={css({
								color: 'inherit',
								textDecoration: 'underline',
								textUnderlineOffset: '0.18em',
								textDecorationThickness: '1px',
								textDecorationColor: 'border.strong',
								_hover: {
									textDecorationThickness: '2px',
									textDecorationColor: 'currentColor',
								},
							})}
						>
							{project.title}
						</span>
					</h3>
					<p
						className={css({
							margin: '0',
							display: 'flex',
							alignItems: 'center',
							gap: '2',
							flexWrap: 'wrap',
							fontFamily: 'mono',
							fontSize: 'xs',
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
							color: 'text.muted',
						})}
					>
						{firstFacet ? FACET_LABEL[firstFacet] : 'Project'}
						{hasPeriod && project.periodLabel ? ` · ${project.periodLabel}` : ''}
						{project.pinned ? <Badge tone="accent">Pinned</Badge> : null}
					</p>
				</div>
			</a>
		</li>
	);
}
