/**
 * Public contract for a third-party API read that a display
 * component renders (Issue #499).
 *
 * Why this file exists
 * --------------------
 * A display component that reads someone else's API has exactly three
 * failure modes that are NOT the component's own bugs:
 *
 *   1. the upstream answers, slowly (`timeout`),
 *   2. the upstream does not answer at all (`network`),
 *   3. the upstream says no (`rate-limited` / `not-found` / …).
 *
 * The reliability requirement is the same for all of them: the page
 * must reach a TERMINAL state inside a bounded time, keep the last
 * known good value on screen (non-destructive fallback), and say out
 * loud how old that value is and when the next attempt may happen.
 *
 * This module owns those decisions as PURE functions plus the types
 * that travel between the transport, the reader and the UI. It owns
 * no I/O: `timeout.ts` performs the fetch, `reader.ts` sequences
 * attempts, `ExternalReadCard.tsx` renders the snapshot.
 *
 * The vocabulary is deliberately small and closed:
 *
 *   attempt -> outcome -> snapshot
 *
 * `applySuccess` / `applyFailure` are the only transitions a
 * snapshot can take, so "a failure never destroys what was already
 * on screen" is a property of the module rather than a convention
 * each adapter has to remember.
 */

/**
 * Why a read failed, in the vocabulary a visitor may read.
 *
 * These strings are the PUBLIC failure surface. They never carry an
 * upstream status line, an error body, a URL with a query string, or
 * any exception message — see `EXTERNAL_FAILURE_LABEL`, which is the
 * only text the display layer is allowed to render.
 */
export type ExternalFailureReason =
	| 'timeout'
	| 'network'
	| 'rate-limited'
	| 'not-found'
	| 'upstream-error'
	| 'malformed-response';

/**
 * Public, fixed labels for each failure reason.
 *
 * Repository constants, never generated per request: the display
 * layer has exactly this vocabulary and nothing else, so an upstream
 * message can reach a visitor only through a code change.
 */
export const EXTERNAL_FAILURE_LABEL: Readonly<Record<ExternalFailureReason, string>> = {
	timeout: '応答时间内.timeout',
	network: '接続不可.network',
	'rate-limited': '回数制限.rate limited',
	'not-found': '該当なし.not found',
	'upstream-error': '上流エラー.upstream error',
	'malformed-response': '応答形式不明.malformed response',
};

/** Circuit state of one source. This is the 「遮断」 state in the Issue. */
export type ExternalBreakerState = 'closed' | 'open' | 'half-open';

/** Whether a value is inside or past its freshness window. */
export type ExternalFreshness = 'fresh' | 'stale';

/**
 * The upstream a read talks to, declared as data so the audit
 * surface (which endpoint, whether a credential leaves the Worker,
 * what the budget is) is a value a test can read instead of a
 * comment nobody re-checks.
 */
export interface ExternalSource {
	/** Stable id, e.g. `github-repo`. */
	readonly id: string;
	/** Host shown to the visitor, e.g. `api.github.com`. */
	readonly label: string;
	/** The exact URL requested. */
	readonly endpoint: string;
	/**
	 * Literal `false`, not `boolean`.
	 *
	 * This surface renders PUBLIC facts only, so no adapter may
	 * attach a credential to a request it renders. Typing the field
	 * as the literal `false` makes "just send the token" a compile
	 * error; `github.ts` and its tests rely on that.
	 */
	readonly sendsCredentials: false;
	/** What the visitor should know about the budget (e.g. rate limit). */
	readonly budgetNote: string;
}

/** Bounded policy for one source. Every number is a decision, not a default of convenience. */
export interface ExternalReadPolicy {
	/** Hard deadline for one attempt. An attempt MUST settle within it. */
	timeoutMs: number;
	/** Age past which a value is reported `stale` (not hidden). */
	staleAfterMs: number;
	/** Consecutive failures that open the breaker. */
	failureThreshold: number;
	/** How long the breaker stays open before one probe may run. */
	openMs: number;
	/** First retry delay; doubles per failure, capped by `retryMaxMs`. */
	retryBaseMs: number;
	/** Ceiling for the retry delay. A retry cadence must stay finite. */
	retryMaxMs: number;
	/** Hard cap on the response body an attempt may buffer. */
	maxResponseBytes: number;
}

/**
 * Default policy.
 *
 * The numbers are chosen for a page-render read on an unbudgeted
 * egress path, and each one is documented because "we bumped it" is
 * a product decision, not a refactor:
 *
 *   - `timeoutMs` 3 s — a display component must not hold a render
 *     for longer than the reader is willing to wait; the reader
 *     settles the attempt itself even when the adapter ignores the
 *     abort signal.
 *   - `staleAfterMs` 6 h — public repository metadata changes far
 *     slower than this, and the unauthenticated budget of the
 *     examples (60 requests / hour / source IP) is far too small to
 *     justify a tighter window across a shared egress pool.
 *   - `failureThreshold` 3 / `openMs` 60 s — three consecutive
 *     failures, then one minute of zero upstream traffic. Short
 *     enough that a recovered upstream is picked up within a minute,
 *     long enough that one bad request cannot become a storm.
 *   - `retryBaseMs` 1 s → `retryMaxMs` 60 s — a visible retry
 *     affordance is offered with a bounded, stated cadence. The
 *     reader never arms a timer by itself.
 *   - `maxResponseBytes` 64 KiB — the metadata read this contract
 *     exists for is a few hundred bytes; anything larger is an
 *     upstream change worth failing on.
 */
export const DEFAULT_EXTERNAL_READ_POLICY: ExternalReadPolicy = {
	timeoutMs: 3_000,
	staleAfterMs: 6 * 60 * 60 * 1_000,
	failureThreshold: 3,
	openMs: 60_000,
	retryBaseMs: 1_000,
	retryMaxMs: 60_000,
	maxResponseBytes: 64 * 1_024,
};

/**
 * Merge caller overrides over the default policy.
 *
 * Always returns a fresh object: a policy is module-level state that
 * every reader shares, so handing out the constant itself would let
 * one caller's mutation change every other reader's deadline.
 */
export function resolveReadPolicy(overrides?: Partial<ExternalReadPolicy>): ExternalReadPolicy {
	return overrides
		? { ...DEFAULT_EXTERNAL_READ_POLICY, ...overrides }
		: { ...DEFAULT_EXTERNAL_READ_POLICY };
}

/**
 * A read result a display component can render.
 *
 * `loading` exists so the very first read has something to say. It is
 * reachable ONLY while no value has ever been read: every settled
 * attempt leaves `loading` for `value` or `degraded`, which is what
 * makes a persistent spinner unrepresentable rather than merely
 * discouraged.
 *
 * The two branches are named interfaces rather than inline members so
 * a caller holding one of them (as every transition returns) can still
 * have the type parameter inferred from it.
 */
export type ExternalSnapshot<T> =
	| { readonly status: 'loading' }
	| ExternalValueSnapshot<T>
	| ExternalDegradedSnapshot<T>;

/** The healthy branch: a value that was observed at a known instant. */
export interface ExternalValueSnapshot<T> {
	readonly status: 'value';
	readonly value: T;
	readonly observedAt: string;
	readonly freshness: ExternalFreshness;
	readonly breaker: ExternalBreakerState;
}

/**
 * The degraded branch — a settled attempt that produced no new value.
 *
 * `value` is the LAST KNOWN GOOD value, preserved. It is `null` only
 * when no attempt ever succeeded, which is what makes the card show a
 * reason instead of an empty space.
 */
export interface ExternalDegradedSnapshot<T> {
	readonly status: 'degraded';
	readonly value: T | null;
	readonly observedAt: string | null;
	readonly reason: ExternalFailureReason;
	readonly failedAt: string;
	readonly breaker: ExternalBreakerState;
	/** Whether an attempt may run now (false while the breaker is open). */
	readonly retryable: boolean;
	/** When the next attempt becomes possible, for a blocked source. */
	readonly retryAt: string | null;
}

/** The empty state a reader starts from. */
export const LOADING_SNAPSHOT: ExternalSnapshot<never> = { status: 'loading' };

/** The healthy branch of a snapshot. */
/** Breaker bookkeeping for one source. */
export interface ExternalBreaker {
	readonly state: ExternalBreakerState;
	readonly consecutiveFailures: number;
	/** When the breaker opened. `null` while closed / never opened. */
	readonly openedAt: number | null;
}

export function initialBreaker(): ExternalBreaker {
	return { state: 'closed', consecutiveFailures: 0, openedAt: null };
}

/** Whether an attempt may run now, and whether it would be a probe. */
export interface ExternalAttemptDecision {
	readonly allowed: boolean;
	/** A probe is the single attempt allowed after an open cooldown. */
	readonly probe: boolean;
	/** Epoch ms at which the next probe may run; `null` when one may run now. */
	readonly retryAt: number | null;
}

/**
 * May an attempt run right now?
 *
 * Open breaker + cooldown not elapsed -> blocked, and the caller is
 * told exactly when the next probe is due so the UI can state it
 * instead of hiding a button that would do nothing.
 */
export function allowAttempt(
	breaker: ExternalBreaker,
	now: number,
	policy: ExternalReadPolicy,
): ExternalAttemptDecision {
	if (breaker.state === 'open') {
		const retryAt = (breaker.openedAt ?? now) + policy.openMs;
		return now < retryAt
			? { allowed: false, probe: false, retryAt }
			: { allowed: true, probe: true, retryAt: null };
	}
	if (breaker.state === 'half-open') {
		return { allowed: true, probe: true, retryAt: null };
	}
	return { allowed: true, probe: false, retryAt: null };
}

/**
 * Fold one settled attempt into the breaker.
 *
 * Success closes it (a probe that works ends the incident). Failure
 * increments the counter and opens it at the threshold — or on the
 * first failure of a probe, because a probe that fails means the
 * upstream is still down.
 */
export function recordOutcome(
	breaker: ExternalBreaker,
	outcome: 'success' | 'failure',
	now: number,
	policy: ExternalReadPolicy,
): ExternalBreaker {
	if (outcome === 'success') return initialBreaker();
	const consecutiveFailures = breaker.consecutiveFailures + 1;
	const opens = breaker.state === 'half-open' || consecutiveFailures >= policy.failureThreshold;
	return opens
		? { state: 'open', consecutiveFailures, openedAt: now }
		: { state: 'closed', consecutiveFailures, openedAt: null };
}

/**
 * Bounded exponential backoff for the retry affordance.
 *
 * `attempt` is 1-based. The result is clamped to `retryMaxMs`, so no
 * adapter can express an unbounded or negative cadence.
 */
export function retryDelayMs(attempt: number, policy: ExternalReadPolicy): number {
	const step = Math.max(1, Math.trunc(attempt));
	const delay = policy.retryBaseMs * 2 ** (step - 1);
	return Math.min(Math.max(delay, policy.retryBaseMs), policy.retryMaxMs);
}

/** Fresh or stale, from an observation instant and the policy window. */
export function freshnessOf(
	observedAt: string | number,
	now: number,
	policy: ExternalReadPolicy,
): ExternalFreshness {
	const observed = typeof observedAt === 'number' ? observedAt : Date.parse(observedAt);
	if (Number.isNaN(observed)) return 'stale';
	return now - observed > policy.staleAfterMs ? 'stale' : 'fresh';
}

/**
 * The snapshot after a successful read.
 *
 * A value is `fresh` the moment it is observed; ageing happens while
 * the page sits open, which is what `withRecomputedFreshness` is for.
 * The previous snapshot is not read here — a success replaces the
 * value, and nothing about a failure may leak into the healthy path.
 */
export function applySuccess<T>(value: T, now: number): ExternalValueSnapshot<T> {
	return {
		status: 'value',
		value,
		observedAt: new Date(now).toISOString(),
		freshness: 'fresh',
		breaker: 'closed',
	};
}

/**
 * Re-evaluate freshness of a snapshot without touching its value.
 *
 * This is the only way `fresh` becomes `stale`: the snapshot is an
 * immutable record of an observation, and age is a property of "now".
 * A reader, a route loader or a render can call this as often as the
 * UI refreshes; a value is never hidden for being old.
 */
export function withRecomputedFreshness<T>(
	snapshot: ExternalSnapshot<T>,
	now: number,
	policy: ExternalReadPolicy,
): ExternalSnapshot<T> {
	if (snapshot.status !== 'value' || snapshot.observedAt === null) return snapshot;
	const freshness = freshnessOf(snapshot.observedAt, now, policy);
	return freshness === snapshot.freshness ? snapshot : { ...snapshot, freshness };
}
/**
 * The snapshot after a failed read.
 *
 * Non-destructive by construction: the previous value and its
 * observation instant survive, and the reason is added beside them.
 * A degraded snapshot with a value is the fallback path — the page
 * keeps showing real data plus a stated reason it is old.
 */
export function applyFailure<T>(
	current: ExternalSnapshot<T>,
	reason: ExternalFailureReason,
	now: number,
	breaker: ExternalBreaker,
	policy: ExternalReadPolicy,
): ExternalDegradedSnapshot<T> {
	// The breaker passed here must ALREADY include this attempt's
	// outcome (`recordOutcome` first, then `applyFailure`), so the
	// snapshot's retry cadence matches the breaker the reader owns.
	const retryDelay = retryDelayMs(Math.max(1, breaker.consecutiveFailures), policy);
	const blocked = breaker.state === 'open';
	const retryAt = blocked ? (breaker.openedAt ?? now) + policy.openMs : now + retryDelay;
	return {
		status: 'degraded',
		value: current.status === 'loading' ? null : current.value,
		observedAt: current.status === 'loading' ? null : current.observedAt,
		reason,
		failedAt: new Date(now).toISOString(),
		breaker: breaker.state,
		retryable: !blocked,
		retryAt: new Date(retryAt).toISOString(),
	};
}

/**
 * The snapshot a caller sees when the breaker refuses the attempt.
 *
 * No upstream call happened, so `failedAt` is the moment the refusal
 * was observed rather than a failure of the upstream at that instant;
 * the previous value is preserved exactly as `applyFailure` preserves
 * it.
 */
export function applyBlocked<T>(
	current: ExternalSnapshot<T>,
	reason: ExternalFailureReason,
	now: number,
	breaker: ExternalBreaker,
	policy: ExternalReadPolicy,
): ExternalDegradedSnapshot<T> {
	const retryAt = (breaker.openedAt ?? now) + policy.openMs;
	return {
		status: 'degraded',
		value: current.status === 'loading' ? null : current.value,
		observedAt: current.status === 'loading' ? null : current.observedAt,
		reason,
		failedAt: current.status === 'degraded' ? current.failedAt : new Date(now).toISOString(),
		breaker: 'open',
		retryable: false,
		retryAt: new Date(retryAt).toISOString(),
	};
}

/**
 * The classified failure an adapter or transport raises.
 *
 * The message is a fixed public string per reason. Constructing it
 * from an upstream body, a URL or a caught exception would put that
 * text one render away from a visitor, so the constructor takes no
 * free-form detail.
 */
export class ExternalReadError extends Error {
	readonly reason: ExternalFailureReason;

	constructor(reason: ExternalFailureReason) {
		super(`external read failed: ${reason}`);
		this.name = 'ExternalReadError';
		this.reason = reason;
	}
}

/** Narrow an unknown thrown value to a reason, defaulting to `network`. */
export function classifyThrown(thrown: unknown): ExternalFailureReason {
	if (thrown instanceof ExternalReadError) return thrown.reason;
	if (thrown instanceof DOMException && thrown.name === 'TimeoutError') return 'timeout';
	if (thrown instanceof DOMException && thrown.name === 'AbortError') return 'timeout';
	return 'network';
}
