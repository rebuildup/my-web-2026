import { css } from '../../../styled-system/css';
import type { ActivityTimeline } from '../../activity/contract';
import { Button } from '../../editorial/primitives/Button';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageHero } from '../../editorial/primitives/PageHero';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { ActivityTimelineView } from './Timeline';

/**
 * `/activity` page composition (Issue #352; redesigned Issue #1297).
 *
 * Presentation only — the assembled `ActivityTimeline` arrives
 * through the route loader (`load.ts`), which composes the GitHub
 * public projection and the public portfolio index through the
 * `src/activity` adapters. This component renders exactly what the
 * server assembled and never re-derives a fact.
 *
 * Layout: skip link → hero → one content section → closing band.
 *
 * Issue #1297 changes:
 *   - the per-source status strip left the hero's aside (where the
 *     bordered table competed with the page title) and now renders
 *     as one quiet line inside `ActivityTimelineView`, next to the
 *     list it describes;
 *   - the page ends with a closing CTA instead of dead-ending at
 *     the last timeline row.
 *
 * The honest-state vocabulary (per-source 観測中 / 未接続 / 取得失敗,
 * the empty list, the unreadable timeline) all lives inside
 * `ActivityTimelineView` — this page only frames it.
 */
export function ActivityPage({ timeline }: { timeline: ActivityTimeline }) {
	return (
		<>
			<SkipLink />
			<PageHero
				labelledBy="activity-hero-title"
				eyebrow="my-web-2026 · /activity"
				title="活動タイムライン / Activity"
				description="GitHub のリリース、公開された記事、Portfolio の公開作品を一つの時系列にまとめた読み取り専用の一覧です。各項目はソースが記録した日付だけを表示し、日付が分からない項目に日付を補いません。"
			/>
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
				{/* Issue #1297 — the closing band: the archive ends with a
				    next step instead of a dead end (contact / portfolio). */}
				<PageSection
					labelledBy="activity-closing-heading"
					rhythm="closing"
					tone="inverse"
					separator
					name="contact"
				>
					<SectionHeading
						id="activity-closing-heading"
						eyebrow="02 — Next"
						title="この活動について話す"
						titleEn="Keep in touch"
						description="タイムラインの元データは portfolio の case study と現在地の記録にも展開しています。仕事の相談・掲載の訂正は contact の verified channel からどうぞ。"
						variant="spread"
					>
						<Button as="a" href="/contact" variant="primary">
							<span lang="ja">Contact を見る</span>
							<MaterialSymbol d={ARROW_FORWARD_PATH} size={18} />
						</Button>
					</SectionHeading>
				</PageSection>
			</main>
		</>
	);
}
