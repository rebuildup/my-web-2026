import { Hono } from 'hono';
import type { ApiKeyContext } from '../api-keys/middleware';
import { requireApiKey, requireResourceAction } from '../api-keys/middleware';
import { rateLimitRead, rateLimitWrite } from '../middleware/rate-limit';
import {
	jsonBody,
	methodNotAllowed,
	parseBoundaryInput,
	parsePathInput,
	parseQueryInput,
	rejection,
} from '../validation';
import { getImageStream } from './images';
import {
	ReactionReferenceError,
	aggregateByTarget,
	deleteReaction,
	listReactionsForActor,
	putReaction,
} from './reactions';
import type { ReactionInputValue } from './schema';
import {
	validateActorId,
	validateReactionImageId,
	validateTargetKey,
	parseReactionInput,
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

reactionsRouter.put('/', requireApiKey, rateLimitWrite, jsonBody(parseReactionInput), async (c) => {
	const apiKey = requireResourceAction(c, 'reactions', 'write');
	const input = c.get('boundaryBody') as ReactionInputValue;
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

reactionsRouter.delete(
	'/',
	requireApiKey,
	rateLimitWrite,
	jsonBody(parseReactionInput),
	async (c) => {
		const apiKey = requireResourceAction(c, 'reactions', 'write');
		const input = c.get('boundaryBody') as ReactionInputValue;
		const result = await deleteReaction(c.env.DB, { ...input, principal: apiKey.id });
		return c.json({ deleted: result.deleted });
	},
);

reactionsRouter.get('/', requireApiKey, rateLimitRead, async (c) => {
	const apiKey = requireResourceAction(c, 'reactions', 'read');
	// Repeated query keys are rejected before the first value is read
	// (HTTP parameter pollution — Issue #450).
	const query = parseQueryInput(c, ['target', 'actor_id']);
	if (!query.ok) return rejection(c, query.failure);
	const { target: targetKeyRaw, actor_id: actorIdRaw } = query.value;
	if (targetKeyRaw === undefined) {
		return c.json({ error: 'missing_target' }, 400);
	}
	const targetResult = parseBoundaryInput('invalid_target', validateTargetKey, targetKeyRaw);
	if (!targetResult.ok) return rejection(c, targetResult.failure);
	const targetKey = targetResult.value;
	// Aggregate scoped to the calling principal (API key id) —
	// see reactions.aggregateByTarget. Cross-principal rolls up
	// are explicitly out of scope.
	const aggregates = await aggregateByTarget(c.env.DB, targetKey, apiKey.id);
	// Optional viewer-state channel. When the caller supplies an
	// `actor_id` (the home loader reads it from the `mw_actor_id`
	// cookie and forwards it here), we also return that visitor's
	// own reactions — drives the widget's toggle predicate (P1
	// review finding: widget previously conflated "everyone's
	// count" with "this visitor's selection"). Backward-compatible:
	// omit `actor_id` and the response shape is unchanged.
	if (actorIdRaw !== undefined) {
		// External input — a malformed `actor_id` query param must
		// surface as 400, not 500. P2 review #10: the bare call to
		// `validateActorId` would throw and bubble to the default
		// error handler. `parseBoundaryInput` owns that conversion so
		// the shape stays `invalid_actor_id` + reason.
		const actorResult = parseBoundaryInput('invalid_actor_id', validateActorId, actorIdRaw);
		if (!actorResult.ok) return rejection(c, actorResult.failure);
		const viewer_reactions = await listReactionsForActor(
			c.env.DB,
			targetKey,
			apiKey.id,
			actorResult.value,
		);
		return c.json({ target_key: targetKey, aggregates, viewer_reactions });
	}
	return c.json({ target_key: targetKey, aggregates });
});

/**
 * Protocol guard (Issue #450): these paths accept exactly the three
 * verbs above. Anything else answers `405` with an `Allow` header
 * instead of falling through to the boundary `notFound` (`404`).
 */
reactionsRouter.all('/', methodNotAllowed(['GET', 'PUT', 'DELETE']));

// Public image read — no API key required (images are public data).
// Rate-limited by request IP via the read-side binding.
export const reactionImagesRouter = new Hono<{ Bindings: Env }>();
reactionImagesRouter.get('/:id', rateLimitRead, async (c) => {
	const idResult = parsePathInput(c, 'id', validateReactionImageId, 'invalid_id');
	if (!idResult.ok) return rejection(c, idResult.failure);
	const stream = await getImageStream(c.env.DB, c.env.MEDIA, idResult.value);
	if (!stream) {
		return c.json({ error: 'not_found' }, 404);
	}
	c.header('Content-Type', stream.contentType);
	c.header('Cache-Control', stream.cacheControl);
	return c.body(stream.body, 200);
});

/**
 * Protocol guard (Issue #450) — reaction images are a read-only
 * public resource, so every other verb is a `405`.
 */
reactionImagesRouter.all('/:id', methodNotAllowed(['GET']));
