import { describe, expect, it } from 'vitest';
import type { HomeGitHubActivity } from '../../home/activity/contract';
import { assembleActivityPage } from './assemble';

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
		topRepos: [
			{
				id: 'rebuildup/my-web-2026',
				name: 'my-web-2026',
				href: 'https://github.com/rebuildup/my-web-2026',
				commits: 12,
				pullRequests: 4,
				windowDays: 30,
			},
		],
		repoCount: { public: 1, private: 2 },
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

describe('assembleActivityPage', () => {
	it('merges release and work items date-descending with per-source health', () => {
		const { timeline } = assembleActivityPage({
			github: githubActivity(),
			portfolio: [WORK],
			selectedWorks: [],
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
		const { timeline, highlights } = assembleActivityPage({
			github: null,
			portfolio: null,
			selectedWorks: [],
			generatedAt: GENERATED_AT,
		});
		expect(timeline.items).toEqual([]);
		expect(timeline.sources).toEqual([
			{ id: 'github', status: 'failed' },
			{ id: 'portfolio', status: 'failed' },
			{ id: 'articles', status: 'unconfigured' },
		]);
		// A failed GitHub read is null, never a zero window.
		expect(highlights.windowDays).toBeNull();
		expect(highlights.repoCount).toBeNull();
		expect(highlights.measures).toEqual([]);
	});

	it('passes the public source health through — unconfigured stays unconfigured', () => {
		const github = githubActivity();
		const { timeline } = assembleActivityPage({
			github: {
				...github,
				sources: {
					public: { status: 'unconfigured' },
					private: { status: 'failed' },
				},
			},
			portfolio: [],
			selectedWorks: [],
			generatedAt: GENERATED_AT,
		});
		// The timeline reads only the public feed, so the private
		// source's failure is not this surface's claim.
		expect(timeline.sources[0]).toEqual({ id: 'github', status: 'unconfigured' });
	});

	it('keeps a partial outage honest: one failed source, one ok source', () => {
		const { timeline } = assembleActivityPage({
			github: githubActivity(),
			portfolio: null,
			selectedWorks: [],
			generatedAt: GENERATED_AT,
		});
		expect(timeline.sources.map((s) => s.status)).toEqual(['ok', 'failed', 'unconfigured']);
		expect(timeline.items).toHaveLength(1);
	});

	it('joins a release event to the work its repo link names (Issue #1319)', () => {
		const { timeline, highlights } = assembleActivityPage({
			github: githubActivity(),
			portfolio: [
				{
					...WORK,
					repoFullName: 'rebuildup/my-web-2026',
					summary: 'A personal web platform.',
				},
			],
			selectedWorks: [],
			generatedAt: GENERATED_AT,
		});
		const release = timeline.items.find((item) => item.kind === 'release');
		expect(release?.relatedWork).toEqual({
			title: 'Demo Work',
			href: '/portfolio/demo',
		});
		expect(highlights.releases[0]?.relatedWork?.href).toBe('/portfolio/demo');
	});

	it('never joins a release to a work that is not public+published', () => {
		const { timeline } = assembleActivityPage({
			github: githubActivity(),
			portfolio: [
				{
					...WORK,
					status: 'draft',
					repoFullName: 'rebuildup/my-web-2026',
				},
			],
			selectedWorks: [],
			generatedAt: GENERATED_AT,
		});
		const release = timeline.items.find((item) => item.kind === 'release');
		expect(release?.relatedWork).toBeUndefined();
	});

	it('carries the measured window facts into the highlights', () => {
		const { highlights } = assembleActivityPage({
			github: githubActivity(),
			portfolio: [WORK],
			selectedWorks: [],
			generatedAt: GENERATED_AT,
		});
		expect(highlights.windowDays).toBe(30);
		expect(highlights.repoCount).toEqual({ public: 1, private: 2 });
		expect(highlights.measures).toEqual([
			{
				name: 'my-web-2026',
				href: 'https://github.com/rebuildup/my-web-2026',
				commits: 12,
				pullRequests: 4,
				windowDays: 30,
			},
		]);
		expect(highlights.totals).toEqual({ releases: 1, works: 1 });
		expect(highlights.releases).toHaveLength(1);
	});

	it('projects only public selected works into highlight cards, bounded', () => {
		const selected = [
			{ ...WORK, slug: 'one', title: 'One', summary: 's1', repoFullName: null },
			{ ...WORK, slug: 'two', title: 'Two', visibility: 'private', repoFullName: null },
			{ ...WORK, slug: 'three', title: 'Three', repoFullName: null },
			{ ...WORK, slug: 'four', title: 'Four', repoFullName: null },
		];
		const { highlights } = assembleActivityPage({
			github: null,
			portfolio: null,
			selectedWorks: selected,
			generatedAt: GENERATED_AT,
		});
		// The private work is skipped; the cap keeps the band a summary.
		expect(highlights.works.map((work) => work.slug)).toEqual(['one', 'three', 'four']);
		expect(highlights.works[0]).toMatchObject({
			title: 'One',
			summary: 's1',
			periodLabel: '2025-09 - present',
			href: '/portfolio/one',
		});
	});
});
