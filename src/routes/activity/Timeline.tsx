import { css, cx } from '../../../styled-system/css';
import {
	ACTIVITY_KIND_LABELS_JA,
	ACTIVITY_SOURCE_LABELS_JA,
	ACTIVITY_SOURCE_STATUS_LABELS_JA,
	ACTIVITY_TIMELINE_KINDS,
	type ActivityTimeline,
	type ActivityTimelineItem,
} from '../../activity/contract';
import { Disclosure } from '../../editorial/primitives/Disclosure';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { noteSansMdPlain, tabularDateSm } from '../../editorial/primitives/shared-styles';

/**
 * ActivityTimeline — the unified read-only chronology of published
 * activity (Issue #352): GitHub releases, published articles and
 * approved works in one date-descending list.
 *
 * Honest-state rules (same vocabulary as `GitHubActivityCard`)
 * ----------------------------------------------------------------
 *   - `timeline === null` means the assembly could not run at all —
 *     the component says so instead of rendering an empty list that
 *     would read as "no activity".
 *   - Each source reports its own health (`観測中` / `未接続` /
 *     `取得失敗`); a failed source never silently becomes zero items.
 *   - `観測日` is the freshest `observedAt` any source carries (or the
 *     assembly instant when none do) — the page never claims to be
 *     fresher than its sources.
 *   - An item prints exactly what its source recorded: kind badge,
 *     出典 label, the authored date (`dateLabel` when the source
 *     authored a coarse period label, else the `at` day) and a real
 *     permalink when one exists.
 *
 * The chronology's shape (Issue #1165, L-C review F-14)
 * ------------------------------------------------------
 * The first cut was one flat run of small lines: date, kind, source
 * and title all at the same size, one per row, with nothing between
 * them. Twenty such rows read as a log dump — the reader could not
 * see the SHAPE of the archive (which month was busy, which entries
 * are the same kind, which title carries the weight).
 *
 * A chronology has three levels, and the surface now states them
 * (Issue #1297 re-cut the grouping year → month → row):
 *
 *   - the YEAR is a display-size heading with a rule under it, so
 *     the archive reads as a sequence of periods rather than a
 *     list; the MONTH is a quiet sub-label inside it;
 *   - the DATE is a column of its own (tabular mono), so the eye can
 *     find a day without reading the text;
 *   - the TITLE is the dominant element, with the kind and the
 *     source demoted to a quiet suffix — the subject of the entry is
 *     what the reader came for. Works that published a cover show
 *     it as a thumbnail, the one piece of media the sources record.
 */

const mutedClassName = css({
	color: 'text.muted',
});

const badgeClassName = css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingInline: '2',
	paddingBlock: '1',
	borderRadius: 'full',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: '600',
	letterSpacing: '0.02em',
	lineHeight: '1.4',
	color: 'text.muted',
});

const linkClassName = css({
	color: 'text.default',
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_hover: { textDecorationThickness: '2px' },
});

const titleClassName = css({
	fontFamily: 'sans',
	fontSize: 'md',
	fontWeight: '600',
	color: 'text.default',
});

/**
 * Issue #1319 — a release item's subject IS a repository id
 * (`owner/name`), so it prints in the mono face the platform uses
 * for identifiers. Works keep the sans title: their subject is a
 * work, not a repo path. This is the archive's kind differentiation
 * — shape (cover vs. none) plus typeface, never colour alone.
 */
const repoIdClassName = css({
	fontFamily: 'mono',
});

const relatedWorkLinkClassName = css({
	display: 'inline-flex',
	alignItems: 'baseline',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'xs',
	color: 'text.muted',
	textDecoration: 'none',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	_hover: { color: 'text.default', textDecoration: 'underline' },
});

const dateClassName = css(tabularDateSm);

/**
 * Issue #1297 — the YEAR is the chronology's rhythm unit, so it
 * reads as a real heading now (heading face, display size) instead
 * of the mono micro-label it was. The month sits under it as a
 * quiet sub-label: year → month → row is the archive's three
 * levels, and each level has its own voice.
 */
const yearHeadingClassName = css({
	display: 'flex',
	alignItems: 'baseline',
	justifyContent: 'space-between',
	gap: '4',
	margin: '0',
	paddingBlock: '3',
	paddingBlockEnd: '2',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.strong',
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	letterSpacing: '-0.01em',
	color: 'text.default',
});

const yearCountClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	fontWeight: '400',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const monthLabelClassName = css({
	display: 'flex',
	alignItems: 'baseline',
	gap: '3',
	margin: '0',
	marginBlockStart: '6',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.08em',
	color: 'text.muted',
});

/** The kind wayfinding strip above the groups (Issue #1297). */
const kindCountsClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '3',
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const itemClassName = css({
	paddingBlock: '4',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
	'&:last-child': {
		borderBottomWidth: '0',
	},
});

/**
 * Issue #1297 — the work cover thumbnail. A fixed 4:3 frame (the
 * same ratio the portfolio card grid uses) keeps the row's box
 * reserved before the bytes arrive; `object-fit: cover` crops to
 * it, and the intrinsic `width`/`height` attributes still travel
 * with the `<img>` for engines that derive the ratio themselves.
 */
const thumbClassName = css({
	display: 'block',
	width: '100%',
	aspectRatio: '4 / 3',
	objectFit: 'cover',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	borderRadius: 'sm',
	backgroundColor: 'bg.subtle',
});

const thumbLinkClassName = css({
	display: 'block',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const metaCellClassName = css({
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'flex-start',
	gap: '2',
});

const sourceRowClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '2',
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	color: 'text.muted',
});

const statusStripClassName = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '3',
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const statusItemClassName = css({
	display: 'inline-flex',
	alignItems: 'baseline',
	gap: '1',
});

const statusValueClassName = css({
	fontVariantNumeric: 'tabular-nums',
	color: 'text.default',
});

function isInternalHref(href: string): boolean {
	return href.startsWith('/');
}

function observedDay(timeline: ActivityTimeline): string {
	let latest: string | null = null;
	for (const source of timeline.sources) {
		if (source.observedAt && (!latest || source.observedAt > latest)) {
			latest = source.observedAt;
		}
	}
	return (latest ?? timeline.generatedAt).slice(0, 10);
}

/**
 * The per-source status strip.
 *
 * Issue #1163 — this is the page's own context: which source feeds
 * the chronology and how fresh each one is. Issue #1297 moved it
 * out of the hero's aside (where the table competed with the title)
 * into the chronology section as one quiet line.
 */
export function ActivitySourceStatus({ timeline }: { readonly timeline: ActivityTimeline | null }) {
	if (!timeline) {
		return <p className={css(noteSansMdPlain)}>観測状態を表示できません。</p>;
	}
	// Issue #1297 — the status used to be a bordered table in the
	// hero's right column, where it competed with the page's own
	// title for attention. It is context for the LIST, so it now
	// renders as one quiet mono line inside the chronology section:
	// same facts (per-source health + 観測日), no table chrome.
	return (
		<p className={statusStripClassName} data-testid="activity-source-status">
			{timeline.sources.map((source) => (
				<span key={source.id} className={statusItemClassName}>
					<span>{ACTIVITY_SOURCE_LABELS_JA[source.id] ?? source.id}</span>
					<span className={statusValueClassName}>
						{ACTIVITY_SOURCE_STATUS_LABELS_JA[source.status] ?? '不明'}
						{source.observedAt ? ` · ${source.observedAt.slice(0, 10)}` : ''}
					</span>
				</span>
			))}
			<span className={statusItemClassName}>
				<span>観測日</span>
				<span className={statusValueClassName}>{observedDay(timeline)}</span>
			</span>
		</p>
	);
}

/**
 * The item's recorded cover (Issue #1297) — a real published image
 * or nothing. The thumbnail links to the same permalink the title
 * does; an internal href stays in-app, an external one opens in a
 * new tab with `noopener noreferrer`, exactly like the title link.
 */
function CoverMedia({ item }: { readonly item: ActivityTimelineItem }) {
	const cover = item.cover;
	if (!cover) return null;
	const img = (
		<img
			src={cover.url}
			alt={cover.alt}
			width={cover.width ?? undefined}
			height={cover.height ?? undefined}
			loading="lazy"
			className={thumbClassName}
		/>
	);
	if (!item.href) return img;
	return (
		<a
			href={item.href}
			className={thumbLinkClassName}
			{...(isInternalHref(item.href) ? {} : { rel: 'noopener noreferrer', target: '_blank' })}
		>
			{img}
		</a>
	);
}

function TimelineItemRow({ item }: { readonly item: ActivityTimelineItem }) {
	const dateText = item.dateLabel ?? item.at.slice(0, 10);
	const hasCover = item.cover !== undefined;
	return (
		<li className={itemClassName} data-timeline-item={item.id}>
			<Grid template="12" columnGap="4" rowGap="2">
				<GridItem span={{ base: 12, md: 2 }} className={dateClassName}>
					{dateText}
				</GridItem>
				{hasCover ? (
					<GridItem span={{ base: 12, md: 2 }}>
						<CoverMedia item={item} />
					</GridItem>
				) : null}
				<GridItem span={{ base: 12, md: hasCover ? 6 : 8 }}>
					{item.href ? (
						<a
							href={item.href}
							className={cx(linkClassName, item.kind === 'release' ? repoIdClassName : undefined)}
							{...(isInternalHref(item.href)
								? {}
								: { rel: 'noopener noreferrer', target: '_blank' })}
						>
							{item.title}
						</a>
					) : (
						<span
							className={cx(titleClassName, item.kind === 'release' ? repoIdClassName : undefined)}
						>
							{item.title}
						</span>
					)}
				</GridItem>
				<GridItem span={{ base: 12, md: 2 }} className={metaCellClassName}>
					<span className={badgeClassName}>{ACTIVITY_KIND_LABELS_JA[item.kind]}</span>
					<span className={sourceRowClassName}>
						<span>{ACTIVITY_SOURCE_LABELS_JA[item.source] ?? item.source}</span>
					</span>
					{/* Issue #1319 — the derived work join: present only
					    when the assembly proved the repository ↔ work
					    pairing; absent means "no provable link". */}
					{item.relatedWork ? (
						<a href={item.relatedWork.href} className={relatedWorkLinkClassName}>
							関連作品: {item.relatedWork.title}
						</a>
					) : null}
				</GridItem>
			</Grid>
		</li>
	);
}

/**
 * The year a row belongs to.
 *
 * The group is the SORT key's year (`at`), never the authored period
 * label: the chronology is ordered by what the sources recorded, and
 * the authored label ("2025-09 - present") is what the row itself
 * prints. The year is the group and the row keeps the full date, so
 * no information is printed twice.
 */
function yearOf(item: ActivityTimelineItem): string {
	return item.at.slice(0, 4);
}

/** The month a row belongs to, inside its year group (same `at` rule). */
function monthOf(item: ActivityTimelineItem): string {
	return item.at.slice(5, 7);
}

/** `"09"` → `"9月"` — the month sub-label inside a year group. */
function monthLabel(month: string): string {
	return `${Number.parseInt(month, 10)}月`;
}

interface MonthGroup {
	readonly month: string;
	readonly items: ActivityTimelineItem[];
}

interface YearGroup {
	readonly year: string;
	readonly months: MonthGroup[];
}

/**
 * Issue #1297 — the chronology groups year → month → row. The input
 * is already date-descending, so consecutive runs of the same
 * (year, month) merge without a sort; a month boundary inside a
 * year starts a sub-label, and a year boundary starts the rhythm
 * heading.
 */
function groupByYearMonth(items: readonly ActivityTimelineItem[]): YearGroup[] {
	const years: { year: string; months: MonthGroup[] }[] = [];
	for (const item of items) {
		const year = yearOf(item);
		const month = monthOf(item);
		let yearGroup = years[years.length - 1];
		if (!yearGroup || yearGroup.year !== year) {
			yearGroup = { year, months: [] };
			years.push(yearGroup);
		}
		const lastMonth = yearGroup.months[yearGroup.months.length - 1];
		if (lastMonth && lastMonth.month === month) {
			lastMonth.items.push(item);
			continue;
		}
		yearGroup.months.push({ month, items: [item] });
	}
	return years;
}

export interface ActivityTimelineProps {
	readonly timeline: ActivityTimeline | null;
}

export function ActivityTimelineView({ timeline }: ActivityTimelineProps) {
	if (!timeline) {
		return (
			<p className={css(noteSansMdPlain)} data-testid="activity-timeline">
				活動タイムラインを読み込めませんでした。
			</p>
		);
	}
	const noSourceOk =
		timeline.sources.length > 0 && timeline.sources.every((s) => s.status !== 'ok');
	return (
		<div
			className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}
			data-testid="activity-timeline"
		>
			{/* Issue #1297 — the source-health strip renders for EVERY
			    assembled state (populated and empty alike): a failed
			    source must stay visible next to the list it feeds,
			    not only when the list happens to be empty. */}
			<ActivitySourceStatus timeline={timeline} />
			{timeline.items.length === 0 ? (
				<p className={mutedClassName}>
					{noSourceOk ? '活動ソースを取得できませんでした。' : '掲載できる活動はまだありません。'}
				</p>
			) : (
				<>
					<KindCounts items={timeline.items} />
					{/* Issue #1319 — the chronology is the ARCHIVE now, not
					    the page's protagonist: the edited highlight band
					    leads and the full record stays one disclosure
					    away. Every item remains in the DOM and in the
					    record — nothing is filtered out, only folded. */}
					<Disclosure
						data-testid="activity-archive"
						summary={
							<span>
								時系列アーカイブ（全 {timeline.items.length} 件）
								<span className={mutedClassName}>
									{' '}
									— 展開すると全記録を日付の新しい順に読めます
								</span>
							</span>
						}
					>
						{groupByYearMonth(timeline.items).map((year) => (
							<div key={year.year}>
								<h3 className={yearHeadingClassName}>
									<span>{year.year}</span>
									<span className={yearCountClassName}>
										{`${year.months.reduce((total, m) => total + m.items.length, 0)} 件`}
									</span>
								</h3>
								{year.months.map((month) => (
									<div key={month.month}>
										<h4 className={monthLabelClassName}>
											<span>{monthLabel(month.month)}</span>
											<span className={yearCountClassName}>{`${month.items.length} 件`}</span>
										</h4>
										<ul className={css({ margin: '0', padding: '0', listStyle: 'none' })}>
											{month.items.map((item) => (
												<TimelineItemRow key={item.id} item={item} />
											))}
										</ul>
									</div>
								))}
							</div>
						))}
					</Disclosure>
				</>
			)}
		</div>
	);
}

/**
 * The kind wayfinding strip (Issue #1297): the chronology is
 * text-uniform, so a quiet count line — リリース 2 · 作品 4 · 記事 1 —
 * tells the reader the archive's composition before they start
 * reading. Only kinds that actually occur are listed; a zero would
 * be noise, not information. Order follows the contract's kind
 * union, never the items' order.
 */
function KindCounts({ items }: { readonly items: readonly ActivityTimelineItem[] }) {
	const counts = new Map<string, number>();
	for (const item of items) {
		counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
	}
	const parts = ACTIVITY_TIMELINE_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map(
		(kind) => `${ACTIVITY_KIND_LABELS_JA[kind]} ${counts.get(kind)}`,
	);
	if (parts.length === 0) return null;
	return <p className={kindCountsClassName}>{parts.join(' · ')}</p>;
}
