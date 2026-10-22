import { describe, expect, it } from 'vitest';
import { evaluateFreshness, getDotfilesIntroduction, isSnapshot } from './snapshot';
import {
	MAX_AGE_HOURS,
	type ProjectIntroductionSnapshot,
	SUPPORTED_SNAPSHOT_SCHEMA_VERSION,
} from './types';

const BASE_NOW = Date.parse('2026-10-20T12:00:00.000Z');

function currentSnapshot(): ProjectIntroductionSnapshot {
	const view = getDotfilesIntroduction(BASE_NOW);
	if (!view.snapshot) throw new Error('the committed dotfiles snapshot must validate');
	return view.snapshot;
}

function clone(overrides: Partial<ProjectIntroductionSnapshot>): ProjectIntroductionSnapshot {
	return { ...currentSnapshot(), ...overrides } as ProjectIntroductionSnapshot;
}

describe('getDotfilesIntroduction', () => {
	it('returns the committed snapshot as current inside the freshness window', () => {
		const view = getDotfilesIntroduction(BASE_NOW);
		expect(view.freshness).toBe('current');
		expect(view.reason).toBeNull();
		expect(view.snapshot?.source).toMatchObject({
			id: 'dotfiles',
			owner: 'rebuildup',
			repo: 'dotfiles',
		});
	});

	it('publishes only the allowlisted README sections', () => {
		const snapshot = currentSnapshot();
		const ids = snapshot.introduction.sections.map((section) => section.id);
		expect(ids).toEqual([
			'principles',
			'layout',
			'agent-launcher',
			'agent-configuration',
			'decisions-and-research',
		]);
	});

	it('describes repository-root entries, not nested agent directories', () => {
		const snapshot = currentSnapshot();
		const layout = snapshot.introduction.sections.find((section) => section.id === 'layout');
		expect(layout?.structure).toEqual([
			'.infisical.json',
			'config',
			'agents',
			'home',
			'script',
			'docs',
			'AGENTS.md',
		]);
		expect(layout?.structure).not.toContain('common');
		expect(layout?.structure).not.toContain('claude');
	});

	it('carries no machine-local path, secret endpoint or executable markup', () => {
		const serialized = JSON.stringify(currentSnapshot());
		expect(serialized).not.toMatch(/<script/i);
		expect(serialized).not.toMatch(/javascript:/i);
		expect(serialized).not.toMatch(/\.gitconfig(?:\.local)?/);
		expect(serialized).not.toMatch(/secrets\.[a-z0-9.-]+/i);
	});
});

describe('evaluateFreshness', () => {
	it('is current up to and including MAX_AGE_HOURS', () => {
		const snapshot = currentSnapshot();
		const verifiedAt = Date.parse(snapshot.verifiedAt);
		expect(evaluateFreshness(snapshot, verifiedAt + MAX_AGE_HOURS * 3_600_000)).toBe('current');
		expect(evaluateFreshness(snapshot, verifiedAt + MAX_AGE_HOURS * 3_600_000 + 1)).toBe('stale');
	});

	it('reports unavailable for a snapshot whose source is not public', () => {
		const snapshot = clone({
			availability: 'unavailable',
			unavailable: {
				reason: 'source-not-public',
				observedAt: '2026-10-20T00:00:00.000Z',
			},
		});
		expect(evaluateFreshness(snapshot, BASE_NOW)).toBe('unavailable');
	});

	it('reports unknown for a missing or undated snapshot', () => {
		expect(evaluateFreshness(null, BASE_NOW)).toBe('unknown');
		expect(evaluateFreshness(clone({ verifiedAt: 'not-a-date' }), BASE_NOW)).toBe('unknown');
		expect(evaluateFreshness(clone({ verifiedAt: '' }), BASE_NOW)).toBe('unknown');
	});
});

describe('isSnapshot', () => {
	it('accepts the committed snapshot', () => {
		expect(isSnapshot(currentSnapshot())).toBe(true);
	});

	it('rejects an unsupported schema version', () => {
		expect(isSnapshot(clone({ schemaVersion: SUPPORTED_SNAPSHOT_SCHEMA_VERSION + 1 }))).toBe(false);
	});

	it('rejects a source that is not the dotfiles repository', () => {
		const snapshot = currentSnapshot();
		expect(
			isSnapshot({
				...snapshot,
				source: { ...snapshot.source, repo: 'pc-setup' },
			}),
		).toBe(false);
	});

	it('rejects a README URL that is not pinned to the recorded commit', () => {
		const snapshot = currentSnapshot();
		expect(
			isSnapshot({
				...snapshot,
				source: {
					...snapshot.source,
					readmeUrl:
						'https://github.com/rebuildup/dotfiles/blob/0000000000000000000000000000000000000000/README.md',
				},
			}),
		).toBe(false);
	});

	it('rejects an unsafe link scheme anywhere in the introduction', () => {
		const snapshot = currentSnapshot();
		const section = snapshot.introduction.sections[0];
		expect(
			isSnapshot({
				...snapshot,
				introduction: {
					...snapshot.introduction,
					sections: [
						{
							...section,
							points: [[{ text: 'click', href: 'javascript:alert(1)' }]],
						},
						...snapshot.introduction.sections.slice(1),
					],
				},
			}),
		).toBe(false);
	});

	it('requires an unavailable reason and observation time', () => {
		expect(isSnapshot(clone({ availability: 'unavailable', unavailable: null }))).toBe(false);
		expect(
			isSnapshot(
				clone({
					availability: 'unavailable',
					unavailable: { reason: 'source-archived', observedAt: '2026-10-20' },
				}),
			),
		).toBe(true);
	});
});

describe('freshness boundary', () => {
	it('uses a 14-day window', () => {
		expect(MAX_AGE_HOURS).toBe(14 * 24);
	});
});
