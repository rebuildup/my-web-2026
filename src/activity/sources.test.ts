import { describe, expect, it } from 'vitest';
import { githubReleaseItems, portfolioWorkItems } from './sources';

describe('githubReleaseItems', () => {
	it('keeps only ReleaseEvent rows as release items', () => {
		const items = githubReleaseItems([
			{
				id: '1',
				repoId: 'o/r',
				type: 'ReleaseEvent',
				at: '2026-11-01T00:00:00Z',
				href: 'https://github.com/o/r',
			},
			{ id: '2', repoId: 'o/r', type: 'PushEvent', at: '2026-11-02T00:00:00Z' },
			{ id: '3', repoId: 'o/r', type: 'PullRequestEvent', at: '2026-11-03T00:00:00Z' },
		]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: 'github:1',
			kind: 'release',
			source: 'github',
			title: 'o/r',
			at: '2026-11-01T00:00:00Z',
			href: 'https://github.com/o/r',
		});
	});

	it('omits href when the feed carries none — never fabricates a permalink', () => {
		const items = githubReleaseItems([
			{ id: '1', repoId: 'o/r', type: 'ReleaseEvent', at: '2026-11-01T00:00:00Z' },
		]);
		expect(items[0]?.href).toBeUndefined();
	});

	it('drops rows whose timestamp does not parse', () => {
		const items = githubReleaseItems([
			{ id: '1', repoId: 'o/r', type: 'ReleaseEvent', at: 'garbage' },
		]);
		expect(items).toHaveLength(0);
	});
});

describe('portfolioWorkItems', () => {
	const base = {
		slug: 'demo',
		title: 'Demo Work',
		status: 'published',
		visibility: 'public',
		periodStart: Date.UTC(2025, 8, 1),
		periodLabel: '2025-09 - present',
	};

	it('maps a published+public project to a work item with the authored period label', () => {
		const items = portfolioWorkItems([base]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id: 'portfolio:demo',
			kind: 'work',
			source: 'portfolio',
			title: 'Demo Work',
			at: '2025-09-01T00:00:00.000Z',
			dateLabel: '2025-09 - present',
			href: '/portfolio/demo',
		});
	});

	it('excludes draft, unlisted, archived and non-public rows', () => {
		const items = portfolioWorkItems([
			{ ...base, slug: 'a', visibility: 'draft' },
			{ ...base, slug: 'b', visibility: 'unlisted' },
			{ ...base, slug: 'c', status: 'archived' },
		]);
		expect(items).toHaveLength(0);
	});

	it('excludes rows with no recorded period start — the date is never interpolated', () => {
		const items = portfolioWorkItems([
			{ ...base, periodStart: 0 },
			{ ...base, slug: 'neg', periodStart: -1 },
			{ ...base, slug: 'nan', periodStart: Number.NaN },
		]);
		expect(items).toHaveLength(0);
	});

	it('omits dateLabel when the project authored none', () => {
		const items = portfolioWorkItems([{ ...base, periodLabel: null }]);
		expect(items[0]?.dateLabel).toBeUndefined();
	});
});
