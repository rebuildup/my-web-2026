import { describe, expect, it } from 'vitest';
import type { PortfolioMedia, PortfolioProject } from '../../portfolio/schema';
import {
	FEATURED_SLUGS,
	WORK_TILE_COUNT,
	composeProfileCardModel,
	discordSummary,
	githubSummary,
	selectShowcaseWorks,
} from './model';

/**
 * Contract tests for the profile card's data assembly (Issue #1170).
 * The privacy boundary is the point: private-kind snapshot entries may
 * contribute COUNTS only — never a name, id or URL — and unavailable
 * inputs must render as unavailable, never as invented state.
 */

const MEDIA_ENV = {
	MEDIA: {} as R2Bucket,
	MEDIA_PUBLIC_BASE_URL: 'https://rebuildup.dev/media',
};

function media(r2Key: string, overrides: Partial<PortfolioMedia> = {}): PortfolioMedia {
	return {
		id: r2Key,
		r2Key,
		contentType: 'image/png',
		width: null,
		height: null,
		alt: '',
		caption: null,
		isCover: true,
		displayOrder: 0,
		url: null,
		...overrides,
	};
}

function project(slug: string, overrides: Partial<PortfolioProject> = {}): PortfolioProject {
	return {
		id: `id-${slug}`,
		slug,
		title: `Title ${slug}`,
		summary: `Summary ${slug}`,
		role: 'Developer',
		periodStart: 2025,
		periodEnd: null,
		periodLabel: null,
		motivationMd: '',
		architectureMd: null,
		constraintsMd: null,
		implementationMd: null,
		evidenceMd: null,
		retrospectiveMd: null,
		facets: ['develop'],
		technologies: [],
		visibility: 'public',
		status: 'published',
		evidenceStatus: 'unreviewed',
		pinned: false,
		displayOrder: 0,
		createdAt: 0,
		updatedAt: 0,
		links: [],
		media: [media(`portfolio/${slug}/${slug}/cover.png`)],
		...overrides,
	};
}

const ACTIVITY_OK = {
	schemaVersion: 1,
	generatedOn: '2026-11-22',
	windowDays: 7,
	sources: {
		public: { status: 'ok', observedAt: '2026-11-22T05:00:00Z' },
		private: { status: 'ok', observedAt: '2026-11-22T05:00:00Z' },
	},
	repos: [
		{
			id: 'rebuildup/tool-pomodoro',
			kind: 'public',
			name: 'tool-pomodoro',
			repoFullName: 'rebuildup/tool-pomodoro',
			htmlUrl: 'https://github.com/rebuildup/tool-pomodoro',
			activity: { events: 3, commits: 5, prs: 1, windowDays: 7 },
		},
		{
			id: 'private-abcdef123456',
			kind: 'private',
			name: '非公開プロジェクト',
			activity: { events: 9, commits: 40, windowDays: 7 },
		},
	],
	feed: [
		{
			id: 'e1',
			kind: 'private',
			repoId: 'private-abcdef123456',
			type: 'PushEvent',
			at: '2026-11-22T06:00:00Z',
		},
		{
			id: 'e2',
			kind: 'public',
			repoId: 'rebuildup/tool-pomodoro',
			type: 'PullRequestEvent',
			at: '2026-11-22T04:00:00Z',
		},
		{
			id: 'e3',
			kind: 'public',
			repoId: 'rebuildup/older-repo',
			type: 'IssuesEvent',
			at: '2026-11-21T04:00:00Z',
		},
	],
};

const PRESENCE_OK = {
	generatedAt: '2026-11-22T06:10:00Z',
	userId: '123456789012345678',
	status: 'online',
	customStatusText: 'shipping the profile card',
	activities: [{ type: 0, name: 'After Effects', details: 'scene-b.aep', isPrimary: true }],
	isLive: true,
};

const NOW = Date.parse('2026-11-22T06:12:00Z');

describe('githubSummary', () => {
	it('projects counts and the latest PUBLIC feed item only', () => {
		const summary = githubSummary(ACTIVITY_OK);
		expect(summary.state).toBe('ok');
		expect(summary.publicRepos).toBe(1);
		expect(summary.privateRepos).toBe(1);
		expect(summary.latest?.repoId).toBe('rebuildup/tool-pomodoro');
		expect(summary.latest?.type).toBe('PullRequestEvent');
		expect(summary.observedAt).toBe('2026-11-22T05:00:00Z');
	});

	it('never surfaces a private identity', () => {
		const summary = githubSummary(ACTIVITY_OK);
		const serialized = JSON.stringify(summary);
		expect(serialized).not.toContain('private-abcdef123456');
		expect(serialized).not.toContain('非公開プロジェクト');
	});

	it('fails closed on invalid or absent payloads', () => {
		for (const bad of [null, undefined, {}, 'x', { schemaVersion: 2 }]) {
			expect(githubSummary(bad).state).toBe('unavailable');
		}
	});
});

describe('discordSummary', () => {
	it('returns ok for a fresh matching snapshot', () => {
		const summary = discordSummary(PRESENCE_OK, '123456789012345678', NOW);
		expect(summary.state).toBe('ok');
		if (summary.state === 'ok') {
			expect(summary.statusLabel).toBe('Online');
			expect(summary.detail).toBe('shipping the profile card');
			expect(summary.observedAt).toBe('2026-11-22T06:10:00Z');
		}
	});

	it('prefers the primary activity over custom status absence', () => {
		const noCustom = { ...PRESENCE_OK, customStatusText: undefined };
		const summary = discordSummary(noCustom, '123456789012345678', NOW);
		expect(summary.state).toBe('ok');
		if (summary.state === 'ok') {
			expect(summary.detail).toContain('Playing');
			expect(summary.detail).toContain('After Effects');
		}
	});

	it('marks stale snapshots instead of claiming online', () => {
		const stale = { ...PRESENCE_OK, generatedAt: '2026-11-22T05:00:00Z' };
		const summary = discordSummary(stale, '123456789012345678', NOW);
		expect(summary.state).toBe('stale');
	});

	it('fails closed on userId mismatch, missing secret, bad payload', () => {
		expect(discordSummary(PRESENCE_OK, '999', NOW).state).toBe('unavailable');
		expect(discordSummary(PRESENCE_OK, undefined, NOW).state).toBe('unavailable');
		expect(discordSummary(null, '123456789012345678', NOW).state).toBe('unavailable');
	});
});

describe('selectShowcaseWorks', () => {
	it('orders FEATURED_SLUGS first, then fills by recency', () => {
		// Only the first two featured slugs exist → the remaining two
		// slots fill from the recency-sorted rest.
		const featured = FEATURED_SLUGS.slice(0, 2).map((slug, i) =>
			project(slug, { periodStart: 2020 + i }),
		);
		const filler = [
			project('newest', { periodStart: 2026 }),
			project('mid', { periodStart: 2024 }),
		];
		const works = selectShowcaseWorks([...filler, ...featured], MEDIA_ENV);
		expect(works).toHaveLength(WORK_TILE_COUNT);
		expect(works[0]?.title).toBe(`Title ${FEATURED_SLUGS[0]}`);
		expect(works[1]?.title).toBe(`Title ${FEATURED_SLUGS[1]}`);
		// fillers sorted by periodStart desc after the featured block
		expect(works[2]?.title).toBe('Title newest');
		expect(works[3]?.title).toBe('Title mid');
	});

	it('skips projects without a servable raster cover', () => {
		const noCover = project('nocover', {
			media: [media('portfolio/nocover/nocover/cover.svg', { contentType: 'image/svg+xml' })],
		});
		const works = selectShowcaseWorks([noCover], MEDIA_ENV);
		expect(works).toHaveLength(0);
	});

	it('produces absolute media URLs through composeMediaUrl', () => {
		const works = selectShowcaseWorks([project('only')], MEDIA_ENV);
		expect(works[0]?.imageUrl).toBe('https://rebuildup.dev/media/portfolio/only/only/cover.png');
	});
});

describe('composeProfileCardModel', () => {
	it('assembles all three sections from raw payloads', () => {
		const model = composeProfileCardModel({
			activityPayload: ACTIVITY_OK,
			presencePayload: PRESENCE_OK,
			expectedPresenceUserId: '123456789012345678',
			now: NOW,
			mediaEnv: MEDIA_ENV,
			projects: [project('p1')],
		});
		expect(model.github.state).toBe('ok');
		expect(model.discord.state).toBe('ok');
		expect(model.works.length).toBeGreaterThan(0);
		expect(model.generatedAt).toBe('2026-11-22T06:12:00.000Z');
	});
});
