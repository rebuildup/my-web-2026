import { describe, expect, it } from 'vitest';
import type { ProfileCardModel } from './model';
import { NOW_HEIGHT, NOW_WIDTH, type NowStats, renderProfileNowSvg } from './now';

/**
 * Unified "now" strip contract (Issue #1205): GitHub streak/top-language
 * stats + activity + Discord presence in ONE SVG. Same honesty rules as
 * `/status` — observation times inside the image, `—` + `unavailable`
 * for failed upstreams — and no raster media.
 */

const BASE_MODEL: ProfileCardModel = {
	works: [],
	github: {
		state: 'ok',
		publicRepos: 28,
		privateRepos: 8,
		windowDays: 7,
		latest: {
			repoId: 'rebuildup/my-web-2026',
			type: 'PushEvent',
			at: '2026-11-22T04:00:00Z',
		},
		observedAt: '2026-11-22T05:00:00Z',
	},
	discord: {
		state: 'ok',
		statusLabel: 'Online',
		detail: 'Playing: After Effects — scene-b.aep',
		observedAt: '2026-11-22T06:10:00Z',
	},
	generatedAt: '2026-11-22T06:12:00.000Z',
};

const FULL_STATS: NowStats = {
	totalContributions: 4213,
	currentStreak: 17,
	longestStreak: 64,
	topLanguage: { name: 'TypeScript', pct: 61 },
};

const PROJECTS = ['my-web-2026', 'Tastile', 'After Effects', 'AI coding agent'] as const;

const EMPTY_STATS: NowStats = {
	totalContributions: null,
	currentStreak: null,
	longestStreak: null,
	topLanguage: null,
};

describe('renderProfileNowSvg', () => {
	it('renders a fixed-size SVG document', () => {
		const svg = renderProfileNowSvg(BASE_MODEL, FULL_STATS, PROJECTS);
		expect(svg).toContain(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${NOW_WIDTH}" height="${NOW_HEIGHT}"`,
		);
		expect(svg).toContain('role="img"');
	});

	it('is deterministic for the same inputs', () => {
		expect(renderProfileNowSvg(BASE_MODEL, FULL_STATS, PROJECTS)).toBe(
			renderProfileNowSvg(BASE_MODEL, FULL_STATS, PROJECTS),
		);
	});

	it('embeds no raster media', () => {
		expect(renderProfileNowSvg(BASE_MODEL, FULL_STATS, PROJECTS)).not.toContain('<image');
	});

	it('shows real stat values with labels and units', () => {
		const svg = renderProfileNowSvg(BASE_MODEL, FULL_STATS, PROJECTS);
		expect(svg).toContain('4,213');
		expect(svg).toContain('17');
		expect(svg).toContain('TypeScript');
		expect(svg).toContain('CURRENT STREAK');
		expect(svg).toContain('TOP LANGUAGE');
	});

	it('renders unavailable honestly when GitHub stats fail', () => {
		const svg = renderProfileNowSvg(BASE_MODEL, EMPTY_STATS, PROJECTS);
		expect(svg).toContain('unavailable');
		expect(svg).toContain('—');
	});

	it('keeps activity, Discord and in-progress panels with observation times', () => {
		const svg = renderProfileNowSvg(BASE_MODEL, EMPTY_STATS, PROJECTS);
		expect(svg).toContain('IN PROGRESS');
		expect(svg).toContain('my-web-2026');
		expect(svg).toContain('Tastile');
		expect(svg).toContain('GITHUB ACTIVITY');
		expect(svg).toContain('DISCORD');
		expect(svg).toContain('28 public / 8 private repos active in 7d');
		expect(svg).toContain('not projects in progress');
		expect(svg).toContain('Online');
		expect(svg).toContain('observed');
	});
});
