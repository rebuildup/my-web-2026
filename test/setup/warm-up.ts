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
 * cost lands in the HOOK budget and every test in the file measures a
 * warm worker. Which hook budget: see "Best effort" below (Issue #900
 * made that budget explicit and finite instead of the 10 s default).
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
 * Best effort (Issue #900)
 * ------------------------
 * The warm-up is a performance measure, not an assertion. If it
 * fails, the file behaves exactly as it did before this setup file
 * existed — the cold start stays in the first test. It therefore
 * never fails a test on its own. Before Issue #900 that sentence was
 * FALSE: the hook passed no timeout, Vitest's default `hookTimeout`
 * (10 000 ms) applied, and a hook timeout fires OUTSIDE any try/catch
 * — on a loaded machine the cold start passed 10 s, the hook
 * rejected with `Error: Hook timed out in 10000ms.` and the whole
 * FILE failed as a suite failure. Issue #900 measured 17 such files
 * in one `validate:fast` run; the false red verified nothing.
 *
 * The hook can no longer fail a file, by construction:
 *
 *   1. BOUNDED RACE — the hook awaits `Promise`-style race of the
 *      request against a finite timer (`WARMUP_BOUND_MS`). Whichever
 *      side settles first ends the hook, so the hook body itself can
 *      never outlive the bound. The request's rejection is consumed
 *      by the race, so an abandoned request can still settle later
 *      without an unhandled rejection.
 *   2. EXPLICIT HOOK TIMEOUT — the hook passes
 *      `WARMUP_HOOK_TIMEOUT_MS`, strictly LARGER than the bound.
 *      Vitest's own timer therefore always loses the race to the
 *      bound and can never be the thing that ends the hook.
 *
 * Why WARMUP_BOUND_MS = 60 000 (finite, not generous-for-its-own-sake):
 *
 *   - It is above the worst cold start ever measured under load:
 *     56 700 ms (Issue #900, cors.test.ts with a 60 s hook budget on a
 *     loaded machine). On THIS box the same day, a full
 *     `validate:fast` run pushed the hook past the old 10 s default
 *     (`Error: Hook timed out in 10000ms.` at this file's hook,
 *     gate-887-e run 2026-11-04) — the exact cliff this issue removes.
 *     A bound below those numbers would abandon a cold start that was
 *     still going to finish, pushing its remaining cost into the
 *     first test — trading a suite failure for a test failure.
 *   - It is finite so a REAL hang cannot be absorbed silently: the
 *     hook stops waiting at 60 s instead of stalling the file, and a
 *     genuinely stuck request then surfaces where it belongs — in the
 *     tests that need the Worker, which fail on their own budgets.
 *     Nothing is skipped, retried or deferred to make that happen.
 *
 * Observability: a cold start longer than
 * `WARMUP_OVER_BUDGET_THRESHOLD_MS` (10 000 ms — the old default
 * hook timeout, i.e. the exact cliff this issue removes) emits ONE
 * status-only line with the duration. No URL, no headers, no response
 * body, no value of any kind: `test/setup/**` lives outside `src/**`
 * so it is outside the `log:redaction:check` scope (confirmed by
 * running that gate, not assumed), and the line still prints nothing
 * a redaction rule could object to.
 */

/**
 * Finite wait bound for the warm-up request — see "Best effort" for
 * why this number. The hook settles no later than this.
 */
const WARMUP_BOUND_MS = 60_000;

/**
 * Explicit `beforeAll` timeout, strictly larger than
 * `WARMUP_BOUND_MS` so Vitest's timer never fires first (Issue #900).
 */
const WARMUP_HOOK_TIMEOUT_MS = 75_000;

/**
 * Duration above which the hook reports itself as over budget
 * (10 000 ms = the former default `hookTimeout`, the cliff #900
 * removed). Reporting threshold only — it does not change behaviour.
 */
const WARMUP_OVER_BUDGET_THRESHOLD_MS = 10_000;

if (needsWarmup(expect.getState().testPath, process.env[WARMUP_ENV_VAR])) {
	const { SELF } = await import('cloudflare:test');
	beforeAll(async () => {
		const startedAt = Date.now();
		// Bounded race: the request OR the finite timer, whichever comes
		// first. Both branches resolve — never reject — so this hook has
		// no path to an uncaught rejection and no path past the bound.
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, WARMUP_BOUND_MS);
			const settle = () => {
				clearTimeout(timer);
				resolve();
			};
			try {
				void SELF.fetch('https://example.com/__warmup__', { redirect: 'manual' }).then(
					settle,
					() => {
						// A warm-up that cannot run leaves the file in its
						// previous state. It must never turn into a failure.
						settle();
					},
				);
			} catch {
				// Synchronous refusal (pool not connected): same contract —
				// a warm-up that cannot run is not a test failure.
				settle();
			}
		});
		const elapsed = Date.now() - startedAt;
		if (elapsed > WARMUP_OVER_BUDGET_THRESHOLD_MS) {
			// Status-only: a duration, nothing else (Issue #900).
			console.log(`[warm-up] cold start over budget: ${elapsed}ms`);
		}
	}, WARMUP_HOOK_TIMEOUT_MS);
}
