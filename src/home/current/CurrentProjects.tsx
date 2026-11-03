import { css } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
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
	textDecoration: 'none',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '4px',
		borderRadius: '2px',
	},
	_hover: {
		textDecoration: 'underline',
	},
});

const summaryClassName = /* @__PURE__ */ css({
	margin: '0',
	marginBlockEnd: '8',
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	lineHeight: '1.6',
});

const listClassName = /* @__PURE__ */ css({
	display: 'flex',
	flexDirection: 'column',
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

const groupClassName = /* @__PURE__ */ css({
	display: 'block',
	'&:not(:first-child)': {
		marginBlockStart: '10',
	},
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

const rowHeaderClassName = /* @__PURE__ */ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '3',
});

const nameClassName = /* @__PURE__ */ css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'xl',
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

const emptyClassName = /* @__PURE__ */ css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.muted',
	lineHeight: '1.6',
});

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
		const { commits, windowDays, commitsTotal } = activity.value;
		const total = commitsTotal === undefined ? '' : ` / 累計 ${formatCount(commitsTotal)}`;
		rows.push({
			label: `直近 ${windowDays} 日`,
			// The window is counted up to the day the source MEASURED it, not
			// up to today, so that day is printed with the number. A snapshot
			// that has aged says "（2026-11-01 時点）" instead of quietly
			// claiming the last 30 days of the reader's calendar.
			value: `${formatCount(commits)} commits${total}（${activity.observedOn} 時点）`,
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
}

function ProjectRow({ project, today, changed, reducedMotion, grouped }: ProjectRowProps) {
	const Heading = grouped ? 'h4' : 'h3';
	const rows = metaRows(project, today);
	const level = project.weight?.level;
	return (
		<li data-testid="home-current-project" data-project-id={project.id} className={rowClassName}>
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
			{rows.length === 0 ? null : (
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
			)}
			{project.link ? (
				<a href={project.link.href} className={linkClassName}>
					<span>{project.link.label}</span>
					<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
				</a>
			) : null}
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

export function CurrentProjects({ projects = [], today }: CurrentProjectsProps) {
	const published = selectPublishedProjects(projects, today);
	const groups = groupByWeight(published);
	const reducedMotion = usePrefersReducedMotion();
	const changedIds = useChangedProjectIds(published);
	const recent = recentlyUpdatedCount(published, today);
	const summary =
		published.length === 0
			? null
			: `全 ${published.length} 件。${today} 時点・直近 ${RECENT_UPDATE_WINDOW_DAYS} 日の更新は${
					recent === 0 ? 'ありません' : ` ${recent} 件です`
				}。`;

	return (
		<section
			aria-labelledby="current-projects-heading"
			data-testid="home-current-projects"
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					id="current-projects-heading"
					eyebrow="00 — Now"
					title="現在地 / Where I am now"
					description="続けているプロジェクトと、始めた日・最後に動いた日・そこに入れている量です。計測した値には出所（手書き / git）を添えています。"
					variant="spread"
				>
					{published.length === 0 ? (
						<p lang="ja" data-testid="home-current-projects-empty" className={emptyClassName}>
							現在、公開している進行中のプロジェクトはありません。
						</p>
					) : (
						<>
							<p data-testid="home-current-projects-summary" className={summaryClassName}>
								{summary}
							</p>
							{groups ? (
								<ul data-testid="home-current-projects-list" className={listClassName}>
									{groups.map((group) => (
										<li
											key={group.level}
											data-testid="home-current-project-group"
											data-level={group.level}
											className={groupClassName}
										>
											<h3 className={groupHeadingClassName}>
												<span>{group.label}</span>
												<span className={levelTagClassName}>{`${group.records.length} 件`}</span>
											</h3>
											<ul className={listClassName}>
												{group.records.map((project) => (
													<ProjectRow
														key={project.id}
														project={project}
														today={today}
														changed={changedIds.has(project.id)}
														reducedMotion={reducedMotion}
														grouped
													/>
												))}
											</ul>
										</li>
									))}
								</ul>
							) : (
								<ul data-testid="home-current-projects-list" className={listClassName}>
									{published.map((project) => (
										<ProjectRow
											key={project.id}
											project={project}
											today={today}
											changed={changedIds.has(project.id)}
											reducedMotion={reducedMotion}
											grouped={false}
										/>
									))}
								</ul>
							)}
						</>
					)}
				</SectionHeading>
			</Container>
		</section>
	);
}
