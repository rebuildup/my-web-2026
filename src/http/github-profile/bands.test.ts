import { describe, expect, it } from 'vitest';
import {
	BAND_MOBILE_WIDTH,
	BAND_WIDTH,
	type BandStats,
	composeBand1Model,
	composeBand2Model,
	drawIdentitySection,
	renderBand1Svg,
	renderBand2Svg,
} from './bands';
import type { ProfileCardModel } from './model';

/**
 * Visual-band contract (Issue #1216, visual doc §18): the GitHub-
 * native band design — profile head with readme-stats metrics,
 * per-repo output bars and an observation-anchored activity list.
 * Same honesty rules as the card stack: observation times inside
 * the image, `—`/empty states for failed upstreams, private data
 * aggregated anonymously, unmeasured counts never rendered as zero.
 */

const NOW = Date.parse('2026-11-24T14:00:00Z');

const BASE_MODEL: ProfileCardModel = {
	works: [],
	github: {
		state: 'ok',
		publicRepos: 28,
		privateRepos: 8,
		windowDays: 30,
		latest: { repoId: 'rebuildup/my-web-2026', type: 'PushEvent', at: '2026-11-24T01:00:00Z' },
		observedAt: '2026-11-24T13:00:00Z',
	},
	discord: {
		state: 'ok',
		statusLabel: 'Online',
		detail: null,
		observedAt: '2026-11-24T13:30:00Z',
	},
	generatedAt: '2026-11-24T14:00:00.000Z',
};

const FULL_STATS: BandStats = {
	currentStreak: 204,
	longestStreak: 206,
	totalContributions: 35239,
	contributedTo: 27,
	rankLevel: 'B+',
	rankPercentile: 45.2,
	topLangs: [
		{ name: 'TypeScript', pct: 45.8, color: '#3178c6' },
		{ name: 'C#', pct: 40.9, color: '#178600' },
		{ name: 'C++', pct: 7.9, color: '#f34b7d' },
		{ name: 'HTML', pct: 2.5, color: '#e34c26' },
	],
	totalStars: 128,
	totalCommits: 4211,
	totalPRs: 1302,
	totalIssues: 87,
	participatedRepos: 26,
	participatedStars: 48120,
	participatedLangs: [
		{ name: 'Rust', pct: 38.2, color: '#dea584' },
		{ name: 'TypeScript', pct: 21.4, color: '#3178c6' },
		{ name: 'Go', pct: 12.1, color: '#00add8' },
	],
	combinedLangs: [
		{ name: 'TypeScript', pct: 40.1, color: '#3178c6' },
		{ name: 'Rust', pct: 33.4, color: '#dea584' },
		{ name: 'C#', pct: 15.2, color: '#178600' },
	],
};

const EMPTY_STATS: BandStats = {
	currentStreak: null,
	longestStreak: null,
	totalContributions: null,
	contributedTo: null,
	rankLevel: null,
	rankPercentile: null,
	topLangs: null,
	totalStars: null,
	totalCommits: null,
	totalPRs: null,
	totalIssues: null,
	participatedRepos: null,
	participatedStars: null,
	participatedLangs: null,
	combinedLangs: null,
};

const band1 = (over: Partial<Parameters<typeof composeBand1Model>[0]> = {}) =>
	composeBand1Model({
		theme: 'dark',
		mobile: false,
		model: BASE_MODEL,
		stats: FULL_STATS,
		avatarDataUri: null,
		now: NOW,
		...over,
	});

const ACTIVITY_SNAPSHOT = {
	schemaVersion: 1,
	generatedOn: '2026-11-24',
	windowDays: 30,
	sources: {
		public: { status: 'ok', observedAt: '2026-11-24T13:00:00Z' },
		private: { status: 'ok', observedAt: '2026-11-24T12:00:00Z' },
	},
	repos: [
		{
			id: 'rebuildup/my-web-2026',
			kind: 'public',
			name: 'rebuildup/my-web-2026',
			activity: { events: 40, commits: 1800, prs: 352, windowDays: 30 },
		},
		{
			id: 'rebuildup/dotfiles',
			kind: 'public',
			name: 'rebuildup/dotfiles',
			activity: { events: 10, commits: 240, prs: 96, windowDays: 30 },
		},
		{
			id: 'rebuildup/unmeasured',
			kind: 'public',
			name: 'rebuildup/unmeasured',
			activity: { events: 3, windowDays: 30 },
		},
		{
			id: 'private-a1b2c3d4e5f6',
			kind: 'private',
			name: '非公開プロジェクト',
			activity: { events: 5, commits: 1500, prs: 540, windowDays: 30 },
		},
	],
	feed: [
		{
			id: 'e1',
			kind: 'public',
			repoId: 'rebuildup/my-web-2026',
			type: 'PushEvent',
			at: '2026-11-24T10:00:00Z',
		},
		{
			id: 'e2',
			kind: 'public',
			repoId: 'rebuildup/dotfiles',
			type: 'PullRequestEvent',
			at: '2026-11-23T20:00:00Z',
		},
		{
			id: 'e3',
			kind: 'private',
			repoId: 'private-a1b2c3d4e5f6',
			type: 'PushEvent',
			at: '2026-11-24T11:00:00Z',
		},
		{
			id: 'e4',
			kind: 'public',
			repoId: 'rebuildup/my-web-2026',
			type: 'PushEvent',
			at: '2026-11-10T10:00:00Z',
		},
	],
};

const band2 = (over: Partial<Parameters<typeof composeBand2Model>[0]> = {}) =>
	composeBand2Model({
		theme: 'dark',
		mobile: false,
		activityPayload: ACTIVITY_SNAPSHOT,
		now: NOW,
		...over,
	});

describe('composeBand1Model', () => {
	it('carries the Discord detail line and avatar slot honestly', () => {
		const model = band1({ avatarDataUri: 'data:image/png;base64,AAAA' });
		expect(model.avatarDataUri).toBe('data:image/png;base64,AAAA');
		expect(model.presenceDetail).toBeNull();
	});

	it('marks a stale presence honestly', () => {
		const model = band1({
			model: {
				...BASE_MODEL,
				discord: { state: 'stale', observedAt: '2026-11-24T10:00:00Z' },
			},
		});
		expect(model.presenceOk).toBe(false);
		expect(model.presenceLabel).toBe('Offline');
	});
});

describe('renderBand1Svg', () => {
	// Issue #1286: the standalone `/identity` surface is the person
	// fragment only — vitals and the language bar belong to the
	// independent `/vitals` + `/top-languages` assets the README
	// serves alongside it, so no stats value may leak back in.
	it('renders the person masthead without account stats', () => {
		const svg = renderBand1Svg(band1());
		expect(svg).toContain(`width="${BAND_WIDTH}"`);
		expect(svg).toContain('rebuildup');
		expect(svg).toContain('Online');
		for (const leaked of [
			'streak',
			'contributions',
			'commits',
			'issues',
			'stars',
			'128',
			'4,211',
			'35,239',
			'45.8%',
			'TypeScript',
			'Other',
			'unavailable',
		]) {
			expect(svg).not.toContain(leaked);
		}
	});

	it('stays person-only even when the stats snapshot is empty', () => {
		const svg = renderBand1Svg(band1({ stats: EMPTY_STATS }));
		expect(svg).toContain('rebuildup');
		expect(svg).not.toContain('unavailable');
	});

	it('supports the light theme and mobile variant', () => {
		const light = renderBand1Svg(band1({ theme: 'light' }));
		expect(light).toContain('fill="#ffffff"');
		const mob = renderBand1Svg(band1({ mobile: true }));
		expect(mob).toContain(`width="${BAND_MOBILE_WIDTH}"`);
		expect(mob).toContain('rebuildup');
		expect(mob).not.toContain('streak');
	});

	it('keeps the compat /profile composition intact by default', () => {
		const compat = drawIdentitySection(band1(), 0);
		expect(compat.svg).toContain('streak');
		expect(compat.svg).toContain('TypeScript');
		const scoped = drawIdentitySection(band1(), 0, { accountStats: false });
		expect(scoped.svg).not.toContain('streak');
		expect(scoped.bottom).toBeLessThan(compat.bottom);
	});

	it('is deterministic for the same inputs', () => {
		expect(renderBand1Svg(band1())).toBe(renderBand1Svg(band1()));
	});
});

describe('composeBand2Model', () => {
	it('keeps public repos sorted by commits and aggregates the rest', () => {
		const model = band2();
		expect(model.rows[0].name).toBe('my-web-2026');
		expect(model.rows.map((r) => r.name)).toContain('Private repos');
		const priv = model.rows.find((r) => r.name === 'Private repos');
		expect(priv?.commits).toBe(1500);
	});

	it('keeps unmeasured counts null — never a fake zero', () => {
		const model = band2();
		const unmeasured = model.rows.find((r) => r.name === 'unmeasured');
		expect(unmeasured?.commits).toBeNull();
		expect(unmeasured?.prs).toBeNull();
	});

	it('filters the 72h feed to public events inside the window', () => {
		const model = band2();
		expect(model.feed72).toHaveLength(2);
		expect(model.feed72.every((e) => e.repoId.startsWith('rebuildup/'))).toBe(true);
	});

	it('renders human verbs for every feed event type — never the raw API name (Issue #1286)', () => {
		const payload = {
			...ACTIVITY_SNAPSHOT,
			feed: [
				{
					id: 'x1',
					kind: 'public',
					repoId: 'rebuildup/my-web-2026',
					type: 'IssuesEvent',
					at: '2026-11-24T12:00:00Z',
				},
				{
					id: 'x2',
					kind: 'public',
					repoId: 'rebuildup/my-web-2026',
					type: 'SomeFutureEvent',
					at: '2026-11-24T11:00:00Z',
				},
			],
		};
		const svg = renderBand2Svg(band2({ activityPayload: payload }));
		expect(svg).toContain('· issue');
		expect(svg).toContain('· activity');
		expect(svg).not.toContain('IssuesEvent');
		expect(svg).not.toContain('SomeFutureEvent');
	});

	it('fails closed on an invalid snapshot', () => {
		const model = band2({ activityPayload: { bogus: true } });
		expect(model.snapshotAvailable).toBe(false);
		expect(model.rows).toHaveLength(0);
		expect(model.feed72).toHaveLength(0);
	});
});

describe('renderBand2Svg', () => {
	it('renders repo rows, the event strip and the observation stamp', () => {
		const svg = renderBand2Svg(band2());
		expect(svg).toContain(`width="${BAND_WIDTH}"`);
		expect(svg).toContain('REPO OUTPUT');
		expect(svg).toContain('LAST 72 HOURS');
		expect(svg).toContain('RECENT EVENTS');
		// same-day events collapse to HH:MM in their own right-aligned
		// stamp column — the footer already declares the observed day
		expect(svg).toContain('· pushed');
		expect(svg).toContain('19:00');
		// units live once in the Total legend line, not per-row headers
		expect(svg).toContain('commits');
		expect(svg).toContain('PRs');
		expect(svg).toContain('my-web-2026');
	});

	it('says the snapshot is unavailable instead of drawing zeros', () => {
		const svg = renderBand2Svg(band2({ activityPayload: null }));
		expect(svg).toContain('no activity snapshot');
		expect(svg).not.toContain('REPO OUTPUT');
	});

	it('supports light theme and mobile variant', () => {
		expect(renderBand2Svg(band2({ theme: 'light' }))).toContain('fill="#ffffff"');
		const mob = renderBand2Svg(band2({ mobile: true }));
		expect(mob).toContain(`width="${BAND_MOBILE_WIDTH}"`);
		expect(mob).toContain('REPO OUTPUT');
	});
});
