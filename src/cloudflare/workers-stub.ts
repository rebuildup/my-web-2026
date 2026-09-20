/**
 * Client-environment stub for `cloudflare:workers`.
 *
 * Why this exists:
 *
 * Source files under `src/**` that contain a `createServerFn()` body
 * also import `cloudflare:workers` at the module top-level (for the
 * closure that the server function captures — `env.DB`, `env.MEDIA`,
 * `env.ASSETS`, etc.). The TanStack Start compiler plugin
 * (`@tanstack/start-plugin-core`) replaces the `createServerFn().handler()`
 * callback with an RPC stub on the client side, so the body's `env.*`
 * references are stripped. BUT the top-level `import { env } from
 * 'cloudflare:workers'` statement on line 1 of those files is left
 * intact.
 *
 * Result during `pnpm dev` (Vite 7 + @cloudflare/vite-plugin 1.54.x):
 *
 *   [vite] Internal server error: Failed to resolve import
 *   "cloudflare:workers" from "src/admin/invitations/accept.ts".
 *
 * Vite's import-analysis walks every import in pre-transform and route
 * registration, and the cloudflare() plugin's virtual module resolver
 * is registered only for the SSR environment (the one workerd runs in),
 * so the client environment needs this explicit resolver in both dev
 * and production builds. Leaving the specifier external would preserve
 * a bare `cloudflare:workers` import in the browser bundle and prevent
 * the application from hydrating.
 *
 * What this stub provides:
 *
 * A frozen empty object for `env`. The client bundle never actually
 * reads `env.DB` etc. — the createServerFn handler body has been
 * replaced with an RPC stub. If a future regression ever lets a
 * server-only body execute on the client, `Object.freeze({})` makes
 * any property access fail loudly with a TypeError, which is the
 * desired early signal.
 *
 * Where the magic happens:
 *
 * A custom Vite plugin in `vite.config.ts`
 * (`cloudflareWorkersClientStub`) maps `cloudflare:workers` to this
 * file for any environment that is NOT the workerd-backed SSR one.
 * The real `cloudflare:workers` (provided by workerd) is untouched on
 * the SSR path.
 */

export const env: Readonly<Record<string, unknown>> = Object.freeze({});
