import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { CurrentProjectRecord, ProjectFact } from './types';

/**
 * The current-projects records for a base date (Issue #316).
 *
 * Why this is a server function
 * -----------------------------
 * The section's inputs are committed artefacts — the owner's roster, the
 * generated git snapshot — and none of them belongs in the browser. A
 * plain function would be bundled into the shared client entry: every
 * route in the application would download a roster it never renders, and
 * the git snapshot with it.
 *
 * `createServerFn` is the same boundary `src/home/{status,access,reactions}/
 * load.ts` uses, and it is what confines the composition to the server.
 * The loader module is therefore imported **inside** the handler: a
 * top-level import is evaluated when this module loads, which keeps it in
 * the graph of every client that imports this file (the same reason
 * `src/home/reactions/load.ts` resolves its bindings inside `.handler()`).
 *
 * `today` is the caller's, never a clock read here: the route passes the
 * same `observedAt` day it gives the status tiles, so the two cannot
 * disagree about which day they describe.
 */
const Input = z.object({ today: z.string() });

export const getCurrentProjects = createServerFn({ method: 'GET' })
	.validator(Input)
	.handler(async ({ data }): Promise<readonly CurrentProjectRecord[]> => {
		const { currentProjectsLoader } = await import('./loader');
		// Issues #316 / #932 — the GitHub-observed projects come from
		// the same preferred snapshot the status card reads: the D1
		// document the operator sync job pushes when it is valid and
		// fresher than the committed artefact. Both modules are
		// imported inside the handler so neither the binding nor the
		// snapshot JSON enters the client bundle.
		const { readPreferredGitHubActivitySnapshot } = await import('../activity/live');
		const { activityProjectRecords } = await import('../activity/snapshot');
		const snapshot = await readPreferredGitHubActivitySnapshot();
		const githubProjects = snapshot ? activityProjectRecords(snapshot) : null;
		const records = await currentProjectsLoader.loadCurrentProjects(data.today, githubProjects);
		return records.map(toPublicRecord);
	});

/**
 * Public projection of one current-projects record (Issue #1009).
 *
 * `ProjectFact#evidence` is operator provenance — the commit SHA or the
 * sync script that produced the fact. Nothing renders it, but the
 * server function serialises the whole record into the `$_TSR`
 * hydration payload, so it would reach every visitor's browser. The
 * public surface keeps `value` / `source` / `observedOn` and drops
 * `evidence` here, at the boundary, rather than relying on every
 * future consumer to remember.
 */
function toPublicRecord(record: CurrentProjectRecord): CurrentProjectRecord {
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
