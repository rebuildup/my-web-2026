import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { publicErrorResponse } from './errors';
import { generateRequestId, requestIdMiddleware } from './middleware/request-id';

/**
 * Unit tests for the public error contract (Issue #457).
 *
 * The probe app below mirrors the production composition in
 * `src/http/hono.ts` — the same `requestIdMiddleware` followed by
 * the same `publicErrorResponse` fallback — so the assertions run
 * against the real middleware and the real redaction helper rather
 * than a re-declared copy of either.
 *
 * The throw payloads are shaped like the failures this contract
 * exists for: a D1 message carrying SQL and a table name, an R2
 * message carrying the bucket, and a Better Auth failure carrying a
 * secret binding name. Each is asserted to be absent from every
 * byte of the response.
 */

const SQL_LEAK = 'D1_ERROR: no such table: reactions: SQLITE_ERROR';
const BUCKET_LEAK = 'The specified bucket does not exist. (my-web-2026)';
const SECRET_LEAK = 'BETTER_AUTH_SECRET is not configured for this Worker';

function probeApp() {
	const app = new Hono<{ Bindings: Env; Variables: { requestId?: string } }>();
	app.use('/api/v1/*', requestIdMiddleware);
	app.get('/api/v1/probe', () => {
		throw new Error(SQL_LEAK);
	});
	app.get('/api/v1/unavailable', () => {
		throw new Error(BUCKET_LEAK);
	});
	app.get('/api/v1/secret', () => {
		throw new Error(SECRET_LEAK);
	});
	app.onError((err, c) =>
		publicErrorResponse(c, err, {
			status: 500,
			code: 'internal_error',
			logLabel: 'probe failure',
		}),
	);
	return app;
}

async function bodyText(res: Response): Promise<string> {
	return await res.text();
}

describe('publicErrorResponse (Issue #457)', () => {
	it('returns a stable code, a repo-authored message, and a correlation id', async () => {
		const res = await probeApp().request('/api/v1/probe');
		expect(res.status).toBe(500);
		const body = JSON.parse(await bodyText(res)) as {
			error: string;
			message: string;
			request_id: string;
		};
		expect(body.error).toBe('internal_error');
		expect(body.message).toContain('could not be completed');
		expect(body.request_id).toMatch(/^[0-9a-f]{32}$/);
	});

	it('publishes the same id in the body and the X-Request-Id header', async () => {
		const res = await probeApp().request('/api/v1/probe');
		const body = JSON.parse(await bodyText(res)) as { request_id: string };
		expect(res.headers.get('x-request-id')).toBe(body.request_id);
	});

	it('keeps a client-supplied X-Request-Id so the reporter can be correlated', async () => {
		const res = await probeApp().request('/api/v1/probe', {
			headers: { 'X-Request-Id': 'client-correlation-1234' },
		});
		const body = JSON.parse(await bodyText(res)) as { request_id: string };
		expect(body.request_id).toBe('client-correlation-1234');
		expect(res.headers.get('x-request-id')).toBe('client-correlation-1234');
	});

	it('never leaks a stack, an SQL message, or a binding name', async () => {
		const res = await probeApp().request('/api/v1/probe');
		const text = await bodyText(res);
		for (const forbidden of [
			SQL_LEAK,
			'SQLITE_ERROR',
			'no such table',
			'reactions',
			'at ',
			'.ts:',
		]) {
			expect(text).not.toContain(forbidden);
		}
	});

	it('never leaks an R2 bucket name from a 5xx body', async () => {
		const res = await probeApp().request('/api/v1/unavailable');
		const text = await bodyText(res);
		expect(text).not.toContain(BUCKET_LEAK);
		expect(text).not.toContain('my-web-2026');
	});

	it('never leaks a secret binding name from a 5xx body', async () => {
		const res = await probeApp().request('/api/v1/secret');
		const text = await bodyText(res);
		expect(text).not.toContain('BETTER_AUTH_SECRET');
		expect(text).not.toContain(SECRET_LEAK);
	});

	it('answers 503 with the service_unavailable code when asked', async () => {
		const app = new Hono<{ Bindings: Env; Variables: { requestId?: string } }>();
		app.get('/api/v1/probe', () => {
			throw new Error(SQL_LEAK);
		});
		app.onError((err, c) =>
			publicErrorResponse(c, err, {
				status: 503,
				code: 'service_unavailable',
				logLabel: 'probe failure',
			}),
		);
		const res = await app.request('/api/v1/probe');
		expect(res.status).toBe(503);
		const body = JSON.parse(await bodyText(res)) as { error: string; request_id: string };
		expect(body.error).toBe('service_unavailable');
		// Outside `/api/v1/*` no request-id middleware runs, so the
		// fallback mints one and publishes it as a header.
		expect(body.request_id).toMatch(/^[0-9a-f]{32}$/);
		expect(res.headers.get('x-request-id')).toBe(body.request_id);
	});

	it('writes the correlation id and the internal error to the log, and nothing else', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const res = await probeApp().request('/api/v1/probe');
			const body = JSON.parse(await bodyText(res)) as { request_id: string };
			expect(spy).toHaveBeenCalledTimes(1);
			const [label, logged] = spy.mock.calls[0] as [string, unknown];
			expect(label).toContain(`request_id=${body.request_id}`);
			expect(label).not.toContain(SQL_LEAK);
			expect((logged as Error).message).toBe(SQL_LEAK);
		} finally {
			spy.mockRestore();
		}
	});

	it('generates request ids in the same format the middleware uses', () => {
		expect(generateRequestId()).toMatch(/^[0-9a-f]{32}$/);
	});
});
