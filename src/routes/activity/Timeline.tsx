import { css } from '../../../styled-system/css';
import {
	ACTIVITY_KIND_LABELS_JA,
	ACTIVITY_SOURCE_LABELS_JA,
	ACTIVITY_SOURCE_STATUS_LABELS_JA,
	type ActivityTimeline,
	type ActivityTimelineItem,
} from '../../activity/contract';
import { Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { monoXsPlain, noteSansMdPlain, vStackGap4 } from '../../editorial/primitives/shared-styles';

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
 */

const itemClassName = /*#__PURE__*/ css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'baseline',
	gap: '2',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.5',
});

const mutedClassName = /*#__PURE__*/ css({
	color: 'text.muted',
});

const monoClassName = /*#__PURE__*/ css(monoXsPlain);

const badgeClassName = /*#__PURE__*/ css({
	display: 'inline-block',
	paddingInline: '2',
	paddingBlock: '0.5',
	borderRadius: 'sm',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	color: 'text.default',
	fontFamily: 'sans',
	fontSize: 'xs',
	fontWeight: 'medium',
	lineHeight: '1.4',
});

const linkClassName = /*#__PURE__*/ css({
	color: 'text.accent',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_hover: { textDecorationThickness: '2px' },
});

const titleClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'sm',
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

function TimelineItemRow({ item }: { readonly item: ActivityTimelineItem }) {
	const dateText = item.dateLabel ?? item.at.slice(0, 10);
	return (
		<li className={itemClassName} data-timeline-item={item.id}>
			<span className={monoClassName}>{dateText}</span>
			<span className={badgeClassName}>{ACTIVITY_KIND_LABELS_JA[item.kind]}</span>
			<span className={mutedClassName}>{ACTIVITY_SOURCE_LABELS_JA[item.source]}</span>
			{item.href ? (
				<a
					href={item.href}
					className={linkClassName}
					{...(isInternalHref(item.href) ? {} : { rel: 'noopener noreferrer', target: '_blank' })}
				>
					{item.title}
				</a>
			) : (
				<span className={titleClassName}>{item.title}</span>
			)}
		</li>
	);
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
		<div className={css(vStackGap4)} data-testid="activity-timeline">
			<p className={css(noteSansMdPlain)}>
				{timeline.sources.map((source) => (
					<span key={source.id}>
						{ACTIVITY_SOURCE_LABELS_JA[source.id] ?? source.id}:{' '}
						{ACTIVITY_SOURCE_STATUS_LABELS_JA[source.status] ?? '不明'}
						{source.observedAt ? (
							<>
								{' '}
								(<span className={monoClassName}>{source.observedAt.slice(0, 10)}</span>)
							</>
						) : null}
						{'　'}
					</span>
				))}
				観測日 <span className={monoClassName}>{observedDay(timeline)}</span>
			</p>
			{timeline.items.length === 0 ? (
				<p className={mutedClassName}>
					{noSourceOk ? '活動ソースを取得できませんでした。' : '掲載できる活動はまだありません。'}
				</p>
			) : (
				<Stack as="ul" gap="2" className={listResetClassName}>
					{timeline.items.map((item) => (
						<TimelineItemRow key={item.id} item={item} />
					))}
				</Stack>
			)}
		</div>
	);
}
