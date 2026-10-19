import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { publicErrorResponse } from './errors';
import {
	generateRequestId,
	isAcceptedRequestId,
	requestIdMiddleware,
} from './middleware/request-id';

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

/**
 * Fabricated credentials/personal data used to prove the boundary
 * record is redacted before it reaches the log stream (Issue #467).
 * Nothing here is a real value.
 */
const CANARY_KEY = 'mk_canary_b7c3d9e0f1a26488';
const CANARY_EMAIL = 'canary.person@example.invalid';
const CANARY_TEXT = `upstream rejected ${CANARY_KEY} for ${CANARY_EMAIL}`;

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
	app.get('/api/v1/canary', () => {
		throw new Error(CANARY_TEXT);
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

	it('declares application/json on the body it returns (ASVS V4.1.1, #507)', async () => {
		// The 5xx body is the one an unexpected error produces, so a
		// media type that stopped matching it would be exactly the
		// failure this requirement is about. `application/json` carries
		// no charset parameter by design (RFC 8259 defines the media
		// type as UTF-8 only), so the media type is the assertion.
		const res = await probeApp().request('/api/v1/probe');
		expect(res.status).toBe(500);
		expect(res.headers.get('content-type')).toMatch(/^application\/json\b/);
		expect(JSON.parse(await bodyText(res))).toBeTypeOf('object');
	});

	it('keeps a client-supplied X-Request-Id so the reporter can be correlated', async () => {
		const res = await probeApp().request('/api/v1/probe', {
			headers: { 'X-Request-Id': 'client-correlation-1234' },
		});
		const body = JSON.parse(await bodyText(res)) as { request_id: string };
		expect(body.request_id).toBe('client-correlation-1234');
		expect(res.headers.get('x-request-id')).toBe('client-correlation-1234');
	});

	it('mints an id instead of echoing a client string outside the accepted charset', async () => {
		// Issue #457: the id is now published in the body too, so an
		// arbitrary client string must not ride along inside a
		// documented contract field.
		const res = await probeApp().request('/api/v1/probe', {
			headers: { 'X-Request-Id': 'not a valid id <script>' },
		});
		const body = JSON.parse(await bodyText(res)) as { request_id: string };
		expect(body.request_id).toMatch(/^[0-9a-f]{32}$/);
		expect(res.headers.get('x-request-id')).toBe(body.request_id);
	});

	it('accepts the trace-id alphabets the ecosystem actually uses', () => {
		for (const id of [
			'2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b', // hex
			'4bf92f3577b34da6a3ce929d0e0e4736', // W3C trace-id
			'00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01', // traceparent
			'req_1234.5678:prod', // dotted service id
		]) {
			expect(isAcceptedRequestId(id)).toBe(true);
		}
		for (const id of [
			undefined,
			null,
			'',
			'a'.repeat(129),
			'has space',
			'<script>',
			'id\nwith-newline',
		]) {
			expect(isAcceptedRequestId(id)).toBe(false);
		}
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
			// The id is greppable because THIS Worker minted it (the
			// logger proves the mint format before printing it).
			expect(label).toContain(`request_id=${body.request_id}`);
			expect(label).not.toContain(SQL_LEAK);
			// The record is the redacting logger's collapsed shape
			// (`{ name, message }`, Issue #467) — the internal detail
			// is still there for the operator, but the value passed to
			// `console` is no longer the raw `Error` instance.
			expect(logged).toEqual({ name: 'Error', message: SQL_LEAK });
		} finally {
			spy.mockRestore();
		}
	});

	it('never writes a client-supplied id into the operator log (Issue #467)', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			// The response contract is unchanged (Issue #457): the id
			// the client supplied is published back in body + header.
			// The log record is a different surface — a client chose
			// this string, so it is not proof of anything and is not
			// printed (open owner decision, docs/security.md).
			const res = await probeApp().request('/api/v1/probe', {
				headers: { 'X-Request-Id': 'client-correlation-1234' },
			});
			const body = JSON.parse(await bodyText(res)) as { request_id: string };
			expect(body.request_id).toBe('client-correlation-1234');
			const [label] = spy.mock.calls[0] as [string, unknown];
			expect(label).toContain('request_id=[redacted-correlation]');
			expect(label).not.toContain('client-correlation-1234');
		} finally {
			spy.mockRestore();
		}
	});

	it('redacts a credential and an address out of the boundary record (Issue #467)', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const res = await probeApp().request('/api/v1/canary');
			expect(res.status).toBe(500);
			const body = await bodyText(res);
			expect(body).not.toContain(CANARY_KEY);
			expect(body).not.toContain(CANARY_EMAIL);
			const [, logged] = spy.mock.calls[0] as [string, unknown];
			const record = JSON.stringify(logged);
			expect(record).not.toContain(CANARY_KEY);
			expect(record).not.toContain(CANARY_EMAIL);
			// The scope survives, so the operator's grep is unchanged.
			expect((spy.mock.calls[0] as [string, unknown])[0]).toContain('[boundary]');
		} finally {
			spy.mockRestore();
		}
	});

	it('generates request ids in the same format the middleware uses', () => {
		expect(generateRequestId()).toMatch(/^[0-9a-f]{32}$/);
	});
});
