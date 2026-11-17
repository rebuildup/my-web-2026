import { describe, expect, it } from 'vitest';
import { selectActivitySnapshot } from './live';

/**
 * Snapshot selection contract (Issues #316 / #319 / #932): the D1
 * document wins only when it is VALID and at least as fresh as the
 * committed artefact; anything else falls back to the committed
 * snapshot, and `null` means "no usable snapshot".
 */

const COMMITTED = {
	schemaVersion: 1,
	generatedOn: '2026-11-10',
	windowDays: 30,
	sources: {
		public: { status: 'ok', observedAt: '2026-11-10T00:00:00.000Z' },
		private: { status: 'ok', observedAt: '2026-11-10T00:00:00.000Z' },
	},
	repos: [
		{
			id: 'rebuildup/my-web-2026',
			kind: 'public',
			name: 'my-web-2026',
			htmlUrl: 'https://github.com/rebuildup/my-web-2026',
		},
	],
	feed: [],
};

const LIVE_FRESH = {
	...COMMITTED,
	generatedOn: '2026-11-17',
	sources: {
		public: { status: 'ok', observedAt: '2026-11-17T00:00:00.000Z' },
		private: { status: 'ok', observedAt: '2026-11-17T00:00:00.000Z' },
	},
};

const LIVE_STALE = {
	...COMMITTED,
	generatedOn: '2026-11-01',
	sources: {
		public: { status: 'ok', observedAt: '2026-11-01T00:00:00.000Z' },
		private: { status: 'ok', observedAt: '2026-11-01T00:00:00.000Z' },
	},
};

describe('selectActivitySnapshot', () => {
	it('prefers a valid, fresher live snapshot', () => {
		const selected = selectActivitySnapshot(LIVE_FRESH, COMMITTED);
		expect(selected?.generatedOn).toBe('2026-11-17');
	});

	it('falls back to the committed snapshot when live is older', () => {
		const selected = selectActivitySnapshot(LIVE_STALE, COMMITTED);
		expect(selected?.generatedOn).toBe('2026-11-10');
	});

	it('falls back to the committed snapshot when live is invalid', () => {
		const selected = selectActivitySnapshot({ garbage: true }, COMMITTED);
		expect(selected?.generatedOn).toBe('2026-11-10');
	});

	it('uses the live snapshot when no committed one exists', () => {
		const selected = selectActivitySnapshot(LIVE_FRESH, null);
		expect(selected?.generatedOn).toBe('2026-11-17');
	});

	it('returns the committed snapshot when live is absent', () => {
		const selected = selectActivitySnapshot(null, COMMITTED);
		expect(selected?.generatedOn).toBe('2026-11-10');
	});

	it('returns null when neither source is usable', () => {
		expect(selectActivitySnapshot(null, null)).toBeNull();
		expect(selectActivitySnapshot('junk', 42)).toBeNull();
	});

	it('rejects a live snapshot that leaks a private identity', () => {
		const leaky = {
			...LIVE_FRESH,
			repos: [
				{
					id: 'rebuildup/secret-side-project',
					kind: 'private',
					name: 'secret-side-project',
					htmlUrl: 'https://github.com/rebuildup/secret-side-project',
				},
			],
		};
		const selected = selectActivitySnapshot(leaky, COMMITTED);
		expect(selected?.generatedOn).toBe('2026-11-10');
	});
});
