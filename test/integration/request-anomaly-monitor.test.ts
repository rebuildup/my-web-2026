/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import {
	ANOMALY_EVENT_FIELDS,
	ANOMALY_EVENT_NAME,
} from '../../src/http/middleware/anomaly-monitor';

/**
 * Request anomaly monitor — end-to-end wiring (Issue #481).
 *
 * The unit suite (`src/http/middleware/anomaly-monitor.test.ts`) proves
 * the decision, and the fixture proof
 * (`scripts/request-anomaly-monitor-fixture.mjs`) reproduces the
 * crossings from recorded observations. This file proves the part that
 * only a real request can show: that a Worker-generated response on a
 * watched surface actually REACHES the monitor, and that the crossing
 * shows up as the status-only audit record the operator will read.
 *
 *   - `external-api` — a real 401 storm through `SELF.fetch`. Every
 *     `GET /api/v1/reactions` without an `Authorization` header is
 *     answered `401 missing_authorization` by `requireApiKey`, and
 *     `GET /api/v1/health` is a public 200. The mixture crosses the
 *     25% bar on exactly one request, so the record can be checked by
 *     hand against the counts printed beside it.
 *   - `admin` — the negative half. Anonymous `/admin` traffic answers a
 *     307 to the login screen, which is not a watched class, so a
 *     realistic number of Admin requests must produce NO record. A
 *     monitor that reported here would train its reader to ignore it.
 *
 * Every request carries fabricated caller context (user agent, referrer,
 * forwarded address) that the Worker certainly received, so "the record
 * holds none of it" is asserted against data that really arrived rather
 * than against a field list alone.
 *
 * Why the Admin crossing is NOT reproduced here: reaching an anomalous
 * Admin status over HTTP requires a real operator session, and this
 * Issue forbids manufacturing one from production credentials. The
 * Admin crossings are reproduced from recorded fixtures instead — see
 * `quality/fixtures/request-anomaly-monitor/` and
 * `docs/security/request-anomaly-monitor.md`.
 *
 * Scope guard: local workerd pool with Miniflare bindings only. No
 * credential is read, no request leaves the Worker, and nothing here
 * mutates anything an operator owns.
 *
 * The counters are per-isolate module state, so the external-API
 * scenario is ONE ordered test: a second one would inherit the
 * denominator the first left behind, and the admin test reads a
 * different surface's counters.
 */

/** Fabricated caller context, sent on every request below. */
const CANARY_HEADERS = Object.freeze({
	'User-Agent': 'canary-agent/1.0',
	Referer: 'https://canary.invalid/probe',
	'X-Forwarded-For': '203.0.113.7',
});

/** Values that must not survive into an operator-visible record. */
const CANARIES = [
	'canary-agent',
	'canary.invalid',
	'203.0.113.7',
	'X-Forwarded-For',
	'authorization',
];

/**
 * The audit line this file is looking for, as a prefix.
 *
 * `audit()` emits `{"event":…,"at":…,…}` with the event name first, and
 * the scope is the shared `boundary` stream, so the prefix selects the
 * anomaly record without swallowing the boundary's error records (they
 * are human lines, not JSON, and `JSON.parse` would throw on them).
 */
const ANOMALY_LINE_PREFIX = `[boundary] {"event":"${ANOMALY_EVENT_NAME}"`;

/** Every anomaly record the sink emitted while `run` executed. */
async function captureAnomalyRecords(run: () => Promise<void>): Promise<Record<string, unknown>[]> {
	const lines: string[] = [];
	const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
	});
	try {
		await run();
	} finally {
		spy.mockRestore();
	}
	return lines
		.filter((line) => line.startsWith(ANOMALY_LINE_PREFIX))
		.map((line) => JSON.parse(line.slice('[boundary] '.length)) as Record<string, unknown>);
}

describe('request anomaly monitor at the Worker entry', () => {
	it('reports a real 401 storm on the external API once, and records nothing else', async () => {
		const records = await captureAnomalyRecords(async () => {
			for (let index = 0; index < 15; index += 1) {
				const health = await SELF.fetch('https://example.com/api/v1/health', {
					headers: { ...CANARY_HEADERS },
				});
				expect(health.status).toBe(200);
			}
			// 4 of 19 = 0.21 is still under the 0.25 bar.
			for (let index = 0; index < 4; index += 1) {
				const denied = await SELF.fetch('https://example.com/api/v1/reactions', {
					headers: { ...CANARY_HEADERS },
				});
				expect(denied.status).toBe(401);
			}
			// 5 of 20 = 0.25 — the crossing, on this request.
			const crossing = await SELF.fetch('https://example.com/api/v1/reactions', {
				headers: { ...CANARY_HEADERS },
			});
			expect(crossing.status).toBe(401);

			// 15 more 401s take the surface to 30 of 50 = 0.6. The window
			// latch holds, so an incident that does not change produces
			// one record and not thirty: a monitor that narrated every
			// request would be muted within a day.
			for (let index = 0; index < 15; index += 1) {
				const denied = await SELF.fetch('https://example.com/api/v1/reactions', {
					headers: { ...CANARY_HEADERS },
				});
				expect(denied.status).toBe(401);
			}
		});

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			event: ANOMALY_EVENT_NAME,
			surface: 'external-api',
			signal: 'unauthorized',
			status: '401',
			samples: 20,
			hits: 5,
			rate: 0.25,
			threshold: 0.25,
			minSamples: 20,
		});

		// The record is exactly the event, field for field: the sink
		// writes a purpose-built shape and never forwards request
		// context, so the audit stream cannot grow a caller dimension
		// without an explicit edit here.
		expect(Object.keys(records[0] ?? {}).sort()).toEqual([...ANOMALY_EVENT_FIELDS].sort());
		const rendered = JSON.stringify(records[0]);
		for (const canary of CANARIES) {
			expect(rendered.toLowerCase()).not.toContain(canary);
		}
	});

	it('does not report an ordinary Admin browsing session', async () => {
		const records = await captureAnomalyRecords(async () => {
			for (let index = 0; index < 30; index += 1) {
				const admin = await SELF.fetch('https://example.com/admin', {
					headers: { ...CANARY_HEADERS },
				});
				// Anonymous Admin traffic renders the login screen (a 2xx
				// here, a redirect on other paths): 2xx/3xx is the
				// denominator, never a signal.
				expect(admin.status).toBeGreaterThanOrEqual(200);
				expect(admin.status).toBeLessThan(400);
			}
		});
		expect(records).toEqual([]);
	});
});
