import { createMiddleware } from 'hono/factory';

/**
 * Rate limit middleware — per-consumer-principal throttle via the
 * Cloudflare Workers Rate Limiting binding (ADR-0010).
 *
 * Two bindings are declared in `cloudflare.config.ts`:
 *
 *   RATE_LIMIT_WRITE  60 req / 60 s   (write endpoints)
 *   RATE_LIMIT_READ   600 req / 60 s  (read endpoints)
 *
 * The principal is the API key id (set in `c.var.apiKey.id` by
 * `requireApiKey`). For endpoints without an API key (e.g. public
 * `GET /api/v1/reaction-images/:id`), the caller falls back to the
 * request IP — documented in ADR-0010 as a known limitation.
 *
 * Response shape on throttle: HTTP 429 with `{ error: 'rate_limited' }`
 * plus a `Retry-After` header (Issue #456). The body is the stable
 * machine contract every consumer keys on
 * (`src/home/reactions/load.ts`, `src/home/access/load.ts`); the
 * header is the human / operator-facing retry hint. Both are part of
 * the documented contract — see `docs/security/write-rate-limit.md`.
 *
 * `Retry-After` is the configured window in seconds because the
 * binding is a **fixed window**: the budget refills at the window
 * boundary, so a caller that waits a full window is always safe to
 * retry. The binding's `limit()` result carries no reset timestamp,
 * so advertising the window is the strongest honest claim available
 * from inside the Worker. The values below MUST track
 * `RATE_LIMITS` in `scripts/_cloudflare-contract.mjs`; a unit test
 * asserts the two do not drift.
 *
 * Usage in a router:
 *
 *   app.use('/api/v1/access/*', requireApiKey);
 *   app.post('/api/v1/access/hit', rateLimitWrite, handler);
 */

type Binding = 'RATE_LIMIT_WRITE' | 'RATE_LIMIT_READ';

/** `Retry-After` seconds advertised per binding — mirrors the fixed window. */
export const RATE_LIMIT_RETRY_AFTER_SECONDS: Readonly<Record<Binding, number>> = Object.freeze({
	RATE_LIMIT_WRITE: 60,
	RATE_LIMIT_READ: 60,
});

function rateLimit(binding: Binding) {
	return createMiddleware<{ Bindings: Env }>(async (c, next) => {
		// apiKey is set by requireApiKey on protected routes; for
		// unprotected routes (image GET) we fall back to IP.
		const apiKey = c.get('apiKey');
		const key = apiKey?.id ?? c.req.header('cf-connecting-ip') ?? 'anonymous';
		const limiter = c.env[binding];
		const outcome = await limiter.limit({ key });
		if (!outcome.success) {
			c.header('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS[binding]));
			return c.json({ error: 'rate_limited' }, 429);
		}
		await next();
	});
}

export const rateLimitWrite = rateLimit('RATE_LIMIT_WRITE');
export const rateLimitRead = rateLimit('RATE_LIMIT_READ');
