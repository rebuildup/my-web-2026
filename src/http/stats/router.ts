import { Hono } from 'hono';
import type { ApiKeyContext } from '../api-keys/middleware';
import { requireApiKey, requireResourceAction } from '../api-keys/middleware';
import { rateLimitWrite } from '../middleware/rate-limit';
import { jsonBody, methodNotAllowed } from '../validation';
import { GitHubStatsSnapshotBody, type GitHubStatsSnapshotValue } from './schema';
import { upsertGitHubStatsSnapshot } from './store';

/**
 * GitHub stats ingest router — `/api/v1/stats/*` (Issues #1244 / #1245).
 *
 * Routes:
 *   PUT /api/v1/stats/github  store the latest stats snapshot pushed
 *                            by the operator-side sync job
 *                            (`scripts/sync-github-stats.mjs --push`)
 *
 * Authentication: requires an API key with the `github_stats:write`
 * scope. The ingest key is provisioned once per environment; the
 * public surface reads D1 directly at request time, never through
 * this boundary.
 *
 * The body is validated by `GitHubStatsSnapshotBody` (strict
 * allowlist; aggregates and public repo totals only) before it
 * reaches D1; the public reader re-validates independently. This
 * endpoint lets the snapshot refresh WITHOUT a commit, PR merge or
 * site release: the operator job pushes, the Worker serves the new
 * document on the next request.
 */

export const statsRouter = new Hono<{
	Bindings: Env;
	Variables: { apiKey: ApiKeyContext };
}>();

statsRouter.put(
	'/github',
	requireApiKey,
	rateLimitWrite,
	jsonBody(GitHubStatsSnapshotBody),
	async (c) => {
		requireResourceAction(c, 'github_stats', 'write');
		const snapshot = c.get('boundaryBody') as GitHubStatsSnapshotValue;
		const receivedAt = new Date().toISOString();
		await upsertGitHubStatsSnapshot(c.env.DB, snapshot, receivedAt);
		return c.json({ stored: true, receivedAt });
	},
);

// Protocol guard: PUT is the only method on this router.
statsRouter.all('/github', methodNotAllowed(['PUT']));
