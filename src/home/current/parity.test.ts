import { describe, expect, it } from 'vitest';
import githubActivityJson from '../activity/github-activity.json' with { type: 'json' };
import { activityProjectRecords, readGitHubActivitySnapshot } from '../activity/snapshot';
import { currentProjectsFor, currentProjectsLoader } from './loader';
import type { CurrentProjectRecord, ProjectFact } from './types';

/**
 * Preview / route record-set parity (Issue #510).
 *
 * The `/stack` component-integration example claims the `Shipped`
 * story and the `/` route share one composition path. They do — up to
 * one deliberate difference: the route additionally merges the
 * GitHub-observed projects (`gh-*` ids) projected from the activity
 * snapshot, while `currentProjectsFor` composes roster + handwritten +
 * git only. This test pins the honest relationship instead of
 * asserting an equality that cannot hold:
 *
 *   - every roster-derived record the route publishes is identical
 *     (after the server function's public projection, which strips
 *     `ProjectFact#evidence`) to the record the story renders, in the
 *     same relative order;
 *   - every record the route adds on top is a `gh-*` id whose measured
 *     facts are all stamped `github`;
 *   - no roster id is dropped or duplicated by the merge.
 *
 * The live-D1 variant of the snapshot is covered by
 * `src/home/activity/live.test.ts` (`selectActivitySnapshot` picks the
 * fresher valid document); this test pins the committed-artefact path,
 * which is also the floor every environment falls back to.
 */
const TODAY = new Date().toISOString().slice(0, 10);

/** Mirror of `toPublicRecord` in `load.ts`: the boundary strips `evidence`. */
function publicView(record: CurrentProjectRecord): CurrentProjectRecord {
	const strip = <T>(fact: ProjectFact<T> | undefined): ProjectFact<T> | undefined =>
		fact === undefined
			? undefined
			: { value: fact.value, source: fact.source, observedOn: fact.observedOn };
	return {
		...record,
		startedOn: strip(record.startedOn),
		updatedOn: strip(record.updatedOn),
		weight:
			record.weight === undefined
				? undefined
				: {
						...record.weight,
						activity: strip(record.weight.activity),
						level: strip(record.weight.level),
					},
	};
}

function allFactSources(record: CurrentProjectRecord): string[] {
	const sources: string[] = [];
	const facts = [record.startedOn, record.updatedOn, record.weight?.level, record.weight?.activity];
	for (const fact of facts) {
		if (fact) sources.push(fact.source);
	}
	return sources;
}

describe('current-projects preview / route parity', () => {
	it('publishes every roster record identically to the story composition', async () => {
		const preview = currentProjectsFor(TODAY).map(publicView);
		const snapshot = readGitHubActivitySnapshot(githubActivityJson);
		const github = snapshot ? activityProjectRecords(snapshot) : [];
		const route = (await currentProjectsLoader.loadCurrentProjects(TODAY, github)).map(publicView);

		const previewIds = new Set(preview.map((record) => record.id));
		const routeRoster = route.filter((record) => previewIds.has(record.id));

		// Same records, same order, same public fields — the merge adds
		// records, it never rewrites a roster-derived one.
		expect(routeRoster).toEqual(preview);
	});

	it('adds only github-sourced gh-* records on top of the roster set', async () => {
		const preview = currentProjectsFor(TODAY);
		const previewIds = new Set(preview.map((record) => record.id));
		const snapshot = readGitHubActivitySnapshot(githubActivityJson);
		const github = snapshot ? activityProjectRecords(snapshot) : [];
		const route = await currentProjectsLoader.loadCurrentProjects(TODAY, github);

		const added = route.filter((record) => !previewIds.has(record.id));
		expect(added.length).toBeGreaterThan(0);
		for (const record of added) {
			expect(record.id.startsWith('gh-')).toBe(true);
			for (const source of allFactSources(record)) {
				expect(source).toBe('github');
			}
		}
		// No roster id is duplicated by the merge.
		const routeIds = route.map((record) => record.id);
		expect(new Set(routeIds).size).toBe(routeIds.length);
	});
});
