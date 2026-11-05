import { resolve } from 'node:path';
import { type ConfigContext, bindings, defineConfig } from 'cf/config';
import {
	PRODUCTION_BETTER_AUTH_URL,
	PRODUCTION_CUSTOM_DOMAIN,
	PRODUCTION_MEDIA_PUBLIC_BASE_URL,
	RATE_LIMITS,
	RATE_LIMIT_BINDING,
	RATE_LIMIT_NAMESPACES,
	WORKER_RUNTIME_SECRET,
} from './scripts/_cloudflare-contract.mjs';
import {
	ACCOUNT_ID,
	D1_DATABASE_ID,
	D1_DATABASE_NAME,
	R2_BUCKET_NAME,
	WORKER_NAME,
} from './scripts/_cloudflare-identity.mjs';
import { readDevVars } from './scripts/_dev-vars-reader.mjs';

/**
 * Cloudflare Worker configuration for my-web-2026 — the single SoT
 * replacing the former `wrangler.jsonc` + `wrangler.production.jsonc`
 * pair (Issue #247).
 *
 * Why one file with modes
 * -----------------------
 * The old layout used two files because wrangler 4.x `env.<name>`
 * narrows `Env` to env-scoped bindings during typegen, which made every
 * top-level binding optional and forced non-null assertions across the
 * source tree. `cloudflare.config.ts` expresses the same distinction
 * with `ConfigContext.mode` instead of a second file, so the default
 * typegen is never env-scoped.
 *
 * `mode` arrives from the CLI / Vite: `vite dev` -> `development`,
 * `vite build` -> `production`, `wrangler` -> `undefined`.
 *
 * Entrypoint
 * ----------
 * ONE source entrypoint (`./src/server.ts`) for every mode. The cf/Vite
 * native path bundles it into the Build Output; `cf deploy --prebuilt`
 * reuses that Build Output — it is a deploy operation, not a second
 * production entrypoint. The old `wrangler.production.jsonc` carried
 * `main: ./dist/server/index.js` + `no_bundle: true` + hand-listed
 * `rules` because the old deploy path ran wrangler's own bundler
 * against an already-built tree. None of that is copied here: bundling
 * is Vite's job now, so `no_bundle` and `rules` have no counterpart
 * and are deliberately absent.
 *
 * What was translated rather than copied
 * --------------------------------------
 * - `routes[].custom_domain + zone_id`  -> `domains: ["rebuildup.dev"]`
 * - `d1_databases[].migrations_dir`     -> the `cf d1 migrations apply
 *                                          --dir migrations` CLI flag
 * - `secrets.required`                  -> `bindings.secret()` entries
 * - `ratelimits[]`                      -> `bindings.rateLimit()`
 * - `vars`                              -> `bindings.text()`
 * - `upload_source_maps`                -> owned by the cf/Vite build;
 *                                          verified, not re-declared
 * - account id                          -> `accountId`
 *
 * `cf d1 migrations` requires the database **ID**; names and binding
 * names are rejected. That is a semantic change from the old
 * name-addressed `wrangler d1 execute`, not a rename.
 */

/**
 * Local `LOCAL_API_MODE=mock` opt-in (Issue #186).
 *
 * Read from `.dev.vars` and injected ONLY in development. The Vite
 * Plugin 2 config is mode-aware, so this no longer needs the
 * `config` customizer that used to inject it into `wrangler.jsonc#vars`
 * at plugin-1 build time — and that injection path was mode-blind,
 * which leaked the mock gate into a production build.
 */
function localApiModeBinding(isProduction: boolean): {
	LOCAL_API_MODE?: ReturnType<typeof bindings.text>;
} {
	if (isProduction) return {};
	// The process environment wins over `.dev.vars` so an explicit
	// command (`pnpm dev:mock`) states the mode the developer asked
	// for, instead of a stale local file deciding it.
	const fromEnv = process.env.LOCAL_API_MODE;
	const devVars: Record<string, string> =
		readDevVars(resolve(import.meta.dirname, '.dev.vars')) ?? {};
	const value = fromEnv ?? devVars?.LOCAL_API_MODE;
	if (typeof value !== 'string' || value.length === 0) return {};
	return { LOCAL_API_MODE: bindings.text(value) };
}

/**
 * The development data-source vocabulary (Issue #377).
 *
 * WHY THIS IS RESTATED HERE
 * -------------------------
 * `cloudflare.config.ts` is loaded OUTSIDE the Worker module graph
 * (the Cloudflare config-drift gate imports it with Node, and the Vite
 * plugin loads it to resolve the bindings). Importing the runtime
 * module `src/cloudflare/data-source.ts` from here breaks the dev
 * server: the file would be loaded twice — once as a Node module by
 * the config loader and once as a Worker module by the module runner
 * — and the runner then cannot resolve it.
 *
 * The runtime contract therefore lives in `src/cloudflare/data-source.ts`
 * (it owns what the values MEAN), and this file restates the three
 * strings it needs. `test/integration/dev-data-source.test.ts` asserts
 * that every value declared here is recognised by the runtime, so the
 * two cannot drift apart silently.
 */
const DATA_SOURCE_ENV_VAR = 'MY_WEB_2026_DATA_SOURCE';
/** The plugin's own switch that keeps the bindings local. */
const FORCE_LOCAL_ENV_VAR = 'CLOUDFLARE_VITE_FORCE_LOCAL';
const DATA_SOURCE_LOCAL = 'local';
const DATA_SOURCE_PRODUCTION_READONLY = 'production-readonly';
const DATA_SOURCE_PRODUCTION_READONLY_LOCAL = 'production-readonly-local';

/**
 * The data source the development surface DECLARES.
 *
 * The development surface always states its source: `local` by
 * default, `production-readonly` when the operator opted in with
 * `pnpm dev:production-data`, and `production-readonly-local` when the
 * operator opted in but forced the bindings to stay local
 * (`pnpm dev:read-only-guard` — the SAFE way to exercise the write
 * refusal without a write ever reaching production).
 *
 * An unrecognised value is passed through unchanged so the runtime can
 * fail closed on it (and say so on the development screen) instead of
 * this function silently repairing it.
 */
export function resolveDevelopmentDataSource(env: Record<string, string | undefined>): string {
	const raw = env[DATA_SOURCE_ENV_VAR];
	if (!raw) return DATA_SOURCE_LOCAL;
	if (raw === DATA_SOURCE_PRODUCTION_READONLY && env[FORCE_LOCAL_ENV_VAR] === 'true') {
		return DATA_SOURCE_PRODUCTION_READONLY_LOCAL;
	}
	return raw;
}

/**
 * Development-only data-source binding (Issue #377).
 *
 * The binding tells the running Worker WHICH data it is looking at.
 * It is declared ONLY in development, so its ABSENCE identifies the
 * deployed production Worker (`src/cloudflare/data-source.ts` reads
 * that absence as "production").
 *
 * `LOCAL_API_MODE` (Issue #186) is a separate axis and stays where it
 * is: it is read from `.dev.vars` because it selects the HTTP
 * boundary's mock gate, not the binding target.
 */
function dataSourceBinding(isProduction: boolean): {
	MY_WEB_2026_DATA_SOURCE?: ReturnType<typeof bindings.text>;
} {
	if (isProduction) return {};
	// The development surface always states its source: the absence
	// of this binding is what identifies production.
	return { MY_WEB_2026_DATA_SOURCE: bindings.text(resolveDevelopmentDataSource(process.env)) };
}

/**
 * Whether the dev server's D1 / R2 bindings point at the PRODUCTION
 * resources (Issue #377).
 *
 * `@cloudflare/vite-plugin` resolves a binding to its remote resource
 * only when BOTH hold: the plugin's `remoteBindings` switch is on AND
 * the binding itself declares `dev.remote`. The switch lives in
 * `vite.config.ts`; the per-binding flag lives here. Both read the
 * SAME environment variables with the SAME rule, so the binding target
 * and the runtime's write policy cannot drift apart.
 *
 * The default (`false`) keeps the dev server on the local miniflare
 * copies, so `pnpm dev` never touches production by accident.
 */
function productionDataMode(): boolean {
	return (
		process.env[DATA_SOURCE_ENV_VAR] === DATA_SOURCE_PRODUCTION_READONLY &&
		process.env[FORCE_LOCAL_ENV_VAR] !== 'true'
	);
}

export default defineConfig({
	accountId: ACCOUNT_ID,
	worker: (ctx: ConfigContext) => {
		// `mode` is `development` under `vite dev` and `production` under
		// `vite build` / `cf build --mode production`.
		const isProduction = ctx.mode === 'production';
		return {
			name: WORKER_NAME,
			compatibilityDate: '2026-09-07',
			compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
			entrypoint: './src/server.ts',
			observability: { enabled: true },
			// Development must not inherit the production origin: the
			// canonical-domain decision is ADR-0014 (Issue #43).
			domains: isProduction ? [PRODUCTION_CUSTOM_DOMAIN] : [],
			env: {
				// Shared non-secret vars.
				MY_WEB_2026_REACTIONS_TARGET: bindings.text('home-page'),
				MY_WEB_2026_COUNTER_KEY: bindings.text('home-page'),
				// Production-only. `BETTER_AUTH_URL` pins the cookie domain
				// and Better Auth `trustedOrigins`; leaving it unset in
				// development is deliberate (see ADR-0009 §8).
				//
				// The empty branch is annotated to the same shape as the
				// populated one. Without that, `env` becomes a union and
				// `UnwrapConfig` (which `cf workers types` uses to infer
				// `Env`) can no longer see the binding types — the mode
				// behaviour and the generated types both have to survive.
				...(isProduction
					? {
							BETTER_AUTH_URL: bindings.text(PRODUCTION_BETTER_AUTH_URL),
							MEDIA_PUBLIC_BASE_URL: bindings.text(PRODUCTION_MEDIA_PUBLIC_BASE_URL),
						}
					: ({} as {
							BETTER_AUTH_URL?: ReturnType<typeof bindings.text>;
							MEDIA_PUBLIC_BASE_URL?: ReturnType<typeof bindings.text>;
						})),
				// Runtime secrets. Infisical is the value SoT
				// (ADR-0015 §6 / §9); Workers Builds injects values at
				// deploy time via `cf deploy --secrets-file`.
				// Keyed by the shared contract names, so a name cannot
				// drift between this config and the deploy-time gate in
				// `run-deploy-inner.mjs` / `check-cloudflare-contract.mjs`.
				[WORKER_RUNTIME_SECRET.BETTER_AUTH_SECRETS]: bindings.secret(),
				[WORKER_RUNTIME_SECRET.CONSUMER_API_KEY]: bindings.secret(),
				[WORKER_RUNTIME_SECRET.GA_MEASUREMENT_ID]: bindings.secret(),
				// D1 needs the ID under the cf CLI.
				DB: bindings.d1({
					name: D1_DATABASE_NAME,
					id: D1_DATABASE_ID,
					// Issue #377 — remote ONLY in the explicit
					// production-readonly development mode.
					dev: { remote: !isProduction && productionDataMode() },
				}),
				MEDIA: bindings.r2({
					name: R2_BUCKET_NAME,
					// Issue #377 — see the DB binding above.
					dev: { remote: !isProduction && productionDataMode() },
				}),
				// Per-consumer-principal rate limits (ADR-0010). These are
				// the runtime's only rate-limit layer; the Better Auth
				// api-key plugin's per-key limit is disabled because two
				// layers would gate on the lower budget.
				[RATE_LIMIT_BINDING.WRITE]: bindings.rateLimit({
					namespace: RATE_LIMIT_NAMESPACES[RATE_LIMIT_BINDING.WRITE],
					simple: { ...RATE_LIMITS[RATE_LIMIT_BINDING.WRITE] },
				}),
				[RATE_LIMIT_BINDING.READ]: bindings.rateLimit({
					namespace: RATE_LIMIT_NAMESPACES[RATE_LIMIT_BINDING.READ],
					simple: { ...RATE_LIMITS[RATE_LIMIT_BINDING.READ] },
				}),
				ASSETS: bindings.assets(),
				...localApiModeBinding(isProduction),
				...dataSourceBinding(isProduction),
			},
		};
	},
});
