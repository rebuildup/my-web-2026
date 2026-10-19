/**
 * Request anomaly monitor — rate observation for the Admin and the
 * external API surfaces (Issue #481).
 *
 * The question this module owns
 * -----------------------------
 * "On the two request surfaces an operator cannot watch by hand, did
 * the share of 401 / 403 / 429 / 5xx answers cross the rate this
 * repository considers anomalous, and if so what is the one
 * status-only record that says so?"
 *
 * Three properties are deliberate, and each one exists because the
 * Issue named it:
 *
 *   1. **The aggregation key has no identity dimension.** A bucket is
 *      keyed by `(surface, window)` and nothing else. There is no IP,
 *      API key id, cookie, path, user agent, referrer, or body field
 *      anywhere in the observation type, so the counter cannot grow a
 *      per-visitor dimension later by accident: the type does not have
 *      a slot for one. The Issue asks for the rates to be aggregated
 *      "秘密・IPなどの個人情報を含めず" — this is that rule as a type,
 *      not as a promise in a comment.
 *   2. **A threshold crossing produces a DETECTION EVENT**, not a
 *      log line and not an alert to somebody. Delivery is a seam
 *      (`onEvent`); the shipped sink is a status-only audit record.
 *      Where an operator wants that record to go (email, Slack, a
 *      Cloudflare alert) is an owner decision plus a new ADR — no
 *      additional Cloudflare service is declared for it here
 *      (AGENTS.md §4), and nothing in this module opens a socket.
 *   3. **The count is per-isolate and therefore approximate.** A
 *      Workers isolate sees only the requests it served, and the
 *      platform schedules those across many isolates. This module
 *      therefore owns the DETECTION decision and its reproducible
 *      proof, and makes no claim of a durable global rate. A global
 *      aggregate is a zone-level analytics / Logpush property that
 *      this repository can observe only through an owner-provisioned
 *      destination; `docs/security/request-anomaly-monitor.md` states
 *      the scope limit where an operator reads the number.
 *
 * Where it sits
 * -------------
 * `src/http/middleware/` because that is where the boundary already
 * owns per-request security state (CSRF guard, rate limit, cache
 * isolation). The Worker entry (`src/server.ts`) feeds it at the one
 * choke point every Worker-generated response passes, so the Admin
 * surface (served by the SSR pipeline) and the external API (served by
 * Hono) are observed by the same code and the same policy. No new
 * dependency edge is introduced: `http -> logging` already exists and
 * the module itself imports nothing at all.
 *
 * Why the observation is a value
 * ------------------------------
 * `AnomalyObservation` is deliberately a plain data record so that an
 * OUTBOUND third-party read (`src/external-api`, whose failure reasons
 * are `rate-limited` / `upstream-error`) can report into the same
 * vocabulary later without this module importing it, or it importing
 * the outbound obligation. Today the only producer is the Worker
 * entry; the fixture proof drives the same module directly.
 */

/** Surfaces whose request rates this repository watches. */
export const ANOMALY_SURFACES = ['admin', 'external-api'] as const;

export type AnomalySurface = (typeof ANOMALY_SURFACES)[number];

/**
 * The closed vocabulary of answers worth counting.
 *
 * These four are the classes the Issue names (429 / 401 / 403 / 500).
 * The names are semantic rather than numeric so the vocabulary does not
 * widen when a handler answers 502 — a 5xx is the same operational
 * fact to whoever reads the rate.
 */
export const ANOMALY_SIGNALS = [
	'unauthorized',
	'forbidden',
	'rate-limited',
	'server-error',
] as const;

export type AnomalySignal = (typeof ANOMALY_SIGNALS)[number];

/**
 * One policy row: how many of this signal, out of how many requests
 * on the surface, is a rate worth reporting.
 *
 *   `rate`       share of the surface's window requests that answered
 *                with this signal (0..1). Compared against the value
 *                ROUNDED to two decimals, so the number printed in a
 *                detection event is the number the decision used.
 *   `minSamples` floor on the denominator. Without it, one 401 out of
 *                one request is a 100% rate and every cold start on a
 *                quiet surface would report an anomaly.
 */
export interface AnomalyThreshold {
	readonly signal: AnomalySignal;
	/** Evidence label for the status class that feeds this signal. */
	readonly status: string;
	readonly rate: number;
	readonly minSamples: number;
}

/**
 * The shipped policy. One declaration, both surfaces.
 *
 * The values are conservative defaults chosen from the surface's own
 * contract, and they are DATA on purpose: an operator who observes a
 * real baseline edits this table rather than editing a comparison
 * buried in a loop. Raising a rate is a judgement call about false
 * positives; lowering one is a judgement call about what gets missed,
 * and both belong to the owner (see the document).
 *
 *   - `unauthorized` / `forbidden`: a healthy authenticated surface
 *     answers 401/403 only for an expired or absent session, so a
 *     quarter of the surface's traffic is a session problem (expired
 *     secret, broken cookie policy, a crawler probing), not a normal
 *     shape.
 *   - `rate-limited`: half. A consumer that is being throttled more
 *     than it is being served has already lost the integration.
 *   - `server-error`: five percent, two orders of magnitude below the
 *     401/403 bar because a single 5xx is a visible incident even
 *     when it is a small share of a busy window.
 */
export const DEFAULT_ANOMALY_POLICY: Readonly<Record<AnomalySignal, AnomalyThreshold>> =
	Object.freeze({
		unauthorized: Object.freeze({
			signal: 'unauthorized',
			status: '401',
			rate: 0.25,
			minSamples: 20,
		}),
		forbidden: Object.freeze({ signal: 'forbidden', status: '403', rate: 0.25, minSamples: 20 }),
		'rate-limited': Object.freeze({
			signal: 'rate-limited',
			status: '429',
			rate: 0.5,
			minSamples: 20,
		}),
		'server-error': Object.freeze({
			signal: 'server-error',
			status: '5xx',
			rate: 0.05,
			minSamples: 20,
		}),
	});

/**
 * Length of the fixed window the rates are computed over.
 *
 * Fixed, not sliding, and aligned to `windowMs` multiples of the Unix
 * epoch: a sliding window needs per-request timestamps, which is the
 * one dimension this module refuses to keep. The consequence is stated
 * rather than hidden — a crossing that happens in the last seconds of
 * a window is counted against the next window, so a short burst that
 * straddles a boundary can be diluted. The window is long enough that
 * the dilution window is small relative to it.
 */
export const ANOMALY_WINDOW_MS = 300_000;

/**
 * The complete field list of a detection event.
 *
 * Exported so the shape can be asserted closed: `scripts/` checks and
 * the unit suite both assert that a produced event has exactly these
 * keys, which is what keeps a future "just one more field for triage"
 * (an IP, a key id, a path) a failing test rather than a shipped leak.
 */
export const ANOMALY_EVENT_FIELDS = Object.freeze([
	'event',
	'surface',
	'signal',
	'status',
	'windowStart',
	'samples',
	'hits',
	'rate',
	'threshold',
	'minSamples',
	'at',
] as const);

/**
 * A detection event: status-only, aggregate, and stable in key order.
 *
 * There is no field here a reader could use to single out a caller.
 * The strongest statement the repository can make is "this surface
 * answered this way too often in this window", and every field exists
 * to make that sentence checkable against the counter that produced
 * it.
 */
export interface AnomalyEvent {
	readonly event: 'request_anomaly_detected';
	readonly surface: AnomalySurface;
	readonly signal: AnomalySignal;
	readonly status: string;
	/** ISO start of the fixed window the rates were computed over. */
	readonly windowStart: string;
	/** Requests observed on the surface during the window (denominator). */
	readonly samples: number;
	/** Requests on the surface that answered with this signal. */
	readonly hits: number;
	/** `hits / samples`, rounded to two decimals. */
	readonly rate: number;
	readonly threshold: number;
	readonly minSamples: number;
	/** ISO instant the crossing was observed. */
	readonly at: string;
}

/** One request outcome handed to the monitor. Nothing else is accepted. */
export interface AnomalyObservation {
	readonly surface: AnomalySurface;
	/** Final HTTP status of the Worker-generated response. */
	readonly status: number;
	/** Milliseconds since the Unix epoch; defaults to now. */
	readonly at?: number;
}

/** Where a detection event goes. The shipped sink is the audit log. */
export type AnomalyEventSink = (event: AnomalyEvent) => void;

export interface AnomalyMonitorOptions {
	readonly policy?: Readonly<Record<AnomalySignal, AnomalyThreshold>>;
	readonly onEvent?: AnomalyEventSink;
}

export interface AnomalyCounts {
	readonly hits: number;
	readonly samples: number;
}

export interface AnomalyMonitor {
	/**
	 * Count one request and report any threshold crossing it caused.
	 *
	 * Returns the events produced by THIS observation — usually none,
	 * at most one per latched signal. The returned value is the same
	 * object handed to `onEvent`, so a caller that wants no sink can
	 * ignore the option entirely.
	 */
	record(observation: AnomalyObservation): readonly AnomalyEvent[];
	/** The surface's current-window counts. Read-only by contract. */
	counts(surface: AnomalySurface, signal: AnomalySignal): AnomalyCounts;
	/** Forget every count and latch. Used by tests and by the fixture proof. */
	reset(): void;
}

/**
 * Map a status onto the signal it counts as, or `null` when it is not
 * one of the four watched classes.
 *
 * 2xx / 3xx / 4xx-other are the denominator and nothing else: a 404
 * crawl is not an anomaly on a public surface, and counting it would
 * dilute the four rates the Issue asked for.
 */
export function signalForStatus(status: number): AnomalySignal | null {
	if (status === 401) return 'unauthorized';
	if (status === 403) return 'forbidden';
	if (status === 429) return 'rate-limited';
	if (status >= 500 && status <= 599) return 'server-error';
	return null;
}

/**
 * Which watched surface a request path belongs to, or `null`.
 *
 * Exact-prefix-or-`/`, the same rule `src/server.ts` uses to dispatch to
 * the external boundary: `/adminish` and `/api/v10` are neither the
 * Admin surface nor the external API, and counting them under a
 * watched surface would attribute somebody else's traffic to it.
 */
export function classifySurface(pathname: string): AnomalySurface | null {
	if (pathname === '/admin' || pathname.startsWith('/admin/')) return 'admin';
	if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) return 'external-api';
	return null;
}

/**
 * Round a ratio to the precision the event publishes.
 *
 * Two decimals, and the DETECTION uses the rounded value, so the rate
 * in the record is the rate that crossed the threshold. Comparing the
 * full float and printing the rounded one would let a record print
 * `0.25` next to a threshold of `0.25` while the actual comparison was
 * `0.2449 < 0.25`, which is the kind of unreadable evidence this
 * repository is trying not to produce.
 */
export function roundRate(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Window bucket index for an instant. Aligned to `ANOMALY_WINDOW_MS`. */
export function windowIndex(at: number): number {
	return Math.floor(at / ANOMALY_WINDOW_MS);
}

/** ISO start of the window an instant falls into. */
export function windowStartIso(at: number): string {
	return new Date(windowIndex(at) * ANOMALY_WINDOW_MS).toISOString();
}

interface SurfaceWindow {
	window: number;
	samples: number;
	hits: Record<AnomalySignal, number>;
	/**
	 * Signals already reported in this window.
	 *
	 * The latch is what makes the monitor an OBSERVER instead of a
	 * log amplifier: an anomaly that stays anomalous for an hour emits
	 * one event per window per signal, not one per request. The latch
	 * clears when the window rolls, so a persistent incident is still
	 * re-announced every window instead of going quiet after the first
	 * line.
	 */
	latched: Set<AnomalySignal>;
}

function createWindow(window: number): SurfaceWindow {
	return {
		window,
		samples: 0,
		hits: { unauthorized: 0, forbidden: 0, 'rate-limited': 0, 'server-error': 0 },
		latched: new Set<AnomalySignal>(),
	};
}

/**
 * Build a monitor.
 *
 * State is per instance and bounded: one fixed-size record per watched
 * surface, holding four integers and a latch set. There is no
 * unbounded growth path here — no per-caller map, no retained
 * timestamps — because a per-isolate Worker that could grow without
 * limit would be a memory-exhaustion incident of its own.
 */
export function createAnomalyMonitor(options: AnomalyMonitorOptions = {}): AnomalyMonitor {
	const policy = options.policy ?? DEFAULT_ANOMALY_POLICY;
	const windows = new Map<AnomalySurface, SurfaceWindow>();

	const windowFor = (surface: AnomalySurface, at: number): SurfaceWindow => {
		const index = windowIndex(at);
		const current = windows.get(surface);
		if (current === undefined || current.window !== index) {
			const fresh = createWindow(index);
			windows.set(surface, fresh);
			return fresh;
		}
		return current;
	};

	return {
		record(observation) {
			const at = observation.at ?? Date.now();
			const current = windowFor(observation.surface, at);
			current.samples += 1;
			const signal = signalForStatus(observation.status);
			if (signal !== null) current.hits[signal] += 1;

			const emitted: AnomalyEvent[] = [];
			for (const candidate of ANOMALY_SIGNALS) {
				if (current.latched.has(candidate)) continue;
				const row = policy[candidate];
				if (current.samples < row.minSamples) continue;
				const rate = roundRate(current.hits[candidate] / current.samples);
				if (rate < row.rate) continue;
				current.latched.add(candidate);
				const event: AnomalyEvent = Object.freeze({
					event: 'request_anomaly_detected',
					surface: observation.surface,
					signal: candidate,
					status: row.status,
					windowStart: windowStartIso(at),
					samples: current.samples,
					hits: current.hits[candidate],
					rate,
					threshold: row.rate,
					minSamples: row.minSamples,
					at: new Date(at).toISOString(),
				});
				emitted.push(event);
				options.onEvent?.(event);
			}
			return emitted;
		},
		counts(surface, signal) {
			const current = windows.get(surface);
			if (current === undefined) return Object.freeze({ hits: 0, samples: 0 });
			return Object.freeze({ hits: current.hits[signal], samples: current.samples });
		},
		reset() {
			windows.clear();
		},
	};
}
