import { css } from '../../../styled-system/css';
import { ActivityTimelineView } from '../../activity/Timeline';
import type { ActivityTimeline } from '../../activity/contract';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';

/**
 * `/activity` page composition (Issue #352).
 *
 * Presentation only — the assembled `ActivityTimeline` arrives
 * through the route loader (`load.ts`), which composes the GitHub
 * public projection and the public portfolio index through the
 * `src/activity` adapters. This component renders exactly what the
 * server assembled and never re-derives a fact.
 *
 * Layout mirrors `/stack`: skip link → hero → one content section.
 * The honest-state vocabulary (per-source 観測中 / 未接続 / 取得失敗,
 * the empty list, the unreadable timeline) all lives inside
 * `ActivityTimelineView` — this page only frames it.
 */
export function ActivityPage({ timeline }: { timeline: ActivityTimeline }) {
	return (
		<>
			<a href="#main" className={skipLinkStyle}>
				本文へスキップ
			</a>
			<PageSection rhythm="hero" labelledBy="activity-hero-title">
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					my-web-2026 · /activity
				</span>
				<h1
					id="activity-hero-title"
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '2',
						fontFamily: 'heading',
						fontSize: { base: '3xl', lg: '4xl' },
						fontWeight: '700',
						lineHeight: { base: '1.15', lg: '1.05' },
						color: 'text.default',
						letterSpacing: '-0.03em',
					})}
				>
					活動タイムライン / Activity
				</h1>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '6',
						fontFamily: 'sans',
						fontSize: 'lg',
						lineHeight: '1.6',
						color: 'text.default',
						maxWidth: '640px',
					})}
				>
					GitHub のリリース、公開された記事、Portfolio
					の公開作品を一つの時系列にまとめた読み取り専用の一覧です。各項目はソースが記録した日付だけを表示し、日付が分からない項目に日付を補いません。ソースごとの観測状態は一覧の上に併記します。
				</p>
			</PageSection>
			<main id="main">
				<PageSection labelledBy="activity-timeline-heading" separator testId="activity-page">
					<SectionHeading
						id="activity-timeline-heading"
						eyebrow="01 — Chronology"
						title="公開アクティビティ"
						description="GitHub のリリースイベント、公開記事、公開・掲載中の Portfolio 作品を日付の新しい順に並べます。日付は各ソースが記録した値だけを使い、作品は期間ラベルをそのまま表示します。"
						variant="default"
					/>
					<div className={css({ marginBlockStart: '10' })}>
						<ActivityTimelineView timeline={timeline} />
					</div>
				</PageSection>
			</main>
		</>
	);
}

const skipLinkStyle = css({
	position: 'absolute',
	left: '0',
	top: '0',
	padding: '2',
	backgroundColor: 'bg.canvas',
	color: 'text.default',
	textDecoration: 'none',
	transform: 'translateY(-200%)',
	_focusVisible: {
		transform: 'translateY(0)',
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});
