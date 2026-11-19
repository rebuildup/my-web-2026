import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import type { CareerEntry, CareerEntryKind } from '../career';

/**
 * CareerTimeline — the standalone history-timeline component
 * (Issue #389).
 *
 * Presentation only: it renders whatever `entries` it is given and
 * owns no data. The fail-closed gate is `selectPublishableCareerEntries`
 * in `src/about/career.ts` — a route adapter is expected to pass the
 * filtered list, and this component additionally marks any entry whose
 * `verification.status` is not `verified` so a non-publishable entry
 * can never be shown as if it were confirmed.
 *
 * Empty state: when no entry is publishable the component renders an
 * honest empty message instead of fabricating a row — the Issue #389
 * acceptance criterion 「データが1件も公開承認されない場合の代替表示」.
 *
 * The component composes editorial primitives (`Badge`) and the Panda
 * style layer only; it imports no route, no binding and no peer
 * obligation, so its Storybook story stands alone.
 */

export interface CareerTimelineProps {
	readonly entries: readonly CareerEntry[];
}

const KIND_LABELS: Readonly<Record<CareerEntryKind, string>> = {
	event: '出来事',
	state: '現在の状態',
	planned: '予定',
};

const KIND_TONES: Readonly<Record<CareerEntryKind, 'accent' | 'neutral'>> = {
	event: 'neutral',
	state: 'accent',
	planned: 'neutral',
};

const VERIFICATION_STATUS_LABELS: Readonly<Record<string, string>> = {
	verified: '確認済み',
	'legacy-only': '旧サイトのみ・未確認',
	unverified: '未確認',
};

const listStyle = css({
	listStyle: 'none',
	margin: '0',
	padding: '0',
	display: 'flex',
	flexDirection: 'column',
});

const itemStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	paddingBlock: '5',
	borderTop: '1px solid {colors.border.subtle}',
});

const metaRowStyle = css({
	display: 'flex',
	alignItems: 'center',
	flexWrap: 'wrap',
	gap: '3',
});

const dateStyle = css({
	fontFamily: 'mono',
	fontSize: 'sm',
	letterSpacing: '0.04em',
	color: 'text.muted',
	minWidth: '7ch',
});

const titleStyle = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	lineHeight: '1.3',
	color: 'text.default',
	letterSpacing: '-0.01em',
});

const summaryStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.6',
	color: 'text.muted',
});

const sourceLinkStyle = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	_hover: { textDecorationThickness: '2px' },
});

const emptyStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	paddingBlock: '8',
	color: 'text.muted',
});

export function CareerTimeline({ entries }: CareerTimelineProps) {
	if (entries.length === 0) {
		return (
			<output className={emptyStyle}>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.6',
					})}
				>
					公開が承認された経歴項目はまだありません。
				</p>
				<p
					className={css({ margin: '0', fontFamily: 'sans', fontSize: 'sm', color: 'text.muted' })}
				>
					旧サイトの記録は確認待ちの項目として保持しています。確認が済み次第、ここに表示されます。
				</p>
			</output>
		);
	}
	return (
		<ol className={listStyle}>
			{entries.map((entry) => (
				<li key={entry.id} className={itemStyle}>
					<div className={metaRowStyle}>
						<span className={dateStyle}>{entry.dateLabel}</span>
						<Badge tone={KIND_TONES[entry.kind]}>{KIND_LABELS[entry.kind]}</Badge>
						{entry.verification.status !== 'verified' ? (
							<Badge tone="neutral">
								{VERIFICATION_STATUS_LABELS[entry.verification.status] ?? entry.verification.status}
							</Badge>
						) : null}
					</div>
					<h3 className={titleStyle}>{entry.title}</h3>
					{entry.summary ? <p className={summaryStyle}>{entry.summary}</p> : null}
					{entry.sources.length > 0 ? (
						<p className={css({ margin: '0', display: 'flex', flexWrap: 'wrap', gap: '4' })}>
							{entry.sources.map((source) => (
								<a
									key={source.url}
									href={source.url}
									className={sourceLinkStyle}
									rel={source.url.startsWith('http') ? 'noreferrer' : undefined}
								>
									{source.label ?? '出典'}
								</a>
							))}
						</p>
					) : null}
					{/* `verification.note` is an internal review record
					    (it names repo modules), so it is deliberately NOT
					    rendered — only the status badge above is public. */}
				</li>
			))}
		</ol>
	);
}
