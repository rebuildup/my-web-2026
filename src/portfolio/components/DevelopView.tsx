import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Cluster, Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { StateMark } from '../../editorial/primitives/StateMark';
import { cardTitleLinkClassName } from '../../editorial/primitives/card-title';
import {
	eyebrowMonoXs,
	focusRing,
	focusRingMedia,
	noteSansMd,
	rowWrapGap3,
	sizeTitle,
	tagMonoXsCaps,
	vStackGap2,
} from '../../editorial/primitives/shared-styles';
import type { PortfolioProject } from '../schema';
import { hasPeriodLabel, hasRecordedRole, projectCover } from '../views';
import { FACET_LABEL, LINK_LABEL } from '../vocabulary';
import { MediaPlaceholder } from './MediaPlaceholder';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * DevelopView — the `?view=develop` exhibition mode (Issue #1048).
 *
 * The successor of my-web-2025's `DevelopGalleryClient`: one row per
 * project, media on one side and the editorial record on the other,
 * alternating sides down the list on `lg` and stacking media-first on
 * smaller screens.
 *
 * What changed from the predecessor, deliberately:
 *
 *   - rows link to `/portfolio/<slug>` detail pages instead of
 *     opening a modal — the 2026 detail surface already owns the
 *     full record (Markdown sections, video facade, links), so a
 *     second in-page detail would duplicate it;
 *   - technologies render as the stored strings (no invented
 *     fallback tag), facet pills and the role/period guards match
 *     `ProjectCard` exactly (`hasRecordedRole` / `hasPeriodLabel` in
 *     `views.ts` are the same rules, centralised);
 *   - a project with no cover renders `MediaPlaceholder` — an honest
 *     labelled frame — rather than a fabricated thumbnail, and a
 *     project with no links simply omits the links row.
 *
 * The frame ratio is the same `16 / 9` the `all` view's card uses, so
 * a cover reserves the same box in every mode.
 */
export interface DevelopViewProps {
	projects: readonly PortfolioProject[];
}

const ROW_FRAME_RATIO = '16 / 9';

export function DevelopView({ projects }: DevelopViewProps) {
	return (
		<Stack as="ol" gap={{ base: '10', lg: '16' }} className={listResetClassName}>
			{projects.map((project, index) => (
				<DevelopRow key={project.id} project={project} index={index} />
			))}
		</Stack>
	);
}

function DevelopRow({ project, index }: { project: PortfolioProject; index: number }) {
	const cover = projectCover(project);
	const detailHref = `/portfolio/${project.slug}`;
	const firstFacet = project.facets[0];
	const category =
		firstFacet === 'develop'
			? 'code'
			: firstFacet === 'video'
				? 'tool'
				: firstFacet === 'design'
					? 'design'
					: firstFacet === 'other'
						? 'writing'
						: null;
	// Odd rows put the media on the right at `lg`, mirroring the
	// predecessor's alternating layout. Mobile always stacks
	// media-first (base order 0 for both columns; the `lg` order is
	// the only one that flips).
	const mediaOnRight = index % 2 === 1;
	const hasRole = hasRecordedRole(project);
	const hasPeriod = hasPeriodLabel(project);
	const hasTechnologies = project.technologies.length > 0;
	const hasLinks = project.links.length > 0;

	return (
		<li>
			<article
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '6',
					lg: { flexDirection: 'row', alignItems: 'center', gap: '8' },
				})}
			>
				<div
					className={css({
						minWidth: '0',
						width: { lg: '50%' },
						flexShrink: 0,
						order: { lg: mediaOnRight ? 2 : 1 },
					})}
				>
					{cover ? (
						<a
							href={detailHref}
							aria-label={project.title}
							className={css({
								display: 'block',
								textDecoration: 'none',
								_focusVisible: focusRingMedia,
							})}
						>
							<PortfolioMediaFigure
								media={cover}
								loading="lazy"
								frameAspectRatio={ROW_FRAME_RATIO}
							/>
						</a>
					) : (
						<MediaPlaceholder ratio={ROW_FRAME_RATIO} />
					)}
				</div>
				<div
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '4',
						minWidth: '0',
						width: { lg: '50%' },
						order: { lg: mediaOnRight ? 1 : 2 },
					})}
				>
					<header className={css(vStackGap2)}>
						<div className={css(rowWrapGap3)}>
							<span
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									gap: '1',
									fontFamily: 'mono',
									fontSize: 'xs',
									letterSpacing: '0.06em',
									textTransform: 'uppercase',
									color: 'text.muted',
								})}
							>
								{category ? <StateMark kind={category} size="sm" /> : null}
								{firstFacet ? FACET_LABEL[firstFacet] : 'Project'}
							</span>
							{project.pinned ? <Badge tone="accent">Pinned</Badge> : null}
						</div>
						<h3
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: sizeTitle,
								fontWeight: '700',
								color: 'text.default',
								lineHeight: '1.25',
								letterSpacing: '-0.01em',
							})}
						>
							<a href={detailHref} className={cardTitleLinkClassName}>
								{project.title}
							</a>
						</h3>
					</header>
					<p className={css(noteSansMd)}>{project.summary}</p>
					{hasRole || hasPeriod ? (
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
							{hasRole ? (
								<>
									<dt className={css(tagMonoXsCaps)}>Role</dt>
									<dd className={css({ margin: '0' })}>{project.role}</dd>
								</>
							) : null}
							{hasPeriod ? (
								<>
									<dt className={css(tagMonoXsCaps)}>Period</dt>
									<dd className={css({ margin: '0' })}>{project.periodLabel}</dd>
								</>
							) : null}
						</dl>
					) : null}
					{hasTechnologies ? (
						<Cluster as="ul" gap="2" className={listResetClassName}>
							{project.technologies.map((technology) => (
								<li
									key={technology}
									className={css({
										fontFamily: 'mono',
										fontSize: 'xs',
										letterSpacing: '0.04em',
										color: 'text.muted',
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: 'border.subtle',
										borderRadius: 'full',
										paddingInline: '3',
										paddingBlock: '1',
									})}
								>
									{technology}
								</li>
							))}
						</Cluster>
					) : null}
					{hasLinks ? (
						<Cluster as="ul" gap="4" className={listResetClassName}>
							{project.links.map((link) => (
								<li key={link.id}>
									<a
										href={link.url}
										target="_blank"
										rel="noopener noreferrer"
										className={css({
											display: 'inline-flex',
											gap: '2',
											alignItems: 'baseline',
											fontFamily: 'sans',
											fontSize: 'sm',
											fontWeight: '600',
											color: 'text.default',
											textDecoration: 'underline',
											textUnderlineOffset: '0.18em',
											textDecorationThickness: '1px',
											textDecorationColor: 'border.strong',
											_focusVisible: focusRing,
											_hover: { textDecorationThickness: '2px' },
										})}
									>
										<span className={css(eyebrowMonoXs)}>{LINK_LABEL[link.kind]}</span>
										<span>{link.label ?? link.url}</span>
									</a>
								</li>
							))}
						</Cluster>
					) : null}
				</div>
			</article>
		</li>
	);
}
