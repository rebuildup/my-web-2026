import { css } from '../../../styled-system/css';
import type { ActivityTimeline } from '../../activity/contract';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import { ledeSansLg, noteMonoSm, pageTitle } from '../../editorial/primitives/shared-styles';
import { ActivityTimelineView } from './Timeline';

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
			<SkipLink />
			<PageSection rhythm="hero" labelledBy="activity-hero-title">
				<span className={css(noteMonoSm)}>my-web-2026 · /activity</span>
				<h1 id="activity-hero-title" lang="ja" className={css(pageTitle)}>
					活動タイムライン / Activity
				</h1>
				<p lang="ja" className={css(ledeSansLg)}>
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
