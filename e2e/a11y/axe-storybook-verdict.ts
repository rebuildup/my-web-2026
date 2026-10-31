/**
 * Shared verdict logic for the Storybook axe audit (Issue #392).
 *
 * Why this file exists
 * --------------------
 * Two layers read axe-core's output and both have to agree on what a
 * verdict is:
 *
 *   - the browser audit (`e2e/a11y/axe-storybook.spec.ts`) measures a
 *     story and decides whether the release candidate may pass;
 *   - the fast gate (`scripts/check-a11y-axe-storybook.mjs`) replays
 *     RECORDED axe results through the same decision, so the decision
 *     stays reproducible without a browser.
 *
 * If the two carried their own copy of the rule, the gate would be
 * able to pass while the browser audit failed. So the rule lives here,
 * once, and both layers call it.
 *
 * What a verdict means
 * --------------------
 *   pass      the story produced no violation at all.
 *   baseline  every observed violation is RECORDED in the ledger
 *             (`e2e/a11y/axe-storybook-baseline.json`) with a reason —
 *             a known violation that is tolerated on purpose.
 *   fail      at least one observed violation is NOT in the ledger.
 *
 * `fail` is a MEASURED state, never a declaration. The manifest may
 * only declare `pass` or `baseline` (see `axe-storybook-manifest.ts`),
 * so a one-word edit cannot turn a new violation into a green run.
 *
 * Machine-checked vs. human-evaluated
 * -----------------------------------
 * Machine-checked here: whether a rule fires, which rule id it is, and
 * which element fired it. Human-evaluated (NOT decided here): whether
 * the recorded violation may stay recorded, whether the wording of an
 * accessible name is good, and whether the rendered result is
 * acceptable to a reader. `docs/verification/a11y/axe-storybook.md`
 * records who looked at them.
 */

/** The verdict a measurement produces. */
export type MeasuredVerdict = 'pass' | 'baseline' | 'fail';

/** The verdicts a manifest entry may declare. */
export const DECLARABLE_VERDICTS: readonly MeasuredVerdict[] = ['pass', 'baseline'];

/** One element axe reported. */
export interface AxeNode {
	/** The element selector axe produced for the failing node. */
	target: string;
	/** The element's outer HTML (truncated by the browser). */
	html?: string;
	/** axe's own explanation for the node. */
	summary?: string;
}

/** One rule violation axe reported. */
export interface AxeViolation {
	/** The rule id (`id` in axe-core 4.x, `ruleId` in older builds). */
	ruleId: string;
	impact?: string;
	help?: string;
	tags: string[];
	nodes: AxeNode[];
}

/**
 * One tolerated violation.
 *
 * The record names the story, the rule and the exact elements it
 * applies to, plus the reason it is tolerated. A record without a
 * reason is not a decision, it is an omission — the gate rejects it.
 */
export interface BaselineRecord {
	/** The story, as `file#export` (the manifest's key). */
	story: string;
	/** The rule id this record tolerates. */
	ruleId: string;
	/** The normalised selectors the record covers. */
	nodes: string[];
	/** Why the violation is tolerated — never empty. */
	reason: string;
	/** When the record was written (ISO date). */
	recordedAt: string;
}

/** The ledger of tolerated violations. */
export interface BaselineLedger {
	version: number;
	records: BaselineRecord[];
}

/**
 * The key one story is recorded under: `<file>#<export>`.
 *
 * The file and the exported story name are the two facts the SOURCE
 * states, so a key built from them is checkable without a browser —
 * which is what lets the fast gate verify the ledger against the
 * manifest offline.
 */
export function storyKey(file: string, exportName: string): string {
	return `${file}#${exportName}`;
}

/**
 * The name Storybook publishes a story under, derived from the export
 * name (`OneLive` → `One Live`).
 *
 * Storybook derives the display name from the export name with
 * `startCase`, and the audit has to recognise the same string to
 * resolve a story id. A story may also publish an explicit `name`, in
 * which case the manifest states that name instead — the resolution
 * falls back to the story id, so an explicit name never breaks the
 * audit.
 */
export function storyNameFromExport(exportName: string): string {
	return exportName
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter((word) => word.length > 0)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
}

/**
 * The id suffix Storybook derives from the export name
 * (`OneLive` → `one-live`).
 *
 * It is the fallback the id resolution uses when a story publishes an
 * explicit display name, so the resolution never depends on one
 * naming convention alone.
 */
export function storyIdSuffix(exportName: string): string {
	return storyNameFromExport(exportName)
		.split(' ')
		.map((word) => word.toLowerCase())
		.join('-');
}

/** One entry of Storybook's published story index. */
export interface StoryIndexEntry {
	type: string;
	id: string;
	name: string;
	title: string;
	importPath: string;
}

/** Storybook's published story index. */
export interface StoryIndex {
	entries: Record<string, StoryIndexEntry>;
}

/**
 * The entry the manifest's file and export name resolve to.
 *
 * The resolution has two steps, because Storybook publishes the story
 * name in two ways: derived from the export name (`OneLive` →
 * `One Live`) or declared by the story itself (`name: '01 fresh — …'`).
 * The first step matches the published name, the second matches the id
 * suffix. A file and export name that resolve to more than one entry,
 * or to none at all, is an error — never a guess.
 */
export function resolveStoryEntry(
	index: StoryIndex,
	file: string,
	exportName: string,
): StoryIndexEntry {
	const candidates = Object.values(index.entries).filter(
		(entry) => entry.type === 'story' && entry.importPath.replace(/^\.\//, '') === file,
	);
	const byName = candidates.filter((entry) => entry.name === storyNameFromExport(exportName));
	if (byName.length === 1) return byName[0];
	const byId = candidates.filter((entry) => entry.id.endsWith(`--${storyIdSuffix(exportName)}`));
	if (byId.length === 1) return byId[0];
	throw new Error(
		`the story ${storyKey(file, exportName)} does not resolve to exactly one Storybook entry ` +
			`(${byName.length} match the name, ${byId.length} match the id suffix)`,
	);
}

/**
 * Normalise a selector so a generated id cannot break the match.
 *
 * React's `useId` produces ids like `_R_4b6_-platform-macos`, which
 * differ between builds. The ledger has to survive a rebuild, so the
 * generated part is replaced by a placeholder before the selector is
 * compared. Everything else — tag, class, structure — is kept, so a
 * new element of the same shape is still a new violation.
 */
export function normalizeSelector(selector: string): string {
	return selector
		.replace(/_R_[A-Za-z0-9]+_/g, '«id»')
		.replace(/«[^»]*»/g, '«id»')
		.replace(/:r[0-9a-z]+:/g, '«id»:');
}

/** The nodes of one observed violation, normalised for ledger matching. */
export function observedNodes(violation: AxeViolation): string[] {
	return violation.nodes.map((node) => normalizeSelector(node.target));
}

/**
 * Which observed violations the ledger already records.
 *
 * A violation node is "known" when a ledger record for the same story
 * and the same rule lists the same normalised selector.
 */
export function matchBaseline(
	violation: AxeViolation,
	story: string,
	records: BaselineRecord[],
): { known: string[]; unknown: string[] } {
	const known: string[] = [];
	const unknown: string[] = [];
	for (const node of observedNodes(violation)) {
		const matched = records.some(
			(record) =>
				record.story === story && record.ruleId === violation.ruleId && record.nodes.includes(node),
		);
		if (matched) known.push(node);
		else unknown.push(node);
	}
	return { known, unknown };
}

/** The ledger records that belong to one story. */
export function recordsForStory(story: string, records: BaselineRecord[]): BaselineRecord[] {
	return records.filter((record) => record.story === story);
}

/**
 * The verdict a story's measurement produces.
 *
 * `fail` when at least one observed node is not in the ledger, else
 * `baseline` when the story has violations at all, else `pass`.
 */
export function verdictFor(
	violations: AxeViolation[],
	story: string,
	records: BaselineRecord[],
): MeasuredVerdict {
	const unknown = violations.flatMap(
		(violation) => matchBaseline(violation, story, records).unknown,
	);
	if (unknown.length > 0) return 'fail';
	return violations.length > 0 ? 'baseline' : 'pass';
}

/** The observed nodes the ledger does not record, as readable lines. */
export function newViolationLines(
	violations: AxeViolation[],
	story: string,
	records: BaselineRecord[],
): string[] {
	return violations.flatMap((violation) =>
		matchBaseline(violation, story, records).unknown.map((node) => `${violation.ruleId} @ ${node}`),
	);
}

/** The rule ids the measurement reported, in the order they were reported. */
export function reportedRuleIds(violations: AxeViolation[]): string[] {
	const ids: string[] = [];
	for (const violation of violations) {
		if (!ids.includes(violation.ruleId)) ids.push(violation.ruleId);
	}
	return ids;
}

/** Ledger records that no observed violation supports any more. */
export function staleRecords(
	violations: AxeViolation[],
	story: string,
	records: BaselineRecord[],
): BaselineRecord[] {
	const observed = new Set<string>();
	for (const violation of violations) {
		for (const node of observedNodes(violation)) {
			observed.add(`${violation.ruleId}::${node}`);
		}
	}
	return recordsForStory(story, records).filter(
		(record) =>
			!record.nodes.some((node) => observed.has(`${record.ruleId}::${normalizeSelector(node)}`)),
	);
}
