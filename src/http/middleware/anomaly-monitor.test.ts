import { describe, expect, it } from 'vitest';
import { redactLogText } from '../../logging/redact';
import {
	ANOMALY_EVENT_FIELDS,
	ANOMALY_EVENT_NAME,
	ANOMALY_SIGNALS,
	ANOMALY_SURFACES,
	ANOMALY_WINDOW_MS,
	type AnomalyEvent,
	type AnomalyMonitor,
	type AnomalySurface,
	DEFAULT_ANOMALY_POLICY,
	classifySurface,
	createAnomalyMonitor,
	roundRate,
	signalForStatus,
	windowStartIso,
} from './anomaly-monitor';

/**
 * Anomaly-monitor unit tests (Issue #481).
 *
 * The claims under test, in the order the Issue states them:
 *
 *   1. the rates are aggregated over the two watched surfaces WITHOUT
 *      an identity dimension, and the event shape is closed so one can
 *      never grow a per-visitor field (the "no secrets / no IPs" rule);
 *   2. a rate that crosses its threshold produces a DETECTION EVENT,
 *      and a rate that does not cross it produces nothing — including
 *      the small-denominator case that would otherwise report on every
 *      cold start;
 *   3. a sustained anomaly is announced once per window instead of once
 *      per request, so the monitor cannot become a log amplifier;
 *   4. the sink is a seam: the shipped behaviour is "an event exists and
 *      a caller receives it". Delivery to an operator destination is an
 *      owner decision and is NOT implemented here.
 *
 * The end-to-end wiring (Worker entry → this module → audit record) is
 * covered by `test/integration/request-anomaly-monitor.test.ts`; the
 * fixture proof in `scripts/request-anomaly-monitor-fixture.mjs` drives
 * this same module from recorded observations.
 */

/** A fixed instant inside a window, so the tests never race the clock. */
const T0 = Date.UTC(2026, 0, 15, 3, 0, 0);

/** Drive one monitor with `n` requests of the same status. */
function feed(
	monitor: AnomalyMonitor,
	surface: AnomalySurface,
	status: number,
	n: number,
	startAt = T0,
): AnomalyEvent[] {
	const emitted: AnomalyEvent[] = [];
	for (let index = 0; index < n; index += 1) {
		emitted.push(...monitor.record({ surface, status, at: startAt + index }));
	}
	return emitted;
}

describe('signalForStatus', () => {
	it('maps exactly the four classes the Issue names', () => {
		expect(signalForStatus(401)).toBe('unauthorized');
		expect(signalForStatus(403)).toBe('forbidden');
		expect(signalForStatus(429)).toBe('rate-limited');
		expect(signalForStatus(500)).toBe('server-error');
	});

	it('treats every 5xx as the server-error signal', () => {
		// A 502 is the same operational fact to whoever reads the rate;
		// widening the vocabulary per status code is what would make
		// the reported number depend on an upstream's whim.
		expect(signalForStatus(502)).toBe('server-error');
		expect(signalForStatus(599)).toBe('server-error');
	});

	it('counts nothing else, so the denominator stays honest', () => {
		for (const status of [200, 201, 204, 301, 304, 400, 404, 405, 418, 451, 600]) {
			expect(signalForStatus(status)).toBeNull();
		}
	});
});

describe('classifySurface', () => {
	it('attributes the Admin and external-API paths the Issue names', () => {
		expect(classifySurface('/admin')).toBe('admin');
		expect(classifySurface('/admin/')).toBe('admin');
		expect(classifySurface('/admin/images')).toBe('admin');
		expect(classifySurface('/api/v1')).toBe('external-api');
		expect(classifySurface('/api/v1/reactions')).toBe('external-api');
	});

	it('does not claim a lookalike path', () => {
		// The dispatch rule in src/server.ts is exact-prefix-or-`/`.
		// A prefix-only match would file somebody else's traffic under a
		// watched surface and quietly corrupt its rate.
		for (const pathname of [
			'/adminish',
			'/admin-tools',
			'/api/v10',
			'/api/v1evil',
			'/',
			'/about',
		]) {
			expect(classifySurface(pathname)).toBeNull();
		}
	});

	it('watches exactly two surfaces', () => {
		expect(ANOMALY_SURFACES).toEqual(['admin', 'external-api']);
	});
});

describe('rate arithmetic', () => {
	it('rounds to the precision the event publishes', () => {
		expect(roundRate(0.2449)).toBe(0.24);
		expect(roundRate(0.25)).toBe(0.25);
		expect(roundRate(1 / 3)).toBe(0.33);
	});

	it('aligns windows to the epoch so two observers agree on the bucket', () => {
		expect(windowStartIso(T0)).toBe('2026-01-15T03:00:00.000Z');
		expect(windowStartIso(T0 + ANOMALY_WINDOW_MS - 1)).toBe('2026-01-15T03:00:00.000Z');
		expect(windowStartIso(T0 + ANOMALY_WINDOW_MS)).toBe('2026-01-15T03:05:00.000Z');
	});
});

describe('detection', () => {
	it('reports nothing until the denominator floor is met', () => {
		const monitor = createAnomalyMonitor();
		// 5 of 5 requests are 401: a 100% rate, but a sample of five is
		// not evidence about a surface. Reporting here would make every
		// quiet window look like an incident.
		expect(feed(monitor, 'admin', 401, 5)).toEqual([]);
		expect(feed(monitor, 'admin', 401, 14)).toEqual([]);
		expect(monitor.counts('admin', 'unauthorized')).toEqual({ hits: 19, samples: 19 });
	});

	it('reports on the exact observation that crosses the threshold', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'admin', 200, 25);
		// 8 of 33 = 0.24 is under the 0.25 bar; the next 401 makes it
		// 9 of 34 = 0.26, which is the crossing.
		expect(feed(monitor, 'admin', 401, 8)).toEqual([]);
		const emitted = feed(monitor, 'admin', 401, 1);
		expect(emitted).toHaveLength(1);
		expect(emitted[0]).toMatchObject({
			event: ANOMALY_EVENT_NAME,
			surface: 'admin',
			signal: 'unauthorized',
			status: '401',
			samples: 34,
			hits: 9,
			rate: 0.26,
			threshold: 0.25,
			minSamples: 20,
			windowStart: '2026-01-15T03:00:00.000Z',
		});
	});

	it('stays quiet under every bar at once', () => {
		const monitor = createAnomalyMonitor();
		// A surface with a bad quarter-hour and nothing that crosses: the
		// 5xx share is held under 5% and the rest far below their bars,
		// so a monitor that only looked at one signal would still pass —
		// this asserts the four are evaluated together.
		feed(monitor, 'external-api', 200, 96);
		expect(feed(monitor, 'external-api', 500, 4)).toEqual([]);
		expect(feed(monitor, 'external-api', 401, 5)).toEqual([]);
		expect(feed(monitor, 'external-api', 403, 5)).toEqual([]);
		expect(feed(monitor, 'external-api', 429, 9)).toEqual([]);
		expect(monitor.counts('external-api', 'server-error')).toEqual({ hits: 4, samples: 119 });
	});

	it('applies each signal at its own bar', () => {
		const serverError = createAnomalyMonitor();
		feed(serverError, 'external-api', 200, 96);
		// 4 of 100 = 0.04 is under the 5xx bar…
		expect(feed(serverError, 'external-api', 500, 4)).toEqual([]);
		// …and 5 of 101 = 0.0495 rounds to 0.05, which is the crossing.
		expect(feed(serverError, 'external-api', 500, 1)).toHaveLength(1);

		const throttled = createAnomalyMonitor();
		feed(throttled, 'external-api', 200, 19);
		// 10 of 29 = 0.34 is over the 401/403 bar but under the 429 bar:
		// a throttled consumer only counts once it is being throttled
		// more than it is being served.
		expect(feed(throttled, 'external-api', 429, 10)).toEqual([]);
		expect(feed(throttled, 'external-api', 429, 9)).toHaveLength(1);
		expect(throttled.counts('external-api', 'rate-limited').hits).toBe(19);
	});
});

describe('latch', () => {
	it('announces a sustained anomaly once per window, not once per request', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'admin', 200, 19);
		expect(feed(monitor, 'admin', 401, 40)).toHaveLength(1);
		// The rate stays at 100%. A monitor without a latch would emit a
		// record per request here, which is how an observer becomes a
		// log amplifier nobody reads.
		expect(feed(monitor, 'admin', 401, 40)).toEqual([]);
		expect(monitor.counts('admin', 'unauthorized').hits).toBe(80);
	});

	it('re-announces when the next window opens', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'admin', 200, 19);
		expect(feed(monitor, 'admin', 401, 10)).toHaveLength(1);
		const nextWindow = T0 + ANOMALY_WINDOW_MS;
		expect(feed(monitor, 'admin', 401, 40, nextWindow)).toHaveLength(1);
		expect(feed(monitor, 'admin', 401, 5, nextWindow)).toEqual([]);
	});

	it('keeps the two surfaces independent', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'admin', 200, 25);
		expect(feed(monitor, 'admin', 401, 9)).toHaveLength(1);
		// The external API has answered nothing at all: its counters are
		// its own window's, and an Admin incident must not make the
		// other surface look anomalous (or quiet).
		expect(monitor.counts('external-api', 'unauthorized')).toEqual({ hits: 0, samples: 0 });
		feed(monitor, 'external-api', 200, 10);
		expect(feed(monitor, 'external-api', 401, 1)).toEqual([]);
	});
});

describe('event shape', () => {
	it('keeps its own name out of the redactor’s reach', () => {
		// `redactLogText` masks any run of 24+ token characters as a
		// credential, and `.` / `_` are inside that run’s character
		// class. Two spellings of this event were exactly 24
		// characters, so the shipped audit line read
		// `{"event":"[redacted-blob]"}` — a record with no greppable
		// identity. This assertion is what stops a rename (or a
		// “more descriptive” expansion) from reintroducing that.
		expect(ANOMALY_EVENT_NAME.length).toBeLessThan(24);
		expect(redactLogText(ANOMALY_EVENT_NAME)).toBe(ANOMALY_EVENT_NAME);
	});

	it('carries no field beyond the declared allowlist', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'admin', 200, 25);
		const [event] = feed(monitor, 'admin', 401, 9);
		expect(Object.keys(event).sort()).toEqual([...ANOMALY_EVENT_FIELDS].sort());
	});

	it('holds no value that could identify a caller', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'external-api', 200, 25);
		const [event] = feed(monitor, 'external-api', 403, 9);
		const rendered = JSON.stringify(event);
		// The aggregation key is (surface, window): there is no slot for
		// an address, a key id, a cookie, a path or a user agent, so the
		// strongest form of this check is that no such field exists.
		expect(rendered).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/);
		expect(rendered).not.toMatch(/@/);
		expect(rendered).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
		for (const forbidden of [
			'ip',
			'address',
			'path',
			'url',
			'cookie',
			'key',
			'userAgent',
			'agent',
		]) {
			expect(Object.keys(event).join(',').toLowerCase()).not.toContain(forbidden);
		}
	});

	it('publishes a rate that reproduces the decision that produced it', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'external-api', 200, 75);
		const [event] = feed(monitor, 'external-api', 500, 5);
		// A reviewer must be able to check the record by hand: hits over
		// samples is the printed rate, and that printed rate is what was
		// compared against the printed threshold.
		expect(roundRate(event.hits / event.samples)).toBe(event.rate);
		expect(event.rate).toBeGreaterThanOrEqual(event.threshold);
		expect(event.at.slice(0, 16)).toBe(windowStartIso(T0).slice(0, 16));
	});
});

describe('policy', () => {
	it('declares one row per signal, each with a floor and a bar under 1', () => {
		expect(Object.keys(DEFAULT_ANOMALY_POLICY).sort()).toEqual([...ANOMALY_SIGNALS].sort());
		for (const signal of ANOMALY_SIGNALS) {
			const row = DEFAULT_ANOMALY_POLICY[signal];
			expect(row.signal).toBe(signal);
			expect(row.minSamples).toBeGreaterThan(0);
			expect(row.rate).toBeGreaterThan(0);
			expect(row.rate).toBeLessThan(1);
		}
	});

	it('is honoured when a caller ships a stricter policy', () => {
		const strict = createAnomalyMonitor({
			policy: {
				...DEFAULT_ANOMALY_POLICY,
				unauthorized: { ...DEFAULT_ANOMALY_POLICY.unauthorized, rate: 0.05 },
			},
		});
		feed(strict, 'admin', 200, 19);
		expect(feed(strict, 'admin', 401, 1)).toHaveLength(1);
	});
});

describe('sink', () => {
	it('hands every event to the sink exactly once', () => {
		const seen: AnomalyEvent[] = [];
		const monitor = createAnomalyMonitor({ onEvent: (event) => seen.push(event) });
		feed(monitor, 'external-api', 200, 10);
		// 10 of 20 = 0.50 — the 429 bar, crossed by one request.
		expect(feed(monitor, 'external-api', 429, 10)).toHaveLength(1);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ signal: 'rate-limited', hits: 10, samples: 20, rate: 0.5 });
	});

	it('works with no sink at all — the caller may read the return value', () => {
		const monitor = createAnomalyMonitor();
		feed(monitor, 'external-api', 200, 19);
		expect(feed(monitor, 'external-api', 500, 5)).toHaveLength(1);
	});
});
