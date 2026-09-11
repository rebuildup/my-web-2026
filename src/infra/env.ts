/**
 * Typed wrapper around the Cloudflare Worker bindings declared in
 * `wrangler.jsonc`. Run `pnpm run cf-typegen` after editing bindings so the
 * generated `worker-configuration.d.ts` keeps `Env` in sync.
 *
 * Modules that need bindings should accept `Env` via parameter rather than
 * importing ambient globals — this keeps domain/application code portable
 * across local Worker dev, integration tests, and deployed runtime.
 */
export type AppBindings = Env;

export interface RuntimeContext {
	env: AppBindings;
	waitUntil: (promise: Promise<unknown>) => void;
}
