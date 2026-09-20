import { createMiddleware } from 'hono/factory';

/**
 * Rate limit middleware — per-consumer-principal throttle via the
 * Cloudflare Workers Rate Limiting binding (ADR-0010).
 *
 * Two bindings are declared in `wrangler.jsonc`:
 *
 *   RATE_LIMIT_WRITE  60 req / 60 s   (write endpoints)
 *   RATE_LIMIT_READ   600 req / 60 s  (read endpoints)
 *
 * The principal is the API key id (set in `c.var.apiKey.id` by
 * `requireApiKey`). For endpoints without an API key (e.g. public
 * `GET /api/v1/reaction-images/:id`), the caller falls back to the
 * request IP — documented in ADR-0010 as a known limitation.
 *
 * Response shape on throttle: HTTP 429 with `{ error: 'rate_limited' }`.
 *
 * Usage in a router:
 *
 *   app.use('/api/v1/access/*', requireApiKey);
 *   app.post('/api/v1/access/hit', rateLimitWrite, handler);
 */

type Binding = 'RATE_LIMIT_WRITE' | 'RATE_LIMIT_READ';

function rateLimit(binding: Binding) {
	return createMiddleware<{ Bindings: Env }>(async (c, next) => {
		// apiKey is set by requireApiKey on protected routes; for
		// unprotected routes (image GET) we fall back to IP.
		const apiKey = c.get('apiKey');
		const key = apiKey?.id ?? c.req.header('cf-connecting-ip') ?? 'anonymous';
		const limiter = c.env[binding];
		const outcome = await limiter.limit({ key });
		if (!outcome.success) {
			return c.json({ error: 'rate_limited' }, 429);
		}
		await next();
	});
}

export const rateLimitWrite = rateLimit('RATE_LIMIT_WRITE');
export const rateLimitRead = rateLimit('RATE_LIMIT_READ');
