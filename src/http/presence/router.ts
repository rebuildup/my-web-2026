import { Hono } from 'hono';
import type { ApiKeyContext } from '../api-keys/middleware';
import { requireApiKey, requireResourceAction } from '../api-keys/middleware';
import { rateLimitWrite } from '../middleware/rate-limit';
import { jsonBody, methodNotAllowed } from '../validation';
import { PresenceSnapshotBody, type PresenceSnapshotValue } from './schema';
import { upsertDiscordPresence } from './store';

/**
 * Discord presence ingest router — `/api/v1/presence/*` (Issue #320).
 *
 * Routes:
 *   PUT /api/v1/presence/discord  store the latest owner-presence
 *                                 snapshot pushed by the operator-side
 *                                 Gateway script
 *
 * Authentication: requires an API key with the
 * `discord_presence:write` scope. The ingest key is provisioned once
 * per environment (see `docs/runbook/discord-presence.md`); it is a
 * different consumer from the home self-consumption key and carries
 * no read scope — the public surface reads D1 directly at SSR time,
 * never through this boundary.
 *
 * The body is validated by `PresenceSnapshotBody` (strict allowlist)
 * before it reaches D1; the public reader re-validates independently.
 */

export const presenceRouter = new Hono<{
	Bindings: Env;
	Variables: { apiKey: ApiKeyContext };
}>();

presenceRouter.put(
	'/discord',
	requireApiKey,
	rateLimitWrite,
	jsonBody(PresenceSnapshotBody),
	async (c) => {
		requireResourceAction(c, 'discord_presence', 'write');
		const snapshot = c.get('boundaryBody') as PresenceSnapshotValue;
		const receivedAt = new Date().toISOString();
		await upsertDiscordPresence(c.env.DB, snapshot, receivedAt);
		return c.json({ stored: true, receivedAt });
	},
);

// Protocol guard: PUT is the only method on this router. Anything
// else answers 405 instead of falling through to the boundary
// `notFound` handler.
presenceRouter.all('/discord', methodNotAllowed(['PUT']));
