import { describe, expect, it } from 'vitest';
import type { ActivityTimelineItem } from './contract';
import { sortActivityTimelineItems } from './merge';

function item(id: string, at: string): ActivityTimelineItem {
	return { id, kind: 'work', source: 'portfolio', title: id, at };
}

describe('sortActivityTimelineItems', () => {
	it('sorts items by date descending', () => {
		const sorted = sortActivityTimelineItems([
			item('old', '2026-01-01T00:00:00.000Z'),
			item('new', '2026-11-01T00:00:00.000Z'),
			item('mid', '2026-06-01T00:00:00.000Z'),
		]);
		expect(sorted.map((i) => i.id)).toEqual(['new', 'mid', 'old']);
	});

	it('breaks timestamp ties on id ascending for a total order', () => {
		const at = '2026-11-01T00:00:00.000Z';
		const sorted = sortActivityTimelineItems([item('b', at), item('a', at), item('c', at)]);
		expect(sorted.map((i) => i.id)).toEqual(['a', 'b', 'c']);
	});

	it('sorts an unparseable date last instead of dropping or promoting it', () => {
		const sorted = sortActivityTimelineItems([
			item('bad', 'not-a-date'),
			item('good', '2026-01-01T00:00:00.000Z'),
		]);
		expect(sorted.map((i) => i.id)).toEqual(['good', 'bad']);
	});

	it('does not mutate the input array', () => {
		const input = [item('a', '2026-01-01T00:00:00.000Z'), item('b', '2026-02-01T00:00:00.000Z')];
		const snapshot = [...input];
		sortActivityTimelineItems(input);
		expect(input).toEqual(snapshot);
	});
});
