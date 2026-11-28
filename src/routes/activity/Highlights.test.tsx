import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { activityHighlightsFixture, emptyActivityHighlightsFixture } from '../../activity/fixtures';
import { ActivityHighlightsView } from './Highlights';

describe('ActivityHighlightsView', () => {
	it('renders the summary panel, measures, works and releases', () => {
		const html = renderToStaticMarkup(
			<ActivityHighlightsView highlights={activityHighlightsFixture} />,
		);
		expect(html).toContain('data-testid="activity-highlights"');
		expect(html).toContain('記録の要約');
		expect(html).toContain('直近 30 日間');
		expect(html).toContain('公開 12 · 非公開 5');
		expect(html).toContain('期間内のリリース');
		expect(html).toContain('計測された貢献');
		expect(html).toContain('18 コミット');
		expect(html).toContain('選定作品');
		expect(html).toContain('href="/portfolio/my-web-2026"');
		expect(html).toContain('最新のリリース');
		expect(html).toContain('関連作品: my-web-2026');
	});

	it('says 取得失敗 for GitHub-derived rows when the read failed', () => {
		const html = renderToStaticMarkup(
			<ActivityHighlightsView
				highlights={{
					...emptyActivityHighlightsFixture,
					works: activityHighlightsFixture.works,
				}}
			/>,
		);
		expect(html).toContain('取得失敗');
		// Works alone still make the band render — no fake zeroes.
		expect(html).toContain('選定作品');
		expect(html).not.toContain('計測された貢献');
		expect(html).not.toContain('最新のリリース');
	});

	it('renders the honest empty note when nothing can be highlighted', () => {
		const html = renderToStaticMarkup(
			<ActivityHighlightsView highlights={emptyActivityHighlightsFixture} />,
		);
		expect(html).toContain('ハイライトを構成できる活動がまだありません。');
	});
});
