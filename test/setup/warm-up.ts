import { beforeAll, expect } from 'vitest';
import { WARMUP_ENV_VAR, needsWarmup } from '../../scripts/_vitest-setup-needs.mjs';

/**
 * Vitest setup file — warms the workerd cold start before the timed
 * tests run (Issue #261).
 *
 * Why this exists
 * ---------------
 * A test file that issues `SELF.fetch` pays the Worker bundle's cold
 * start on its FIRST request: the worker module graph, the TanStack
 * Start route tree and the first SSR render are all loaded on demand.
 * That cost is measured at 2230-3240 ms per file, so the first test
 * spends 45-65% of its 5000 ms budget before it has asserted
 * anything. When the machine is busy, the file fails with
 * "Test timed out in 5000ms" and no failing assertion — the flake
 * Issue #261 reports.
 *
 * The fix is to pay the cold start ONCE, outside any test's budget.
 * This file issues that one request in a `beforeAll` hook, so the
 * cost lands in the hook budget (10 s) and every test in the file
 * measures a warm worker.
 *
 * Scope (Issue #618, extended)
 * ----------------------------
 * Importing `cloudflare:test` connects the file to the Workers pool
 * (~2.4s per test FILE). The import here is therefore CONDITIONAL, on
 * the same file-scoped principle the Better Auth schema setup uses:
 * only a file that imports the `SELF` binding can issue a worker
 * request, so only those files pay for the connection. The set is
 * computed by `scripts/_vitest-warmup-scan.mjs` and carried through
 * `test.env[WARMUP_ENV_VAR]`.
 *
 * The warm-up URL
 * ---------------
 * `https://example.com/__warmup__` is a path that matches no route,
 * so the request renders the SSR 404 surface. That loads the SSR
 * pipeline and the root route — the part of the bundle the cold start
 * consists of — without touching a binding, a data store or a
 * third-party origin. A measured alternative was the home page, but it
 * reads the reaction catalog and the access counter, which produced
 * "no such table" noise in every file's log. The 404 path produced
 * none.
 *
 * The request cannot leave the machine either: the pool's outbound
 * policy answers every outbound request itself
 * (`scripts/_vitest-outbound-policy.mjs`). The 404 path issues no
 * outbound request at all, so the warm-up is local by construction.
 *
 * Best effort
 * -----------
 * The warm-up is a performance measure, not an assertion. If it
 * fails, the file behaves exactly as it did before this setup file
 * existed — the cold start stays in the first test. It therefore
 * never fails a test on its own.
 */

if (needsWarmup(expect.getState().testPath, process.env[WARMUP_ENV_VAR])) {
	const { SELF } = await import('cloudflare:test');
	beforeAll(async () => {
		try {
			await SELF.fetch('https://example.com/__warmup__', { redirect: 'manual' });
		} catch {
			// A warm-up that cannot run leaves the file in its previous
			// state. It must never turn into a test failure.
		}
	});
}
