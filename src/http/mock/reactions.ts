import { Hono } from 'hono';
import { getMockReactions, toggleMockReaction } from './fixtures';

/**
 * Mock reactions router (Issue #166 — design-verification only).
 *
 * Endpoints (mounted under `/api/v1/reactions/*` by `createMockApp`):
 *   - GET  /api/v1/reactions/:slug          — returns canned reactions
 *                                             for the slug (empty
 *                                             array for unknown slugs).
 *   - POST /api/v1/reactions/:slug/toggle   — bumps the targeted emoji
 *                                             by ±1 and returns the
 *                                             updated reactions array.
 *
 * Path-style note: the production router (`src/http/reactions/router.ts`)
 * uses `?target=` as a query parameter, NOT a `:slug` path segment.
 * Mock paths are deliberately a flattened surface — the goal is to
 * let the widget preview exercise the path it actually fetches in
 * Storybook / local QA. The two surfaces do not conflict because the
 * mock router is only mounted when `LOCAL_API_MODE=mock`.
 *
 * Design-verification-only — no D1, no API-key middleware, no rate
 * limit. The activation gate is `env.LOCAL_API_MODE === 'mock'` in
 * `src/http/hono.ts`; when the env is unset, this router is never
 * mounted and the production router takes over.
 */

const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

interface ToggleBody {
	emoji?: unknown;
	direction?: unknown;
}

function parseToggleBody(body: unknown): { emoji: string; direction: 'add' | 'remove' } {
	if (!body || typeof body !== 'object') throw new Error('body must be an object');
	const b = body as ToggleBody;
	if (typeof b.emoji !== 'string' || b.emoji.length === 0) {
		throw new Error('emoji must be a non-empty string');
	}
	const direction = b.direction === 'remove' ? 'remove' : 'add';
	return { emoji: b.emoji, direction };
}

export function createMockReactionsRouter(): Hono<{ Bindings: Env }> {
	const router = new Hono<{ Bindings: Env }>();

	router.get('/:slug', (c) => {
		const slug = c.req.param('slug');
		if (!SLUG_PATTERN.test(slug)) return c.json({ error: 'invalid_slug' }, 400);
		return c.json({
			reactions: getMockReactions(slug),
		});
	});

	router.post('/:slug/toggle', async (c) => {
		const slug = c.req.param('slug');
		if (!SLUG_PATTERN.test(slug)) return c.json({ error: 'invalid_slug' }, 400);
		const raw = (await c.req.json().catch(() => null)) as unknown;
		let input: ReturnType<typeof parseToggleBody>;
		try {
			input = parseToggleBody(raw);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: 'invalid_body', reason: message }, 400);
		}
		const reactions = toggleMockReaction(slug, input.emoji, input.direction);
		return c.json({ reactions });
	});

	return router;
}
