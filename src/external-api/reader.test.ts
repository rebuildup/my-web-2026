import { describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_EXTERNAL_READ_POLICY,
	ExternalReadError,
	type ExternalSnapshot,
	type ExternalSource,
} from './contract';
import { type ExternalAdapter, createExternalReader } from './reader';

/**
 * Reader behaviour: the deadline, the coalescing load property, the
 * breaker, and the non-destructive fallback (Issue #499).
 *
 * Every adapter here is a fake with a scriptable outcome — no test in
 * this file touches the network, so the suite is a contract test of
 * the READER rather than of GitHub.
 */

const T0 = Date.parse('2026-10-18T00:00:00.000Z');

const SOURCE = {
	id: 'fake-source',
	label: 'example.invalid',
	endpoint: 'https://example.invalid/read',
	sendsCredentials: false,
	budgetNote: 'test double',
} as const satisfies ExternalSource;

interface Script {
	/** Resolve after this many ms. `null` = never settles (ignores the abort signal). */
	settleAfterMs: number | null;
	value?: number;
	failure?: ExternalReadError | Error;
}

function fakeAdapter(scripts: Script[]) {
	const calls: { signals: AbortSignal[] } = { signals: [] };
	let index = 0;
	const adapter: ExternalAdapter<number> = {
		source: SOURCE,
		read: (signal) => {
			calls.signals.push(signal);
			const script = scripts[Math.min(index, scripts.length - 1)];
			index += 1;
			return new Promise<number>((resolve, reject) => {
				if (script.settleAfterMs === null) return; // ignores the signal on purpose
				setTimeout(() => {
					if (script.failure) reject(script.failure);
					else resolve(script.value ?? 0);
				}, script.settleAfterMs);
			});
		},
	};
	return { adapter, calls, attempts: () => calls.signals.length };
}

function ok(value: number, settleAfterMs = 0): Script {
	return { settleAfterMs, value };
}

function fails(failure: Error, settleAfterMs = 0): Script {
	return { settleAfterMs, failure };
}

/** An adapter that raises BEFORE it returns a Promise (Codex review finding). */
function throwingAdapter(failure: Error) {
	const calls = { count: 0 };
	const adapter: ExternalAdapter<number> = {
		source: SOURCE,
		read: () => {
			calls.count += 1;
			throw failure;
		},
	};
	return { adapter, attempts: () => calls.count };
}

describe('successful reads', () => {
	it('settles on a value with its observation instant', async () => {
		const { adapter } = fakeAdapter([ok(42)]);
		const reader = createExternalReader(adapter, { now: () => T0 });
		const snapshot = await reader.read();
		expect(snapshot).toEqual({
			status: 'value',
			value: 42,
			observedAt: new Date(T0).toISOString(),
			freshness: 'fresh',
			breaker: 'closed',
		});
		expect(reader.busy()).toBe(false);
	});

	it('starts in loading and leaves it for a terminal state', async () => {
		const { adapter } = fakeAdapter([ok(1, 5)]);
		const reader = createExternalReader(adapter, { now: () => T0 });
		expect(reader.snapshot()).toEqual({ status: 'loading' });
		await reader.read();
		expect(reader.snapshot().status).toBe('value');
	});

	it('reports the source it reads', () => {
		const { adapter } = fakeAdapter([ok(1)]);
		const reader = createExternalReader(adapter);
		expect(reader.source).toBe(SOURCE);
		expect(reader.policy).toEqual(DEFAULT_EXTERNAL_READ_POLICY);
	});
});

describe('deadline', () => {
	it('settles as a timeout when the adapter ignores its abort signal', async () => {
		// A transport that never settles and never aborts is the exact
		// shape of the bug this contract exists to prevent.
		const { adapter } = fakeAdapter([{ settleAfterMs: null }]);
		const reader = createExternalReader(adapter, {
			now: () => T0,
			policy: { timeoutMs: 20 },
		});
		const started = Date.now();
		const snapshot = await reader.read();
		expect(snapshot.status).toBe('degraded');
		expect(snapshot.status === 'degraded' && snapshot.reason).toBe('timeout');
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(reader.snapshot().status).not.toBe('loading');
	});

	it('aborts the adapter signal when the deadline elapses', async () => {
		const { adapter, calls } = fakeAdapter([{ settleAfterMs: null }]);
		const reader = createExternalReader(adapter, { policy: { timeoutMs: 20 } });
		await reader.read();
		expect(calls.signals[0]?.aborted).toBe(true);
	});

	it('does not leave a pending timer after a settled attempt', async () => {
		vi.useFakeTimers();
		try {
			const { adapter } = fakeAdapter([ok(7)]);
			const reader = createExternalReader(adapter);
			const settled = reader.read();
			await vi.advanceTimersByTimeAsync(1);
			await settled;
			// A leaked deadline would keep a Worker's event loop alive and
			// make every later read pay for it. `busy()` cannot see that,
			// so the TIMER COUNT is the assertion.
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not leave a pending timer after a failed attempt either', async () => {
		vi.useFakeTimers();
		try {
			const { adapter } = fakeAdapter([fails(new ExternalReadError('network'))]);
			const reader = createExternalReader(adapter);
			const settled = reader.read();
			await vi.advanceTimersByTimeAsync(1);
			await settled;
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('an adapter that throws before it returns a Promise', () => {
	it('settles as a failure instead of rejecting the attempt', async () => {
		// `ExternalAdapter.read` is typed to return a Promise, but an
		// implementation can raise synchronously. That is a failed READ,
		// so it must take the ordinary failure transition: otherwise the
		// snapshot stays `loading` forever — the exact failure this
		// obligation exists to prevent.
		const { adapter, attempts } = throwingAdapter(new ExternalReadError('network'));
		const reader = createExternalReader(adapter, { now: () => T0 });
		const snapshot = await reader.read();
		expect(snapshot.status).toBe('degraded');
		expect(snapshot.status === 'degraded' && snapshot.reason).toBe('network');
		expect(reader.snapshot().status).not.toBe('loading');
		expect(attempts()).toBe(1);
	});

	it('counts the failure towards the breaker like any other', async () => {
		const { adapter } = throwingAdapter(new Error('boom'));
		const now = T0;
		const reader = createExternalReader(adapter, {
			now: () => now,
			policy: { failureThreshold: 1, openMs: 1_000 },
		});
		await reader.read();
		const refused = await reader.retry();
		expect(refused.status === 'degraded' && refused.breaker).toBe('open');
		expect(refused.status === 'degraded' && refused.retryable).toBe(false);
	});
});

describe('load', () => {
	it('coalesces concurrent callers into ONE upstream attempt', async () => {
		const { adapter, attempts } = fakeAdapter([ok(5, 10)]);
		const reader = createExternalReader(adapter);
		const results = await Promise.all(Array.from({ length: 50 }, () => reader.read()));
		expect(attempts()).toBe(1);
		// Every caller observes the same settled snapshot.
		for (const result of results) expect(result).toEqual(results[0]);
	});

	it('coalesces a retry pressed while an attempt is in flight', async () => {
		const { adapter, attempts } = fakeAdapter([ok(5, 10)]);
		const reader = createExternalReader(adapter);
		const [a, b] = await Promise.all([reader.read(), reader.retry()]);
		expect(attempts()).toBe(1);
		expect(a).toEqual(b);
	});

	it('starts a NEW attempt after the previous one settled', async () => {
		const { adapter, attempts } = fakeAdapter([ok(1), ok(2)]);
		const reader = createExternalReader(adapter);
		const first = await reader.read();
		expect(first.status === 'value' && first.value).toBe(1);
		const second = await reader.read();
		expect(second.status === 'value' && second.value).toBe(2);
		expect(attempts()).toBe(2);
	});
});

describe('breaker', () => {
	it('opens after the configured consecutive failures and stops calling upstream', async () => {
		const { adapter, attempts } = fakeAdapter([fails(new ExternalReadError('timeout'))]);
		let now = T0;
		const reader = createExternalReader(adapter, {
			now: () => now,
			policy: { failureThreshold: 3, openMs: 60_000 },
		});
		// Each read waits out the cadence the previous failure published
		// (`retryBaseMs` 1 s, 2 s), so the breaker — not the cadence — is
		// what stops the third attempt.
		await reader.read();
		now = T0 + 1_000;
		await reader.read();
		now = T0 + 3_000;
		await reader.read();
		expect(attempts()).toBe(3);

		const blocked = await reader.read();
		expect(attempts()).toBe(3); // no upstream traffic while blocked
		expect(blocked.status).toBe('degraded');
		expect(blocked.status === 'degraded' && blocked.breaker).toBe('open');
		expect(blocked.status === 'degraded' && blocked.retryable).toBe(false);
		expect(blocked.status === 'degraded' && blocked.retryAt).toBe(
			new Date(T0 + 3_000 + 60_000).toISOString(),
		);
	});

	it('refuses an attempt inside the retry cadence it published', async () => {
		// The cadence is a contract with the visitor, not a hint: a
		// pressed retry button must not spend the upstream budget the
		// cadence exists to protect.
		const { adapter, attempts } = fakeAdapter([fails(new ExternalReadError('network')), ok(5)]);
		let now = T0;
		const reader = createExternalReader(adapter, {
			now: () => now,
			policy: { retryBaseMs: 1_000, failureThreshold: 3 },
		});
		const failed = await reader.read();
		expect(attempts()).toBe(1);
		expect(failed.status === 'degraded' && failed.retryAt).toBe(new Date(T0 + 1_000).toISOString());

		const early = await reader.retry();
		expect(attempts()).toBe(1); // still inside the published cadence
		expect(early.status === 'degraded' && early.breaker).toBe('closed');
		expect(early.status === 'degraded' && early.retryable).toBe(false);
		expect(early.status === 'degraded' && early.retryAt).toBe(
			failed.status === 'degraded' ? failed.retryAt : null,
		);

		now = T0 + 1_000;
		const recovered = await reader.retry();
		expect(attempts()).toBe(2);
		expect(recovered.status === 'value' && recovered.value).toBe(5);
	});

	it('runs exactly one probe after the cooldown and closes on success', async () => {
		const { adapter, attempts } = fakeAdapter([
			fails(new ExternalReadError('network')),
			fails(new ExternalReadError('network')),
			ok(77),
		]);
		let now = T0;
		const reader = createExternalReader(adapter, {
			now: () => now,
			policy: { failureThreshold: 2, openMs: 1_000, retryBaseMs: 1_000 },
		});
		await reader.read();
		now = T0 + 1_000; // the cadence the first failure published
		await reader.read();
		expect(attempts()).toBe(2);
		// The second failure opened the breaker at T0+1_000, so its
		// cooldown ends at T0+2_000.
		const afterOpen = reader.snapshot();
		expect(afterOpen.status === 'degraded' && afterOpen.retryAt).toBe(
			new Date(T0 + 2_000).toISOString(),
		);

		now = T0 + 1_999;
		await reader.read();
		expect(attempts()).toBe(2); // still blocked

		now = T0 + 2_000;
		const probed = await reader.read();
		expect(attempts()).toBe(3);
		expect(probed.status).toBe('value');
		expect(probed.status === 'value' && probed.value).toBe(77);

		// Closed again: a later attempt runs and a later failure counts
		// from zero.
		now = T0 + 3_000;
		await reader.read();
		expect(attempts()).toBe(4);
	});

	it('re-opens on the cooldown when the probe fails', async () => {
		const { adapter, attempts } = fakeAdapter([fails(new ExternalReadError('network'))]);
		let now = T0;
		const reader = createExternalReader(adapter, {
			now: () => now,
			policy: { failureThreshold: 1, openMs: 1_000 },
		});
		await reader.read();
		now = T0 + 1_000;
		const probed = await reader.read();
		expect(attempts()).toBe(2);
		expect(probed.status === 'degraded' && probed.breaker).toBe('open');
		expect(probed.status === 'degraded' && probed.retryAt).toBe(
			new Date(now + 1_000).toISOString(),
		);
	});
});

describe('non-destructive fallback', () => {
	it('keeps the last known value visible across a failure', async () => {
		const { adapter } = fakeAdapter([ok(31), fails(new ExternalReadError('timeout'))]);
		let now = T0;
		const reader = createExternalReader(adapter, { now: () => now });
		await reader.read();
		now = T0 + 60_000;
		const degraded = await reader.read();
		expect(degraded.status).toBe('degraded');
		expect(degraded.status === 'degraded' && degraded.value).toBe(31);
		expect(degraded.status === 'degraded' && degraded.observedAt).toBe(new Date(T0).toISOString());
	});

	it('keeps the value visible while the source is blocked', async () => {
		const { adapter } = fakeAdapter([ok(31), fails(new ExternalReadError('rate-limited'))]);
		let now = T0;
		const reader = createExternalReader(adapter, {
			now: () => now,
			policy: { failureThreshold: 1, openMs: 1_000 },
		});
		await reader.read();
		now = T0 + 10;
		const blocked = await reader.read();
		now = T0 + 20;
		const stillBlocked = await reader.read();
		expect(stillBlocked.status === 'degraded' && stillBlocked.value).toBe(31);
		expect(blocked.status === 'degraded' && blocked.value).toBe(31);
	});

	it('recovers to a fresh value after a failure, replacing the stale one', async () => {
		const { adapter } = fakeAdapter([ok(1), fails(new ExternalReadError('network')), ok(2)]);
		let now = T0;
		const reader = createExternalReader(adapter, { now: () => now });
		await reader.read();
		await reader.read();
		now = T0 + 1_000; // wait out the published cadence
		const recovered = await reader.read();
		expect(recovered.status === 'value' && recovered.value).toBe(2);
	});

	it('never returns loading once any attempt has settled', async () => {
		const { adapter } = fakeAdapter([
			fails(new ExternalReadError('malformed-response')),
			ok(3),
			fails(new Error('boom')),
		]);
		let now = T0;
		const reader = createExternalReader(adapter, { now: () => now });
		// Far enough apart that every read is a real attempt rather than
		// a cadence refusal.
		const snapshots: ExternalSnapshot<number>[] = [];
		for (const step of [0, 60_000, 120_000]) {
			now = T0 + step;
			snapshots.push(await reader.read());
		}
		expect(snapshots.map((snapshot) => snapshot.status)).toEqual(['degraded', 'value', 'degraded']);
		expect(snapshots.every((snapshot) => snapshot.status !== 'loading')).toBe(true);
	});

	it('recovers the value on screen once the reader is fresh again', async () => {
		const { adapter } = fakeAdapter([fails(new Error('boom')), ok(9)]);
		let now = T0;
		const reader = createExternalReader(adapter, { now: () => now });
		expect((await reader.read()).status).toBe('degraded');
		now = T0 + 1_000; // wait out the published cadence
		const recovered = await reader.retry();
		expect(recovered.status === 'value' && recovered.value).toBe(9);
	});
});

describe('freshness over time', () => {
	it('reports the held value as stale without discarding it', async () => {
		const { adapter } = fakeAdapter([ok(11)]);
		let now = T0;
		const reader = createExternalReader(adapter, {
			now: () => now,
			policy: { staleAfterMs: 1_000 },
		});
		await reader.read();
		now = T0 + 1_001;
		const aged = reader.snapshot();
		expect(aged.status === 'value' && aged.freshness).toBe('stale');
		expect(aged.status === 'value' && aged.value).toBe(11);
	});
});
