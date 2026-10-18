import { expect, test } from '@playwright/test';

/**
 * Cross-site request forgery contract over real HTTP (Issue #440).
 *
 * `test/integration/csrf-contract.test.ts` proves the same contract
 * inside the workerd pool. This spec covers the two things that pool
 * cannot:
 *
 *   1. the `/_serverFn/*` endpoint, which the pool never wires
 *      (`TSS_SERVER_FN_BASE` is a Vite `define` the vitest worker
 *      bundle does not apply), and
 *   2. the built preview server, i.e. the same artifact shape that
 *      ships.
 *
 * Both cases are read-only or refused-by-design:
 *   - the refused write never reaches the handler, so nothing is
 *     recorded in the local D1;
 *   - the accepted case carries no API key, so the next gate answers
 *     401 — the point is that the CSRF layer did NOT answer.
 *
 * No credentials, cookies, or personal data are involved: the request
 * fixture holds no storage state, the bodies use a fixed
 * non-personal target key, and the only credential is a
 * syntactically-valid-but-unused key literal, which the auth layer
 * rejects before any handler runs.
 */

const CROSS_SITE_ORIGIN = 'https://attacker.example';

/**
 * A server-function id that does not exist. The framework's CSRF
 * middleware runs before the id is resolved, so a refused request
 * answers 403 while an accepted one fails later — which is exactly
 * the distinction this spec draws.
 */
const SERVER_FN_PROBE = '/_serverFn/e2e-csrf-probe';

const REACTION_PAYLOAD = {
	target_key: 'e2e-csrf-probe',
	actor_id: 'e2e-csrf-probe',
	kind: 'emoji',
	value: '👍',
};

test.describe('Hono boundary: cross-site writes are refused', () => {
	test('cross-site PUT answers 403 csrf_rejected', async ({ request, baseURL }) => {
		const res = await request.put('/api/v1/reactions', {
			headers: {
				origin: CROSS_SITE_ORIGIN,
				referer: `${CROSS_SITE_ORIGIN}/attack.html`,
				'sec-fetch-site': 'cross-site',
			},
			data: REACTION_PAYLOAD,
		});
		expect(res.status()).toBe(403);
		expect(await res.json()).toEqual({
			error: 'csrf_rejected',
			reason: 'cross_site_fetch_metadata',
		});
	});

	test('the refusal echoes nothing the caller sent', async ({ request }) => {
		const res = await request.post('/api/v1/reactions', {
			headers: {
				origin: `${CROSS_SITE_ORIGIN}/?marker=do-not-echo`,
				'content-type': 'text/plain',
			},
			data: 'do-not-echo',
		});
		expect(res.status()).toBe(403);
		const body = await res.text();
		expect(body).not.toContain('attacker.example');
		expect(body).not.toContain('do-not-echo');
	});

	test('a write with no origin evidence is refused (fail-closed)', async ({ request }) => {
		const res = await request.post('/api/v1/reactions', {
			headers: { 'content-type': 'text/plain' },
			data: 'no-origin-header',
		});
		expect(res.status()).toBe(403);
		expect(await res.json()).toEqual({
			error: 'csrf_rejected',
			reason: 'origin_check_missing',
		});
	});

	test('a same-origin write passes the origin check and is answered by the next gate', async ({
		request,
		baseURL,
	}) => {
		const res = await request.put('/api/v1/reactions', {
			headers: {
				origin: String(baseURL),
				'sec-fetch-site': 'same-origin',
				// A syntactically valid but unused key: the guard allowed
				// the request, and `requireApiKey` is what answers.
				authorization: 'Bearer mk_e2e_csrf_probe_not_a_real_key',
			},
			data: REACTION_PAYLOAD,
		});
		// Not 403: the CSRF guard allowed it and authentication
		// answered instead. The key does not exist, so nothing is
		// written.
		expect(res.status()).toBe(401);
		expect((await res.json()).error).toBe('invalid_api_key');
	});

	test('cross-site reads are still readable', async ({ request }) => {
		// The guard covers unsafe methods only; a cross-site read must
		// not be turned into a refusal (the API key gate answers).
		const res = await request.get('/api/v1/reactions?target=e2e-csrf-probe', {
			headers: { origin: CROSS_SITE_ORIGIN, 'sec-fetch-site': 'cross-site' },
		});
		expect(res.status()).toBe(401);
		expect((await res.json()).error).toBe('missing_authorization');
	});
});

test.describe('TanStack Start: server functions keep the framework default CSRF', () => {
	test('a cross-site POST to /_serverFn/* is refused', async ({ request }) => {
		const res = await request.post(SERVER_FN_PROBE, {
			headers: {
				'content-type': 'application/json',
				origin: CROSS_SITE_ORIGIN,
				'sec-fetch-site': 'cross-site',
			},
			data: { data: {} },
		});
		expect(res.status()).toBe(403);
	});

	test('a POST with no origin evidence is refused', async ({ request }) => {
		const res = await request.post(SERVER_FN_PROBE, {
			headers: { 'content-type': 'application/json' },
			data: { data: {} },
		});
		expect(res.status()).toBe(403);
	});

	test('the same-origin POST is not refused by the CSRF layer', async ({ request, baseURL }) => {
		const res = await request.post(SERVER_FN_PROBE, {
			headers: {
				'content-type': 'application/json',
				origin: String(baseURL),
				'sec-fetch-site': 'same-origin',
			},
			data: { data: {} },
		});
		// The probe id does not exist, so the framework fails the
		// request after the CSRF middleware has already allowed it.
		expect(res.status()).not.toBe(403);
	});
});
