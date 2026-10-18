/**
 * Sequencing one third-party source: attempts, deadlines, the breaker,
 * and the snapshot a display component renders (Issue #499).
 *
 * The reader is the only stateful object in this obligation. It owns
 * three pieces of state — the last good value, the breaker, and the
 * in-flight attempt — and it owns three guarantees:
 *
 *   1. An attempt always settles. The deadline is enforced here as
 *      well as in the transport, so an adapter that ignores the abort
 *      signal still cannot leave the page in `loading`. An adapter
 *      that throws BEFORE returning a Promise is a failed read too,
 *      not a thrown reader.
 *   2. Concurrent callers share one attempt. Fifty SSR renders in the
 *      same window produce ONE upstream request, which is the load
 *      property that keeps an unbudgeted public API from being
 *      hammered by the site's own traffic.
 *   3. A failure never destroys the last good value. The snapshot
 *      transition lives in `contract.ts`; this module only decides
 *      WHICH transition to apply.
 *   4. The published retry cadence is enforced here. A snapshot's
 *      `retryAt` is a contract with the visitor, so an attempt before
 *      it is refused without touching the upstream.
 *
 * There is no internal timer beyond one attempt's deadline: retry
 * cadence is expressed as `retryAt` on the snapshot, and the CALLER
 * decides when to come back. A Worker that armed its own retry loop
 * would spend requests on a page nobody is looking at.
 */

import {
	type ExternalBreaker,
	type ExternalFailureReason,
	ExternalReadError,
	type ExternalReadPolicy,
	type ExternalSnapshot,
	type ExternalSource,
	LOADING_SNAPSHOT,
	allowAttempt,
	applyBlocked,
	applyFailure,
	applySuccess,
	classifyThrown,
	initialBreaker,
	recordOutcome,
	resolveReadPolicy,
	withRecomputedFreshness,
} from './contract';

/** One upstream source, reduced to what a display component can consume. */
export interface ExternalAdapter<T> {
	readonly source: ExternalSource;
	/**
	 * Perform one read. MUST honour `signal`; the reader enforces the
	 * deadline regardless, but an adapter that ignores it leaves the
	 * socket open until the runtime tears it down.
	 */
	read(signal: AbortSignal): Promise<T>;
}

export interface ExternalReaderOptions {
	/** Overrides over `DEFAULT_EXTERNAL_READ_POLICY`. */
	readonly policy?: Partial<ExternalReadPolicy>;
	/** Clock injection point. Defaults to `Date.now`. */
	readonly now?: () => number;
}

export interface ExternalReader<T> {
	readonly source: ExternalSource;
	readonly policy: ExternalReadPolicy;
	/** Current snapshot, with freshness re-evaluated for "now". */
	snapshot(): ExternalSnapshot<T>;
	/** Run (or join) an attempt. Never leaves the snapshot in `loading`. */
	read(): Promise<ExternalSnapshot<T>>;
	/** Explicit retry affordance. Same semantics as `read`, named for the call site. */
	retry(): Promise<ExternalSnapshot<T>>;
	/** Whether an attempt is in flight (used by the UI to avoid double submits). */
	busy(): boolean;
}

/**
 * Settle `work` within `timeoutMs`, aborting the adapter's signal on
 * expiry.
 *
 * `controller.abort()` is what stops the request; the rejection is
 * what stops the page. Both happen in the same tick so a caller can
 * never observe a settled attempt whose socket is still open.
 */
function withDeadline<T>(
	work: Promise<T>,
	timeoutMs: number,
	controller: AbortController,
): Promise<T> {
	return new Promise<T>((settleOk, settleErr) => {
		const timer = setTimeout(() => {
			controller.abort(new Error('external read deadline'));
			settleErr(new ExternalReadError('timeout'));
		}, timeoutMs);
		work.then(
			(value) => {
				clearTimeout(timer);
				settleOk(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				settleErr(error);
			},
		);
	});
}

export function createExternalReader<T>(
	adapter: ExternalAdapter<T>,
	options: ExternalReaderOptions = {},
): ExternalReader<T> {
	const policy = resolveReadPolicy(options.policy);
	const clock = options.now ?? (() => Date.now());

	let snapshot: ExternalSnapshot<T> = LOADING_SNAPSHOT;
	let breaker: ExternalBreaker = initialBreaker();
	let lastReason: ExternalFailureReason | null = null;
	let inFlight: Promise<ExternalSnapshot<T>> | null = null;

	async function attempt(): Promise<ExternalSnapshot<T>> {
		const now = clock();
		const decision = allowAttempt(breaker, now, policy, cooldownUntil());
		if (!decision.allowed) {
			// No upstream call. The snapshot states the refusal and the
			// instant the next attempt may run. `decision.retryAt` is
			// non-null exactly when `allowed` is false.
			snapshot = applyBlocked(
				snapshot,
				lastReason ?? 'network',
				now,
				breaker,
				decision.retryAt ?? now,
			);
			return snapshot;
		}
		if (decision.probe) breaker = { ...breaker, state: 'half-open' };

		// `loading` is reachable only while there is nothing to show.
		const hasValue = snapshot.status !== 'loading' && snapshot.value !== null;
		if (!hasValue) snapshot = { status: 'loading' };

		const controller = new AbortController();
		let pending: Promise<T>;
		try {
			pending = adapter.read(controller.signal);
		} catch (thrown) {
			// A synchronous throw is a failed READ, not a thrown reader:
			// `ExternalAdapter.read` returns a Promise in the type, but
			// nothing stops an implementation from raising before it.
			// Routing it through the normal failure transition is what
			// keeps the breaker and `lastReason` truthful — and keeps the
			// snapshot from being left in `loading` forever.
			return settleFailure(thrown);
		}
		// The race below consumes the outcome; this handler exists so a
		// LATE rejection (the deadline fired first) is never an
		// unhandled rejection in the Worker.
		pending.catch(() => {});

		try {
			const value = await withDeadline(pending, policy.timeoutMs, controller);
			breaker = recordOutcome(breaker, 'success', clock(), policy);
			lastReason = null;
			snapshot = applySuccess(value, clock());
		} catch (thrown) {
			return settleFailure(thrown);
		}
		return snapshot;
	}

	/**
	 * The instant the published retry cadence refuses an attempt.
	 *
	 * Read from the snapshot's own `retryAt`, so honouring it needs no
	 * extra reader state: what the visitor was told and what the reader
	 * enforces cannot drift apart.
	 */
	function cooldownUntil(): number | null {
		if (snapshot.status !== 'degraded' || snapshot.retryAt === null) return null;
		const parsed = Date.parse(snapshot.retryAt);
		return Number.isNaN(parsed) ? null : parsed;
	}

	/** The one failure transition, whether the attempt threw early or late. */
	function settleFailure(thrown: unknown): ExternalSnapshot<T> {
		const reason = classifyThrown(thrown);
		breaker = recordOutcome(breaker, 'failure', clock(), policy);
		lastReason = reason;
		snapshot = applyFailure(snapshot, reason, clock(), breaker, policy);
		return snapshot;
	}

	function run(): Promise<ExternalSnapshot<T>> {
		if (inFlight) return inFlight;
		const started = attempt().finally(() => {
			if (inFlight === started) inFlight = null;
		});
		inFlight = started;
		return started;
	}

	return {
		source: adapter.source,
		policy,
		snapshot: () => withRecomputedFreshness(snapshot, clock(), policy),
		read: run,
		retry: run,
		busy: () => inFlight !== null,
	};
}
