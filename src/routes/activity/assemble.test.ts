import { describe, expect, it } from 'vitest';
import type { HomeGitHubActivity } from '../../home/activity/contract';
import { assembleActivityTimeline } from './assemble';

const GENERATED_AT = '2026-11-21T00:00:00.000Z';

function githubActivity(overrides: Partial<HomeGitHubActivity> = {}): HomeGitHubActivity {
	return {
		generatedOn: '2026-11-20',
		windowDays: 30,
		sources: {
			public: { status: 'ok', observedAt: '2026-11-20T09:00:00.000Z' },
			private: { status: 'ok', observedAt: '2026-11-20T09:05:00.000Z' },
		},
		feed: [
			{
				id: 'evt-1',
				kind: 'public',
				repoId: 'rebuildup/my-web-2026',
				type: 'ReleaseEvent',
				at: '2026-11-10T09:00:00.000Z',
				href: 'https://github.com/rebuildup/my-web-2026',
			},
			{
				id: 'evt-2',
				kind: 'public',
				repoId: 'rebuildup/my-web-2026',
				type: 'PushEvent',
				at: '2026-11-11T09:00:00.000Z',
			},
		],
		topRepos: [],
		repoCount: { public: 1, private: 0 },
		...overrides,
	};
}

const WORK = {
	slug: 'demo',
	title: 'Demo Work',
	status: 'published',
	visibility: 'public',
	periodStart: Date.UTC(2025, 8, 1),
	periodLabel: '2025-09 - present',
};

describe('assembleActivityTimeline', () => {
	it('merges release and work items date-descending with per-source health', () => {
		const timeline = assembleActivityTimeline({
			github: githubActivity(),
			portfolio: [WORK],
			generatedAt: GENERATED_AT,
		});
		expect(timeline.generatedAt).toBe(GENERATED_AT);
		// PushEvent is filtered by the adapter — only the release remains.
		expect(timeline.items.map((item) => item.id)).toEqual(['github:evt-1', 'portfolio:demo']);
		expect(timeline.sources).toEqual([
			{ id: 'github', status: 'ok', observedAt: '2026-11-20T09:00:00.000Z' },
			{ id: 'portfolio', status: 'ok', observedAt: GENERATED_AT },
			{ id: 'articles', status: 'unconfigured' },
		]);
	});

	it('reports github and portfolio as failed when their reads return null', () => {
		const timeline = assembleActivityTimeline({
			github: null,
			portfolio: null,
			generatedAt: GENERATED_AT,
		});
		expect(timeline.items).toEqual([]);
		expect(timeline.sources).toEqual([
			{ id: 'github', status: 'failed' },
			{ id: 'portfolio', status: 'failed' },
			{ id: 'articles', status: 'unconfigured' },
		]);
	});

	it('passes the public source health through — unconfigured stays unconfigured', () => {
		const github = githubActivity();
		const timeline = assembleActivityTimeline({
			github: {
				...github,
				sources: {
					public: { status: 'unconfigured' },
					private: { status: 'failed' },
				},
			},
			portfolio: [],
			generatedAt: GENERATED_AT,
		});
		// The timeline reads only the public feed, so the private
		// source's failure is not this surface's claim.
		expect(timeline.sources[0]).toEqual({ id: 'github', status: 'unconfigured' });
	});

	it('keeps a partial outage honest: one failed source, one ok source', () => {
		const timeline = assembleActivityTimeline({
			github: githubActivity(),
			portfolio: null,
			generatedAt: GENERATED_AT,
		});
		expect(timeline.sources.map((s) => s.status)).toEqual(['ok', 'failed', 'unconfigured']);
		expect(timeline.items).toHaveLength(1);
	});
});
