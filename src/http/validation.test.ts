import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	MAX_JSON_BODY_BYTES,
	declaredBodyBytes,
	formatIssues,
	isJsonContentType,
	jsonBody,
	methodNotAllowed,
	parseBoundaryInput,
	parseQueryInput,
	readJsonBody,
} from './validation';

/**
 * Unit coverage for the boundary input contract (`Issue #450`).
 *
 * These assert the *policy* in isolation — media type, size, Zod vs
 * throwing validator, parameter pollution, method guard. The end-to-end
 * HTTP behaviour through the real routers lives in
 * `test/integration/input-validation.test.ts`.
 */
const Schema = z.object({ name: z.string().min(1).max(4) });

describe('isJsonContentType', () => {
	it('accepts json, structured suffix, wildcard and absent', () => {
		expect(isJsonContentType(new Headers({ 'content-type': 'application/json' }))).toBe(true);
		expect(
			isJsonContentType(new Headers({ 'content-type': 'application/json; charset=utf-8' })),
		).toBe(true);
		expect(isJsonContentType(new Headers({ 'content-type': 'application/ld+json' }))).toBe(true);
		expect(isJsonContentType(new Headers({ 'content-type': '*/*' }))).toBe(true);
		expect(isJsonContentType(new Headers())).toBe(true);
	});

	it('rejects anything that is not JSON', () => {
		expect(isJsonContentType(new Headers({ 'content-type': 'text/plain' }))).toBe(false);
		expect(
			isJsonContentType(new Headers({ 'content-type': 'application/x-www-form-urlencoded' })),
		).toBe(false);
	});
});

describe('declaredBodyBytes', () => {
	it('parses a numeric content-length and ignores junk', () => {
		expect(declaredBodyBytes(new Headers({ 'content-length': '42' }))).toBe(42);
		expect(declaredBodyBytes(new Headers({ 'content-length': 'not-a-number' }))).toBeNull();
		expect(declaredBodyBytes(new Headers({ 'content-length': '-1' }))).toBeNull();
		expect(declaredBodyBytes(new Headers())).toBeNull();
	});
});

describe('formatIssues', () => {
	it('renders path + first message only', () => {
		const result = Schema.safeParse({ name: '' });
		expect(result.success).toBe(false);
		if (result.success) return;
		expect(formatIssues(result.error)).toBe(
			'name: Too small: expected string to have >=1 characters',
		);
	});

	it('falls back when there is no issue', () => {
		expect(formatIssues({ issues: [] })).toBe('invalid input');
	});
});

describe('parseBoundaryInput', () => {
	it('accepts a value a Zod schema allows', () => {
		const result = parseBoundaryInput('invalid_body', Schema, { name: 'ok' });
		expect(result).toEqual({ ok: true, value: { name: 'ok' } });
	});

	it('turns a Zod failure into the caller-provided code', () => {
		const result = parseBoundaryInput('invalid_body', Schema, { name: 'far-too-long' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.failure.status).toBe(400);
		expect(result.failure.code).toBe('invalid_body');
		expect(result.failure.reason).toContain('name');
	});

	it('turns a thrown validate* function into the caller-provided code', () => {
		const thrower = (value: unknown): string => {
			if (typeof value !== 'string') throw new Error('must be a string');
			return value;
		};
		expect(parseBoundaryInput('invalid_key', thrower, 'fine')).toEqual({
			ok: true,
			value: 'fine',
		});
		const bad = parseBoundaryInput('invalid_key', thrower, 42);
		expect(bad.ok).toBe(false);
		if (bad.ok) return;
		expect(bad.failure).toEqual({
			status: 400,
			code: 'invalid_key',
			reason: 'must be a string',
		});
	});

	it('never lets a validator throw escape as a 500', () => {
		const explode = (): string => {
			throw new Error('boom');
		};
		const result = parseBoundaryInput('invalid_body', explode, undefined);
		expect(result.ok).toBe(false);
	});
});

describe('readJsonBody', () => {
	// Bare probe: `readJsonBody` is the unit under test, so the route
	// must not apply the schema layer as well.
	const probe = new Hono();
	probe.post('/', async (c) => {
		const result = await readJsonBody(c);
		return c.json(
			result.ok ? { ok: true } : result.failure,
			result.ok ? 200 : result.failure.status,
		);
	});
	it('415 for a non-JSON content type', async () => {
		const res = await probe.request('/', {
			method: 'POST',
			headers: { 'content-type': 'text/plain' },
			body: '{}',
		});
		expect(res.status).toBe(415);
	});

	it('413 for an over-size body declared by content-length', async () => {
		const res = await probe.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'content-length': '999999' },
			body: '{}',
		});
		expect(res.status).toBe(413);
	});

	it('413 when the read body exceeds the cap even without content-length', async () => {
		const res = await probe.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pad: 'x'.repeat(MAX_JSON_BODY_BYTES + 1) }),
		});
		expect(res.status).toBe(413);
		expect(((await res.json()) as { code: string }).code).toBe('payload_too_large');
	});

	it('400 for a body that is not JSON', async () => {
		const res = await probe.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: 'not json',
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { reason: string }).reason).toContain('valid JSON');
	});

	it('accepts a body at exactly the cap', async () => {
		const filler = 'x'.repeat(MAX_JSON_BODY_BYTES - '""}'.length);
		const res = await probe.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(filler),
		});
		expect(res.status).toBe(200);
	});
});

describe('jsonBody middleware', () => {
	const guarded = new Hono();
	guarded.post('/', jsonBody(Schema), (c) => c.json({ received: c.get('boundaryBody') }));

	it('passes the typed value downstream', async () => {
		const res = await guarded.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'ok' }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ received: { name: 'ok' } });
	});

	it('answers 400 with { error, reason } on a schema failure', async () => {
		const res = await guarded.request('/', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'much-too-long' }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; reason: string };
		expect(body.error).toBe('invalid_body');
		expect(typeof body.reason).toBe('string');
	});
});

describe('parseQueryInput', () => {
	const query = new Hono();
	query.get('/', (c) => {
		const result = parseQueryInput(c, ['target', 'actor_id']);
		return c.json(
			result.ok ? result.value : result.failure,
			result.ok ? 200 : result.failure.status,
		);
	});

	it('collects single-valued parameters', async () => {
		const res = await query.request('/?target=a&actor_id=b');
		expect(await res.json()).toEqual({ target: 'a', actor_id: 'b' });
	});

	it('omits absent parameters instead of inventing a value', async () => {
		const res = await query.request('/?target=a');
		expect(await res.json()).toEqual({ target: 'a' });
	});

	it('rejects a repeated parameter (HTTP parameter pollution)', async () => {
		const res = await query.request('/?target=a&target=b');
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code: string; reason: string };
		expect(body.code).toBe('invalid_query');
		expect(body.reason).toContain('at most once');
	});
});

describe('methodNotAllowed', () => {
	const guarded = new Hono();
	guarded.get('/thing', (c) => c.json({ ok: true }));
	guarded.all('/thing', methodNotAllowed(['GET']));

	it('answers 405 with an Allow header for an unsupported verb', async () => {
		const res = await guarded.request('/thing', { method: 'DELETE' });
		expect(res.status).toBe(405);
		expect(res.headers.get('allow')).toBe('GET');
		expect(((await res.json()) as { error: string }).error).toBe('method_not_allowed');
	});

	it('does not shadow the registered verb', async () => {
		const res = await guarded.request('/thing');
		expect(res.status).toBe(200);
	});
});
