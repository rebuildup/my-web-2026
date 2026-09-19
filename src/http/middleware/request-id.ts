import { createMiddleware } from 'hono/factory';

/**
 * Request id middleware — assigns or echoes `X-Request-Id`.
 *
 * If the client supplies `X-Request-Id`, the value is preserved so
 * distributed traces remain correlatable. Otherwise a 128-bit random
 * hex id is generated. The id is exposed to downstream handlers via
 * `c.set('requestId', ...)` and written back to the response headers.
 *
 * Used by all `/api/v1/*` routes (mounted in `src/http/hono.ts`) so
 * error responses and worker logs share a common correlation token.
 */
export const requestIdMiddleware = createMiddleware<{
	Bindings: Env;
	Variables: { requestId: string };
}>(async (c, next) => {
	const existing = c.req.header('X-Request-Id');
	const requestId =
		existing && existing.length > 0 && existing.length <= 128 ? existing : generateRequestId();
	c.set('requestId', requestId);
	c.header('X-Request-Id', requestId);
	await next();
});

function generateRequestId(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
