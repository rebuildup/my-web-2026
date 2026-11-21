import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { activityTimelineFixture, emptyActivityTimelineFixture } from '../../activity/fixtures';
import { sortActivityTimelineItems } from '../../activity/merge';
import { ActivityTimelineView } from './Timeline';

describe('ActivityTimelineView', () => {
	it('renders the unavailable state when the timeline could not be assembled', () => {
		const html = renderToStaticMarkup(<ActivityTimelineView timeline={null} />);
		expect(html).toContain('活動タイムラインを読み込めませんでした。');
		expect(html).toContain('data-testid="activity-timeline"');
	});

	it('renders kind, source, date and detail link for every item', () => {
		const timeline = {
			...activityTimelineFixture,
			items: sortActivityTimelineItems(activityTimelineFixture.items),
		};
		const html = renderToStaticMarkup(<ActivityTimelineView timeline={timeline} />);
		for (const label of ['リリース', '記事', '作品', 'GitHub', 'Portfolio', 'Content']) {
			expect(html).toContain(label);
		}
		expect(html).toContain('2026-11-10');
		expect(html).toContain('2025-09 - present');
		expect(html).toContain('href="/portfolio/my-web-2026"');
		expect(html).toContain('href="https://github.com/rebuildup/my-web-2026"');
	});

	it('renders the empty state without fabricating items', () => {
		const html = renderToStaticMarkup(
			<ActivityTimelineView timeline={emptyActivityTimelineFixture} />,
		);
		expect(html).toContain('掲載できる活動はまだありません。');
		expect(html).not.toContain('data-timeline-item=');
	});

	it('keeps per-source failure visible instead of claiming zero activity', () => {
		const html = renderToStaticMarkup(
			<ActivityTimelineView
				timeline={{
					generatedAt: '2026-11-17T12:00:00.000Z',
					sources: [{ id: 'github', status: 'failed' }],
					items: [],
				}}
			/>,
		);
		expect(html).toContain('取得失敗');
		expect(html).toContain('活動ソースを取得できませんでした。');
	});
});
