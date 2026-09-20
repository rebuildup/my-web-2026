import { Hono } from 'hono';
import type { ApiKeyContext } from '../api-keys/middleware';
import { requireApiKey, requireResourceAction } from '../api-keys/middleware';
import { rateLimitRead, rateLimitWrite } from '../middleware/rate-limit';
import { getCount, recordHit } from './counter';
import { HitInput, MAX_COUNTER_KEY_LEN, validateCounterKey, validateSessionId } from './schema';

/**
 * Access counter router — `/api/v1/access/*` (Ticket F, branch 38).
 *
 * Routes:
 *   POST /api/v1/access/hit   record a page view (idempotent per
 *                             `(key, principal, session_id)` inside
 *                             `DEDUP_WINDOW_MS`)
 *   GET  /api/v1/access/count/:key  read the aggregate count
 *
 * Authentication: requires an API key with the `access_counter:read`
 * (GET) or `access_counter:write` (POST) scope. The home consumer
 * key (`mk_home_…`) carries both scopes.
 *
 * Rate limits: the existing `RATE_LIMIT_WRITE` / `RATE_LIMIT_READ`
 * bindings (branch 35) cover the write/read paths respectively.
 */

export const accessCounterRouter = new Hono<{
	Bindings: Env;
	Variables: { apiKey: ApiKeyContext };
}>();

accessCounterRouter.post('/hit', requireApiKey, rateLimitWrite, async (c) => {
	const apiKey = requireResourceAction(c, 'access_counter', 'write');
	const raw = (await c.req.json().catch(() => null)) as unknown;
	const parsed = HitInput.safeParse(raw);
	if (!parsed.success) {
		return c.json({ error: 'invalid_body', reason: parsed.error.message }, 400);
	}
	const key = validateCounterKey(parsed.data.key);
	const sessionId = validateSessionId(parsed.data.session_id);
	const result = await recordHit(c.env.DB, {
		key,
		principal: apiKey.id,
		session_id: sessionId,
	});
	return c.json({
		incremented: result.incremented,
		count: result.count,
		first_hit: result.first_hit,
		last_hit: result.last_hit,
	});
});

accessCounterRouter.get('/count/:key', requireApiKey, rateLimitRead, async (c) => {
	const apiKey = requireResourceAction(c, 'access_counter', 'read');
	const rawKey = c.req.param('key');
	if (!rawKey || rawKey.length === 0 || rawKey.length > MAX_COUNTER_KEY_LEN) {
		return c.json({ error: 'invalid_key' }, 400);
	}
	const key = validateCounterKey(rawKey);
	// Per-principal isolation (ADR-0012 §3): each consumer sees only
	// its own counter row for the same `key`. The principal is the
	// authenticated API key id — no client input accepted.
	const result = await getCount(c.env.DB, key, apiKey.id);
	return c.json(result);
});
