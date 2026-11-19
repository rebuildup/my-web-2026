import { describe, expect, it, vi } from 'vitest';
import { ANOMALY_EVENT_FIELDS, ANOMALY_EVENT_NAME } from './http/middleware/anomaly-monitor';
import { serveWorkerRequest } from './server';

/**
 * Worker-entry failure boundary — behavioural proof (Issue #995).
 *
 * `scripts/check-dispatch-failure-boundary.mjs` pins the SHAPE of the
 * catch textually, because the workerd pool cannot `vi.mock` the
 * framework imports a real downstream throw would need. This file
 * proves the BEHAVIOUR instead: `serveWorkerRequest` takes the
 * dispatch as a parameter (the same seam
 * `src/http/api-keys/middleware.ts` uses for `vi.mock`-proof tests),
 * so a stub that throws stands in for `externalBoundary.fetch` /
 * `handler.fetch` throwing, and the assertions run against the real
 * response the entrypoint produces — fallback body, security headers,
 * cache policy, anomaly observation and the status-only audit record.
 *
 * What is NOT re-proven here: that `workerDispatch` routes `/api/v1/*`
 * to Hono and everything else to TanStack Start. That split is the
 * `EXTERNAL_BOUNDARY_PREFIXES` contract owned by `src/server.ts` and
 * covered by the SELF-level suites (`security-headers.test.ts`,
 * `request-anomaly-monitor.test.ts`, …); the stub replaces the whole
 * dispatch, so these tests exercise everything AROUND it.
 *
 * Counter discipline: the anomaly monitor's counts are module state,
 * so the `/api/v1` crossing runs FIRST and alone — every later test
 * uses an unwatched page path (`/contact`) and cannot move the
 * external-API window the first test asserts on.
 */

/** Fabricated detail that must never reach the client or the log. */
const CANARY = 'canary-secret-binding-name-7f3a';

const ENV = {} as Env;
const CTX = {
	waitUntil: () => {},
	passThroughOnException: () => {},
} as unknown as ExecutionContext;

function throwingDispatch(error: unknown) {
	return async (): Promise<Response> => {
		throw error;
	};
}

/** Every `[scope] {...}` audit line emitted while `run` executed. */
async function captureAuditLines(
	scope: string,
	event: string,
	run: () => Promise<void>,
): Promise<Record<string, unknown>[]> {
	const lines: string[] = [];
	const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
	});
	try {
		await run();
	} finally {
		spy.mockRestore();
	}
	const prefix = `[${scope}] {"event":"${event}"`;
	return lines
		.filter((line) => line.startsWith(prefix))
		.map((line) => JSON.parse(line.slice(`[${scope}] `.length)) as Record<string, unknown>);
}

describe('dispatch failure boundary (Issue #995)', () => {
	it('turns 20 external-API dispatch throws into counted 500s and one anomaly record', async () => {
		// First test in the file on purpose: the monitor's window starts
		// empty, so 20 samples / 20 server-error hits is exactly the
		// crossing the policy declares (rate 1.0 >= 0.05, minSamples 20).
		const { anomaly, failures, last } = await (async () => {
			const anomaly: Record<string, unknown>[] = [];
			const failures: Record<string, unknown>[] = [];
			let last: Response | null = null;
			const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
				const line = args
					.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
					.join(' ');
				if (line.startsWith('[boundary] {"event":"anomaly.detected"')) {
					anomaly.push(JSON.parse(line.slice('[boundary] '.length)));
				} else if (line.startsWith('[boundary] {"event":"dispatch-failure"')) {
					failures.push(JSON.parse(line.slice('[boundary] '.length)));
				}
			});
			try {
				for (let index = 0; index < 20; index += 1) {
					last = await serveWorkerRequest(
						new Request('https://example.com/api/v1/health'),
						ENV,
						CTX,
						throwingDispatch(new Error(`upstream exploded near ${CANARY}`)),
					);
					expect(last.status).toBe(500);
				}
			} finally {
				spy.mockRestore();
			}
			return { anomaly, failures, last };
		})();

		// Every throw produced its own status-only record; the error NAME
		// is a class label and the message — which carried the canary —
		// is nowhere in it.
		expect(failures).toHaveLength(20);
		for (const record of failures) {
			expect(record.errorName).toBe('Error');
			expect(JSON.stringify(record)).not.toContain(CANARY);
		}

		// The 500s were observed like any other response: exactly one
		// crossing, field-for-field the closed event shape.
		expect(anomaly).toHaveLength(1);
		expect(anomaly[0]).toMatchObject({
			event: ANOMALY_EVENT_NAME,
			surface: 'external-api',
			signal: 'server-error',
			status: '5xx',
			samples: 20,
			hits: 20,
			rate: 1,
			threshold: 0.05,
			minSamples: 20,
		});
		expect(Object.keys(anomaly[0] ?? {}).sort()).toEqual([...ANOMALY_EVENT_FIELDS].sort());
		expect(JSON.stringify(anomaly[0])).not.toContain(CANARY);

		// The fallback answers in the boundary's own contract: the
		// documented JSON envelope, not the runtime's bare text 500 —
		// and it still carries the whole security-header chain.
		const body = (await last?.json()) as Record<string, unknown>;
		expect(body.error).toBe('internal_error');
		expect(typeof body.request_id).toBe('string');
		expect(JSON.stringify(body)).not.toContain(CANARY);
		const headers = last?.headers;
		expect(headers?.get('content-type')).toContain('application/json');
		expect(headers?.get('x-request-id')).toBe(body.request_id);
		expect(headers?.get('x-content-type-options')).toBe('nosniff');
		expect(headers?.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(headers?.get('permissions-policy')).toContain('microphone=()');
		expect(headers?.get('strict-transport-security')).toBe('max-age=31536000');
		expect(headers?.get('content-security-policy-report-only')).toBeTruthy();
	});

	it('answers a document-path throw with the SSR failure document and the same headers', async () => {
		const failures = await captureAuditLines('boundary', 'dispatch-failure', async () => {
			const response = await serveWorkerRequest(
				new Request('https://example.com/contact'),
				ENV,
				CTX,
				throwingDispatch(new Error(CANARY)),
			);
			expect(response.status).toBe(500);
			const html = await response.text();
			expect(response.headers.get('content-type')).toContain('text/html');
			expect(html).toContain('data-error-state="service_unavailable"');
			expect(html).not.toContain(CANARY);
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
			expect(response.headers.get('permissions-policy')).toContain('microphone=()');
			expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
		});
		expect(failures).toHaveLength(1);
		expect(failures[0]?.errorName).toBe('Error');
		expect(JSON.stringify(failures[0])).not.toContain(CANARY);
	});

	it('records errorName "unknown" when the dispatch throws a non-Error', async () => {
		const failures = await captureAuditLines('boundary', 'dispatch-failure', async () => {
			const response = await serveWorkerRequest(
				new Request('https://example.com/contact'),
				ENV,
				CTX,
				throwingDispatch('a bare string throw'),
			);
			expect(response.status).toBe(500);
		});
		expect(failures).toHaveLength(1);
		expect(failures[0]?.errorName).toBe('unknown');
	});

	it('passes a successful dispatch through the same pipeline unchanged', async () => {
		const seen: unknown[] = [];
		const dispatch = async (request: Request, env: Env, ctx: ExecutionContext) => {
			seen.push(request.url, env === ENV, ctx === CTX);
			return new Response('<html><body>ok</body></html>', {
				status: 200,
				headers: { 'content-type': 'text/html; charset=utf-8' },
			});
		};
		const response = await serveWorkerRequest(
			new Request('https://example.com/contact'),
			ENV,
			CTX,
			dispatch,
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('<html><body>ok</body></html>');
		// The dispatch received the real request/env/ctx triple.
		expect(seen).toEqual(['https://example.com/contact', true, true]);
		// The post-dispatch chain still ran on the success: the security
		// headers are applied to every Worker-generated response,
		// exactly as before. (The cache policy is dispatch-side — it
		// lives in `workerDispatch`, which this stub replaces — so it
		// is deliberately not asserted here.)
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000');
	});
});
