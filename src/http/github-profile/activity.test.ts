import { describe, expect, it } from 'vitest';
import { ACTIVITY_HEIGHT, ACTIVITY_WIDTH, formatJst, renderActivitySvg } from './activity';

/**
 * Activity card contract (rebuildup/rebuildup#8 redesign): per-repo
 * activity bars + recent feed, all dates rendered in Asia/Tokyo,
 * honest unavailable state, no guessed values.
 */

const SNAPSHOT = {
	schemaVersion: 1,
	generatedOn: '2026-11-22',
	windowDays: 30,
	sources: {
		public: { status: 'ok', observedAt: '2026-11-22T05:00:00Z' },
		private: { status: 'ok', observedAt: '2026-11-22T05:00:00Z' },
	},
	repos: [
		{
			kind: 'public',
			id: 'rebuildup/my-web-2026',
			name: 'my-web-2026',
			repoFullName: 'rebuildup/my-web-2026',
			activity: { events: 120, commits: 90, prs: 20, windowDays: 30 },
		},
		{
			kind: 'private',
			id: 'private-abcdef123456',
			name: '非公開プロジェクト',
			activity: { events: 40, commits: 30, prs: 5, windowDays: 30 },
		},
	],
	feed: [
		{
			id: 'f1',
			kind: 'public',
			repoId: 'rebuildup/my-web-2026',
			type: 'PullRequestEvent',
			at: '2026-11-22T04:00:00Z',
			ref: { kind: 'pull', number: 42, state: 'open' },
		},
		{
			id: 'f2',
			kind: 'private',
			repoId: 'private-abcdef123456',
			type: 'PushEvent',
			at: '2026-11-22T03:00:00Z',
		},
	],
};

describe('formatJst', () => {
	it('renders UTC instants in Asia/Tokyo (+9, no DST)', () => {
		// 2026-11-22T20:30:00Z is 2026-11-23 05:30 JST — date rolls over.
		expect(formatJst('2026-11-22T20:30:00Z')).toBe('Nov 23, 2026 · 05:30 JST');
	});

	it('returns the input for unparseable stamps', () => {
		expect(formatJst('not-a-date')).toBe('not-a-date');
	});
});

describe('renderActivitySvg', () => {
	it('renders a fixed-size SVG document', () => {
		const svg = renderActivitySvg(SNAPSHOT);
		expect(svg).toContain(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${ACTIVITY_WIDTH}" height="${ACTIVITY_HEIGHT}"`,
		);
		expect(svg).toContain('role="img"');
	});

	it('is deterministic for the same payload', () => {
		expect(renderActivitySvg(SNAPSHOT)).toBe(renderActivitySvg(SNAPSHOT));
	});

	it('names public repos and aggregates private ones anonymously', () => {
		const svg = renderActivitySvg(SNAPSHOT);
		expect(svg).toContain('rebuildup/my-web-2026');
		expect(svg).not.toContain('secret-repo');
		expect(svg).not.toContain('非公開プロジェクト');
		expect(svg).toContain('1 private repo');
	});

	it('renders feed timestamps in JST, never raw UTC', () => {
		const svg = renderActivitySvg(SNAPSHOT);
		// 04:00Z → 13:00 JST same day (compact row stamp; the panel
		// header carries the year)
		expect(svg).toContain('Nov 22, 13:00 JST');
		expect(svg).not.toContain('04:00 UTC');
	});

	it('labels pull refs on feed rows', () => {
		const svg = renderActivitySvg(SNAPSHOT);
		expect(svg).toContain('PR #42');
	});

	it('renders an honest unavailable state for bad payloads', () => {
		const svg = renderActivitySvg({ bogus: true });
		expect(svg).toContain('unavailable');
		expect(svg).toContain('GitHub activity snapshot unavailable.');
	});

	it('renders an honest empty-feed state', () => {
		const svg = renderActivitySvg({ ...SNAPSHOT, feed: [] });
		expect(svg).toContain('No public feed items in window.');
	});
});
