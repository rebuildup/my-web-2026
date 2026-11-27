import { css } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { StateMark } from '../../editorial/primitives/StateMark';
import { cardTitleClassName, cardTitleLinkClassName } from '../../editorial/primitives/card-title';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { focusRing } from '../../editorial/primitives/shared-styles';
import type { PortfolioProject } from '../schema';
import { FACET_LABEL } from '../vocabulary';
import { MediaPlaceholder } from './MediaPlaceholder';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * SelectedWorks — the editorial band that proves what the site is
 * for (Issue #1295, Epic #1266, `docs/visual/site-concept-2026.md`).
 *
 * The portfolio index and the home page both render the SAME
 * committed selection (`src/portfolio/selected.ts`) through this
 * component, so "the works this site chooses to stand behind" is one
 * fact, not two lists that can drift.
 *
 * Composition: an ordered list of feature rows on the 12-track
 * coordinate grid. Each row pairs a large cover (7 tracks) with a
 * copy cluster (5 tracks); only the SIDE alternates — the media
 * keeps the dominant span on every row so the band scans as one
 * instrument, not a zigzag of two different row types. Rows without
 * a published cover keep their slot as a labelled frame — the
 * selection is editorial, so a missing cover is a data fact to show
 * honestly, not a reason to drop the work silently. Summaries are
 * clamped to three lines so the "case study" exit sits on a shared
 * baseline regardless of copy length (agy review, PR #1299).
 *
 * `headingLevel` lets the same rows serve two placements: `h3`
 * under the portfolio index's section heading, `h2` under home's
 * dedicated section.
 */
export interface SelectedWorksProps {
	works: readonly PortfolioProject[];
	/** Heading level for each work's title. Default `h3`. */
	headingLevel?: 'h2' | 'h3';
}

const FACET_CATEGORY: Readonly<Record<string, 'design' | 'code' | 'writing' | 'tool'>> = {
	develop: 'code',
	video: 'tool',
	design: 'design',
	other: 'writing',
};

const COVER_FRAME_RATIO = '16 / 9';

export function SelectedWorks({ works, headingLevel = 'h3' }: SelectedWorksProps) {
	if (works.length === 0) return null;
	const Heading = headingLevel;
	return (
		<Stack as="ol" gap="0" data-testid="selected-works" className={listResetClassName}>
			{works.map((project, index) => {
				const cover = project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
				const category = project.facets[0] ? (FACET_CATEGORY[project.facets[0]] ?? null) : null;
				const mediaLeft = index % 2 === 0;
				return (
					<li
						key={project.slug}
						data-testid="selected-work"
						data-slug={project.slug}
						className={css({
							paddingBlock: '10',
							borderBlockStartWidth: index === 0 ? '0' : '1px',
							borderBlockStartStyle: 'solid',
							borderBlockStartColor: 'border.subtle',
						})}
					>
						<Grid template="12" gap="6" columnGap={{ base: '4', lg: '10' }}>
							<GridItem
								span={{ base: 12, lg: 7 }}
								start={{ base: 1, lg: mediaLeft ? 1 : 8 }}
								className={css({ minWidth: '0', order: { base: mediaLeft ? 2 : 1, lg: 0 } })}
							>
								{cover ? (
									<PortfolioMediaFigure
										media={cover}
										loading={index < 2 ? 'eager' : 'lazy'}
										frameAspectRatio={COVER_FRAME_RATIO}
									/>
								) : (
									<MediaPlaceholder ratio={COVER_FRAME_RATIO} label="media 未整備" />
								)}
							</GridItem>
							<GridItem
								span={{ base: 12, lg: 5 }}
								start={{ base: 1, lg: mediaLeft ? 8 : 1 }}
								className={css({
									minWidth: '0',
									display: 'flex',
									flexDirection: 'column',
									gap: '3',
									alignSelf: 'center',
									order: { base: mediaLeft ? 1 : 2, lg: 0 },
								})}
							>
								<div
									className={css({
										display: 'flex',
										alignItems: 'center',
										gap: '2',
										fontFamily: 'mono',
										fontSize: 'xs',
										letterSpacing: '0.06em',
										textTransform: 'uppercase',
										color: 'text.muted',
									})}
								>
									<span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
									{category ? <StateMark kind={category} size="sm" /> : null}
									<span>{project.facets.map((f) => FACET_LABEL[f] ?? f).join(' · ')}</span>
								</div>
								<Heading className={cardTitleClassName}>
									<a href={`/portfolio/${project.slug}`} className={cardTitleLinkClassName}>
										{project.title}
									</a>
								</Heading>
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										lineHeight: '1.6',
										color: 'text.muted',
										textWrap: 'pretty',
										lineClamp: '3',
									})}
								>
									{project.summary}
								</p>
								<a
									href={`/portfolio/${project.slug}`}
									className={css({
										display: 'inline-flex',
										alignItems: 'center',
										gap: '1',
										alignSelf: 'flex-start',
										fontFamily: 'mono',
										fontSize: 'sm',
										color: 'text.default',
										textDecoration: 'none',
										_hover: { textDecoration: 'underline' },
										_focusVisible: focusRing,
									})}
								>
									case study
									<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
								</a>
							</GridItem>
						</Grid>
					</li>
				);
			})}
		</Stack>
	);
}
