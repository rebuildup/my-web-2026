import type { ActivityHighlights, ActivityTimeline, ActivityTimelineSourceState } from './contract';

/**
 * Committed fixtures for the activity timeline (Issue #352).
 *
 * These are SYNTHETIC review data — they exist so the component,
 * its states and the verification capture can be exercised without
 * a running Worker, a D1 binding or a GitHub fetch. They are not a
 * claim about what the owner actually published.
 *
 * What is real vs. illustrative
 * -----------------------------
 *   - Item SHAPES mirror the adapters in `sources.ts`: a GitHub
 *     `ReleaseEvent` feed row, an article record (the source Issue
 *     #323 will own — no live adapter emits `article` items today),
 *     and published+public portfolio works keyed by authored
 *     `periodStart` / `periodLabel`.
 *   - Titles, dates and URLs are invented for the fixture. The
 *     production assembly reads the committed GitHub snapshot and
 *     the public portfolio index instead.
 */

const FIXTURE_SOURCES: readonly ActivityTimelineSourceState[] = [
	{ id: 'github', status: 'ok', observedAt: '2026-11-17T09:00:00.000Z' },
	{ id: 'portfolio', status: 'ok', observedAt: '2026-11-17T09:05:00.000Z' },
	{ id: 'articles', status: 'ok', observedAt: '2026-11-17T09:10:00.000Z' },
];

/** All three kinds populated — the contract demo fixture. */
export const activityTimelineFixture: ActivityTimeline = {
	generatedAt: '2026-11-17T12:00:00.000Z',
	sources: FIXTURE_SOURCES,
	items: [
		{
			id: 'github:9001',
			kind: 'release',
			source: 'github',
			title: 'rebuildup/my-web-2026',
			at: '2026-11-10T09:00:00.000Z',
			href: 'https://github.com/rebuildup/my-web-2026',
		},
		{
			id: 'github:9002',
			kind: 'release',
			source: 'github',
			title: 'tastile/tastile-android',
			at: '2026-10-02T09:00:00.000Z',
			href: 'https://github.com/tastile/tastile-android',
		},
		{
			id: 'articles:post-1',
			kind: 'article',
			source: 'articles',
			title: 'After Effects スクリプトの落とし穴',
			at: '2026-09-15T00:00:00.000Z',
			href: '/content/ae-script-pitfalls',
		},
		{
			id: 'portfolio:my-web-2026',
			kind: 'work',
			source: 'portfolio',
			title: 'my-web-2026 — Personal Web Platform on Cloudflare Workers',
			at: new Date(Date.UTC(2025, 8, 1)).toISOString(),
			dateLabel: '2025-09 - present',
			href: '/portfolio/my-web-2026',
		},
		{
			id: 'portfolio:aulymo',
			kind: 'work',
			source: 'portfolio',
			title: 'Aulymo — lyric motion tool for After Effects',
			at: new Date(Date.UTC(2023, 0, 1)).toISOString(),
			dateLabel: '2023 - present',
			href: '/portfolio/aulymo',
		},
		{
			id: 'portfolio:tastile',
			kind: 'work',
			source: 'portfolio',
			title: 'Tastile — scheduling product',
			at: new Date(Date.UTC(2022, 0, 1)).toISOString(),
			dateLabel: '2022 - present',
			href: '/portfolio/tastile',
		},
	],
};

/** The honest "nothing published in the window" state. */
export const emptyActivityTimelineFixture: ActivityTimeline = {
	generatedAt: '2026-11-17T12:00:00.000Z',
	sources: FIXTURE_SOURCES,
	items: [],
};

/** Every source failed — the timeline must not read as "no activity". */
export const failedActivityTimelineFixture: ActivityTimeline = {
	generatedAt: '2026-11-17T12:00:00.000Z',
	sources: [
		{ id: 'github', status: 'failed' },
		{ id: 'portfolio', status: 'failed' },
		{ id: 'articles', status: 'unconfigured' },
	],
	items: [],
};

/**
 * The edited highlight band fixture (Issue #1319) — synthetic review
 * data exercising every block: the summary panel, measured
 * contributions, selected works and releases with a work join.
 */
export const activityHighlightsFixture: ActivityHighlights = {
	windowDays: 30,
	repoCount: { public: 12, private: 5 },
	totals: { releases: 2, works: 6 },
	measures: [
		{
			name: 'my-web-2026',
			href: 'https://github.com/rebuildup/my-web-2026',
			commits: 18,
			pullRequests: 5,
			windowDays: 30,
		},
	],
	releases: [
		{
			...activityTimelineFixture.items[0],
			relatedWork: { title: 'my-web-2026', href: '/portfolio/my-web-2026' },
		},
	],
	works: [
		{
			slug: 'my-web-2026',
			title: 'my-web-2026 — Personal Web Platform on Cloudflare Workers',
			summary: 'Cloudflare Workers 上の個人 Web プラットフォーム。',
			periodLabel: '2025-09 - present',
			cover: {
				url: '/media/portfolio/my-web-2026/cover.webp',
				alt: 'my-web-2026 のカバー画像',
				width: 1600,
				height: 900,
			},
			href: '/portfolio/my-web-2026',
		},
	],
};

/** Nothing to highlight — the band must not pad itself. */
export const emptyActivityHighlightsFixture: ActivityHighlights = {
	windowDays: null,
	repoCount: null,
	totals: { releases: 0, works: 0 },
	measures: [],
	releases: [],
	works: [],
};
