/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHomeCounterImpl, recordHomeHitImpl } from '../../src/home/access/load';
import { getHomeReactionsImpl } from '../../src/home/reactions/load';

/**
 * Log-redaction audit — API error surface (Issue #467).
 *
 * What this proves
 * ----------------
 * The Issue asks for an INSPECTION, not a claim: feed fabricated
 * credentials and personal data through the code paths that handle
 * API errors, and show that neither the Worker log stream nor the
 * HTTP response carries them. Three surfaces are exercised:
 *
 *   1. **Hono boundary** — `SELF.fetch` with canary
 *      `Authorization` / `Cookie` headers and a canary query string,
 *      against a 404 path, a rate-limit / auth-rejected API call, and
 *      the health endpoints. Response body AND captured console output
 *      are scanned.
 *   2. **Home loaders** — `recordHomeHitImpl` / `getHomeCounterImpl` /
 *      `getHomeReactionsImpl` with a fake `fetch` whose error body
 *      ECHOES the canary back (the realistic failure mode: a proxy or
 *      upstream that reflects the request in its 5xx body). The
 *      loaders logged `await response.text()` verbatim before #467.
 *   3. **Failure behaviour** — the loaders must still return their
 *      documented degraded result (`upstream_error`, `enabled: false`)
 *      rather than throwing or leaking to keep the detail.
 *
 * Every canary is fabricated here. Nothing in this file reads a real
 * secret, and no production resource is touched: `SELF` is the local
 * workerd pool with Miniflare-simulated D1 / R2.
 */
const CANARY_TOKEN = 'mk_canary_a1b2c3d4e5f60000';
const CANARY_EMAIL = 'canary.person@example.invalid';
const CANARY_COOKIE_VALUE = '550e8400-e29b-41d4-a716-446655440000';
const CANARY_BEARER_HEADER = `Bearer ${CANARY_TOKEN}`;

const CANARIES = [CANARY_TOKEN, CANARY_EMAIL, CANARY_COOKIE_VALUE, 'canary-token-abcdef123456'];

/** Console output captured while `run` executes. */
async function captureConsole(run: () => Promise<void>): Promise<string> {
	const records: string[] = [];
	const spies = (['debug', 'log', 'warn', 'error'] as const).map((method) =>
		vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
			records.push(args.map((arg) => (typeof arg === 'string' ? arg : safeJson(arg))).join(' '));
		}),
	);
	try {
		await run();
	} finally {
		for (const spy of spies) spy.mockRestore();
	}
	return records.join('\n');
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

function expectNoCanary(haystack: string, surface: string): void {
	for (const canary of CANARIES) {
		expect(haystack, `${surface} leaked ${canary}`).not.toContain(canary);
	}
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Hono boundary — request-shaped canaries never reach logs or responses', () => {
	it('keeps canary headers and query strings out of a 404 response and the log', async () => {
		const response = await captureConsole(async () => {
			const res = await SELF.fetch(
				`https://rebuildup.dev/api/v1/nope?token=canary-token-abcdef123456&email=${encodeURIComponent(CANARY_EMAIL)}`,
				{
					headers: {
						authorization: CANARY_BEARER_HEADER,
						cookie: `mw_actor_id=${CANARY_COOKIE_VALUE}`,
					},
				},
			);
			const body = await res.text();
			expectNoCanary(body, '404 response body');
			expect(res.status).toBe(404);
		});
		expectNoCanary(response, 'console');
	});

	it('keeps a rejected Authorization header out of the auth-failure response', async () => {
		const response = await captureConsole(async () => {
			const res = await SELF.fetch('https://rebuildup.dev/api/v1/access/count/home-page', {
				headers: { authorization: CANARY_BEARER_HEADER },
			});
			const body = await res.text();
			expectNoCanary(body, 'access-counter response body');
			// 401 (no key) or 403 (insufficient scope) — never 500, and
			// never an echo of the presented credential.
			expect([401, 403]).toContain(res.status);
		});
		expectNoCanary(response, 'console');
	});

	it('keeps canary cookies out of the health endpoints', async () => {
		const response = await captureConsole(async () => {
			for (const path of ['/api/v1/health', '/api/v1/db/ping', '/api/v1/media/ping']) {
				const res = await SELF.fetch(`https://rebuildup.dev${path}`, {
					headers: { cookie: `better-auth.session_token=${CANARY_TOKEN}` },
				});
				expectNoCanary(await res.text(), `${path} response body`);
			}
		});
		expectNoCanary(response, 'console');
	});

	it('rejects an image upload without echoing the canary token', async () => {
		const response = await captureConsole(async () => {
			const res = await SELF.fetch('https://rebuildup.dev/api/v1/reaction-images', {
				method: 'POST',
				headers: {
					authorization: CANARY_BEARER_HEADER,
					'content-type': 'application/json',
				},
				body: JSON.stringify({ id: 'canary-token-abcdef123456' }),
			});
			expectNoCanary(await res.text(), 'reaction-images response body');
			expect(res.status).toBeGreaterThanOrEqual(400);
		});
		expectNoCanary(response, 'console');
	});
});

describe('home loaders — an upstream that echoes the request cannot poison the log', () => {
	/** Upstream stub: 502 with the request's credential reflected in the body. */
	const echoingFetcher = (): typeof fetch =>
		(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			const echoed = `${CANARY_BEARER_HEADER} ${CANARY_EMAIL} mw_actor_id=${CANARY_COOKIE_VALUE} url=${url}`;
			return new Response(JSON.stringify({ error: 'bad_gateway', echo: echoed }), {
				status: 502,
				headers: { 'content-type': 'application/json' },
			});
		}) as typeof fetch;

	it('recordHomeHitImpl degrades to upstream_error and logs nothing sensitive', async () => {
		const envLike = { MY_WEB_2026_CONSUMER_API_KEY: CANARY_TOKEN };
		let result: Awaited<ReturnType<typeof recordHomeHitImpl>> | undefined;
		const logged = await captureConsole(async () => {
			result = await recordHomeHitImpl(
				envLike,
				{},
				{ session_id: 'canary-session-0001' },
				'https://rebuildup.dev',
				echoingFetcher(),
			);
		});
		expect(result).toEqual({ ok: false, reason: 'upstream_error' });
		expectNoCanary(logged, 'home.access hit console');
		expect(logged).toContain('[home.access]');
		expect(logged).toContain('502');
	});

	it('getHomeCounterImpl returns an empty counter and logs nothing sensitive', async () => {
		const envLike = { MY_WEB_2026_CONSUMER_API_KEY: CANARY_TOKEN };
		let result: Awaited<ReturnType<typeof getHomeCounterImpl>> | undefined;
		const logged = await captureConsole(async () => {
			result = await getHomeCounterImpl(envLike, {}, 'https://rebuildup.dev', echoingFetcher());
		});
		expect(result).toEqual({
			key: 'home-page',
			count: 0,
			first_hit: null,
			last_hit: null,
			enabled: true,
		});
		expectNoCanary(logged, 'home.access count console');
	});

	it('getHomeReactionsImpl returns the disabled-widget shape and logs nothing sensitive', async () => {
		const envLike = { MY_WEB_2026_CONSUMER_API_KEY: CANARY_TOKEN };
		let result: Awaited<ReturnType<typeof getHomeReactionsImpl>> | undefined;
		const logged = await captureConsole(async () => {
			result = await getHomeReactionsImpl(
				envLike,
				{ proto: 'https', cookie: `mw_actor_id=${CANARY_COOKIE_VALUE}` },
				'home-page',
				'https://rebuildup.dev',
				echoingFetcher(),
				null,
			);
		});
		expect(result?.enabled).toBe(true);
		expect(result?.aggregates).toEqual([]);
		expectNoCanary(logged, 'home.reactions console');
		expect(logged).toContain('502');
	});

	it('a request without a configured key warns without naming the key', async () => {
		let result: Awaited<ReturnType<typeof getHomeReactionsImpl>> | undefined;
		const logged = await captureConsole(async () => {
			result = await getHomeReactionsImpl(
				{},
				{ proto: 'https', cookie: undefined },
				'home-page',
				'https://rebuildup.dev',
				echoingFetcher(),
				null,
			);
		});
		expect(result?.enabled).toBe(false);
		expect(logged).toContain('consumer API key not configured');
		expectNoCanary(logged, 'home.reactions warn console');
	});
});
