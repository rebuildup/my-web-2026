/**
 * The two shipped fact sources for the current-projects section
 * (Issue #316).
 *
 * Both are OFFLINE. Neither reads a binding, calls a network and reads a
 * clock: the handwritten source reads the owner's file, the git source
 * reads a committed snapshot that `scripts/sync-home-git-facts.mjs`
 * produced. That is the whole point of the seam — a future GitHub source
 * implements the same interface over its own committed snapshot, so adding
 * it never turns a page render into an outbound request.
 */

import type {
	CurrentProjectFacts,
	CurrentProjectsSource,
	ProjectFactSource,
	RosterEntry,
} from './types';

/**
 * One project's record inside the generated git snapshot.
 *
 * The shape mirrors what `git log` can answer without a network: when the
 * first commit of this project landed, when the last one did, and how many
 * commits fall inside the counting window.
 */
export interface GitSnapshotProject {
	readonly firstCommit: { readonly sha: string; readonly date: string };
	readonly lastCommit: { readonly sha: string; readonly date: string };
	readonly commits: { readonly recent: number; readonly total: number };
}

/**
 * `src/home/current/git-facts.json` — generated, committed, reviewed like
 * any other source file.
 *
 * The snapshot is a build artefact of `scripts/sync-home-git-facts.mjs` and
 * is committed on purpose: a page load must not run `git`, and a value that
 * changes without a commit cannot be reviewed. `generatedOn` is the day the
 * snapshot was produced (the `observedOn` of every fact it supplies), and
 * `headSha` is the commit it was produced at — the evidence a reader would
 * need to re-derive it.
 */
export interface GitFactsSnapshot {
	readonly schemaVersion: number;
	readonly generatedOn: string;
	readonly headSha: string;
	readonly commitsTotal: number;
	/** The window `commits.recent` was counted over, in days. */
	readonly windowDays: number;
	readonly projects: Readonly<Record<string, GitSnapshotProject>>;
}

/** The label a fact carries for each source. Re-exported for convenience. */
export type { ProjectFactSource };

/**
 * The owner's handwritten values, as a source.
 *
 * Reading rules — both fail closed:
 *
 *   - a date pair is published only when BOTH dates are written. A single
 *     date cannot produce a duration, and inventing the other one would be
 *     a fabricated measurement;
 *   - a level is published on its own (a level needs no date).
 *
 * An entry with nothing written contributes nothing, so its facts are
 * simply absent from the document rather than shown as an empty or
 * "未記入" row.
 */
export function handwrittenFacts(
	roster: readonly RosterEntry[],
): ReadonlyMap<string, CurrentProjectFacts> {
	const byId = new Map<string, CurrentProjectFacts>();
	for (const entry of roster) {
		const written = entry.handwritten;
		if (!written) continue;
		const observedOn = written.recordedOn;
		const facts: {
			startedOn?: CurrentProjectFacts['startedOn'];
			updatedOn?: CurrentProjectFacts['updatedOn'];
			weight?: CurrentProjectFacts['weight'];
		} = {};
		if (written.startedOn && written.updatedOn) {
			facts.startedOn = { value: written.startedOn, source: 'handwritten', observedOn };
			facts.updatedOn = { value: written.updatedOn, source: 'handwritten', observedOn };
		}
		if (written.weightLevel) {
			facts.weight = {
				level: { value: written.weightLevel, source: 'handwritten', observedOn },
			};
		}
		if (facts.startedOn || facts.weight) byId.set(entry.id, facts);
	}
	return byId;
}

/** The owner's handwritten values as a source. */
export function createHandwrittenSource(roster: readonly RosterEntry[]): CurrentProjectsSource {
	const byId = handwrittenFacts(roster);
	return {
		source: 'handwritten',
		async load(ids: readonly string[]): Promise<ReadonlyMap<string, CurrentProjectFacts>> {
			const selected = new Map<string, CurrentProjectFacts>();
			for (const id of ids) {
				const facts = byId.get(id);
				if (facts) selected.set(id, facts);
			}
			return selected;
		},
	};
}

/**
 * This repository's history, as a source.
 *
 * Every fact is stamped `git` and carries the commit it was derived from,
 * so a reader (and the verification report) can tell a reproducible value
 * from a remembered one. The activity fact's evidence names both the
 * generator and the snapshot commit, because the count is produced by the
 * script, not by the commit itself.
 */
export function gitSnapshotFacts(
	snapshot: GitFactsSnapshot,
): ReadonlyMap<string, CurrentProjectFacts> {
	const facts = new Map<string, CurrentProjectFacts>();
	for (const [id, project] of Object.entries(snapshot.projects)) {
		facts.set(id, {
			startedOn: {
				value: project.firstCommit.date,
				source: 'git',
				observedOn: snapshot.generatedOn,
				evidence: project.firstCommit.sha,
			},
			updatedOn: {
				value: project.lastCommit.date,
				source: 'git',
				observedOn: snapshot.generatedOn,
				evidence: project.lastCommit.sha,
			},
			weight: {
				activity: {
					value: {
						commits: project.commits.recent,
						windowDays: snapshot.windowDays,
						commitsTotal: project.commits.total,
					},
					source: 'git',
					observedOn: snapshot.generatedOn,
					evidence: `scripts/sync-home-git-facts.mjs @ ${snapshot.headSha}`,
				},
			},
		});
	}
	return facts;
}

/** This repository's history, as a source. */
export function createGitSnapshotSource(snapshot: GitFactsSnapshot): CurrentProjectsSource {
	const byId = gitSnapshotFacts(snapshot);
	return {
		source: 'git',
		async load(ids: readonly string[]): Promise<ReadonlyMap<string, CurrentProjectFacts>> {
			const selected = new Map<string, CurrentProjectFacts>();
			for (const id of ids) {
				const facts = byId.get(id);
				if (facts) selected.set(id, facts);
			}
			return selected;
		},
	};
}
