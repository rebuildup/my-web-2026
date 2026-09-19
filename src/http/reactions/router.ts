import { Hono } from 'hono';
import type { ApiKeyContext } from '../api-keys/middleware';
import { requireApiKey, requireResourceAction } from '../api-keys/middleware';
import { rateLimitRead, rateLimitWrite } from '../middleware/rate-limit';
import { getImageStream } from './images';
import {
	ReactionReferenceError,
	aggregateByTarget,
	deleteReaction,
	listReactionsForActor,
	putReaction,
} from './reactions';
import {
	MAX_TARGET_KEY_LEN,
	validateActorId,
	validateReactionKind,
	validateReactionValue,
	validateTargetKey,
} from './schema';

/**
 * Reactions + reaction-image router — `/api/v1/reactions/*` and
 * `/api/v1/reaction-images/:id`.
 *
 * Routes:
 *   PUT    /api/v1/reactions             add (idempotent)
 *   DELETE /api/v1/reactions             remove (idempotent)
 *   GET    /api/v1/reactions?target=...  aggregate by target_key
 *   GET    /api/v1/reaction-images/:id   public; streams from R2
 *
 * All authenticated routes require `reactions:read` or
 * `reactions:write` scope (via `requireResourceAction`). The image
 * GET is public because reaction images are public data — the
 * `/api/v1/access/*` per-consumer rate limit does not apply here;
 * the read-side `RATE_LIMIT_READ` middleware keys by request IP as
 * a hot-loop guard.
 */
export const reactionsRouter = new Hono<{
	Bindings: Env;
	Variables: { apiKey: ApiKeyContext };
}>();

interface ReactionBody {
	target_key?: unknown;
	actor_id?: unknown;
	kind?: unknown;
	value?: unknown;
}

function parseReactionBody(body: unknown): {
	target_key: string;
	actor_id: string;
	kind: 'emoji' | 'image';
	value: string;
} {
	if (!body || typeof body !== 'object') {
		throw new Error('body must be an object');
	}
	const b = body as ReactionBody;
	const kind = validateReactionKind(b.kind);
	return {
		target_key: validateTargetKey(b.target_key),
		actor_id: validateActorId(b.actor_id),
		kind,
		value: validateReactionValue(kind, b.value),
	};
}

reactionsRouter.put('/', requireApiKey, rateLimitWrite, async (c) => {
	const apiKey = requireResourceAction(c, 'reactions', 'write');
	const raw = (await c.req.json().catch(() => null)) as unknown;
	let input: ReturnType<typeof parseReactionBody>;
	try {
		input = parseReactionBody(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return c.json({ error: 'invalid_body', reason: message }, 400);
	}
	try {
		const result = await putReaction(c.env.DB, { ...input, principal: apiKey.id });
		return c.json({ created: result.created, id: result.id });
	} catch (err) {
		if (err instanceof ReactionReferenceError) {
			return c.json({ error: err.code, reason: err.message }, 422);
		}
		throw err;
	}
});

reactionsRouter.delete('/', requireApiKey, rateLimitWrite, async (c) => {
	const apiKey = requireResourceAction(c, 'reactions', 'write');
	const raw = (await c.req.json().catch(() => null)) as unknown;
	let input: ReturnType<typeof parseReactionBody>;
	try {
		input = parseReactionBody(raw);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return c.json({ error: 'invalid_body', reason: message }, 400);
	}
	const result = await deleteReaction(c.env.DB, { ...input, principal: apiKey.id });
	return c.json({ deleted: result.deleted });
});

reactionsRouter.get('/', requireApiKey, rateLimitRead, async (c) => {
	const apiKey = requireResourceAction(c, 'reactions', 'read');
	const targetKeyRaw = c.req.query('target');
	if (!targetKeyRaw) {
		return c.json({ error: 'missing_target' }, 400);
	}
	if (targetKeyRaw.length > MAX_TARGET_KEY_LEN) {
		return c.json({ error: 'invalid_target' }, 400);
	}
	// Aggregate scoped to the calling principal (API key id) —
	// see reactions.aggregateByTarget. Cross-principal rolls up
	// are explicitly out of scope for 0.3.0.
	const aggregates = await aggregateByTarget(c.env.DB, targetKeyRaw, apiKey.id);
	// Optional viewer-state channel. When the caller supplies an
	// `actor_id` (the home loader reads it from the `mw_actor_id`
	// cookie and forwards it here), we also return that visitor's
	// own reactions — drives the widget's toggle predicate (P1
	// review finding: widget previously conflated "everyone's
	// count" with "this visitor's selection"). Backward-compatible:
	// omit `actor_id` and the response shape is unchanged.
	const actorIdRaw = c.req.query('actor_id');
	if (actorIdRaw) {
		const actorId = validateActorId(actorIdRaw);
		const viewer_reactions = await listReactionsForActor(
			c.env.DB,
			targetKeyRaw,
			apiKey.id,
			actorId,
		);
		return c.json({ target_key: targetKeyRaw, aggregates, viewer_reactions });
	}
	return c.json({ target_key: targetKeyRaw, aggregates });
});

// Public image read — no API key required (images are public data).
// Rate-limited by request IP via the read-side binding.
export const reactionImagesRouter = new Hono<{ Bindings: Env }>();
reactionImagesRouter.get('/:id', rateLimitRead, async (c) => {
	const id = c.req.param('id');
	if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
		return c.json({ error: 'invalid_id' }, 400);
	}
	const stream = await getImageStream(c.env.DB, c.env.MEDIA, id);
	if (!stream) {
		return c.json({ error: 'not_found' }, 404);
	}
	c.header('Content-Type', stream.contentType);
	c.header('Cache-Control', stream.cacheControl);
	return c.body(stream.body, 200);
});
