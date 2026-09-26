import type { PortfolioProject } from '../schema';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * ProjectCard — list item for `/portfolio`.
 *
 * Reading order (per the editorial coordinate system):
 *   1. cover media (when present),
 *   2. project type (facet label, mono / muted),
 *   3. title,
 *   4. summary,
 *   5. role + period,
 *   6. facet pills,
 *   7. detail link.
 *
 * Pinned projects receive an explicit `Pinned` badge so the
 * editorial intent at the data layer shows up on the surface.
 *
 * The card is a link to the detail route — semantic markup: the
 * `<a>` wraps the title and the whole card (CSS `::after`
 * pseudo-element extends the hit area to the entire card
 * surface).
 */
export interface ProjectCardProps {
	project: PortfolioProject;
}

const FACET_LABEL: Readonly<Record<string, string>> = {
	develop: 'Develop',
	video: 'Video',
	design: 'Design',
	other: 'Other',
};

export function ProjectCard({ project }: ProjectCardProps) {
	const cover = project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
	const type = project.facets[0]
		? (FACET_LABEL[project.facets[0]] ?? project.facets[0])
		: 'Project';
	return (
		<article
			className={css({
				position: 'relative',
				display: 'grid',
				gridTemplateColumns: { base: '1fr', md: 'minmax(0, 4fr) minmax(0, 8fr)' },
				columnGap: { base: '0', md: '8' },
				rowGap: { base: '4', md: '0' },
				paddingBlock: '8',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			{cover ? (
				<div className={css({ minWidth: '0' })}>
					<PortfolioMediaFigure media={cover} loading="lazy" />
				</div>
			) : null}
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
					minWidth: '0',
				})}
			>
				<header
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '2',
					})}
				>
					<div
						className={css({
							display: 'flex',
							alignItems: 'center',
							gap: '3',
						})}
					>
						<span
							aria-hidden="true"
							className={css({
								fontFamily: 'mono',
								fontSize: 'xs',
								letterSpacing: '0.06em',
								textTransform: 'uppercase',
								color: 'text.muted',
							})}
						>
							{type}
						</span>
						{project.pinned ? <Badge tone="accent">Pinned</Badge> : null}
					</div>
					<h3
						className={css({
							margin: '0',
							fontFamily: 'heading',
							fontSize: 'xl',
							fontWeight: '700',
							color: 'text.default',
							lineHeight: '1.25',
							letterSpacing: '-0.01em',
						})}
					>
						<a
							href={`/portfolio/${project.slug}`}
							className={css({
								color: 'inherit',
								textDecoration: 'none',
								_focusVisible: {
									outline: '2px solid {colors.border.focus}',
									outlineOffset: '4px',
									borderRadius: '2px',
								},
								_hover: {
									textDecoration: 'underline',
								},
							})}
						>
							{project.title}
						</a>
					</h3>
				</header>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.muted',
						lineHeight: '1.6',
					})}
				>
					{project.summary}
				</p>
				<dl
					className={css({
						margin: '0',
						display: 'grid',
						gridTemplateColumns: { base: '1fr', sm: 'auto auto' },
						columnGap: '6',
						rowGap: '1',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					<dt
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
						})}
					>
						Role
					</dt>
					<dd className={css({ margin: '0' })}>{project.role}</dd>
					<dt
						className={css({
							fontFamily: 'mono',
							fontSize: 'xs',
							letterSpacing: '0.04em',
							textTransform: 'uppercase',
						})}
					>
						Period
					</dt>
					<dd className={css({ margin: '0' })}>{project.periodLabel}</dd>
				</dl>
				<div
					aria-label="facets"
					className={css({
						display: 'flex',
						flexWrap: 'wrap',
						gap: '2',
					})}
				>
					{project.facets.map((facet) => (
						<Badge key={facet} tone="neutral">
							{FACET_LABEL[facet] ?? facet}
						</Badge>
					))}
				</div>
			</div>
		</article>
	);
}
