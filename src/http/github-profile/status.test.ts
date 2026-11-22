import { describe, expect, it } from 'vitest';
import type { ProfileCardModel } from './model';
import { STATUS_HEIGHT, STATUS_WIDTH, renderProfileStatusSvg } from './status';

/**
 * Status strip contract (Issue #1196, ADR-0025): the dynamic half of
 * the profile README. Same honesty rules as the card — observation
 * times inside the image, labelled unavailable/stale states — but NO
 * raster media and a fixed slim geometry.
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

describe('renderProfileStatusSvg', () => {
	it('renders a fixed-size SVG document', () => {
		const svg = renderProfileStatusSvg(BASE_MODEL);
		expect(svg).toContain(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${STATUS_WIDTH}" height="${STATUS_HEIGHT}"`,
		);
		expect(svg).toContain('role="img"');
	});

	it('is deterministic for the same model', () => {
		expect(renderProfileStatusSvg(BASE_MODEL)).toBe(renderProfileStatusSvg(BASE_MODEL));
	});

	it('embeds no raster media — status stays a few KB', () => {
		const svg = renderProfileStatusSvg(BASE_MODEL);
		expect(svg).not.toContain('<image');
		expect(svg).not.toContain('data:image');
	});

	it('carries both panel labels and observation times', () => {
		const svg = renderProfileStatusSvg(BASE_MODEL);
		expect(svg).toContain('GITHUB ACTIVITY');
		expect(svg).toContain('DISCORD');
		expect(svg).toContain('28 public · 8 private');
		expect(svg).toContain('Online');
		expect(svg).toContain('observed');
	});

	it('renders honest unavailable states', () => {
		const svg = renderProfileStatusSvg({
			...BASE_MODEL,
			github: { state: 'unavailable', publicRepos: 0, privateRepos: 0, windowDays: 0 },
			discord: { state: 'unavailable', observedAt: null },
		});
		expect(svg).toContain('No GitHub activity observed yet.');
		expect(svg).toContain('Discord presence unavailable');
	});

	it('renders a stale Discord presence without inventing freshness', () => {
		const svg = renderProfileStatusSvg({
			...BASE_MODEL,
			discord: { state: 'stale', observedAt: '2026-11-22T05:00:00Z' },
		});
		expect(svg).toContain('Presence stale');
		expect(svg).toContain('last seen');
	});
});
