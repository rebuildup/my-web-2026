import { createStart, createMiddleware } from '@tanstack/react-start';
import { Hono } from 'hono';
import { externalBoundary } from './boundary';

/**
 * External boundary path prefixes that must NOT be handled by TanStack Start's
 * SSR pipeline. The Hono layer under `src/boundary/**` owns these paths.
 */
const EXTERNAL_BOUNDARY_PREFIXES = ['/api/v1', '/webhooks', '/oauth', '/integrations'] as const;

/**
 * Mount the Hono external boundary in front of TanStack Start.
 *
 * This is implemented as request middleware so that the canonical
 * `wrangler.jsonc` `main: "@tanstack/react-start/server-entry"` continues to
 * work without change. The Hono app only owns external HTTP traffic
 * (REST APIs, webhooks, OAuth callbacks, integrations); TanStack Start
 * owns everything else.
 *
 * See ADR-0002 for the boundary policy.
 */
const externalBoundaryMiddleware = createMiddleware().server(async ({ next, request }) => {
	const url = new URL(request.url);
	if (EXTERNAL_BOUNDARY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
		// Hono is a Cloudflare-native Web Standards framework; it understands
		// the Request shape coming out of TanStack Start's middleware.
		const honoApp = new Hono<{ Bindings: Env }>().route('/', externalBoundary);
		const ctx = {
			waitUntil: () => {},
			passThroughOnException: () => {},
		} as unknown as ExecutionContext;
		return honoApp.fetch(request, {} as Env, ctx);
	}

	return next();
});

/**
 * Start instance consumed by `src/router.tsx` and the
 * `@tanstack/react-start/server-entry` virtual module.
 */
export const start = createStart(() => ({
	requestMiddleware: [externalBoundaryMiddleware],
}));
