/**
 * The shipped composition of the current-projects loader (Issue #316).
 *
 * This is the only file that names concrete providers. The page depends on
 * `CurrentProjectsLoader`, the loader depends on `CurrentProjectsSource`, and
 * each provider depends on one committed artefact:
 *
 *   - `roster.ts`        the owner's list and hand-written values;
 *   - `git-facts.json`   this repository's history, produced offline by
 *                        `scripts/sync-home-git-facts.mjs`.
 *
 * Nothing here fetches, reads a binding or looks at a clock: `today` is
 * passed in by the caller. Swapping in a GitHub source later means appending
 * one entry to `FACT_SOURCES` — the component and the page do not change.
 */

import githubActivityJson from '../activity/github-activity.json' with { type: 'json' };
import { activityProjectRecords, readGitHubActivitySnapshot } from '../activity/snapshot';
import gitFactsJson from './git-facts.json' with { type: 'json' };
import type { GitFactsSnapshot } from './providers';
import {
	createGitSnapshotSource,
	createHandwrittenSource,
	gitSnapshotFacts,
	handwrittenFacts,
} from './providers';
import { PROJECT_ROSTER } from './roster';
import { composeRecords, createCurrentProjectsLoader, selectPublishedProjects } from './source';
import type { CurrentProjectRecord } from './types';

/**
 * The committed git snapshot, typed.
 *
 * The JSON import is the artefact itself; the assertion gives it the shape
 * the provider reads, so a regenerated file with a different shape fails at
 * the read rather than silently supplying `undefined` facts.
 */
export const GIT_FACTS = gitFactsJson as GitFactsSnapshot;

/** The owner's hand-written facts, resolved once. */
const HANDWRITTEN = handwrittenFacts(PROJECT_ROSTER);

/** This repository's facts, resolved once. */
const GIT = gitSnapshotFacts(GIT_FACTS);

/**
 * The sources, in application order: LAST WINS per fact.
 *
 * Handwritten first, git second, because a value this repository can
 * reproduce is stronger evidence than one the owner typed — and for a
 * project whose history is NOT here (Tastile, After Effects, the agent work)
 * git has nothing to say, so a handwritten date stays exactly as written,
 * stamped `手書き`.
 */
export const FACT_SOURCES = [
	createHandwrittenSource(PROJECT_ROSTER),
	createGitSnapshotSource(GIT_FACTS),
] as const;

/**
 * GitHub-observed projects (Issues #316 / #932), composed from the
 * committed activity snapshot. An invalid or absent snapshot yields
 * the empty list — the section degrades to roster+git only.
 */
const GITHUB_PROJECTS = (() => {
	const snapshot = readGitHubActivitySnapshot(githubActivityJson);
	return snapshot ? activityProjectRecords(snapshot) : [];
})();

/** The loader the route awaits. */
export const currentProjectsLoader = {
	async loadCurrentProjects(today: string): Promise<readonly CurrentProjectRecord[]> {
		const base = await createCurrentProjectsLoader(
			PROJECT_ROSTER,
			FACT_SOURCES,
		).loadCurrentProjects(today);
		// Auto-selected GitHub projects merge into the SAME published
		// ordering: they carry `github`-stamped facts and compete on the
		// same level/date rules, so a repository the owner also rostered
		// is never duplicated (ids are namespaced `gh-`).
		return selectPublishedProjects([...base, ...GITHUB_PROJECTS], today);
	},
};

/**
 * The published records for a given base date, synchronously.
 *
 * The shipped providers resolve immediately, so a story, a unit test and the
 * capture script can build exactly what a request builds — with the same
 * composition order — without an `await`. The async loader stays the
 * contract the page depends on, because a future provider will need it.
 */
export function currentProjectsFor(today: string): readonly CurrentProjectRecord[] {
	return composeRecords(PROJECT_ROSTER, [HANDWRITTEN, GIT], today);
}
