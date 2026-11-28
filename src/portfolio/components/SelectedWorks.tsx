import { css, cx } from '../../../styled-system/css';
import { Cluster, Stack, listResetClassName } from '../../editorial/primitives/Flow';
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
 * SELECTION (`src/portfolio/selected.ts`) AND this one presentation.
 * The exhibition is MATERIAL-driven (Epic #1266 pass): the first
 * work takes the feature slot as a contact sheet — cover at
 * exhibition scale plus a strip of its own additional media — and
 * the wall assigns each work a display mode from its media count:
 * "series" works (a real gallery) hang as diptychs in the wide
 * spans, single-image "plates" keep one framed cover. Every work
 * carries a quiet provenance line (year — role) so the band reads
 * as a curated showing, not a directory of links.
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
 * Wall placement — spans are assigned by MATERIAL, not by position
 * (Issue #1296 exhibition pass): a "series" work (a real gallery,
 * ≥3 media rows) takes the wide slots so its diptych has room, and
 * single-image "plates" fill what remains. Within a full row the
 * span pool still permutes ([5,4,3] with series-first priority), so
 * the ragged right edge keeps its composed irregularity; rows with
 * no series work fall back to the cyclic span patterns for
 * silhouette variety. Partial closing rows redistribute the 12
 * tracks evenly — two works take 6+6, one takes the full width —
 * so the wall never ends in an orphan void.
 */
const WALL_ROW_SPANS: readonly (readonly [number, number, number])[] = [
	[5, 4, 3],
	[3, 4, 5],
	[5, 3, 4],
];

/** Descending span pool for a full row — series work claims the head. */
const SERIES_SPAN_POOL = [5, 4, 3] as const;

function wallSpans(items: readonly { series: boolean }[]): readonly number[] {
	const spans = new Array<number>(items.length).fill(0);
	for (let rowStart = 0; rowStart < items.length; rowStart += 3) {
		const row = items.slice(rowStart, rowStart + 3);
		const n = row.length;
		if (n === 3) {
			const hasSeries = row.some((item) => item.series);
			if (!hasSeries) {
				const pattern = WALL_ROW_SPANS[Math.floor(rowStart / 3) % WALL_ROW_SPANS.length];
				pattern.forEach((span, i) => {
					spans[rowStart + i] = span;
				});
				continue;
			}
			// Positions ordered series-first (stable): the widest span
			// goes to the first series cell, the next to the second,
			// and plates take what is left.
			const order = row
				.map((item, i) => ({ item, i }))
				.sort((a, b) => Number(b.item.series) - Number(a.item.series))
				.map((entry) => entry.i);
			order.forEach((pos, k) => {
				spans[rowStart + pos] = SERIES_SPAN_POOL[k];
			});
			continue;
		}
		const base = Math.floor(12 / n);
		const extra = 12 % n;
		row.forEach((_, i) => {
			spans[rowStart + i] = base + (i < extra ? 1 : 0);
		});
	}
	return spans;
}

function coverOf(project: PortfolioProject) {
	return project.media.find((m) => m.isCover) ?? project.media[0] ?? null;
}

/**
 * The work's additional media, in display order — the material an
 * exhibition hangs BESIDE the cover. `isSeries` reads this count:
 * a work with a real gallery gets the diptych cell, a work with
 * only a cover stays a single plate (Epic #1266 exhibition pass).
 */
function extrasOf(project: PortfolioProject, limit = 3) {
	return project.media.filter((m) => !m.isCover).slice(0, limit);
}

function isSeriesWork(project: PortfolioProject): boolean {
	return project.media.length >= 3;
}

/** `2025` / `2025 — Video production` — absent parts drop out. */
function workMeta(project: PortfolioProject): string | null {
	const year = project.periodLabel ?? (project.periodStart ? String(project.periodStart) : null);
	return [year, project.role].filter(Boolean).join(' — ') || null;
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

/**
 * Feature media — the lead work is shown as a CONTACT SHEET, not a
 * single frame (Issue #1296): the cover at exhibition scale with a
 * strip of the work's own additional media beneath it. kosen-fes-2025
 * carries 29 media rows; hanging one of them would waste the very
 * material that makes it the selection's anchor.
 */
function FeatureMedia({ project }: { project: PortfolioProject }) {
	const cover = coverOf(project);
	const extras = extrasOf(project, 3);
	if (!cover) return <MediaPlaceholder ratio={FEATURE_RATIO} label="media 未整備" />;
	return (
		<Stack gap="3">
			<PortfolioMediaFigure media={cover} loading="eager" frameAspectRatio={FEATURE_RATIO} />
			{extras.length > 0 ? (
				<Cluster gap="3">
					{extras.map((media) => (
						<PortfolioMediaFigure
							key={media.id}
							media={media}
							loading="lazy"
							frameAspectRatio="1 / 1"
							className={css({ flex: '1 1 0', minWidth: '0' })}
						/>
					))}
				</Cluster>
			) : null}
		</Stack>
	);
}

/**
 * Series cell media — a work with a real gallery (≥3 media rows)
 * hangs as a DIPTYCH: cover + its first additional frame side by
 * side. The pair reads "this work has range" where a single cover
 * can only claim it. Single-media works keep `WorkMedia` — the
 * plate stays honest about having one image.
 */
function SeriesMedia({ project }: { project: PortfolioProject }) {
	const cover = coverOf(project);
	const extra = extrasOf(project, 1)[0];
	if (!cover) return <MediaPlaceholder ratio="4 / 3" label="media 未整備" />;
	if (!extra) return <WorkMedia project={project} ratio="4 / 3" eager={false} />;
	return (
		<Cluster gap="3">
			<PortfolioMediaFigure
				media={cover}
				loading="lazy"
				frameAspectRatio="4 / 3"
				className={css({ flex: '1 1 0', minWidth: '0' })}
			/>
			<PortfolioMediaFigure
				media={extra}
				loading="lazy"
				frameAspectRatio="4 / 3"
				className={css({ flex: '1 1 0', minWidth: '0' })}
			/>
		</Cluster>
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

/**
 * The quiet provenance line — `2025 — Video production`. The
 * exhibition answers "when, and in what capacity" for every work,
 * not only the feature (Issue #1304's metadata signal, scoped to
 * what the committed rows actually carry: `periodStart`/`role`).
 */
function WorkMeta({ project }: { project: PortfolioProject }) {
	const meta = workMeta(project);
	if (!meta) return null;
	return (
		<p
			className={css({
				margin: '0',
				fontFamily: 'mono',
				fontSize: 'xs',
				letterSpacing: '0.04em',
				color: 'text.muted',
			})}
		>
			{meta}
		</p>
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
						<FeatureMedia project={feature} />
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
						<WorkMeta project={feature} />
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
						{(() => {
							const wallItems = rest.map((project) => ({
								project,
								series: isSeriesWork(project),
							}));
							const spans = wallSpans(wallItems);
							return wallItems.map(({ project, series }, i) => {
								const span = spans[i];
								const rowStart = Math.floor(i / 3) * 3;
								const col = i - rowStart;
								const rowSpans = spans.slice(
									rowStart,
									rowStart + Math.min(3, rest.length - rowStart),
								);
								const start = 1 + rowSpans.slice(0, col).reduce((sum, n) => sum + n, 0);
								return (
									<GridItem
										as="li"
										key={project.slug}
										span={{ base: 12, lg: span }}
										start={{ base: 1, lg: start }}
										data-testid="selected-work"
										data-slug={project.slug}
										data-variant={series ? 'series' : 'plate'}
										className={cx(css({ minWidth: '0' }), css(vStackGap3Plain))}
									>
										{series ? (
											<SeriesMedia project={project} />
										) : (
											<WorkMedia
												project={project}
												ratio={WALL_RATIOS[i % WALL_RATIOS.length]}
												eager={false}
											/>
										)}
										<WorkEyebrow index={i + 1} project={project} />
										<Heading className={cx(cardTitleClassName, css({ textWrap: 'balance' }))}>
											<a href={`/portfolio/${project.slug}`} className={workTitleLinkClassName}>
												{project.title}
											</a>
										</Heading>
										<WorkMeta project={project} />
										<Summary text={project.summary} clamp="2" />
										<CaseStudyLink slug={project.slug} />
									</GridItem>
								);
							});
						})()}
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
