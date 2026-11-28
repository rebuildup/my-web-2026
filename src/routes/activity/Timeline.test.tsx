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

	it('folds the full record into the archive disclosure (Issue #1319)', () => {
		const timeline = {
			...activityTimelineFixture,
			items: sortActivityTimelineItems(activityTimelineFixture.items),
		};
		const html = renderToStaticMarkup(<ActivityTimelineView timeline={timeline} />);
		// The archive is a native <details> — collapsed by default, but
		// every item stays in the DOM and in the record.
		expect(html).toContain('data-testid="activity-archive"');
		expect(html).toMatch(/<details[^>]*>/);
		// Collapsed by default: the details tag carries no `open`.
		expect(html).not.toMatch(/<details[^>]*\sopen[\s>=]/);
		expect(html).toContain('時系列アーカイブ（全 6 件）');
		expect(html).toContain('data-timeline-item=');
	});

	it('renders the related-work join only when the item carries one', () => {
		const timeline = {
			...activityTimelineFixture,
			items: sortActivityTimelineItems([
				{
					...activityTimelineFixture.items[0],
					relatedWork: { title: 'my-web-2026', href: '/portfolio/my-web-2026' },
				},
				...activityTimelineFixture.items.slice(1),
			]),
		};
		const html = renderToStaticMarkup(<ActivityTimelineView timeline={timeline} />);
		expect(html).toContain('関連作品: my-web-2026');
		expect(html).toContain('href="/portfolio/my-web-2026"');
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
