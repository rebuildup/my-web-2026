/**
 * Current projects — the publication contract (Issue #316).
 *
 * What this module owns
 * ---------------------
 *   1. The vocabulary the section publishes: the four weight levels, the
 *      three source labels, the recent-update window.
 *   2. The link rule (`isPublishableHref`).
 *   3. The STRUCTURE GATE (`selectPublishedProjects`) — what may be
 *      published, and what is dropped instead.
 *   4. The deterministic order and the weight grouping.
 *   5. The loader that composes roster + sources (`createCurrentProjectsLoader`).
 *
 * It is pure: no fetch, no clock, no environment, no binding. The base
 * date is passed in, so the same record set renders identically on the
 * server, in a test and in a preview.
 *
 * What the structure gate guarantees — and what it does not
 * --------------------------------------------------------
 * The owner writes dates by hand; a hand-written date cannot be verified
 * by a program. The gate therefore checks only what a program CAN check:
 *
 *   - both dates are present or neither is (an entry with only one is
 *     dropped, because a duration needs both);
 *   - each is a real `YYYY-MM-DD` calendar day;
 *   - `startedOn <= updatedOn`;
 *   - neither is in the future relative to the base date, and the
 *     `observedOn` of every fact is not in the future either;
 *   - `source` is one of the three published values, and a weight level is
 *     one of the four published values;
 *   - an activity window is a non-negative integer over at least one day.
 *
 * It does NOT guarantee that the date is TRUE — that the owner actually
 * started on that day, or that the project is still running. A green gate
 * is not a fact-check, and the section says so by tagging every measured
 * value with its source (`手書き` is not `git`).
 */

import { compareIsoDates, isValidIsoDate } from './derive';
import type {
	CurrentProjectFacts,
	CurrentProjectLink,
	CurrentProjectRecord,
	CurrentProjectsLoader,
	CurrentProjectsSource,
	ProjectFact,
	ProjectFactSource,
	ProjectWeight,
	ProjectWeightLevel,
	RosterEntry,
} from './types';

/** Level order, most weighted first. Fixed — this is the reading order. */
export const WEIGHT_LEVEL_ORDER: readonly ProjectWeightLevel[] = [
	'primary',
	'active',
	'side',
	'paused',
];

/** The Japanese word for each level. The only place the words are spelled. */
export const WEIGHT_LEVEL_LABELS: Readonly<Record<ProjectWeightLevel, string>> = {
	primary: '主軸',
	active: '並行',
	side: '副次',
	paused: '休止',
};

/**
 * The provenance tag printed next to a measured value.
 *
 * The three spellings are fixed on purpose: `git` stays lower-case (it is
 * the command name) and `GitHub` keeps its brand casing, so a reader can
 * tell a local measurement from a remote one at a glance.
 */
export const SOURCE_LABELS: Readonly<Record<ProjectFactSource, string>> = {
	handwritten: '手書き',
	git: 'git',
	github: 'GitHub',
};

/**
 * The window the section counts "recent" updates over.
 *
 * One month: long enough that a project worked on this month is not
 * reported as stopped, short enough that "動いている" means something. The
 * section prints the window explicitly (`直近 30 日`) so the number never
 * appears without it.
 */
export const RECENT_UPDATE_WINDOW_DAYS = 30;

/**
 * Whether a href may be published.
 *
 * Fail-closed: only an internal path (`/…`, but not the protocol-relative
 * `//…`) or an `https://` URL passes. `http:`, `javascript:`, `data:` and a
 * relative path are all refused. A backslash is refused too, because a
 * browser normalises `/\host` into a protocol-relative URL — the same
 * hazard as `//host`, written differently.
 */
export function isPublishableHref(href: string): boolean {
	const value = href.trim();
	if (value.includes('\\')) return false;
	if (value.startsWith('https://')) return true;
	if (!value.startsWith('/')) return false;
	return !value.startsWith('//');
}

/**
 * The link of an entry, or `undefined` when it may not be published.
 *
 * A missing / unusable label and an unusable href both remove the LINK.
 * The entry itself survives: the project is real even when the way to
 * reach it is unknown.
 */
export function selectPublishableLink(
	link: CurrentProjectLink | undefined,
): CurrentProjectLink | undefined {
	if (!link) return undefined;
	const label = link.label.trim();
	if (label.length === 0) return undefined;
	if (!isPublishableHref(link.href)) return undefined;
	return { label, href: link.href.trim() };
}

/** A fact whose `observedOn` is a real day no later than the base date. */
function isObservedInTime(fact: ProjectFact<unknown>, today: string): boolean {
	return isValidIsoDate(fact.observedOn) && compareIsoDates(fact.observedOn, today) <= 0;
}

/** A date fact: a real day, not in the future, observed no later than the base date. */
function isPublishableDateFact(fact: ProjectFact<string>, today: string): boolean {
	return (
		isValidIsoDate(fact.value) &&
		compareIsoDates(fact.value, today) <= 0 &&
		isObservedInTime(fact, today)
	);
}

function isPublishableActivityFact(
	fact: ProjectFact<{ commits: number; windowDays: number; commitsTotal?: number }>,
	today: string,
): boolean {
	const { commits, windowDays, commitsTotal } = fact.value;
	if (!Number.isInteger(commits) || commits < 0) return false;
	if (!Number.isInteger(windowDays) || windowDays < 1) return false;
	if (commitsTotal !== undefined && (!Number.isInteger(commitsTotal) || commitsTotal < 0)) {
		return false;
	}
	return isObservedInTime(fact, today);
}

function isPublishableLevelFact(fact: ProjectFact<ProjectWeightLevel>, today: string): boolean {
	return WEIGHT_LEVEL_ORDER.includes(fact.value) && isObservedInTime(fact, today);
}

/**
 * The publishable half of a weight, or `undefined` when nothing in it
 * survives. A level the owner has not written, and an activity a source
 * cannot measure, are both simply absent — never defaulted.
 */
function selectWeight(weight: ProjectWeight | undefined, today: string): ProjectWeight | undefined {
	if (!weight) return undefined;
	const level =
		weight.level && isPublishableLevelFact(weight.level, today) ? weight.level : undefined;
	const activity =
		weight.activity && isPublishableActivityFact(weight.activity, today)
			? weight.activity
			: undefined;
	if (!level && !activity) return undefined;
	return { ...(level ? { level } : {}), ...(activity ? { activity } : {}) };
}

/**
 * The published records, in the published order.
 *
 * Fail-closed: an entry that fails the structure gate is DROPPED, never
 * rendered half-broken and never patched up with a guessed date. The
 * section then shows one project fewer; a reader can tell that from an
 * empty section, which prints its own sentence.
 */
export function selectPublishedProjects(
	records: readonly CurrentProjectRecord[],
	today: string,
): CurrentProjectRecord[] {
	if (!isValidIsoDate(today)) return [];
	const seen = new Set<string>();
	const published: CurrentProjectRecord[] = [];
	for (const record of records) {
		const id = record.id.trim();
		const name = record.name.trim();
		const statusJa = record.statusJa.trim();
		if (id.length === 0 || name.length === 0 || statusJa.length === 0) continue;
		if (seen.has(id)) continue;

		const startedOn = record.startedOn;
		const updatedOn = record.updatedOn;
		// Both dates or neither: a duration needs a start and an end, and a
		// lone date would be rendered as if it were the whole story.
		if (Boolean(startedOn) !== Boolean(updatedOn)) continue;
		if (startedOn && updatedOn) {
			if (!isPublishableDateFact(startedOn, today)) continue;
			if (!isPublishableDateFact(updatedOn, today)) continue;
			// The start can never follow the last update.
			if (compareIsoDates(startedOn.value, updatedOn.value) > 0) continue;
		}

		const weight = selectWeight(record.weight, today);
		const link = selectPublishableLink(record.link);
		seen.add(id);
		published.push({
			id,
			name,
			statusJa,
			...(startedOn && updatedOn ? { startedOn, updatedOn } : {}),
			...(weight ? { weight } : {}),
			...(link ? { link } : {}),
		});
	}
	return orderProjects(published);
}

/** Rank of a record's level; an unwritten level sorts after every written one. */
function levelRank(record: CurrentProjectRecord): number {
	const level = record.weight?.level?.value;
	if (!level) return WEIGHT_LEVEL_ORDER.length;
	return WEIGHT_LEVEL_ORDER.indexOf(level);
}

/** Descending comparison of two optional dates; an absent date sorts last. */
function compareDatesDescending(a: string | undefined, b: string | undefined): number {
	if (a === undefined && b === undefined) return 0;
	if (a === undefined) return 1;
	if (b === undefined) return -1;
	return -compareIsoDates(a, b);
}

/**
 * The published order: level → last update (newest first) → start (newest
 * first) → name (code point).
 *
 * A comparator rather than a stored order, so the rule does not change
 * when the list grows: 3 records and 30 records sort by the same rule.
 * There is deliberately no manual ordering — an authored sequence would
 * stop being count-independent.
 */
export function orderProjects(records: readonly CurrentProjectRecord[]): CurrentProjectRecord[] {
	return [...records].sort((a, b) => {
		const byLevel = levelRank(a) - levelRank(b);
		if (byLevel !== 0) return byLevel;
		const byUpdate = compareDatesDescending(a.updatedOn?.value, b.updatedOn?.value);
		if (byUpdate !== 0) return byUpdate;
		const byStart = compareDatesDescending(a.startedOn?.value, b.startedOn?.value);
		if (byStart !== 0) return byStart;
		if (a.name === b.name) return 0;
		return a.name < b.name ? -1 : 1;
	});
}

/** One level's heading and the records under it. */
export interface ProjectGroup {
	readonly level: ProjectWeightLevel;
	readonly label: string;
	readonly records: readonly CurrentProjectRecord[];
}

/**
 * Group the published records by weight level, or `null` when grouping
 * would misrepresent the list.
 *
 * Grouping is ALL-OR-NOTHING: if any published record has no level, the
 * section renders a flat list instead. A list where some records sit under
 * a heading and others sit under none would imply the ungrouped ones have
 * no weight, which is a claim the records do not make. Empty levels are
 * not rendered either — a heading with no rows would imply a project is
 * paused at that level.
 */
export function groupByWeight(records: readonly CurrentProjectRecord[]): ProjectGroup[] | null {
	if (records.length === 0) return null;
	if (!records.every((record) => record.weight?.level)) return null;
	const groups: ProjectGroup[] = [];
	for (const level of WEIGHT_LEVEL_ORDER) {
		const members = records.filter((record) => record.weight?.level?.value === level);
		if (members.length === 0) continue;
		groups.push({ level, label: WEIGHT_LEVEL_LABELS[level], records: members });
	}
	return groups;
}

/**
 * Apply one source's facts on top of a record.
 *
 * Last-wins per fact: the record keeps every fact the source does not
 * mention, including that fact's ORIGINAL source. Provenance is never
 * rewritten — a git snapshot that fills `startedOn` leaves a handwritten
 * `updatedOn` stamped `handwritten`, and the document shows exactly that.
 */
function applyFacts(
	record: CurrentProjectRecord,
	facts: CurrentProjectFacts,
): CurrentProjectRecord {
	const weight: ProjectWeight | undefined =
		record.weight || facts.weight
			? {
					...(record.weight?.level ? { level: record.weight.level } : {}),
					...(record.weight?.activity ? { activity: record.weight.activity } : {}),
					...(facts.weight?.level ? { level: facts.weight.level } : {}),
					...(facts.weight?.activity ? { activity: facts.weight.activity } : {}),
				}
			: undefined;
	return {
		...record,
		...(facts.startedOn ? { startedOn: facts.startedOn } : {}),
		...(facts.updatedOn ? { updatedOn: facts.updatedOn } : {}),
		...(weight ? { weight } : {}),
	};
}

/**
 * Compose the roster with a set of fact maps, then publish.
 *
 * The roster is the starting point and the ONLY source of ids: a provider
 * that returns facts for an id the roster does not carry is ignored, so a
 * future GitHub integration cannot grow the section by listing what it can
 * see. Fact maps are applied in the order given (last wins per fact).
 *
 * Pure and synchronous, so a story, a test and the capture script can build
 * the same records the loader builds without awaiting anything — the async
 * shape exists only because a future provider will need it.
 */
export function composeRecords(
	roster: readonly RosterEntry[],
	factSets: readonly ReadonlyMap<string, CurrentProjectFacts>[],
	today: string,
): readonly CurrentProjectRecord[] {
	const records = roster.map((entry) => {
		let record: CurrentProjectRecord = {
			id: entry.id,
			name: entry.name,
			statusJa: entry.statusJa,
			...(entry.link ? { link: entry.link } : {}),
		};
		for (const facts of factSets) {
			const supplied = facts.get(entry.id);
			if (supplied) record = applyFacts(record, supplied);
		}
		return record;
	});
	return selectPublishedProjects(records, today);
}

/**
 * The loader the page depends on: roster + sources → published records.
 *
 * `today` is the caller's, never a clock read inside this function, so the
 * same inputs always produce the same document.
 */
export function createCurrentProjectsLoader(
	roster: readonly RosterEntry[],
	sources: readonly CurrentProjectsSource[],
): CurrentProjectsLoader {
	return {
		async loadCurrentProjects(today: string): Promise<readonly CurrentProjectRecord[]> {
			const ids = roster.map((entry) => entry.id.trim()).filter((id) => id.length > 0);
			const factSets = await Promise.all(sources.map((source) => source.load(ids)));
			return composeRecords(roster, factSets, today);
		},
	};
}
