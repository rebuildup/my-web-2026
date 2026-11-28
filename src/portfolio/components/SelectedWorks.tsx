import { css, cx } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { StateMark } from '../../editorial/primitives/StateMark';
import { cardTitleClassName } from '../../editorial/primitives/card-title';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { focusRing, vStackGap3Plain } from '../../editorial/primitives/shared-styles';
import type { PortfolioProject } from '../schema';
import { FACET_LABEL } from '../vocabulary';
import { MediaPlaceholder } from './MediaPlaceholder';
import { PortfolioMediaFigure } from './PortfolioMedia';

/**
 * SelectedWorks — the exhibition band that proves what the site is
 * for (Issue #1295, Epic #1266, `docs/visual/site-concept-2026.md`).
 *
 * The portfolio index and the home page share the committed
 * SELECTION (`src/portfolio/selected.ts`) AND this one presentation:
 * the first work takes the feature slot — a media-dominant 8/4
 * split — and the remaining works hang as a subordinate wall on the
 * 12-track grid with permuted spans, varied media ratios and a
 * brick stagger. Hierarchy comes from scale and placement, so the
 * band's claim ("these are the works this site stands behind") is
 * legible at a glance instead of arriving as row 37 of a uniform
 * stack. Home renders the same component over a shorter slice —
 * one hierarchy, two placements (see the note at the foot of this
 * file for why the earlier two-presentation split was rejected).
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
const WALL_RATIOS = ['16 / 10', '4 / 3', '3 / 2'] as const;

/**
 * Exhibition title link — like `cardTitleLinkClassName` but with NO
 * resting underline: agy's review of PR #1299 flagged permanent
 * underlines on multi-line display titles as "default browser link"
 * chrome that competes with the media. The affordance moves to
 * hover (underline draws in) and focus (ring), so at rest the title
 * reads as typography, not as a link row.
 */
const workTitleLinkClassName = /*#__PURE__*/ css({
	color: 'inherit',
	textDecoration: 'none',
	_focusVisible: focusRing,
	_hover: {
		textDecoration: 'underline',
		textUnderlineOffset: '0.18em',
		textDecorationThickness: '2px',
	},
});

/**
 * Wall placement — the subordinate works hang on the 12-track grid
 * with PERMUTED column spans, so no two rows share the same
 * silhouette. Each row of three sums to 12 tracks; the pattern
 * cycles so the ragged right edge reads as composition, not
 * breakage. Bare `span`/`start` values land on md/lg while base
 * falls back to full width (the mobile recomposition contract).
 */
const WALL_ROW_SPANS: readonly (readonly [number, number, number])[] = [
	[5, 4, 3],
	[3, 4, 5],
	[5, 3, 4],
];

function wallPlacement(index: number, rowLength: number): { span: number; start: number } {
	const row = Math.floor(index / 3);
	const col = index % 3;
	const itemsInRow = Math.min(3, rowLength - row * 3);
	// A partial closing row redistributes the 12 tracks evenly —
	// two works take 6+6, one takes the full width — so the wall
	// never ends in an orphan void (agy review of PR #1299).
	if (itemsInRow < 3) {
		const base = Math.floor(12 / itemsInRow);
		const extra = 12 % itemsInRow;
		const spans = Array.from({ length: itemsInRow }, (_, k) => base + (k < extra ? 1 : 0));
		const start = 1 + spans.slice(0, col).reduce((sum, n) => sum + n, 0);
		return { span: spans[col], start };
	}
	const spans = WALL_ROW_SPANS[row % WALL_ROW_SPANS.length];
	const start = 1 + spans.slice(0, col).reduce((sum, n) => sum + n, 0);
	return { span: spans[col], start };
}

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
							// Anchored to the bottom rail: the copy block sits
							// low against the media's baseline instead of
							// floating mid-height — the offset is the
							// editorial gesture that keeps the feature from
							// reading as a two-column form.
							alignSelf: 'end',
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
							<a href={`/portfolio/${feature.slug}`} className={workTitleLinkClassName}>
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
					<Grid
						as="ol"
						template="12"
						gap="6"
						columnGap={{ base: '4', lg: '10' }}
						rowGap="10"
						className={listResetClassName}
					>
						{rest.map((project, i) => {
							const { span, start } = wallPlacement(i, rest.length);
							return (
								<GridItem
									as="li"
									key={project.slug}
									span={{ base: 12, lg: span }}
									start={{ base: 1, lg: start }}
									data-testid="selected-work"
									data-slug={project.slug}
									data-variant="wall"
									className={cx(css({ minWidth: '0' }), css(vStackGap3Plain))}
								>
									<WorkMedia
										project={project}
										ratio={WALL_RATIOS[i % WALL_RATIOS.length]}
										eager={false}
									/>
									<WorkEyebrow index={i + 1} project={project} />
									<Heading className={cx(cardTitleClassName, css({ textWrap: 'balance' }))}>
										<a href={`/portfolio/${project.slug}`} className={workTitleLinkClassName}>
											{project.title}
										</a>
									</Heading>
									<Summary text={project.summary} clamp="2" />
									<CaseStudyLink slug={project.slug} />
								</GridItem>
							);
						})}
					</Grid>
				</li>
			) : null}
		</Stack>
	);
}

/* ------------------------------------------------------------------ */
/* One presentation, two placements                                     */
/*                                                                      */
/* Home renders the SAME `SelectedWorks` with a shorter slice — the   */
/* agy review of PR #1299 flagged the earlier split presentation      */
/* (exhibition on /portfolio, compact wall on home) as "layout        */
/* whiplash": a visitor crossing the two surfaces felt the design     */
/* system change. One component, one hierarchy; surfaces differ only  */
/* in how many works they exhibit.                                    */
/* ------------------------------------------------------------------ */
