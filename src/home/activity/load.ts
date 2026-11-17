import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { HomeGitHubActivity } from './contract';
import { readPreferredGitHubActivitySnapshot } from './live';
import { publicGitHubActivity } from './snapshot';

/**
 * Server functions for the GitHub activity surface (Issues #316 /
 * #319 / #932). The snapshot JSON is imported INSIDE the live
 * reader so it never enters the client bundle (same rule as
 * `current/load.ts`).
 *
 * `readPreferredGitHubActivitySnapshot` prefers the D1 document the
 * operator sync job pushes (`PUT /api/v1/activity/github`) when it
 * is valid and fresher than the committed artefact — that is what
 * lets a refresh reach the public surface without a commit or
 * release. The committed `github-activity.json` remains the
 * reviewed fallback.
 */

/** The public status-card projection (#319). */
export const getHomeGitHubActivity = createServerFn({ method: 'GET' })
	.validator(z.object({}).optional())
	.handler(async (): Promise<HomeGitHubActivity | null> => {
		const parsed = await readPreferredGitHubActivitySnapshot();
		return parsed ? publicGitHubActivity(parsed) : null;
	});
