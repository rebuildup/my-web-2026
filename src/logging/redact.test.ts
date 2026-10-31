import { describe, expect, it } from 'vitest';
import {
	REDACTED,
	REDACTED_BLOB,
	REDACTED_CORRELATION,
	REDACTED_EMAIL,
	REDACTED_ERROR_NAME,
	REDACTED_TOKEN,
	isSensitiveKey,
	redactCorrelationId,
	redactEmailAddress,
	redactErrorName,
	redactLogError,
	redactLogText,
	redactLogValue,
} from './redact';

/**
 * Log-redaction contract (Issue #467).
 *
 * These tests are the audit the Issue asks for: every canary below
 * is a FABRICATED secret / personal-data shape, and the assertion is
 * that it cannot survive a redaction pass. They are the unit-level
 * half of the audit; the API-error half lives in
 * `test/integration/log-redaction.test.ts`, which drives the real
 * boundary and the real loaders.
 *
 * Read every expectation as a security claim, not as a formatting
 * preference: if a value survives, a credential is in the log.
 */
describe('redactLogText — credential shapes', () => {
	it('masks an Authorization bearer token', () => {
		const out = redactLogText(
			'GET /api/v1/access failed: Authorization: Bearer mk_canary_secret_0000',
		);
		expect(out).not.toContain('mk_canary_secret_0000');
		expect(out).toContain(REDACTED);
	});

	it('masks the project API key prefix wherever it appears', () => {
		expect(redactLogText('key=mk_home_canary-0000 rejected')).not.toContain('mk_home_canary-0000');
	});

	it('masks a JWT', () => {
		const jwt =
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJjYW5hcnkifQ.2U-8xTQl0m4v9dKQ3n8b7c1a5e6f0';
		expect(redactLogText(`token=${jwt}`)).not.toContain(jwt);
	});

	it('masks an opaque blob even without a recognisable prefix', () => {
		const blob = 'K7xQm2Zr9Tp4Lv6Nc8Bd1Ws5Yh0Ju3Ee';
		expect(redactLogText(`upstream said ${blob}`)).toBe(`upstream said ${REDACTED_BLOB}`);
	});

	it('masks a single-use link token in a URL', () => {
		const url =
			'https://rebuildup.dev/api/v1/auth/verify-email?token=canary-token-abcdef123456&callbackURL=x';
		const out = redactLogText(url);
		expect(out).not.toContain('canary-token-abcdef123456');
		expect(out).toContain('callbackURL=x');
	});

	it('masks a session cookie header', () => {
		const header = 'cookie: mw_actor_id=550e8400-e29b-41d4-a716-446655440000; theme=dark';
		const out = redactLogText(header);
		expect(out).not.toContain('550e8400-e29b-41d4-a716-446655440000');
		expect(out).toContain(REDACTED);
	});

	it('masks an email address (personal data)', () => {
		const out = redactLogText('invitee canary.person@example.invalid was created');
		expect(out).not.toContain('canary.person@example.invalid');
		expect(out).toContain(REDACTED_EMAIL);
	});

	it('is idempotent — a second pass changes nothing', () => {
		const once = redactLogText(`Bearer mk_canary_0000000000 and a@b.example and ${'x'.repeat(40)}`);
		expect(redactLogText(once)).toBe(once);
	});

	it('keeps ordinary diagnostics readable', () => {
		const out = redactLogText('upstream failed status=502 after 3 retries for /api/v1/access/hit');
		expect(out).toBe('upstream failed status=502 after 3 retries for /api/v1/access/hit');
	});

	it('keeps ordinary prose that merely mentions a secret name', () => {
		expect(redactLogText('BETTER_AUTH_SECRET is required by the deploy driver')).toBe(
			'BETTER_AUTH_SECRET is required by the deploy driver',
		);
	});
});

describe('redactLogValue — structure', () => {
	it('masks sensitive keys regardless of their value', () => {
		const out = redactLogValue({
			authorization: 'Bearer mk_canary_0000000000',
			cookie: 'mw_actor_id=abc',
			api_key: 'plain',
			session_id: 'per-request-uuid',
			email: 'person@example.invalid',
			status: 502,
			retryable: true,
		}) as Record<string, unknown>;
		expect(out).toEqual({
			authorization: REDACTED,
			cookie: REDACTED,
			api_key: REDACTED,
			session_id: REDACTED,
			email: REDACTED,
			status: 502,
			retryable: true,
		});
	});

	it('walks nested objects and arrays', () => {
		const out = redactLogValue({
			response: { headers: { authorization: 'Bearer mk_canary_0000000000' }, body: 'ok' },
			attempts: [{ token: 'abc' }, { token: 'def' }],
		}) as Record<string, Record<string, unknown> | Record<string, unknown>[]>;
		expect(out.response).toEqual({ headers: { authorization: REDACTED }, body: 'ok' });
		expect(out.attempts).toEqual([{ token: REDACTED }, { token: REDACTED }]);
	});

	it('survives a circular reference', () => {
		const cyclic: Record<string, unknown> = { name: 'loop' };
		cyclic.self = cyclic;
		expect(() => redactLogValue(cyclic)).not.toThrow();
		expect(redactLogValue(cyclic)).toEqual({ name: 'loop', self: '[circular]' });
	});

	it('caps string length', () => {
		const out = redactLogValue({ note: 'lorem ipsum '.repeat(100) }) as { note: string };
		expect(out.note.length).toBeLessThan(400);
		expect(out.note).toContain('chars)');
	});

	it('caps array width', () => {
		const out = redactLogValue(Array.from({ length: 40 }, (_, i) => i)) as unknown[];
		expect(out).toHaveLength(26);
		expect(out[out.length - 1]).toBe('[+15 more]');
	});

	it('does not walk class instances (getters can carry request state)', () => {
		const headers = new Headers({ authorization: 'Bearer mk_canary_0000000000' });
		expect(redactLogValue(headers)).toBe('[Headers]');
	});

	it('rejects a prototype-polluted object safely', () => {
		const payload = JSON.parse(
			'{"__proto__":{"authorization":"Bearer mk_canary_0000000000"},"ok":true}',
		);
		const out = redactLogValue(payload) as Record<string, unknown>;
		expect(out.ok).toBe(true);
		expect(JSON.stringify(out)).not.toContain('mk_canary_0000000000');
	});

	it('keeps an own __proto__ key as redacted data, not as a prototype write', () => {
		const payload = JSON.parse(
			'{"__proto__":{"authorization":"Bearer mk_canary_0000000000"},"ok":true}',
		);
		const out = redactLogValue(payload) as Record<string, unknown>;
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect(Object.hasOwn(out, '__proto__')).toBe(true);
		expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({
			authorization: '[redacted]',
		});
		expect(JSON.stringify(out)).toContain('"__proto__"');
	});
});

describe('redactLogError', () => {
	it('collapses an Error to name + redacted message', () => {
		const out = redactLogError(
			new Error('upstream 401 for Bearer mk_canary_secret_0000 (person@example.invalid)'),
		);
		expect(out.name).toBe('Error');
		expect(out.message).not.toContain('mk_canary_secret_0000');
		expect(out.message).not.toContain('person@example.invalid');
	});

	it('does not expose the stack (frame context can carry request URLs)', () => {
		const out: unknown = redactLogError(new Error('boom'));
		expect(out).toEqual({ name: 'Error', message: 'boom' });
	});

	it('handles a thrown non-Error', () => {
		expect(redactLogError('Bearer mk_canary_secret_0000')).toEqual({
			name: 'NonError',
			message: `Bearer ${REDACTED_TOKEN}`,
		});
	});
});

describe('redactErrorName — an attacker-controllable name', () => {
	// `Error.prototype.name` is an ordinary writable string property,
	// so `err.name = 'Bearer …'` is a one-line leak into an
	// operator-visible record. The name must never be trusted.
	it('masks a name that carries a credential', () => {
		const error = new Error('boom');
		error.name = 'Bearer mk_canary_secret_0000';
		const out = redactLogError(error);
		expect(out.name).toBe(REDACTED_ERROR_NAME);
		expect(out.name).not.toContain('mk_canary_secret_0000');
	});

	it.each([
		['an api key prefix', 'sk_live_canary_00000000'],
		['an opaque blob', 'K7xQm2Zr9Tp4Lv6Nc8Bd1Ws5Yh0Ju3Ee'],
		['an email address', 'canary.person@example.invalid'],
		['a query secret', 'token=canary-token-abcdef123456'],
	])('masks a name carrying %s', (_label, name) => {
		expect(redactErrorName(name)).toBe(REDACTED_ERROR_NAME);
	});

	it('masks a name that is not a plain identifier', () => {
		expect(redactErrorName('upstream failed (status=502)')).toBe(REDACTED_ERROR_NAME);
		expect(redactErrorName('')).toBe(REDACTED_ERROR_NAME);
		expect(redactErrorName(undefined)).toBe(REDACTED_ERROR_NAME);
		expect(redactErrorName(42)).toBe(REDACTED_ERROR_NAME);
	});

	it('keeps an allowlisted standard name', () => {
		expect(redactErrorName('Error')).toBe('Error');
		expect(redactErrorName('TypeError')).toBe('TypeError');
	});

	it('keeps an identifier-shaped custom error name', () => {
		class BoundaryInputError extends Error {
			constructor(message: string) {
				super(message);
				this.name = 'BoundaryInputError';
			}
		}
		expect(redactErrorName('BoundaryInputError')).toBe('BoundaryInputError');
		expect(redactLogError(new BoundaryInputError('bad input')).name).toBe('BoundaryInputError');
	});

	it('masks a hostile class-instance name', () => {
		class Holder {}
		const hostile: Record<string, unknown> = Object.create(Holder.prototype);
		Object.defineProperty(hostile, 'constructor', {
			value: { name: 'Bearer mk_canary_secret_0000' },
			enumerable: true,
			writable: true,
			configurable: true,
		});
		const out = redactLogValue(hostile);
		expect(String(out)).not.toContain('mk_canary_secret_0000');
		expect(out).toBe(`[${REDACTED_ERROR_NAME}]`);
	});
});

describe('isSensitiveKey', () => {
	it.each([
		'authorization',
		'Authorization',
		'proxy-authorization',
		'cookie',
		'set-cookie',
		'access_token',
		'refreshToken',
		'client_secret',
		'api_key',
		'apiKey',
		'x-api-key',
		'session_id',
		'mw_actor_id',
		'email',
		'user_agent',
	])('treats %s as sensitive', (key) => {
		expect(isSensitiveKey(key)).toBe(true);
	});

	it.each(['status', 'count', 'r2_key', 'name', 'target_key', 'message', 'worker'])(
		'leaves %s alone',
		(key) => {
			expect(isSensitiveKey(key)).toBe(false);
		},
	);
});

describe('redactEmailAddress', () => {
	it('replaces any non-empty address', () => {
		expect(redactEmailAddress('canary.person@example.invalid')).toBe(REDACTED_EMAIL);
	});

	it('passes an empty string through', () => {
		expect(redactEmailAddress('')).toBe('');
	});
});

describe('redactCorrelationId', () => {
	// A minted id is 128-bit lowercase hex (`generateRequestId`), so
	// it survives verbatim — otherwise the published correlation id of
	// Issue #457 could not be grepped in the operator log.
	it('keeps a token this repository minted', () => {
		const minted = 'a979b75d5b3db6aff86ed49021ecd0c0';
		expect(redactCorrelationId(minted)).toBe(minted);
	});

	// Everything else is a value somebody else chose, or a shape the
	// mint format does not have. Fail closed.
	it.each([
		['a client-supplied trace id', 'client-correlation-1234'],
		['a uuid with dashes', '550e8400-e29b-41d4-a716-446655440000'],
		['an api key', 'mk_canary_a1b2c3d4e5f60000'],
		['an email address', 'canary.person@example.invalid'],
		['uppercase hex', 'A979B75D5B3DBAFF86ED49021ECD0C0'],
		['a 31-char prefix of a minted id', 'a979b75d5b3db6aff86ed49021ecd0c'],
		['an empty string', ''],
	])('replaces %s', (_label, value) => {
		expect(redactCorrelationId(value)).toBe(REDACTED_CORRELATION);
	});

	it('replaces a missing token', () => {
		expect(redactCorrelationId(null)).toBe(REDACTED_CORRELATION);
		expect(redactCorrelationId(undefined)).toBe(REDACTED_CORRELATION);
	});

	it('cannot be used to smuggle a value through the ordinary text path', () => {
		// The exception lives on the correlation channel only: the same
		// string interpolated into a normal message is still masked.
		const minted = 'a979b75d5b3db6aff86ed49021ecd0c0';
		expect(redactLogText(`request_id=${minted}`)).toContain(REDACTED_BLOB);
	});
});
