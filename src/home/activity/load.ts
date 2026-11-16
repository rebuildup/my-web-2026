import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { GitHubActivitySnapshot, HomeGitHubActivity } from './contract';
import { publicGitHubActivity, readGitHubActivitySnapshot } from './snapshot';

/**
 * Server functions for the GitHub activity surface (Issues #316 /
 * #319 / #932). The committed snapshot JSON is imported INSIDE each
 * handler so it never enters the client bundle (same rule as
 * `current/load.ts`).
 */

async function readSnapshot(): Promise<GitHubActivitySnapshot | null> {
	const { default: json } = await import('./github-activity.json', {
		with: { type: 'json' },
	});
	return readGitHubActivitySnapshot(json);
}

/** The public status-card projection (#319). */
export const getHomeGitHubActivity = createServerFn({ method: 'GET' })
	.validator(z.object({}).optional())
	.handler(async (): Promise<HomeGitHubActivity | null> => {
		const parsed = await readSnapshot();
		return parsed ? publicGitHubActivity(parsed) : null;
	});
