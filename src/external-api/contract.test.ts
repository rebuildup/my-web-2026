import { describe, expect, it } from 'vitest';
import {
	DEFAULT_EXTERNAL_READ_POLICY,
	EXTERNAL_FAILURE_LABEL,
	type ExternalBreaker,
	ExternalReadError,
	type ExternalReadPolicy,
	type ExternalSnapshot,
	allowAttempt,
	applyBlocked,
	applyFailure,
	applySuccess,
	classifyThrown,
	freshnessOf,
	initialBreaker,
	recordOutcome,
	resolveReadPolicy,
	retryDelayMs,
	withRecomputedFreshness,
} from './contract';

/**
 * Contract tests for the snapshot state machine (Issue #499).
 *
 * These pin the properties the display component relies on, so a
 * future adapter cannot reintroduce a persistent spinner or a failure
 * that clears the value on screen:
 *
 *   - every settled attempt leaves `loading`,
 *   - a failure preserves the last known value AND its instant,
 *   - the retry cadence is bounded and always finite,
 *   - the public failure vocabulary is closed and label-complete.
 */

const policy = DEFAULT_EXTERNAL_READ_POLICY;
const T0 = Date.parse('2026-10-18T00:00:00.000Z');

describe('policy', () => {
	it('keeps every window positive and the retry cadence ordered', () => {
		expect(policy.timeoutMs).toBeGreaterThan(0);
		expect(policy.staleAfterMs).toBeGreaterThanOrEqual(policy.timeoutMs);
		expect(policy.failureThreshold).toBeGreaterThanOrEqual(1);
		expect(policy.openMs).toBeGreaterThan(0);
		expect(policy.retryBaseMs).toBeGreaterThan(0);
		expect(policy.retryMaxMs).toBeGreaterThanOrEqual(policy.retryBaseMs);
		expect(policy.maxResponseBytes).toBeGreaterThan(0);
	});

	it('merges overrides over the default and ignores nothing silently', () => {
		expect(resolveReadPolicy()).toEqual(DEFAULT_EXTERNAL_READ_POLICY);
		const merged = resolveReadPolicy({ timeoutMs: 250 });
		expect(merged.timeoutMs).toBe(250);
		expect(merged.openMs).toBe(policy.openMs);
	});

	it('does not share a mutable object with the default policy', () => {
		const merged = resolveReadPolicy();
		expect(merged).not.toBe(DEFAULT_EXTERNAL_READ_POLICY);
		expect(merged).toEqual(DEFAULT_EXTERNAL_READ_POLICY);
	});
});

describe('failure vocabulary', () => {
	it('has a public label for every reason and no extra key', () => {
		const reasons = [
			'timeout',
			'network',
			'rate-limited',
			'not-found',
			'upstream-error',
			'malformed-response',
		] as const;
		expect(Object.keys(EXTERNAL_FAILURE_LABEL).sort()).toEqual([...reasons].sort());
		for (const reason of reasons) {
			expect(EXTERNAL_FAILURE_LABEL[reason].length).toBeGreaterThan(0);
		}
	});

	it('builds an error message from the reason alone, never from upstream text', () => {
		const error = new ExternalReadError('timeout');
		expect(error.message).toBe('external read failed: timeout');
		expect(error.reason).toBe('timeout');
	});

	it('classifies thrown values without leaking their message', () => {
		expect(classifyThrown(new ExternalReadError('rate-limited'))).toBe('rate-limited');
		expect(classifyThrown(new DOMException('aborted', 'AbortError'))).toBe('timeout');
		expect(classifyThrown(new DOMException('deadline', 'TimeoutError'))).toBe('timeout');
		expect(classifyThrown(new Error('ECONNREFUSED 10.0.0.1:5432'))).toBe('network');
		expect(classifyThrown('a string')).toBe('network');
	});
});

describe('breaker', () => {
	it('allows attempts while closed and reports no retry instant', () => {
		const decision = allowAttempt(initialBreaker(), T0, policy);
		expect(decision).toEqual({ allowed: true, probe: false, retryAt: null });
	});

	it('blocks every attempt while open and names the next probe instant', () => {
		const opened = { state: 'open', consecutiveFailures: 3, openedAt: T0 } as const;
		const decision = allowAttempt(opened, T0 + policy.openMs - 1, policy);
		expect(decision.allowed).toBe(false);
		expect(decision.probe).toBe(false);
		expect(decision.retryAt).toBe(T0 + policy.openMs);
	});

	it('allows exactly one probe once the cooldown elapsed', () => {
		const opened = { state: 'open', consecutiveFailures: 3, openedAt: T0 } as const;
		expect(allowAttempt(opened, T0 + policy.openMs, policy)).toEqual({
			allowed: true,
			probe: true,
			retryAt: null,
		});
	});

	it('opens at the threshold and closes on the next success', () => {
		let breaker = initialBreaker();
		breaker = { ...breaker, ...recordAll(breaker, ['failure', 'failure'], T0, policy) };
		expect(breaker.consecutiveFailures).toBe(2);
		expect(breaker.state).toBe('closed');
		breaker = { ...breaker, ...recordAll(breaker, ['failure'], T0, policy) };
		expect(breaker.state).toBe('open');
		expect(breaker.openedAt).toBe(T0);
		breaker = { ...breaker, ...recordAll(breaker, ['success'], T0 + 1, policy) };
		expect(breaker).toEqual(initialBreaker());
	});

	it('re-opens immediately when a probe fails', () => {
		const probing = { state: 'half-open', consecutiveFailures: 3, openedAt: T0 } as const;
		const breaker = recordAll(probing, ['failure'], T0 + policy.openMs, policy);
		expect(breaker.state).toBe('open');
		expect(breaker.openedAt).toBe(T0 + policy.openMs);
	});

	it('honours an overridden threshold', () => {
		const strict = { ...policy, failureThreshold: 1 };
		const breaker = recordAll(initialBreaker(), ['failure'], T0, strict);
		expect(breaker.state).toBe('open');
	});

	it('refuses an attempt inside the published retry cadence while closed', () => {
		// `retryAt` is a contract with the visitor, so the reader
		// enforces it even though the breaker never opened.
		const notBefore = T0 + retryDelayMs(2, policy);
		const refused = allowAttempt(initialBreaker(), notBefore - 1, policy, notBefore);
		expect(refused).toEqual({ allowed: false, probe: false, retryAt: notBefore });
	});

	it('allows the attempt the cadence promised, at that instant', () => {
		const notBefore = T0 + retryDelayMs(2, policy);
		expect(allowAttempt(initialBreaker(), notBefore, policy, notBefore)).toEqual({
			allowed: true,
			probe: false,
			retryAt: null,
		});
	});

	it('ignores a cadence instant that is already in the past', () => {
		expect(allowAttempt(initialBreaker(), T0, policy, T0 - 1)).toEqual({
			allowed: true,
			probe: false,
			retryAt: null,
		});
	});
});

function recordAll(
	breaker: ExternalBreaker,
	outcomes: readonly ('success' | 'failure')[],
	now: number,
	effectivePolicy: ExternalReadPolicy,
) {
	let next = breaker;
	for (const outcome of outcomes) {
		next = recordOutcome(next, outcome, now, effectivePolicy);
	}
	return next;
}

describe('retry cadence', () => {
	it('doubles from the base delay and clamps at the ceiling', () => {
		expect(retryDelayMs(1, policy)).toBe(policy.retryBaseMs);
		expect(retryDelayMs(2, policy)).toBe(policy.retryBaseMs * 2);
		expect(retryDelayMs(3, policy)).toBe(policy.retryBaseMs * 4);
		expect(retryDelayMs(99, policy)).toBe(policy.retryMaxMs);
	});

	it('never returns a negative or zero delay for a hostile attempt count', () => {
		expect(retryDelayMs(0, policy)).toBe(policy.retryBaseMs);
		expect(retryDelayMs(-5, policy)).toBe(policy.retryBaseMs);
		expect(retryDelayMs(1.5, policy)).toBe(policy.retryBaseMs);
	});
});

describe('freshness', () => {
	it('is fresh inside the window and stale outside it', () => {
		expect(freshnessOf(new Date(T0).toISOString(), T0 + 1_000, policy)).toBe('fresh');
		expect(freshnessOf(T0, T0 + policy.staleAfterMs, policy)).toBe('fresh');
		expect(freshnessOf(T0, T0 + policy.staleAfterMs + 1, policy)).toBe('stale');
	});

	it('reports an unparseable instant as stale rather than throwing', () => {
		expect(freshnessOf('not-a-date', T0, policy)).toBe('stale');
	});

	it('ages a value without touching it', () => {
		const snapshot = applySuccess({ stars: 1 }, T0);
		const aged = withRecomputedFreshness(snapshot, T0 + policy.staleAfterMs + 1, policy);
		expect(aged).toEqual({ ...snapshot, freshness: 'stale' });
		// The original snapshot is immutable — ageing produced a new one.
		expect(snapshot.status === 'value' && snapshot.freshness).toBe('fresh');
	});

	it('leaves degraded and loading snapshots untouched', () => {
		const loading: ExternalSnapshot<number> = { status: 'loading' };
		expect(withRecomputedFreshness(loading, T0, policy)).toBe(loading);
		const degraded = applyFailure(
			applySuccess(7, T0),
			'timeout',
			T0 + 1,
			{ state: 'closed', consecutiveFailures: 1, openedAt: null },
			policy,
		);
		expect(withRecomputedFreshness(degraded, T0 + 10_000_000, policy)).toBe(degraded);
	});
});

/**
 * Narrow a snapshot for assertions.
 *
 * `expect(snapshot.status).toBe('degraded')` does not narrow the type,
 * and the degraded branch is where this contract lives, so the
 * assertion helper doubles as the type guard.
 */
function degradedOf<T>(snapshot: ExternalSnapshot<T>) {
	if (snapshot.status !== 'degraded') {
		throw new Error(`expected a degraded snapshot, got ${snapshot.status}`);
	}
	return snapshot;
}

describe('snapshot transitions', () => {
	it('replaces loading with a value on the first success', () => {
		const snapshot = applySuccess(42, T0);
		expect(snapshot).toEqual({
			status: 'value',
			value: 42,
			observedAt: new Date(T0).toISOString(),
			freshness: 'fresh',
			breaker: 'closed',
		});
	});

	it('keeps the value and the instant when a later attempt fails', () => {
		const healthy = applySuccess(42, T0);
		const breaker = { state: 'closed', consecutiveFailures: 1, openedAt: null } as const;
		const degraded = degradedOf(applyFailure(healthy, 'timeout', T0 + 60_000, breaker, policy));

		expect(degraded.status).toBe('degraded');
		expect(degraded.value).toBe(42);
		expect(degraded.observedAt).toBe(healthy.status === 'value' ? healthy.observedAt : null);
		expect(degraded.reason).toBe('timeout');
		expect(degraded.failedAt).toBe(new Date(T0 + 60_000).toISOString());
		expect(degraded.retryable).toBe(true);
		expect(degraded.breaker).toBe('closed');
	});

	it('degrades with a null value when the FIRST attempt fails', () => {
		const degraded = degradedOf(
			applyFailure(
				{ status: 'loading' },
				'network',
				T0,
				{ state: 'closed', consecutiveFailures: 1, openedAt: null },
				policy,
			),
		);
		expect(degraded.status).toBe('degraded');
		expect(degraded.value).toBeNull();
		expect(degraded.observedAt).toBeNull();
		expect(degraded.retryable).toBe(true);
	});

	it('is never loading again after a settled attempt', () => {
		const outcomes: ExternalSnapshot<number>[] = [
			applySuccess(1, T0),
			applyFailure(applySuccess(1, T0), 'network', T0 + 1, initialBreaker(), policy),
			applyFailure({ status: 'loading' }, 'timeout', T0 + 2, initialBreaker(), policy),
		];
		expect(outcomes.every((snapshot) => snapshot.status !== 'loading')).toBe(true);
	});

	it('states the next probe instant and refuses retry while open', () => {
		const healthy = applySuccess(9, T0);
		const open = { state: 'open', consecutiveFailures: 3, openedAt: T0 } as const;
		const degraded = degradedOf(applyFailure(healthy, 'rate-limited', T0 + 10_000, open, policy));
		expect(degraded.breaker).toBe('open');
		expect(degraded.retryable).toBe(false);
		expect(degraded.retryAt).toBe(new Date(T0 + policy.openMs).toISOString());
		expect(degraded.value).toBe(9);
	});

	it('preserves the value and the original failure instant when blocked', () => {
		const degraded = degradedOf(
			applyFailure(
				applySuccess(9, T0),
				'timeout',
				T0 + 10_000,
				{ state: 'open', consecutiveFailures: 3, openedAt: T0 },
				policy,
			),
		);
		const blocked = degradedOf(
			applyBlocked(degraded, 'timeout', T0 + 20_000, degradedBreaker(), T0 + policy.openMs),
		);
		expect(blocked.status).toBe('degraded');
		expect(blocked.value).toBe(9);
		expect(blocked.reason).toBe('timeout');
		// The refusal did not invent a new failure instant.
		expect(blocked.failedAt).toBe(degraded.failedAt);
		expect(blocked.retryable).toBe(false);
		expect(blocked.retryAt).toBe(new Date(T0 + policy.openMs).toISOString());
	});

	it('reports the breaker it actually has when a cadence attempt is refused', () => {
		// A cadence refusal is not an incident: the breaker stays closed,
		// and the snapshot must not imply an incident that was never
		// declared (the card badges the breaker state).
		const notBefore = T0 + retryDelayMs(1, policy);
		const blocked = degradedOf(
			applyBlocked({ status: 'loading' }, 'timeout', T0, initialBreaker(), notBefore),
		);
		expect(blocked.breaker).toBe('closed');
		expect(blocked.retryable).toBe(false);
		expect(blocked.retryAt).toBe(new Date(notBefore).toISOString());
		expect(blocked.value).toBeNull();
	});

	it('degrades a never-read source with a null value when blocked', () => {
		const blocked = degradedOf(
			applyBlocked(
				{ status: 'loading' },
				'network',
				T0,
				{ state: 'open', consecutiveFailures: 3, openedAt: T0 },
				T0 + policy.openMs,
			),
		);
		expect(blocked.value).toBeNull();
		expect(blocked.observedAt).toBeNull();
		expect(blocked.breaker).toBe('open');
	});

	function degradedBreaker() {
		return { state: 'open', consecutiveFailures: 3, openedAt: T0 } as const;
	}
});
