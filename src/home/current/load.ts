import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { CurrentProjectRecord } from './types';

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
		return currentProjectsLoader.loadCurrentProjects(data.today, githubProjects);
	});
