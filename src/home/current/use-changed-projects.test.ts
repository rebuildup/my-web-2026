import { describe, expect, it } from 'vitest';
import type { CurrentProjectRecord } from './types';
import {
	CHANGE_SIGNATURE_STORAGE_KEY,
	buildSignatures,
	changedProjectIds,
	projectSignature,
} from './use-changed-projects';

/**
 * The change signature behind the section's one motion surface
 * (Issue #316).
 *
 * The rule under test is the honesty rule: a row may only be reported as
 * changed when a STORED fact changed. A derived value (`1 か月`, `今日`, the
 * 30-day count) changes with the calendar, not with the record, and must
 * never produce a marker — that would be the fake-live behaviour the whole
 * design exists to avoid.
 */
const STARTED_ON = { value: '2026-09-11', source: 'git', observedOn: '2026-11-01' } as const;

const RECORD: CurrentProjectRecord = {
	id: 'repo',
	name: 'repo',
	statusJa: '説明。',
	startedOn: STARTED_ON,
	updatedOn: { value: '2026-11-01', source: 'git', observedOn: '2026-11-01' },
	weight: {
		level: { value: 'primary', source: 'handwritten', observedOn: '2026-11-01' },
		activity: {
			value: { commits: 12, windowDays: 30 },
			source: 'git',
			observedOn: '2026-11-01',
		},
	},
};

describe('projectSignature', () => {
	it('contains no derived value', () => {
		const signature = projectSignature(RECORD);
		expect(signature).not.toContain('か月');
		expect(signature).not.toContain('日前');
		expect(signature).not.toContain('今日');
	});

	it('is stable for the same record', () => {
		expect(projectSignature(RECORD)).toBe(
			projectSignature({ ...RECORD, weight: { ...RECORD.weight } }),
		);
	});

	it('changes when a value changes, even if its source does not', () => {
		expect(projectSignature({ ...RECORD, statusJa: '別の説明。' })).not.toBe(
			projectSignature(RECORD),
		);
	});

	it('changes when only the SOURCE of a fact changes', () => {
		// The number did not move, but the claim about it did.
		const rewritten: CurrentProjectRecord = {
			...RECORD,
			startedOn: { ...STARTED_ON, source: 'handwritten' },
		};
		expect(projectSignature(rewritten)).not.toBe(projectSignature(RECORD));
	});
});

describe('changedProjectIds', () => {
	const current = buildSignatures([RECORD]);

	it('reports nothing on a first visit', () => {
		expect(changedProjectIds(null, current)).toEqual([]);
		expect(changedProjectIds(undefined, current)).toEqual([]);
		// A cleared or corrupt store is "no previous visit", not "all new".
		expect(changedProjectIds('not-an-object', current)).toEqual([]);
	});

	it('reports nothing when every signature matches', () => {
		expect(changedProjectIds(current, current)).toEqual([]);
	});

	it('reports the id whose stored signature differs', () => {
		const previous = { repo: 'something else' };
		expect(changedProjectIds(previous, current)).toEqual(['repo']);
	});

	it('reports a project that appeared since the last visit', () => {
		const previous = buildSignatures([]);
		expect(changedProjectIds(previous, current)).toEqual(['repo']);
	});

	it('reports nothing for a project that disappeared — it is not rendered', () => {
		const previous = { gone: 'x' };
		expect(changedProjectIds(previous, {})).toEqual([]);
	});
});

describe('the storage key', () => {
	it('is versioned, so a signature shape change cannot be compared across versions', () => {
		expect(CHANGE_SIGNATURE_STORAGE_KEY).toBe('mw_home_current_projects_v1');
	});
});
