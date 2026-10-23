import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { discoverAuthSchemaTestFiles } from './scripts/_vitest-auth-schema-scan.mjs';
import { createOutboundPolicy } from './scripts/_vitest-outbound-policy.mjs';
import {
	AUTH_SCHEMA_ENV_VAR,
	WARMUP_ENV_VAR,
	encodeAuthSchemaTestFiles,
	encodeWarmupTestFiles,
} from './scripts/_vitest-setup-needs.mjs';
import { discoverWarmupTestFiles } from './scripts/_vitest-warmup-scan.mjs';

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
 *
 * Setup-file scope (Issue #618)
 * -----------------------------
 * `Better Auth schema` setup imports `cloudflare:test` to reach `env.DB`,
 * and that import connects the file to the Workers pool (~2.4s per test
 * FILE). The DDL is only needed by files whose import graph can reach a
 * binding (`cloudflare:test`) or the `env` accessor (`cloudflare:workers`);
 * `test.env[AUTH_SCHEMA_ENV_VAR]` carries the absolute paths of those
 * files, and the setup applies the schema only for them. Every other
 * file keeps running in the same workerd pool but never opens a pool
 * connection. The check fails safe: when the setup cannot decide, it
 * applies the schema.
 *
 * Warm-up scope (Issue #261)
 * --------------------------
 * `test/setup/warm-up.ts` uses the SAME file-scoped principle: only a
 * file that imports the `SELF` binding can issue a worker request, so
 * only those files pay for the pool connection the warm-up needs.
 * `scripts/_vitest-warmup-scan.mjs` computes that set and carries it
 * through `test.env[WARMUP_ENV_VAR]`; the check fails safe (when the
 * setup cannot decide, it warms up). The warm-up moves the workerd
 * cold start OUT of the timed tests — it does not change any timeout
 * value. See `docs/verification/quality/flaky-unit-suite-261.md`.
 *
 * Outbound requests (Issue #261)
 * ------------------------------
 * The Worker under test must not reach the public internet. It used
 * to: the home route calls its own origin, and this pool's request
 * origin is a public host name. `outboundService` answers every
 * outbound request locally, so a home render no longer spends real
 * network time — and no longer sends traffic to production from a
 * test run. The policy and its reasoning live in
 * `scripts/_vitest-outbound-policy.mjs`.
 */
const repoRoot = dirname(fileURLToPath(import.meta.url));
const authSchemaTestFiles = discoverAuthSchemaTestFiles(repoRoot);
const warmupTestFiles = discoverWarmupTestFiles(repoRoot);

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
				// The Worker under test must not reach the public internet
				// (Issue #261). The home route is its own consumer of the
				// access-counter and reactions APIs, so rendering it makes
				// the Worker call its OWN origin — and in this pool that
				// origin is a real public host, so every home render used
				// to spend real DNS + TLS + round-trip time on the open
				// internet (`cors.test.ts` even used the production
				// origin). That made the suite non-hermetic AND slow
				// (measured 1900-3100 ms per home render, and the reason
				// `d1.test.ts` still timed out once after the cold-start
				// fix).
				//
				// The pool answers every outbound request locally with a
				// 503, so the upstream call fails FAST and the Worker
				// takes the same degradation branch it already took
				// (the old answer was a 404/405 from the public host).
				// No assertion changes, and the suite no longer depends on
				// public or production availability. The policy and its
				// reasoning live in `scripts/_vitest-outbound-policy.mjs`.
				outboundService: createOutboundPolicy(),
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
		env: {
			[AUTH_SCHEMA_ENV_VAR]: encodeAuthSchemaTestFiles(authSchemaTestFiles),
			[WARMUP_ENV_VAR]: encodeWarmupTestFiles(warmupTestFiles),
		},
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
		setupFiles: ['./test/setup/better-auth-schema.ts', './test/setup/warm-up.ts'],
	},
});
