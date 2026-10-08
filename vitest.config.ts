import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vitest/config';
import {
	PRODUCTION_BETTER_AUTH_URL,
	PRODUCTION_MEDIA_PUBLIC_BASE_URL,
	RATE_LIMITS,
	RATE_LIMIT_BINDING,
	RATE_LIMIT_NAMESPACES,
	WORKER_RUNTIME_SECRET,
} from './scripts/_cloudflare-contract.mjs';
import { D1_DATABASE_ID, R2_BUCKET_NAME } from './scripts/_cloudflare-identity.mjs';

/**
 * Vitest configuration for my-web-2026.
 *
 * Plugins are the **workerd-aware subset** of `vite.config.ts`:
 *   - `cloudflareTest()` provides the Workers test pool (`SELF`, `env`)
 *   - `tanstackStart()` is required so that the worker bundle resolves
 *     `#tanstack-router-entry` / `#tanstack-start-entry` virtual modules
 *     when workerd pulls in `src/server.ts`.
 *
 * `@cloudflare/vite-plugin` is intentionally **not** included here:
 * vitest runs in its own Vite environment and only needs to bundle the
 * Worker once per session to feed workerd.
 *
 * No Wrangler config (Issue #247)
 * -------------------------------
 * This used to pass `wrangler: { configPath: './wrangler.jsonc' }`,
 * which made the test pool parse a file the migration deletes. The pool
 * accepts `main` plus direct `miniflare` options, so the Worker is now
 * described HERE from the same shared constants that
 * `cloudflare.config.ts` uses.
 *
 * Two properties are deliberate:
 *
 *   - Canonical identity is IMPORTED, never restated. A database id or a
 *     bucket name typed here would be a second declaration that could
 *     drift from the real one, and a test suite asserting against the
 *     wrong database is worse than no suite.
 *   - This is a TEST-ONLY binding set, not a second Worker config. It
 *     reproduces the bindings tests need, plus DUMMY values for the
 *     secret bindings (a test asserts the NAME is required, never a
 *     value). The shipped contract is verified against the generated
 *     Build Output by `check-cloudflare-contract.mjs --build`, which is
 *     the deployed truth; this file does not restate it.
 *
 * Tests:
 *   - `src/**\/*.{test,spec}.{ts,tsx}`           — Hono unit smoke
 *   - `test/integration/**\/*.{test,spec}.{ts,tsx}` — D1 / R2 SELF smoke
 *
 * Both kinds run inside workerd; bindings are real (D1 / R2 / ASSETS).
 */
export default defineConfig({
	plugins: [
		tanstackStart(),
		cloudflareTest({
			main: './src/server.ts',
			miniflare: {
				compatibilityDate: '2026-09-07',
				compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
				d1Databases: { DB: D1_DATABASE_ID },
				r2Buckets: { MEDIA: R2_BUCKET_NAME },
				// Rate limits are real bindings here, not stubs: the
				// rate-limit middleware test asserts against the actual
				// namespace and budget, so a fake would test nothing.
				// Key and field names are Miniflare's own (`ratelimits`,
				// `namespace_id`), not the camelCase Worker-binding names.
				// The pool passes this object straight through, so a
				// camelCase key is silently ignored and every rate-limited
				// request then fails on `simple.limit` of undefined.
				ratelimits: {
					[RATE_LIMIT_BINDING.WRITE]: {
						namespace_id: RATE_LIMIT_NAMESPACES[RATE_LIMIT_BINDING.WRITE],
						simple: { ...RATE_LIMITS[RATE_LIMIT_BINDING.WRITE] },
					},
					[RATE_LIMIT_BINDING.READ]: {
						namespace_id: RATE_LIMIT_NAMESPACES[RATE_LIMIT_BINDING.READ],
						simple: { ...RATE_LIMITS[RATE_LIMIT_BINDING.READ] },
					},
				},
				// Dummy values for the secret bindings. A test asserts the
				// NAME is required and the value is never read back, so a
				// placeholder is correct and a real credential would be
				// wrong. These are NOT production values.
				// Mirrors `cloudflare.config.ts` in DEVELOPMENT mode, which
				// is what the test pool is. The production-only text vars
				// (`BETTER_AUTH_URL`, `MEDIA_PUBLIC_BASE_URL`) are
				// deliberately ABSENT: binding them made
				// `composeMediaUrl` return a real URL where the loader
				// tests assert the unbound placeholder branch, which is
				// the branch a deployment without the R2 custom domain
				// actually takes.
				bindings: {
					[WORKER_RUNTIME_SECRET.BETTER_AUTH_SECRETS]: '1:dummy-test-secret-not-real',
					[WORKER_RUNTIME_SECRET.CONSUMER_API_KEY]: 'mk_home_dummy-test-key-not-real',
					[WORKER_RUNTIME_SECRET.GA_MEASUREMENT_ID]: 'G-DUMMYTEST00',
					MY_WEB_2026_REACTIONS_TARGET: 'home-page',
					MY_WEB_2026_COUNTER_KEY: 'home-page',
				},
			},
		}),
	],
	test: {
		include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/integration/**/*.{test,spec}.{ts,tsx}'],
		exclude: [
			'node_modules',
			'dist',
			'dist-cloudflare',
			'.vinxi',
			'.output',
			// Local Cloudflare state (the canonical `--persist-to` path
			// since Issue #247) and the legacy Wrangler state directory.
			'.tmp',
			'.wrangler',
			// Files matching `*.client.test.{ts,tsx}` are dispatched to
			// `vitest.client.config.ts` (happy-dom + React Testing
			// Library). The workerd pool here does not support a DOM
			// environment — `vm.Script` in Node collides with the
			// happy-dom shim — so we exclude them from this config.
			'**/*.client.test.{ts,tsx}',
		],
		// Apply the canonical Better Auth + auth_invitation schema to
		// the local D1 binding BEFORE any test file is loaded. The
		// Better Auth module eagerly validates its schema at import
		// time and caches the verdict — see test/setup/better-auth-schema.ts.
		setupFiles: ['./test/setup/better-auth-schema.ts'],
	},
});
