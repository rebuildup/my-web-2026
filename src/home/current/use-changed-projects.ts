import { useEffect, useState } from 'react';
import type { CurrentProjectRecord, ProjectFact } from './types';

/**
 * "Which rows changed since this browser last rendered the section?"
 * (Issue #316).
 *
 * What is compared
 * ----------------
 * The COMMITTED facts only: `name`, `statusJa`, each date with its source,
 * the level with its source, and the activity value with its source. A row
 * whose stored facts are identical to the last visit's is not "changed",
 * however long ago that visit was.
 *
 * What is deliberately NOT compared
 * ---------------------------------
 * Every derived value: the duration (`1 か月`), the relative day (`今日`),
 * the recent-update count. They change when the calendar moves, not when a
 * record does, and animating them would claim "something just happened"
 * when nothing did (MOTION-DESIGN-current-location.md §0). Including them
 * would also make the marker fire on a page nobody edited — the exact
 * fake-live behaviour the section is built to avoid.
 *
 * Why per-viewer storage
 * ----------------------
 * "Since you last looked" is a per-viewer statement, so its memory is
 * per-viewer: one localStorage key holding `{ [projectId]: signature }`,
 * nothing else. No identifier, no timestamp, no history. The owner
 * approved this store (2026-11-01) and `src/privacy/data-lifecycle.ts`
 * records it; nothing here is sent anywhere.
 *
 * Storage is never allowed to break the page: a read that throws is
 * treated as "no previous visit", and a write that throws (private mode,
 * quota, blocked storage) costs the NEXT visit its comparison, not this
 * one its content.
 */

/**
 * The one key this feature stores.
 *
 * Versioned in the name: if the signature shape changes, the old value must
 * not be compared against the new one, and a version bump is the cheapest
 * way to say that.
 */
export const CHANGE_SIGNATURE_STORAGE_KEY = 'mw_home_current_projects_v1';

/** The answer for a first visit, a failed read, or SSR: nothing changed. */
const NO_CHANGES: ReadonlySet<string> = new Set<string>();

/** A fact's contribution to the signature: its value and where it came from. */
function factSignature<T>(fact: ProjectFact<T> | undefined): string | null {
	if (!fact) return null;
	return `${JSON.stringify(fact.value)}|${fact.source}`;
}

/**
 * One project's signature.
 *
 * The array order is fixed, so the string is stable for equal facts. A
 * change of SOURCE alone (handwritten → git) is a change: the value's
 * claim changed even when the number did not.
 */
export function projectSignature(project: CurrentProjectRecord): string {
	return JSON.stringify([
		project.name,
		project.statusJa,
		factSignature(project.startedOn),
		factSignature(project.updatedOn),
		factSignature(project.weight?.level),
		factSignature(project.weight?.activity),
	]);
}

/** The publication's signature map: `projectId → signature`. */
export function buildSignatures(projects: readonly CurrentProjectRecord[]): Record<string, string> {
	const signatures: Record<string, string> = {};
	for (const project of projects) signatures[project.id] = projectSignature(project);
	return signatures;
}

/**
 * The ids whose signature differs from the stored one.
 *
 * A stored value that is not an object means the key was never written (or
 * was cleared), so nothing is reported as changed — a first visit cannot
 * claim a change it has nothing to compare against. A project absent from
 * the stored map is treated as changed: it appeared, which is a change in
 * the list a reader is looking at.
 */
export function changedProjectIds(previous: unknown, current: Record<string, string>): string[] {
	if (!previous || typeof previous !== 'object') return [];
	const stored = previous as Record<string, unknown>;
	const changed: string[] = [];
	for (const [id, signature] of Object.entries(current)) {
		if (stored[id] !== signature) changed.push(id);
	}
	return changed;
}

/** Read the stored signature map, or `null` when there is none to compare. */
function readStoredSignatures(): unknown {
	try {
		const raw = window.localStorage.getItem(CHANGE_SIGNATURE_STORAGE_KEY);
		return raw === null ? null : JSON.parse(raw);
	} catch {
		return null;
	}
}

function writeStoredSignatures(serialized: string): void {
	try {
		window.localStorage.setItem(CHANGE_SIGNATURE_STORAGE_KEY, serialized);
	} catch {
		// Storage refused (private mode / quota / blocked). The page keeps
		// rendering; only the next visit loses its comparison.
	}
}

/**
 * The ids that changed since the previous visit.
 *
 * Runs after hydration only (`useEffect`), so the server document never
 * carries a marker: SSR cannot know what this browser saw last, and a
 * marker rendered there would animate on every first paint. The effect
 * writes the current signature immediately after comparing, so the same
 * difference is reported once.
 */
export function useChangedProjectIds(
	projects: readonly CurrentProjectRecord[],
): ReadonlySet<string> {
	const serialized = JSON.stringify(buildSignatures(projects));
	const [changed, setChanged] = useState<ReadonlySet<string>>(NO_CHANGES);

	useEffect(() => {
		const current = JSON.parse(serialized) as Record<string, string>;
		const ids = changedProjectIds(readStoredSignatures(), current);
		writeStoredSignatures(serialized);
		setChanged(ids.length === 0 ? NO_CHANGES : new Set(ids));
	}, [serialized]);

	return changed;
}
