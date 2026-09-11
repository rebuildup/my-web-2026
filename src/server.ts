import { externalBoundary } from './http/hono';
// `handler` is the default TanStack Start Worker handler. The default
// export shape is `{ fetch(request) }` because `@tanstack/react-start`
// wraps `createStartHandler(defaultStreamHandler)` in a server-entry.
// Importing `@tanstack/react-start/server-entry` keeps the canonical
// CSRF middleware active; do NOT define a custom `startInstance` here.
// See ADR-0002 for the boundary policy.
import handler from '@tanstack/react-start/server-entry';

/**
 * Path prefixes that must be served by the Hono external boundary
 * instead of the TanStack Start SSR pipeline.
 *
 *   /api/v1/*        external REST API
 *   /webhooks/*      inbound webhooks from external services
 *   /oauth/*         OAuth callback handlers
 *   /integrations/*  third-party integration adapters
 *
 * Internal application operations invoked from the UI use TanStack
 * Start server functions and never appear under these prefixes.
 */
const EXTERNAL_BOUNDARY_PREFIXES = ['/api/v1', '/webhooks', '/oauth', '/integrations'] as const;

/**
 * Cloudflare Worker entry for my-web-2026.
 *
 * Default export shape matches the Cloudflare Workers `ExportedHandler`
 * contract. The `@cloudflare/vite-plugin` reads `wrangler.jsonc.main`,
 * resolves it through Vite, and uses the default export's `fetch`.
 *
 * Real `env` and `ctx` flow through to Hono so external-boundary
 * handlers can talk to D1, R2, KV, and other bindings without
 * indirection.
 */
export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		if (EXTERNAL_BOUNDARY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
			return externalBoundary.fetch(request, env, ctx);
		}
		return handler.fetch(request);
	},
} satisfies ExportedHandler<Env>;
