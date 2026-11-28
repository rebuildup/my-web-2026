import { GITHUB_PROJECT_ID_PREFIX } from '../../home/activity/snapshot';
import { WEIGHT_LEVEL_LABELS } from '../../home/current/source';
import type { CurrentProjectRecord, ProjectWeightLevel } from '../../home/current/types';
import type { PortfolioMedia } from '../../portfolio/schema';

/**
 * `/now` focus band — the editorial "what matters now" selection
 * (Issue #1316).
 *
 * The enumeration below the band answers "what is published"; this
 * module answers "what is the owner actually pointing at". The
 * selection rule is DERIVED, not hand-picked: a named record
 * (never a `gh-` observed row — those are measurements, not
 * declarations) whose owner-written weight level is `primary` or
 * `active` is in focus. The roster already records that judgement
 * (`weightLevel` in `src/home/current/roster.ts`), so the band cannot
 * drift from it: change the level and the band follows.
 *
 * Visual evidence is a separate, committed decision: a record shows
 * its portfolio cover only when `NOW_FOCUS_PORTFOLIO_SLUGS` names a
 * published case study for it. A record without a mapping renders a
 * typographic plate — the band never borrows an unrelated cover to
 * look complete, and a slug that stops resolving simply drops the
 * image (the loader resolves fail-soft).
 */

/** Weight levels that count as "in focus". Fixed order is irrelevant — the published order wins. */
const FOCUS_LEVELS: readonly ProjectWeightLevel[] = ['primary', 'active'];

/** At most this many records take the band; the enumeration keeps the rest reachable. */
export const NOW_FOCUS_LIMIT = 3;

/**
 * record id → published portfolio slug whose cover may illustrate the
 * record. Keys are roster ids; values are `/portfolio/<slug>` slugs.
 * An entry is a CLAIM that the case study is the same work the
 * record names — remove it when that stops being true.
 *
 *   - `my-web-2026` → `my-web-2026`: the platform is its own case
 *     study (the cover is the published top page).
 *   - `after-effects` → `ae-devtools`: the roster's "After Effects"
 *     project is the script/plugin/extension work, and `ae-devtools`
 *     is the published development foundation for exactly that.
 *     Owner confirmation pending — flagged in the Issue #1316 PR.
 */
export const NOW_FOCUS_PORTFOLIO_SLUGS: Readonly<Record<string, string>> = {
	'my-web-2026': 'my-web-2026',
	'after-effects': 'ae-devtools',
};

/** One focus-band entry: the published record plus its resolved evidence. */
export interface NowFocusItem {
	readonly record: CurrentProjectRecord;
	/**
	 * The portfolio cover for the mapped slug, or `null` when the
	 * record has no mapping, the slug did not resolve, or the project
	 * carries no servable media. `null` renders the typographic plate.
	 */
	readonly cover: {
		readonly slug: string;
		readonly title: string;
		readonly media: PortfolioMedia | null;
	} | null;
}

function isGithubObserved(record: CurrentProjectRecord): boolean {
	return record.id.startsWith(GITHUB_PROJECT_ID_PREFIX);
}

function focusLevel(record: CurrentProjectRecord): ProjectWeightLevel | null {
	const level = record.weight?.level?.value;
	return level !== undefined && FOCUS_LEVELS.includes(level) ? level : null;
}

/**
 * The focus selection for a published record set.
 *
 * Input must already be the PUBLISHED list (`selectPublishedProjects`
 * output) so ordering, dedup and the structure gate have run — this
 * function only partitions, it never re-validates.
 */
export function selectNowFocus(
	projects: readonly CurrentProjectRecord[],
): readonly CurrentProjectRecord[] {
	return projects
		.filter((record) => !isGithubObserved(record) && focusLevel(record) !== null)
		.slice(0, NOW_FOCUS_LIMIT);
}

/** The Japanese label of a record's focus level, for the band's meta line. */
export function nowFocusLevelLabel(record: CurrentProjectRecord): string | null {
	const level = record.weight?.level?.value;
	return level === undefined ? null : WEIGHT_LEVEL_LABELS[level];
}
