import { createMiddleware } from 'hono/factory';
import { CORS_REFUSAL_STATUS, decideCors } from './policy';

/**
 * Hono adapter for `policy.ts` (Issue #455).
 *
 * The middleware owns exactly three responsibilities and nothing else:
 * reading the CORS-relevant request inputs off the Hono context,
 * rendering the decision, and short-circuiting the two cases that must
 * not reach a handler (an answered preflight and a refusal). Every
 * decision about *which* origin, method or header is acceptable lives in
 * `policy.ts`, which is pure and unit-tested without workerd.
 *
 * Mounted first on `externalBoundary` (`src/http/hono.ts`) so the
 * policy also covers the `LOCAL_API_MODE=mock` short-circuit — a
 * designer running in mock mode must see the same CORS surface as
 * production, otherwise the mock would be a way to bypass it.
 */
export const corsMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
	const preflight =
		c.req.method === 'OPTIONS' && c.req.header('access-control-request-method') !== undefined;
	// A preflight asks "may I send METHOD here?" — classify against the
	// requested method so `DELETE /api/v1/health` is refused as a method
	// violation instead of being accepted because `OPTIONS` is allowed.
	const method = preflight
		? (c.req.header('access-control-request-method') ?? c.req.method)
		: c.req.method;

	const requestedHeaders = (c.req.header('access-control-request-headers') ?? '')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value.length > 0);

	// `BETTER_AUTH_URL` is intentionally not in the typegen'd `Env`: it
	// is a production-only text var declared in the companion
	// `wrangler.production.jsonc` (ADR-0014), and declaring it inside
	// `wrangler.jsonc` would narrow every other binding. Same cast, same
	// reason, as `src/cloudflare/auth/better-auth.ts`. One value feeds
	// both Better Auth's `trustedOrigins` and this allow-list.
	const configuredOrigin = (c.env as { BETTER_AUTH_URL?: string }).BETTER_AUTH_URL;

	const decision = decideCors({
		method,
		path: c.req.path,
		origin: c.req.header('origin') ?? null,
		requestOrigin: new URL(c.req.url).origin,
		extraAllowedOrigins: configuredOrigin ? [configuredOrigin] : [],
		requestedHeaders,
		preflight,
	});

	if (decision.kind === 'refuse') {
		for (const [name, value] of Object.entries(decision.headers)) c.header(name, value);
		return c.json({ error: decision.code, class: decision.klass }, CORS_REFUSAL_STATUS);
	}

	if (decision.kind === 'preflight') {
		return c.body(null, 204, decision.headers);
	}

	// Pass-through: render the decision onto the FINALIZED response.
	//
	// Hono parks a `c.header()` call made before `next()` in a private
	// prepared-header bag, and that bag is only merged into a response
	// the CONTEXT produces (`c.json()` / `c.body()` / `c.newResponse()`).
	// A handler that returns a raw `Response` replaces `context.res`
	// wholesale and the prepared headers are silently dropped — and the
	// two handlers on this boundary that do exactly that are
	// `auth.handler(c.req.raw)` (`src/http/auth/router.ts`) and the
	// `mockApp.fetch(...)` the `LOCAL_API_MODE=mock` gate returns. That
	// is the `credentialed` allow branch, i.e. precisely the
	// `Access-Control-Allow-Origin` echo + credentials pair this Issue
	// exists to guarantee: before this ordering, a browser on an
	// allow-listed origin got NO CORS header from `/api/v1/auth/*`.
	//
	// `c.header()` after `await next()` takes Hono's finalized-response
	// path (it re-instantiates `c.res` with a mutable header bag first),
	// so it is correct for both handler shapes and keeps the handler's
	// own `Set-Cookie` — which the Better Auth sign-in response carries
	// and which a re-wrap must not drop.
	await next();
	for (const [name, value] of Object.entries(decision.headers)) c.header(name, value);
	return undefined;
});
