import { css } from '../../../styled-system/css';
import {
	ACTIVITY_KIND_LABELS_JA,
	ACTIVITY_SOURCE_LABELS_JA,
	ACTIVITY_SOURCE_STATUS_LABELS_JA,
	type ActivityTimeline,
	type ActivityTimelineItem,
} from '../../activity/contract';
import { listResetClassName } from '../../editorial/primitives/Flow';
import { Grid, GridItem } from '../../editorial/primitives/Grid';
import { monoXsPlain, noteSansMdPlain } from '../../editorial/primitives/shared-styles';

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
 * A chronology has three levels, and the surface now states them:
 *
 *   - the MONTH is a group heading with a rule under it, so the
 *     archive reads as a sequence of periods rather than a list;
 *   - the DATE is a column of its own (tabular mono), so the eye can
 *     find a day without reading the text;
 *   - the TITLE is the dominant element, with the kind and the
 *     source demoted to a quiet suffix — the subject of the entry is
 *     what the reader came for.
 */

const mutedClassName = css({
	color: 'text.muted',
});

const monoClassName = css(monoXsPlain);

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
	whiteSpace: 'nowrap',
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

const dateClassName = css({
	fontFamily: 'mono',
	fontSize: 'sm',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
	whiteSpace: 'nowrap',
});

const groupLabelClassName = css({
	display: 'flex',
	alignItems: 'baseline',
	justifyContent: 'space-between',
	gap: '4',
	margin: '0',
	paddingBlockEnd: '2',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.strong',
	fontFamily: 'mono',
	fontSize: 'sm',
	letterSpacing: '0.08em',
	color: 'text.default',
});

const groupCountClassName = css({
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

const statusLabelClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
});

const statusValueClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
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
 * The per-source status block.
 *
 * Issue #1163 — this is the page's own context: which source feeds
 * the chronology and how fresh each one is. It used to be a single
 * small line above the list; the hero's right column carries it now,
 * as a table the reader can scan.
 */
export function ActivitySourceStatus({ timeline }: { readonly timeline: ActivityTimeline | null }) {
	if (!timeline) {
		return <p className={css(noteSansMdPlain)}>観測状態を表示できません。</p>;
	}
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
			{timeline.sources.map((source) => (
				<div
					key={source.id}
					className={css({
						display: 'flex',
						alignItems: 'baseline',
						justifyContent: 'space-between',
						gap: '3',
						paddingBlockEnd: '2',
						borderBottomWidth: '1px',
						borderBottomStyle: 'solid',
						borderBottomColor: 'border.subtle',
					})}
				>
					<span className={statusLabelClassName}>
						{ACTIVITY_SOURCE_LABELS_JA[source.id] ?? source.id}
					</span>
					<span className={statusValueClassName}>
						{ACTIVITY_SOURCE_STATUS_LABELS_JA[source.status] ?? '不明'}
						{source.observedAt ? ` · ${source.observedAt.slice(0, 10)}` : ''}
					</span>
				</div>
			))}
			<div
				className={css({
					display: 'flex',
					alignItems: 'baseline',
					justifyContent: 'space-between',
					gap: '3',
				})}
			>
				<span className={statusLabelClassName}>観測日</span>
				<span className={statusValueClassName}>{observedDay(timeline)}</span>
			</div>
		</div>
	);
}

function TimelineItemRow({ item }: { readonly item: ActivityTimelineItem }) {
	const dateText = item.dateLabel ?? item.at.slice(0, 10);
	return (
		<li className={itemClassName} data-timeline-item={item.id}>
			<Grid template="12" columnGap="4" rowGap="2">
				<GridItem span={{ base: 12, md: 2 }} className={dateClassName}>
					{dateText}
				</GridItem>
				<GridItem span={{ base: 12, md: 2 }}>
					<span className={badgeClassName}>{ACTIVITY_KIND_LABELS_JA[item.kind]}</span>
				</GridItem>
				<GridItem span={{ base: 12, md: 6 }}>
					{item.href ? (
						<a
							href={item.href}
							className={linkClassName}
							{...(isInternalHref(item.href)
								? {}
								: { rel: 'noopener noreferrer', target: '_blank' })}
						>
							{item.title}
						</a>
					) : (
						<span className={titleClassName}>{item.title}</span>
					)}
				</GridItem>
				<GridItem span={{ base: 12, md: 2 }}>
					<span className={sourceRowClassName}>
						<span>{ACTIVITY_SOURCE_LABELS_JA[item.source] ?? item.source}</span>
					</span>
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

function groupByMonth(
	items: readonly ActivityTimelineItem[],
): { month: string; items: ActivityTimelineItem[] }[] {
	const groups: { month: string; items: ActivityTimelineItem[] }[] = [];
	for (const item of items) {
		const month = yearOf(item);
		const last = groups[groups.length - 1];
		if (last && last.month === month) {
			last.items.push(item);
			continue;
		}
		groups.push({ month, items: [item] });
	}
	return groups;
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
	if (timeline.items.length === 0) {
		return (
			<div
				className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
				data-testid="activity-timeline"
			>
				<ActivitySourceStatus timeline={timeline} />
				<p className={mutedClassName}>
					{noSourceOk ? '活動ソースを取得できませんでした。' : '掲載できる活動はまだありません。'}
				</p>
			</div>
		);
	}
	const groups = groupByMonth(timeline.items);
	return (
		<div
			className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}
			data-testid="activity-timeline"
		>
			{groups.map((group) => (
				<section key={group.month} aria-label={`${group.month} 年の公開アクティビティ`}>
					<h3 className={groupLabelClassName}>
						<span>{group.month}</span>
						<span className={groupCountClassName}>{`${group.items.length} 件`}</span>
					</h3>
					<ul className={css({ margin: '0', padding: '0', listStyle: 'none' })}>
						{group.items.map((item) => (
							<TimelineItemRow key={item.id} item={item} />
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
