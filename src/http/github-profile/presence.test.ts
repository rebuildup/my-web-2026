import { describe, expect, it } from 'vitest';
import type { ProfileCardModel } from './model';
import { PRESENCE_HEIGHT, PRESENCE_WIDTH, renderPresenceSvg } from './presence';

/**
 * Presence chip contract (rebuildup/rebuildup#8 redesign): a small
 * independent surface — presence freshness never shares a response
 * with GitHub activity data.
 */

const BASE: ProfileCardModel = {
	works: [],
	github: { state: 'unavailable', publicRepos: 0, privateRepos: 0, windowDays: 0 },
	discord: {
		state: 'ok',
		statusLabel: 'Online',
		detail: 'Playing: After Effects — scene-ae.aep',
		observedAt: '2026-11-22T06:10:00Z',
	},
	generatedAt: '2026-11-22T06:12:00.000Z',
};

describe('renderPresenceSvg', () => {
	it('renders a fixed-size SVG chip', () => {
		const svg = renderPresenceSvg(BASE);
		expect(svg).toContain(`width="${PRESENCE_WIDTH}" height="${PRESENCE_HEIGHT}"`);
		expect(svg).toContain('role="img"');
	});

	it('shows status, detail and observation stamp when fresh', () => {
		const svg = renderPresenceSvg(BASE);
		expect(svg).toContain('Online');
		expect(svg).toContain('Playing: After Effects');
		expect(svg).toContain('observed');
	});

	it('renders stale and unavailable states honestly', () => {
		expect(
			renderPresenceSvg({
				...BASE,
				discord: { state: 'stale', observedAt: '2026-11-22T06:10:00Z' },
			}),
		).toContain('presence stale');
		expect(
			renderPresenceSvg({
				...BASE,
				discord: { state: 'unavailable', observedAt: null },
			}),
		).toContain('presence unavailable');
	});
});
