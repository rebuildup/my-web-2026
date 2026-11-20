import type { ActivityTimelineItem } from './contract';

/**
 * Timeline assembly — merge per-source item lists into the
 * date-descending read model (Issue #352).
 *
 * Pure function: no clock, no fetch, no owner import. The caller
 * supplies `generatedAt` (the assembly instant) and the per-source
 * health lines; this module owns ONLY the ordering contract:
 *
 *   - descending by `Date.parse(at)` — newest first;
 *   - an item whose `at` does not parse sorts LAST (`-Infinity`),
 *     never dropped silently and never promoted by a NaN comparison;
 *   - ties break on `id` ascending so the order is total and
 *     deterministic for a given input set.
 *
 * Deduplication is deliberately absent: two sources reporting the
 * same real-world event are two claims with two sources, and the
 * 出典 column exists precisely to keep them distinguishable. If a
 * future source double-reports, that is a source-contract bug to fix
 * at the adapter, not something the merge may paper over.
 */
export function sortActivityTimelineItems(
	items: readonly ActivityTimelineItem[],
): readonly ActivityTimelineItem[] {
	const time = (item: ActivityTimelineItem): number => {
		const parsed = Date.parse(item.at);
		return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
	};
	return [...items].sort((a, b) => {
		const byTime = time(b) - time(a);
		if (byTime !== 0) return byTime;
		if (a.id === b.id) return 0;
		return a.id < b.id ? -1 : 1;
	});
}
