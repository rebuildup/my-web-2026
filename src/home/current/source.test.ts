import { describe, expect, it } from 'vitest';
import {
	RECENT_UPDATE_WINDOW_DAYS,
	SOURCE_LABELS,
	WEIGHT_LEVEL_ORDER,
	composeRecords,
	groupByWeight,
	orderProjects,
	selectPublishableLink,
	selectPublishedProjects,
} from './source';
import type { CurrentProjectFacts, CurrentProjectRecord, ProjectFact } from './types';

/**
 * The publication contract of the current-projects section (Issue #316).
 *
 * Two things are asserted here that the rendered document cannot assert:
 *
 *   1. the STRUCTURE GATE is fail-closed — an entry whose dates do not add
 *      up disappears rather than rendering half a story, and a fact the
 *      source cannot prove (a future date, a rolled-over calendar day) is
 *      refused;
 *   2. the ORDER and GROUPING are count-independent — a comparator and a
 *      grouping rule that do not change when the roster grows.
 *
 * The gate checks structure, NOT truth. Nothing here can tell whether the
 * owner really started on the date they wrote; that is why the document
 * names the source next to every value.
 */

const TODAY = '2026-11-01';

function fact<T>(value: T, source: ProjectFact<T>['source'] = 'handwritten'): ProjectFact<T> {
	return { value, source, observedOn: TODAY };
}

function record(overrides: Partial<CurrentProjectRecord> & { id: string }): CurrentProjectRecord {
	return {
		name: overrides.id,
		statusJa: '説明。',
		...overrides,
	} as CurrentProjectRecord;
}

function dated(
	id: string,
	startedOn: string,
	updatedOn: string,
	extra: Partial<CurrentProjectRecord> = {},
): CurrentProjectRecord {
	return record({
		id,
		startedOn: fact(startedOn, 'git'),
		updatedOn: fact(updatedOn, 'git'),
		...extra,
	});
}

describe('the structure gate', () => {
	it('drops an entry whose id, name or status is empty after trimming', () => {
		const published = selectPublishedProjects(
			[
				record({ id: '  ', name: '空 id' }),
				record({ id: 'no-name', name: '   ' }),
				record({ id: 'no-status', statusJa: '  ' }),
				record({ id: 'kept', name: '残る' }),
			],
			TODAY,
		);
		expect(published.map((entry) => entry.id)).toEqual(['kept']);
	});

	it('keeps the FIRST entry when an id repeats', () => {
		const published = selectPublishedProjects(
			[record({ id: 'dupe', name: '先頭' }), record({ id: 'dupe', name: '後ろ' })],
			TODAY,
		);
		expect(published).toHaveLength(1);
		expect(published[0]?.name).toBe('先頭');
	});

	it('drops an entry that carries only one of the two dates', () => {
		// A duration needs a start and an end; rendering one date alone
		// would read as if it were the whole story.
		const published = selectPublishedProjects(
			[
				record({ id: 'only-start', startedOn: fact('2026-09-11') }),
				record({ id: 'only-update', updatedOn: fact('2026-10-01') }),
				dated('both', '2026-09-11', '2026-10-01'),
			],
			TODAY,
		);
		expect(published.map((entry) => entry.id)).toEqual(['both']);
	});

	it('drops an entry whose start follows its last update', () => {
		const published = selectPublishedProjects(
			[
				dated('backwards', '2026-10-01', '2026-09-11'),
				dated('forwards', '2026-09-11', '2026-10-01'),
			],
			TODAY,
		);
		expect(published.map((entry) => entry.id)).toEqual(['forwards']);
	});

	it('drops an entry with a date in the future', () => {
		const published = selectPublishedProjects(
			[
				dated('future-update', '2026-09-11', '2026-11-02'),
				dated('future-start', '2026-11-02', '2026-11-02'),
				dated('today', '2026-09-11', '2026-11-01'),
			],
			TODAY,
		);
		expect(published.map((entry) => entry.id)).toEqual(['today']);
	});

	it('drops an entry whose value is not a real calendar day', () => {
		const published = selectPublishedProjects(
			[dated('rolled-over', '2026-02-30', '2026-03-01')],
			TODAY,
		);
		expect(published).toEqual([]);
	});

	it('drops an entry whose fact was observed in the future', () => {
		const published = selectPublishedProjects(
			[
				record({
					id: 'observed-later',
					startedOn: { value: '2026-09-11', source: 'git', observedOn: '2026-11-02' },
					updatedOn: fact('2026-10-01', 'git'),
				}),
			],
			TODAY,
		);
		expect(published).toEqual([]);
	});

	it('publishes nothing when the base date itself is unusable', () => {
		expect(selectPublishedProjects([dated('a', '2026-09-11', '2026-10-01')], '')).toEqual([]);
	});

	it('keeps a record with no facts at all — a project is real without them', () => {
		const published = selectPublishedProjects([record({ id: 'bare' })], TODAY);
		expect(published).toHaveLength(1);
		expect(published[0]?.startedOn).toBeUndefined();
		expect(published[0]?.weight).toBeUndefined();
	});
});

describe('the link rule', () => {
	it('drops only the link when its scheme is not publishable', () => {
		for (const href of [
			'javascript:alert(1)',
			'data:text/html,x',
			'http://example.com',
			'about',
			'//example.com',
			'/\\example.com',
		]) {
			expect(selectPublishableLink({ label: '開く', href })).toBeUndefined();
		}
	});

	it('drops the link when its label is empty', () => {
		expect(selectPublishableLink({ label: '   ', href: '/x' })).toBeUndefined();
	});

	it('keeps an internal path and an https URL, trimmed', () => {
		expect(selectPublishableLink({ label: '  内部  ', href: ' /about ' })).toEqual({
			label: '内部',
			href: '/about',
		});
		expect(selectPublishableLink({ label: '外部', href: 'https://example.com/x' })).toEqual({
			label: '外部',
			href: 'https://example.com/x',
		});
	});

	it('keeps the project and removes the link', () => {
		const published = selectPublishedProjects(
			[record({ id: 'linked', link: { label: '開く', href: 'javascript:alert(1)' } })],
			TODAY,
		);
		expect(published).toHaveLength(1);
		expect(published[0]?.link).toBeUndefined();
	});
});

describe('the weight gate', () => {
	it('drops an unknown level but keeps a valid activity', () => {
		const published = selectPublishedProjects(
			[
				record({
					id: 'bad-level',
					weight: {
						level: {
							value: 'critical' as never,
							source: 'handwritten',
							observedOn: TODAY,
						},
						activity: fact({ commits: 12, windowDays: 30 }, 'git'),
					},
				}),
			],
			TODAY,
		);
		expect(published[0]?.weight?.level).toBeUndefined();
		expect(published[0]?.weight?.activity?.value.commits).toBe(12);
	});

	it('drops an unusable activity but keeps a valid level', () => {
		const published = selectPublishedProjects(
			[
				record({
					id: 'bad-activity',
					weight: {
						level: { value: 'primary', source: 'handwritten', observedOn: TODAY },
						activity: fact({ commits: -1, windowDays: 0 }, 'git'),
					},
				}),
			],
			TODAY,
		);
		expect(published[0]?.weight?.level?.value).toBe('primary');
		expect(published[0]?.weight?.activity).toBeUndefined();
	});

	it('removes an empty weight entirely rather than publishing an empty object', () => {
		const published = selectPublishedProjects([record({ id: 'empty', weight: {} })], TODAY);
		expect(published[0]?.weight).toBeUndefined();
	});

	it('labels the three sources', () => {
		expect(SOURCE_LABELS).toEqual({ handwritten: '手書き', git: 'git', github: 'GitHub' });
	});
});

describe('orderProjects', () => {
	it('sorts by level, then last update, then start, then name', () => {
		const ordered = orderProjects([
			record({
				id: 'p',
				name: 'Paused late',
				weight: { level: fact('paused' as const) },
				updatedOn: fact('2026-10-31', 'git'),
			}),
			record({
				id: 'a-early',
				name: 'Active early',
				weight: { level: fact('active' as const) },
				startedOn: fact('2026-01-01', 'git'),
				updatedOn: fact('2026-10-20', 'git'),
			}),
			record({
				id: 'a-late',
				name: 'Active late',
				weight: { level: fact('active' as const) },
				startedOn: fact('2025-01-01', 'git'),
				updatedOn: fact('2026-10-31', 'git'),
			}),
			record({
				id: 'a-same',
				name: 'Active same',
				weight: { level: fact('active' as const) },
				startedOn: fact('2024-01-01', 'git'),
				updatedOn: fact('2026-10-31', 'git'),
			}),
			record({ id: 'm', name: 'Primary', weight: { level: fact('primary' as const) } }),
			record({ id: 'none', name: 'No level' }),
		]);
		expect(ordered.map((entry) => entry.id)).toEqual([
			'm',
			'a-late',
			'a-same',
			'a-early',
			'p',
			'none',
		]);
	});

	it('sorts unlevelled records by last update and puts undated ones last', () => {
		const ordered = orderProjects([
			record({ id: 'undated', name: 'A' }),
			dated('old', '2026-09-11', '2026-09-12'),
			dated('new', '2026-09-11', '2026-10-30'),
			record({ id: 'undated-b', name: 'B' }),
		]);
		expect(ordered.map((entry) => entry.id)).toEqual(['new', 'old', 'undated', 'undated-b']);
	});

	it('has no cap — every record is published', () => {
		const many = Array.from({ length: 30 }, (_unused, index) => record({ id: `p${index}` }));
		expect(selectPublishedProjects(many, TODAY)).toHaveLength(30);
	});
});

describe('groupByWeight', () => {
	it('groups in the fixed level order and skips empty levels', () => {
		const groups = groupByWeight([
			record({ id: 'side', weight: { level: fact('side' as const) } }),
			record({ id: 'primary', weight: { level: fact('primary' as const) } }),
		]);
		expect(groups?.map((group) => group.level)).toEqual(['primary', 'side']);
		expect(groups?.[0]?.records.map((entry) => entry.id)).toEqual(['primary']);
	});

	it('returns null when ANY record has no level', () => {
		// Grouping would imply the ungrouped record has no weight, which
		// the record does not say.
		expect(
			groupByWeight([
				record({ id: 'levelled', weight: { level: fact('primary' as const) } }),
				record({ id: 'bare' }),
			]),
		).toBeNull();
	});

	it('returns null for an empty list', () => {
		expect(groupByWeight([])).toBeNull();
	});

	it('exposes the four levels in reading order', () => {
		expect(WEIGHT_LEVEL_ORDER).toEqual(['primary', 'active', 'side', 'paused']);
		expect(RECENT_UPDATE_WINDOW_DAYS).toBe(30);
	});
});

describe('composeRecords — the source seam', () => {
	const roster = [
		{ id: 'repo', name: 'repo', statusJa: '説明。' },
		{ id: 'outside', name: 'outside', statusJa: '説明。' },
	];

	it('applies sources in order, last wins per fact', () => {
		const first: ReadonlyMap<string, CurrentProjectFacts> = new Map([
			[
				'repo',
				{
					startedOn: fact('2026-01-01', 'handwritten'),
					updatedOn: fact('2026-10-01', 'handwritten'),
				},
			],
		]);
		const second: ReadonlyMap<string, CurrentProjectFacts> = new Map([
			['repo', { startedOn: fact('2026-09-11', 'git') }],
		]);
		const [published] = composeRecords(roster, [first, second], TODAY);
		expect(published?.startedOn).toEqual(fact('2026-09-11', 'git'));
		// The fact the second source did not mention keeps the FIRST
		// source's value AND its provenance.
		expect(published?.updatedOn).toEqual(fact('2026-10-01', 'handwritten'));
	});

	it('ignores a fact for an id the roster does not carry', () => {
		const rogue: ReadonlyMap<string, CurrentProjectFacts> = new Map([
			['not-in-roster', { startedOn: fact('2026-09-11', 'git') }],
		]);
		const published = composeRecords(roster, [rogue], TODAY);
		// The rogue id never becomes a record; both roster ids survive.
		expect(published.map((entry) => entry.id).sort()).toEqual(['outside', 'repo']);
	});

	it('merges a level from one source with an activity from another', () => {
		const level: ReadonlyMap<string, CurrentProjectFacts> = new Map([
			['repo', { weight: { level: fact('primary' as const) } }],
		]);
		const activity: ReadonlyMap<string, CurrentProjectFacts> = new Map([
			['repo', { weight: { activity: fact({ commits: 5, windowDays: 30 }, 'git') } }],
		]);
		const [published] = composeRecords(roster, [level, activity], TODAY);
		expect(published?.weight?.level?.value).toBe('primary');
		expect(published?.weight?.activity?.value.commits).toBe(5);
	});
});
