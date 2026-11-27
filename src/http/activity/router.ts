import { Hono } from 'hono';
import type { ApiKeyContext } from '../api-keys/middleware';
import { requireApiKey, requireResourceAction } from '../api-keys/middleware';
import { rateLimitWrite } from '../middleware/rate-limit';
import { jsonBody, methodNotAllowed } from '../validation';
import { GitHubActivitySnapshotBody, type GitHubActivitySnapshotValue } from './schema';
import { upsertGitHubActivitySnapshot } from './store';

/**
 * GitHub activity ingest router — `/api/v1/activity/*`
 * (Issues #316 / #319 / #932).
 *
 * Routes:
 *   PUT /api/v1/activity/github  store the latest activity snapshot
 *                                pushed by the operator-side sync
 *                                script (`scripts/sync-github-
 *                                activity.mjs --push`)
 *
 * Authentication: requires an API key with the
 * `github_activity:write` scope. The ingest key is provisioned once
 * per environment (see `docs/runbook/github-activity-sync.md`); it is
 * a dedicated consumer — the public surface reads D1 directly at SSR
 * time, never through this boundary.
 *
 * The body is validated by `GitHubActivitySnapshotBody` (strict
 * allowlist; private entries pinned to the anonymous contract)
 * before it reaches D1; the public reader re-validates
 * independently. This endpoint is what lets the snapshot refresh
 * WITHOUT a commit, PR merge or site release: the operator job
 * pushes, the Worker serves the new document on the next request.
 */

// The activity snapshot carries up to 200 repo entries plus a 100-item
// feed (schema ceilings in `./schema.ts`), so the shared 16 KiB JSON
// cap cannot hold a schema-valid document — repo discovery growth
// pushed the production payload past it and the daily sync was refused
// with 413 (Issue #1256, same class as #1251). The cap here is sized to
// the schema's own worst case; the global default stays untouched for
// every other ingest route.
const ACTIVITY_SNAPSHOT_MAX_BODY_BYTES = 1024 * 1024;

export const activityRouter = new Hono<{
	Bindings: Env;
	Variables: { apiKey: ApiKeyContext };
}>();

activityRouter.put(
	'/github',
	requireApiKey,
	rateLimitWrite,
	jsonBody(GitHubActivitySnapshotBody, { maxBytes: ACTIVITY_SNAPSHOT_MAX_BODY_BYTES }),
	async (c) => {
		requireResourceAction(c, 'github_activity', 'write');
		const snapshot = c.get('boundaryBody') as GitHubActivitySnapshotValue;
		const receivedAt = new Date().toISOString();
		await upsertGitHubActivitySnapshot(c.env.DB, snapshot, receivedAt);
		return c.json({ stored: true, receivedAt });
	},
);

// Protocol guard: PUT is the only method on this router. Anything
// else answers 405 instead of falling through to the boundary
// `notFound` handler.
activityRouter.all('/github', methodNotAllowed(['PUT']));
