import { css, cx } from '../../../styled-system/css';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { noteSansMd } from '../../editorial/primitives/shared-styles';
import {
	CURRENT_LOCATION_CHANGE_MOTION,
	usePrefersReducedMotion,
} from '../../editorial/reduced-motion';
import { daysBetween, formatCount, formatDuration, formatRelativeDay } from './derive';
import {
	RECENT_UPDATE_WINDOW_DAYS,
	SOURCE_LABELS,
	WEIGHT_LEVEL_LABELS,
	groupByWeight,
	selectPublishedProjects,
} from './source';
import type { CurrentProjectRecord, ProjectFactSource } from './types';
import { useChangedProjectIds } from './use-changed-projects';

/**
 * CurrentProjects — the "現在地 / Where I am now" section (Issue #316).
 *
 * What the section claims
 * -----------------------
 * Three separate answers, never mixed into one number:
 *
 *   - 続いているか  → `開始` (start date) + the derived duration
 *   - 動いているか  → `最終更新` (last update) + the derived relative day
 *   - どれだけ入れているか → the weight level (group heading or row tag)
 *                     + the measured activity window, when a source can
 *                     measure it
 *
 * Every measured value is followed by the word for its source
 * (`手書き` / `git` / `GitHub`), so a remembered date never looks like a
 * reproducible one. A value the record does not carry is OMITTED — there
 * is no "未記入", no dash, no zero standing in for "not measured".
 *
 * Why a group heading and not a number
 * ------------------------------------
 * Weight is structure, not a score. When every published project has a
 * level, the list is grouped by level (`主軸 · 1 件`) so a reader sees where
 * the centre of gravity is before reading a row. When only some have one,
 * grouping would imply the ungrouped rows have no weight, so the list goes
 * flat and each row carries its own level tag. Empty levels are never
 * rendered.
 *
 * Count independence
 * ------------------
 * There is no cap, no paging and no "see more": a stopped project must not
 * be hidden. The layout is a single column at every width, the label column
 * is a fixed width from `md` up (so values align without a row count
 * deciding it), and the order comes from `orderProjects` — a comparator, not
 * an authored sequence.
 *
 * Motion
 * ------
 * One surface: a row that CHANGED since this browser last rendered the
 * section gets a marker, and — unless the visitor asked for reduced motion —
 * that marker fades up once (200ms, `current-location-change`). The set of
 * changed ids comes from `useChangedProjectIds`, which compares committed
 * facts and never derived values, so a day passing animates nothing. On a
 * first visit there is nothing to compare and nothing moves.
 */
export interface CurrentProjectsProps {
	/**
	 * The projects to publish. Optional, and the default is the EMPTY
	 * list: a caller that forgets the record set publishes the "nothing
	 * is published" sentence rather than a stale one.
	 */
	projects?: readonly CurrentProjectRecord[];
	/**
	 * The base date every derived value and the structure gate are
	 * computed against (`YYYY-MM-DD`). Passed in rather than read from a
	 * clock, so the document is a pure function of (records, today).
	 */
	today: string;
	/**
	 * Issue #1108 — curated mode. When set, only the first `limit`
	 * records of the ORDERED published list render (the ordering is
	 * the component's own importance/freshness/weight order, so the
	 * representative slice is never hand-picked). The summary still
	 * reports the full published count, and `seeAllHref` renders a
	 * "see all" link to the enumeration surface (`/now`). Omitted on
	 * the index route, which exists to enumerate.
	 */
	limit?: number;
	seeAllHref?: string;
	/**
	 * Issue #1163 — `section` (the default) is the HOME's body
	 * section: the heading sits above the list on the full measure.
	 * `page` is the `/now` ENTRY: the heading takes the left 7 tracks
	 * and the summary facts move to the right column, so the entry's
	 * right half carries the page's own scale instead of empty space.
	 * The data is the same in both — only its placement differs.
	 */
	variant?: 'section' | 'page';
	/**
	 * Issue #1297 — the weight-group heading level for the `page`
	 * variant. `/now` now nests each enumeration under its own
	 * `PageSection` + `SectionHeading` (h2), so the groups step down
	 * to h3. The default stays `h2` for a caller that renders the
	 * enumeration directly under the hero's h1. The flat-list row
	 * level is unchanged (h3 under a section h2, h4 under a group).
	 */
	groupHeadingLevel?: 'h2' | 'h3';
	/**
	 * Issue #1297 — the enumeration's `data-testid`, overridable so a
	 * page that renders TWO enumerations (the `/now` named/observed
	 * split) gives each list a distinct hook instead of colliding on
	 * `home-current-projects-list`.
	 */
	listTestId?: string;
}

// Every style in this module is built at module scope, and every `css()` call
// carries a `@__PURE__` annotation. That annotation is load-bearing, not a
// style choice: Rollup keeps a module that is reachable from the shared client
// entry when its evaluation has a side effect it cannot prove away, even when
// the only importer is the `/` route component that the route splitter
// excludes. Without the annotation this whole section shipped in the entry
// chunk that every route downloads (Issue #776: 626,488 B base -> 639,798 B
// measured on the branch). With it, Rollup drops the module from the entry and
// keeps it in `/`'s own chunk (629,522 B entry, section paid for only by `/`).
// A module-scope `css()` is the normal pattern in this repository; it only has
// to be annotatable where an excluded importer is the sole edge to the entry.

/** The shared link treatment — the home capabilities grid's link. */
const linkClassName = /* @__PURE__ */ css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	marginBlockStart: '3',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '4px',
		borderRadius: '2px',
	},
	_hover: {
		textDecorationThickness: '2px',
	},
});

const seeAllLinkClassName = /* @__PURE__ */ css({
	marginBlockStart: '1',
});

const summaryClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockEnd: '8',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	lineHeight: '1.6',
});

const groupHeadingClassName = /* @__PURE__ */ css({
	display: 'flex',
	alignItems: 'baseline',
	gap: '3',
	margin: '0',
	marginBlockEnd: '3',
	paddingBlockEnd: '2',
	borderBlockEnd: '1px solid {colors.border.subtle}',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	letterSpacing: '0.08em',
	color: 'text.muted',
});

const rowClassName = /* @__PURE__ */ css({
	paddingBlock: '5',
	borderBlockEnd: '1px solid {colors.border.subtle}',
	'&:last-child': {
		borderBlockEnd: 'none',
	},
});

/**
 * Issue #1135 — the row's index number.
 *
 * The L-C review found the section read as one undifferentiated dump:
 * four rows of the same shape, none of them scannable. The number
 * gives the column a rhythm and lets a reader count the entries
 * without reading them.
 */
const rowIndexClassName = /* @__PURE__ */ css({
	fontFamily: 'mono',
	fontSize: 'sm',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
});

/**
 * Issue #1135 — the facts column.
 *
 * The measured facts move to their own column, separated by a
 * vertical hairline, so the row reads as ONE record with a name and
 * a set of measurements instead of a name with a small table
 * hanging under it. On mobile the columns stack and the hairline
 * goes with them — a rule that separates two stacked blocks would
 * draw a false relationship.
 */
const factsColumnClassName = /* @__PURE__ */ css({
	// The vertical rule uses the `border-left` SHORTHAND: the CSS
	// vocabulary gate (quality/css-standards.json) knows the shorthand
	// and `border-left-color`, and rejects the `border-left-width` /
	// `border-left-style` longhands Panda would emit from the
	// longhand props.
	borderLeft: { base: 'none', md: '1px solid' },
	borderLeftColor: 'border.subtle',
	paddingInlineStart: { base: '0', md: '6' },
});

const rowHeaderClassName = /* @__PURE__ */ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '3',
});

const nameClassName = /* @__PURE__ */ css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: '2xl',
	fontWeight: '700',
	color: 'text.default',
	lineHeight: '1.2',
	letterSpacing: '-0.01em',
});

const statusClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockStart: '2',
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.muted',
	lineHeight: '1.6',
});

const metaListClassName = /* @__PURE__ */ css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', md: '7rem 1fr' },
	columnGap: '4',
	rowGap: '1',
	margin: '0',
	marginBlockStart: '4',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
});

const metaLabelClassName = /* @__PURE__ */ css({
	color: 'text.muted',
	fontVariantNumeric: 'tabular-nums',
});

const metaValueClassName = /* @__PURE__ */ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '2',
	margin: '0',
	color: 'text.default',
	fontVariantNumeric: 'tabular-nums',
});

const sourceTagClassName = /* @__PURE__ */ css({
	fontSize: 'xs',
	color: 'text.muted',
	letterSpacing: '0.04em',
});

const levelTagClassName = /* @__PURE__ */ css({
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	letterSpacing: '0.08em',
	color: 'text.muted',
});

const emptyClassName = /* @__PURE__ */ css(noteSansMd);

/** One measured line: label, value, and the word for where the value came from. */
interface MetaRow {
	readonly label: string;
	readonly value: string;
	readonly source: ProjectFactSource;
}

/**
 * The measured facts of one project, in a fixed order.
 *
 * A fact the record does not carry produces no row at all — the renderer
 * never fills the gap with a placeholder, because "not written" and "zero"
 * are different claims and only one of them is true.
 */
function metaRows(project: CurrentProjectRecord, today: string): MetaRow[] {
	const rows: MetaRow[] = [];
	if (project.startedOn) {
		const duration = formatDuration(project.startedOn.value, today);
		rows.push({
			label: '開始',
			value: duration ? `${project.startedOn.value}（${duration}）` : project.startedOn.value,
			source: project.startedOn.source,
		});
	}
	if (project.updatedOn) {
		const relative = formatRelativeDay(project.updatedOn.value, today);
		rows.push({
			label: '最終更新',
			value: relative ? `${project.updatedOn.value}（${relative}）` : project.updatedOn.value,
			source: project.updatedOn.source,
		});
	}
	const activity = project.weight?.activity;
	if (activity) {
		const { commits, windowDays, commitsTotal, pullRequests } = activity.value;
		const prs = pullRequests === undefined ? '' : ` / PR ${formatCount(pullRequests)}`;
		const total = commitsTotal === undefined ? '' : ` / 累計 ${formatCount(commitsTotal)}`;
		rows.push({
			label: `直近 ${windowDays} 日`,
			// The window is counted up to the day the source MEASURED it, not
			// up to today, so that day is printed with the number. A snapshot
			// that has aged says "（2026-11-01 時点）" instead of quietly
			// claiming the last 30 days of the reader's calendar.
			value: `${formatCount(commits)} commits${prs}${total}（${activity.observedOn} 時点）`,
			source: activity.source,
		});
	}
	return rows;
}

/**
 * The change marker.
 *
 * `data-motion` names the hook the stylesheet's reduced-motion block
 * targets, and the `reducedMotion` branch means the reduced document emits
 * no animation at all — the marker is still there, because the marker is
 * information and the fade is decoration.
 */
function ChangeMarker({ reducedMotion }: { reducedMotion: boolean }) {
	return (
		<span
			data-motion={CURRENT_LOCATION_CHANGE_MOTION}
			data-motion-state={reducedMotion ? 'reduced' : 'animated'}
			data-testid="home-current-project-changed"
			className={css({
				fontFamily: 'sans',
				fontSize: 'xs',
				fontWeight: '600',
				// Issue #887 — this marker is NOT a link, so an underline
				// would promise navigation it cannot deliver. `text.accent`
				// is ink now, so the "this row changed" cue is carried by
				// SHAPE (a raised chip) plus the word, per direction B §4.
				display: 'inline-flex',
				alignItems: 'center',
				paddingInline: '2',
				paddingBlock: '1',
				borderRadius: 'full',
				backgroundColor: 'bg.surface',
				color: 'text.accent',
				...(reducedMotion
					? {}
					: {
							animationName: 'currentLocationChange',
							animationDuration: '200ms',
							animationTimingFunction: 'ease-out',
							animationFillMode: 'both',
						}),
			})}
		>
			前回の表示から更新
		</span>
	);
}

interface ProjectRowProps {
	readonly project: CurrentProjectRecord;
	readonly today: string;
	readonly changed: boolean;
	readonly reducedMotion: boolean;
	/** `true` when the list is grouped, so the level is already in the heading. */
	readonly grouped: boolean;
	/** Position in the ordered published list (1-based) — the row's index number. */
	readonly index: number;
}

function ProjectRow({ project, today, changed, reducedMotion, grouped, index }: ProjectRowProps) {
	const Heading = grouped ? 'h4' : 'h3';
	const rows = metaRows(project, today);
	const level = project.weight?.level;
	return (
		<li data-testid="home-current-project" data-project-id={project.id} className={rowClassName}>
			{/* Issue #1135 — the row became a two-column record: the name
			    and its sentence on the left, the measured facts on the
			    right, separated by a hairline. Before, every fact sat
			    under its own name in a narrow label/value grid, and the
			    section read as a stack of identical blocks. */}
			<Grid template="12" gap="4" columnGap={{ base: '4', md: '6' }}>
				<GridItem span={1} className={rowIndexClassName} aria-hidden="true">
					{String(index).padStart(2, '0')}
				</GridItem>
				{/* Issue #1279 — a record with no measured facts must not
				    keep the hairline column: the border belongs to the
				    facts, so the column is rendered only when a fact
				    exists, and the name column takes the freed measure. */}
				<GridItem span={{ base: 12, md: rows.length > 0 ? 5 : 11 }} start={{ base: 1, md: 2 }}>
					<div className={rowHeaderClassName}>
						<Heading className={nameClassName}>{project.name}</Heading>
						{!grouped && level ? (
							<span data-testid="home-current-project-level" className={levelTagClassName}>
								{WEIGHT_LEVEL_LABELS[level.value]}
							</span>
						) : null}
						{changed ? <ChangeMarker reducedMotion={reducedMotion} /> : null}
					</div>
					<p lang="ja" className={statusClassName}>
						{project.statusJa}
					</p>
					{project.link ? (
						<a href={project.link.href} className={linkClassName}>
							<span>{project.link.label}</span>
							<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
						</a>
					) : null}
				</GridItem>
				{rows.length > 0 ? (
					<GridItem
						span={{ base: 12, md: 6 }}
						start={{ base: 1, md: 7 }}
						className={factsColumnClassName}
					>
						<ProjectFacts rows={rows} />
					</GridItem>
				) : null}
			</Grid>
		</li>
	);
}

/** How many published projects were updated inside the counting window. */
function recentlyUpdatedCount(projects: readonly CurrentProjectRecord[], today: string): number {
	return projects.filter((project) => {
		if (!project.updatedOn) return false;
		const days = daysBetween(project.updatedOn.value, today);
		if (!Number.isFinite(days) || days < 0) return false;
		return days <= RECENT_UPDATE_WINDOW_DAYS;
	}).length;
}

/**
 * The measured facts of one project.
 *
 * Issue #1135 — the facts live in their own component so the row stays
 * readable: the record is a two-column composition (name + sentence on
 * the left, measurements on the right) and the measurement list is a
 * separate concern from the record's identity. The list holds at most
 * three rows (start / last update / measured window), and a row the
 * record does not carry is omitted rather than filled in.
 */
function ProjectFacts({ rows }: { readonly rows: readonly MetaRow[] }) {
	if (rows.length === 0) return null;
	return (
		<dl data-testid="home-current-project-meta" className={metaListClassName}>
			{rows.map((row) => (
				<div key={row.label} className={css({ display: 'contents' })}>
					<dt className={metaLabelClassName}>{row.label}</dt>
					<dd className={metaValueClassName}>
						<span>{row.value}</span>
						<span data-testid="home-current-project-source" className={sourceTagClassName}>
							{SOURCE_LABELS[row.source]}
						</span>
					</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * The entry's scale sentence — how many projects are published, as of
 * `today`, and how many moved in the recent window.
 *
 * Issue #1163 — the `/now` ENTRY carries this in its hero's aside, so
 * the route needs the same sentence the section used to print under its
 * heading. One function, two placements; the numbers cannot drift.
 */
export function currentProjectsSummary(
	projects: readonly CurrentProjectRecord[],
	today: string,
): string | null {
	const published = selectPublishedProjects(projects, today);
	if (published.length === 0) return null;
	const recent = recentlyUpdatedCount(published, today);
	return `全 ${published.length} 件。${today} 時点・直近 ${RECENT_UPDATE_WINDOW_DAYS} 日の更新は${
		recent === 0 ? 'ありません' : ` ${recent} 件です`
	}。`;
}

export function CurrentProjects({
	projects = [],
	today,
	limit,
	seeAllHref,
	variant = 'section',
	groupHeadingLevel = 'h2',
	listTestId = 'home-current-projects-list',
}: CurrentProjectsProps) {
	const published = selectPublishedProjects(projects, today);
	const visible = limit === undefined ? published : published.slice(0, limit);
	const groups = groupByWeight(visible);
	const reducedMotion = usePrefersReducedMotion();
	const changedIds = useChangedProjectIds(published);
	const recent = recentlyUpdatedCount(published, today);
	const summary = currentProjectsSummary(projects, today);
	// Issue #1135 — the row index is the record's position in the
	// ORDERED published list, so the number a reader sees is the
	// order the section itself published, not a counter of the
	// rendered slice.
	const orderIndex = new Map<string, number>();
	visible.forEach((project, position) => {
		orderIndex.set(project.id, position + 1);
	});

	// The enumeration itself, shared by the two placements: the HOME's
	// section (groups are h3 under the section's h2) and the `/now`
	// ENTRY (groups are h2 under the hero's h1). One renderer, so the
	// two surfaces cannot drift apart.
	const renderEnumeration = (headingLevel: 'h2' | 'h3') => {
		if (published.length === 0) {
			return (
				<p lang="ja" data-testid="home-current-projects-empty" className={emptyClassName}>
					現在、公開している進行中のプロジェクトはありません。
				</p>
			);
		}
		const GroupHeading = headingLevel;
		return groups ? (
			<Stack as="ul" gap="10" data-testid={listTestId} className={listResetClassName}>
				{groups.map((group) => (
					<li key={group.level} data-testid="home-current-project-group" data-level={group.level}>
						<GroupHeading className={groupHeadingClassName}>
							<span>{group.label}</span>
							<span className={levelTagClassName}>{`${group.records.length} 件`}</span>
						</GroupHeading>
						<Stack as="ul" gap="0" className={listResetClassName}>
							{group.records.map((project) => (
								<ProjectRow
									key={project.id}
									project={project}
									today={today}
									changed={changedIds.has(project.id)}
									reducedMotion={reducedMotion}
									grouped
									index={orderIndex.get(project.id) ?? 1}
								/>
							))}
						</Stack>
					</li>
				))}
			</Stack>
		) : (
			<Stack as="ul" gap="0" data-testid={listTestId} className={listResetClassName}>
				{visible.map((project) => (
					<ProjectRow
						key={project.id}
						project={project}
						today={today}
						changed={changedIds.has(project.id)}
						reducedMotion={reducedMotion}
						grouped={false}
						index={orderIndex.get(project.id) ?? 1}
					/>
				))}
			</Stack>
		);
	};

	// Issue #1185 — `/now` is an ENTRY surface: the route owns the page's
	// h1 (the PageHero) and the entry's right column (the summary
	// sentence), so this variant renders the enumeration alone. The
	// section wrapper and its heading belong to the HOME's section,
	// which keeps its h2.
	if (variant === 'page') {
		return renderEnumeration(groupHeadingLevel);
	}

	return (
		<PageSection
			labelledBy="current-projects-heading"
			testId="home-current-projects"
			id="current"
			name="now"
		>
			{/* v12/v13 review — the HOME's section keeps the heading on
			    the full measure: the spread variant parks the whole
			    project list in the 8/12 column beside a heading cluster
			    that ends after three lines, which read as a dead zone on
			    desktop. The list needs the full measure for its records.

			    Issue #1185 — the `/now` ENTRY no longer renders this
			    heading: the route owns the page's h1 (the PageHero) and
			    the entry's right column (the summary sentence), so the
			    page variant returns the enumeration alone above. */}
			<SectionHeading
				id="current-projects-heading"
				eyebrow="01 — Now"
				title="現在地"
				titleEn="Where I am now"
				description="続けているプロジェクトと、始めた日・最後に動いた日・そこに入れている量です。計測した値には出所（手書き / git）を添えています。"
			/>
			{summary ? (
				<p data-testid="home-current-projects-summary" className={summaryClassName}>
					{summary}
				</p>
			) : null}
			{renderEnumeration('h3')}
			{seeAllHref && published.length > visible.length ? (
				<a
					href={seeAllHref}
					className={cx(linkClassName, seeAllLinkClassName)}
					data-testid="home-current-projects-see-all"
				>
					すべて見る ({published.length} 件)
				</a>
			) : null}
		</PageSection>
	);
}
