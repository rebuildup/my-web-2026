import { css, cx } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { StateMark } from '../../editorial/primitives/StateMark';
import { cardTitleClassName, cardTitleLinkClassName } from '../../editorial/primitives/card-title';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { focusRing, vStackGap2, vStackGap3Plain } from '../../editorial/primitives/shared-styles';
import type { PortfolioProject } from '../schema';
import { FACET_LABEL } from '../vocabulary';
import { MediaPlaceholder } from './MediaPlaceholder';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * SelectedWorks — the exhibition band that proves what the site is
 * for (Issue #1295, Epic #1266, `docs/visual/site-concept-2026.md`).
 *
 * The portfolio index and the home page share the committed
 * SELECTION (`src/portfolio/selected.ts`) but NOT the composition:
 * this file owns two presentations of the same facts.
 *
 * `SelectedWorks` (the index) is an exhibition, not a list: the
 * first work takes the feature slot — a media-dominant 8/4 split —
 * and the remaining works hang as a subordinate card wall. Hierarchy
 * comes from scale and placement, so the band's claim ("these are
 * the works this site stands behind") is legible at a glance instead
 * of arriving as row 37 of a uniform stack.
 *
 * `SelectedWorksWall` (home) is the compact counterpart: the same
 * selection rendered as a scannable cover wall with no summaries —
 * the home page's job is to make a recruiter believe, then hand off
 * to `/portfolio` for the case studies.
 *
 * A work without a published cover keeps its slot as a labelled
 * frame: the selection is editorial, so a missing cover is a data
 * fact to show honestly, not a reason to drop the work silently.
 *
 * `headingLevel` lets the same rows serve two placements: `h3`
 * under a section heading, `h2` under home's dedicated section.
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

const FEATURE_RATIO = '16 / 9';
const CARD_RATIO = '4 / 3';
const WALL_RATIO = '16 / 10';

function coverOf(project: PortfolioProject) {
	return project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
}

function facetLine(project: PortfolioProject): string {
	return project.facets.map((f) => FACET_LABEL[f] ?? f).join(' · ');
}

function categoryOf(project: PortfolioProject) {
	return project.facets[0] ? (FACET_CATEGORY[project.facets[0]] ?? null) : null;
}

function WorkMedia({
	project,
	ratio,
	eager,
}: {
	project: PortfolioProject;
	ratio: string;
	eager: boolean;
}) {
	const cover = coverOf(project);
	if (!cover) return <MediaPlaceholder ratio={ratio} label="media 未整備" />;
	return (
		<PortfolioMediaFigure
			media={cover}
			loading={eager ? 'eager' : 'lazy'}
			frameAspectRatio={ratio}
		/>
	);
}

function WorkEyebrow({
	index,
	project,
}: {
	index: number;
	project: PortfolioProject;
}) {
	const category = categoryOf(project);
	return (
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
			<span>{facetLine(project)}</span>
		</div>
	);
}

function CaseStudyLink({ slug }: { slug: string }) {
	return (
		<a
			href={`/portfolio/${slug}`}
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
	);
}

function Summary({ text, clamp }: { text: string; clamp?: '2' | '3' }) {
	return (
		<p
			className={css({
				margin: '0',
				fontFamily: 'sans',
				fontSize: 'md',
				lineHeight: '1.6',
				color: 'text.muted',
				textWrap: 'pretty',
				...(clamp ? { lineClamp: clamp } : {}),
			})}
		>
			{text}
		</p>
	);
}

/* ------------------------------------------------------------------ */
/* Portfolio index — feature + subordinate wall                        */
/* ------------------------------------------------------------------ */

export function SelectedWorks({ works, headingLevel = 'h3' }: SelectedWorksProps) {
	if (works.length === 0) return null;
	const Heading = headingLevel;
	const [feature, ...rest] = works;
	return (
		<Stack as="ol" gap="0" data-testid="selected-works" className={listResetClassName}>
			{/* Feature — the work the selection leads with. Media takes
			    8 of 12 tracks; the copy cluster is a narrow rail, so the
			    artifact dominates and the text explains it. */}
			<li
				data-testid="selected-work"
				data-slug={feature.slug}
				data-variant="feature"
				className={css({ paddingBlock: '10' })}
			>
				<Grid template="12" gap="6" columnGap={{ base: '4', lg: '10' }}>
					<GridItem span={{ base: 12, lg: 8 }} className={css({ minWidth: '0' })}>
						<WorkMedia project={feature} ratio={FEATURE_RATIO} eager />
					</GridItem>
					<GridItem
						span={{ base: 12, lg: 4 }}
						start={{ base: 1, lg: 9 }}
						className={css({
							minWidth: '0',
							display: 'flex',
							flexDirection: 'column',
							gap: '3',
							alignSelf: 'center',
						})}
					>
						<WorkEyebrow index={0} project={feature} />
						<Heading
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: { base: '2xl', lg: '3xl' },
								fontWeight: '700',
								lineHeight: '1.2',
								letterSpacing: '-0.015em',
								color: 'text.default',
								textWrap: 'balance',
							})}
						>
							<a href={`/portfolio/${feature.slug}`} className={cardTitleLinkClassName}>
								{feature.title}
							</a>
						</Heading>
						<Summary text={feature.summary} />
						<CaseStudyLink slug={feature.slug} />
					</GridItem>
				</Grid>
			</li>
			{rest.length > 0 ? (
				<li data-testid="selected-works-wall" className={css({ paddingBlock: '10' })}>
					<Grid as="ol" columns={5} columnGap="6" rowGap="10" className={listResetClassName}>
						{rest.map((project, i) => (
							<li
								key={project.slug}
								data-testid="selected-work"
								data-slug={project.slug}
								data-variant="wall"
								className={cx(css({ minWidth: '0' }), css(vStackGap3Plain))}
							>
								<WorkMedia project={project} ratio={WALL_RATIO} eager={false} />
								<WorkEyebrow index={i + 1} project={project} />
								<Heading className={cardTitleClassName}>
									<a href={`/portfolio/${project.slug}`} className={cardTitleLinkClassName}>
										{project.title}
									</a>
								</Heading>
								<Summary text={project.summary} clamp="2" />
								<CaseStudyLink slug={project.slug} />
							</li>
						))}
					</Grid>
				</li>
			) : null}
		</Stack>
	);
}

/* ------------------------------------------------------------------ */
/* Home — compact cover wall                                            */
/* ------------------------------------------------------------------ */

export function SelectedWorksWall({ works, headingLevel = 'h3' }: SelectedWorksProps) {
	if (works.length === 0) return null;
	const Heading = headingLevel;
	return (
		<Grid
			as="ol"
			columns={5}
			columnGap="6"
			rowGap="10"
			data-testid="selected-works-wall"
			className={listResetClassName}
		>
			{works.map((project, i) => (
				<li
					key={project.slug}
					data-testid="selected-work"
					data-slug={project.slug}
					data-variant="home-wall"
					className={cx(css({ minWidth: '0' }), css(vStackGap2))}
				>
					<WorkMedia project={project} ratio={CARD_RATIO} eager={i === 0} />
					<WorkEyebrow index={i} project={project} />
					<Heading className={cardTitleClassName}>
						<a href={`/portfolio/${project.slug}`} className={cardTitleLinkClassName}>
							{project.title}
						</a>
					</Heading>
					<CaseStudyLink slug={project.slug} />
				</li>
			))}
		</Grid>
	);
}
