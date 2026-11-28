import { css } from '../../../styled-system/css';
import type { ActivityPageModel } from '../../activity/contract';
import { Button } from '../../editorial/primitives/Button';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageHero } from '../../editorial/primitives/PageHero';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import { ActivityHighlightsView } from './Highlights';
import { ActivityTimelineView } from './Timeline';

/**
 * `/activity` page composition (Issue #352; redesigned Issue #1297;
 * edited record Issue #1319).
 *
 * Presentation only — the assembled `ActivityPageModel` arrives
 * through the route loader (`load.ts`), which composes the GitHub
 * public projection and the public portfolio index through the
 * `src/activity` adapters. This component renders exactly what the
 * server assembled and never re-derives a fact.
 *
 * Layout: skip link → hero → highlights (the edited layer) →
 * archive (the full chronology, folded) → closing band.
 *
 * Issue #1319 changes — the page stops being a raw timeline dump:
 *   - section 01 is the EDITED layer: the observation window, the
 *     measured contributions, the editorially selected works and
 *     the newest releases — what the record proves, before the
 *     record itself;
 *   - section 02 is the ARCHIVE: the same honest chronology as
 *     before, now folded behind a disclosure so the full record
 *     stays one click away without dominating the scroll;
 *   - release items print their repository id in mono and carry a
 *     `relatedWork` link when the assembly proved the work join.
 *
 * The honest-state vocabulary (per-source 観測中 / 未接続 / 取得失敗,
 * the empty list, the unreadable timeline) all lives inside
 * `ActivityTimelineView` / `ActivityHighlightsView` — this page only
 * frames them.
 */
export function ActivityPage({ model }: { model: ActivityPageModel }) {
	return (
		<>
			<SkipLink />
			<PageHero
				labelledBy="activity-hero-title"
				eyebrow="my-web-2026 · /activity"
				title="活動の記録 / Activity"
				description="GitHub のリリースと Portfolio の公開作品を一つの記録に編集したページです。冒頭のハイライトが観測窓の計測値・選定作品・直近のリリースを示し、その下のアーカイブが全記録を日付順に保管します。各項目はソースが記録した日付だけを表示し、日付が分からない項目に日付を補いません。"
			/>
			<main id="main">
				<PageSection labelledBy="activity-highlights-heading" rhythm="feature" name="highlights">
					<SectionHeading
						id="activity-highlights-heading"
						eyebrow="01 — Highlights"
						title="この活動が示すこと"
						titleEn="The edited record"
						description="生の時系列を読む前に、この記録が実際に観測・計測したことだけを編集して置きます。数値は GitHub の観測スナップショット、作品は Portfolio の editorial selection、リリースは記録済みのイベントです。"
						variant="default"
					/>
					<div className={css({ marginBlockStart: '10' })}>
						<ActivityHighlightsView highlights={model.highlights} />
					</div>
				</PageSection>
				<PageSection labelledBy="activity-archive-heading" name="archive" testId="activity-page">
					<SectionHeading
						id="activity-archive-heading"
						eyebrow="02 — Archive"
						title="時系列アーカイブ"
						description="GitHub のリリースイベントと公開・掲載中の Portfolio 作品の全記録を、日付の新しい順に畳んで保管しています。展開すると年 → 月 → 行の三段構成で全件を読めます。日付は各ソースが記録した値だけを使い、作品は期間ラベルをそのまま表示します。"
						variant="default"
					/>
					<div className={css({ marginBlockStart: '10' })}>
						<ActivityTimelineView timeline={model.timeline} />
					</div>
				</PageSection>
				{/* Issue #1297 — the closing band: the archive ends with a
				    next step instead of dead-ending at the last row. */}
				<PageSection
					labelledBy="activity-closing-heading"
					rhythm="closing"
					tone="inverse"
					separator
					name="contact"
				>
					<SectionHeading
						id="activity-closing-heading"
						eyebrow="03 — Next"
						title="この活動について話す"
						titleEn="Keep in touch"
						description="記録の元データは portfolio の case study と現在地の記録にも展開しています。仕事の相談・掲載の訂正は contact の verified channel からどうぞ。"
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
