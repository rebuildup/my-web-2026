import { describe, expect, it } from 'vitest';
import { PROJECT_ROSTER } from '../../home/current/roster';
import {
	BAND1_HEIGHT,
	BAND1_MOBILE_HEIGHT,
	BAND2_HEIGHT,
	BAND2_MOBILE_HEIGHT,
	BAND_MOBILE_WIDTH,
	BAND_WIDTH,
	type BandStats,
	composeBand1Model,
	composeBand2Model,
	renderBand1Svg,
	renderBand2Svg,
} from './bands';
import type { ProfileCardModel } from './model';

/**
 * Visual-band contract (Issue #1216, visual doc §18): the approved
 * two-band information design. Same honesty rules as the card stack —
 * observation times inside the image, `—`/empty states for failed
 * upstreams, private data aggregated anonymously, public feed only.
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
};

const EMPTY_STATS: BandStats = {
	currentStreak: null,
	longestStreak: null,
	totalContributions: null,
	contributedTo: null,
	rankLevel: null,
	rankPercentile: null,
	topLangs: null,
};

const band1 = (over: Partial<Parameters<typeof composeBand1Model>[0]> = {}) =>
	composeBand1Model({
		theme: 'dark',
		mobile: false,
		model: BASE_MODEL,
		stats: FULL_STATS,
		roster: PROJECT_ROSTER,
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
	it('orders focus nodes by weight level with roster glyphs', () => {
		const model = band1();
		const levels = model.focus.map((n) => n.level);
		expect(levels).toEqual(['primary', 'active', 'side', 'side']);
		expect(model.focus[0].glyph).toBe('web');
		expect(model.focus.map((n) => n.name)).toContain('AI coding agent');
	});

	it('uses the latest observation time across presence and GitHub', () => {
		expect(band1().observedAt).toBe('2026-11-24T13:30:00Z');
	});

	it('marks a stale presence honestly', () => {
		const model = band1({
			model: {
				...BASE_MODEL,
				discord: { state: 'stale', observedAt: '2026-11-24T10:00:00Z' },
			},
		});
		expect(model.presenceOk).toBe(false);
		expect(model.presenceLabel).toBe('stale');
	});
});

describe('renderBand1Svg', () => {
	it('renders the approved desktop geometry', () => {
		const svg = renderBand1Svg(band1());
		expect(svg).toContain(`width="${BAND_WIDTH}" height="${BAND1_HEIGHT}"`);
		expect(svg).toContain('IN PROGRESS · DECLARED FOCUS');
		expect(svg).toContain('▮▮▮ primary · ▮▮ active · ▮ side');
		expect(svg).toContain('my-web-2026');
		expect(svg).toContain('After Effects');
		expect(svg).toContain('204');
		expect(svg).toContain('B+');
		expect(svg).toContain('45.8%');
		expect(svg).toContain('CONTRIBUTED TO · 27 REPOS');
		expect(svg).toContain('Online on Discord');
		expect(svg).toContain('JST');
	});

	it('renders honest unavailable states when stats fail', () => {
		const svg = renderBand1Svg(band1({ stats: EMPTY_STATS }));
		expect(svg).toContain('unavailable');
		expect(svg).toContain('—');
	});

	it('supports the light theme and mobile variant', () => {
		const light = renderBand1Svg(band1({ theme: 'light' }));
		expect(light).toContain('fill="#ffffff"');
		const mob = renderBand1Svg(band1({ mobile: true }));
		expect(mob).toContain(`width="${BAND_MOBILE_WIDTH}" height="${BAND1_MOBILE_HEIGHT}"`);
		expect(mob).toContain('IN PROGRESS');
	});

	it('is deterministic for the same inputs', () => {
		expect(renderBand1Svg(band1())).toBe(renderBand1Svg(band1()));
	});
});

describe('composeBand2Model', () => {
	it('keeps public repos sorted by commits and aggregates the rest', () => {
		const model = band2();
		expect(model.rows[0].name).toBe('my-web-2026');
		expect(model.rows.map((r) => r.name)).toContain('private repos · sum');
		const priv = model.rows.find((r) => r.name === 'private repos · sum');
		expect(priv?.commits).toBe(1500);
	});

	it('filters the 72h feed to public events inside the window', () => {
		const model = band2();
		expect(model.feed72).toHaveLength(2);
		expect(model.feed72.every((e) => e.repoId.startsWith('rebuildup/'))).toBe(true);
	});

	it('fails closed on an invalid snapshot', () => {
		const model = band2({ activityPayload: { bogus: true } });
		expect(model.rows).toHaveLength(0);
		expect(model.feed72).toHaveLength(0);
		expect(model.windowDays).toBe(30);
	});
});

describe('renderBand2Svg', () => {
	it('renders repo rows, pulse shapes and JST feed', () => {
		const svg = renderBand2Svg(band2());
		expect(svg).toContain(`width="${BAND_WIDTH}" height="${BAND2_HEIGHT}"`);
		expect(svg).toContain('REPO OUTPUT · 30D');
		expect(svg).toContain('LAST 72 HOURS');
		expect(svg).toContain('rotate(45'); // PR diamond
		expect(svg).toContain('public events · times JST');
		expect(svg).toContain('my-web-2026');
	});

	it('renders the honest empty state with no events', () => {
		const svg = renderBand2Svg(band2({ activityPayload: null }));
		expect(svg).toContain('no public events in 72h');
		expect(svg).toContain('0 public events');
	});

	it('supports light theme and mobile variant', () => {
		expect(renderBand2Svg(band2({ theme: 'light' }))).toContain('fill="#ffffff"');
		const mob = renderBand2Svg(band2({ mobile: true }));
		expect(mob).toContain(`width="${BAND_MOBILE_WIDTH}" height="${BAND2_MOBILE_HEIGHT}"`);
		expect(mob).toContain('REPO OUTPUT · 30D');
	});
});
