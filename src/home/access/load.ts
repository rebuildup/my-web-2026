import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { getRequestUrl } from '@tanstack/react-start/server';
import { z } from 'zod';
import type { GetCountOutput, RecordHitOutput } from '../../http/access-counter/schema';

/**
 * Home → access counter integration (ADR-0011).
 *
 * The home is its **own consumer** of the access counter API. Each
 * request to `/` mints a fresh `session_id = crypto.randomUUID()` and
 * self-calls `POST /api/v1/access/hit` with the configured `key`
 * (default `home-page`). The widget then reads
 * `GET /api/v1/access/count/:key` and renders the aggregate.
 *
 * Per ADR-0012 §2, `session_id` is **per-request** in 0.3.0 — the
 * counter is therefore a page-view counter. Per-visitor dedup via
 * the `mw_actor_id` cookie is a 0.4.0 ticket; coupling it to Ticket
 * E's cookie now would mix two backends.
 *
 * Upstream origin: the loader self-calls `/api/v1/access/*` against
 * the same origin it was invoked from. In dev that is
 * `http://127.0.0.1:3000` (Vite speaks plain HTTP and does not
 * inject `x-forwarded-proto`); in production it is
 * `https://rebuildup.dev` via `wrangler.production.jsonc`'s
 * `BETTER_AUTH_URL`. TanStack Start's `getRequestUrl()` returns a
 * URL with the right protocol in both environments, so the impls
 * use its `.origin` for the upstream URL. The `upstreamOrigin`
 * parameter lets tests / scripts inject a literal origin without
 * going through the server runtime (which would throw — see
 * `getRequestUrl`'s `No StartEvent found in AsyncLocalStorage`).
 */

const HitInput = z.object({
	session_id: z.string().min(1).max(256).optional(),
});
const GetInput = z.object({});

export interface HomeCounterData {
	key: string;
	count: number;
	first_hit: number | null;
	last_hit: number | null;
	enabled: boolean;
}

export interface HomeAccessEnv {
	MY_WEB_2026_CONSUMER_API_KEY?: string;
	MY_WEB_2026_COUNTER_KEY?: string;
	BETTER_AUTH_URL?: string;
}

/**
 * Empty request context. The upstream URL is resolved from the
 * incoming request by the server-fn handler (which has access to
 * `getRequestUrl()`); no per-call headers need to be threaded
 * through. The interface stays for parity with
 * `HomeReactionsRequestContext` and to keep tests honest about the
 * function's dependency surface.
 */
export interface HomeAccessRequestContext {
	readonly _placeholder?: never;
}

export const HOME_COUNTER_KEY_DEFAULT = 'home-page';

export async function recordHomeHitImpl(
	envLike: HomeAccessEnv,
	ctx: HomeAccessRequestContext,
	input: { session_id?: string },
	upstreamOrigin: string,
	fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; reason?: 'api_key_unconfigured' | 'upstream_error' | 'rate_limited' }> {
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) return { ok: false, reason: 'api_key_unconfigured' };
	const key = envLike.MY_WEB_2026_COUNTER_KEY ?? HOME_COUNTER_KEY_DEFAULT;
	const session_id = input.session_id ?? crypto.randomUUID();
	const response = await fetcher(`${upstreamOrigin}/api/v1/access/hit`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiKey}`,
			accept: 'application/json',
			'content-type': 'application/json',
		},
		body: JSON.stringify({ key, session_id }),
	});
	if (response.status === 429) return { ok: false, reason: 'rate_limited' };
	if (!response.ok) {
		console.error('[home.access.hit] upstream failed', response.status, await response.text());
		return { ok: false, reason: 'upstream_error' };
	}
	return { ok: true };
}

export async function getHomeCounterImpl(
	envLike: HomeAccessEnv,
	ctx: HomeAccessRequestContext,
	upstreamOrigin: string,
	fetcher: typeof fetch = fetch,
): Promise<HomeCounterData> {
	const key = envLike.MY_WEB_2026_COUNTER_KEY ?? HOME_COUNTER_KEY_DEFAULT;
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) {
		return { key, count: 0, first_hit: null, last_hit: null, enabled: false };
	}
	const response = await fetcher(
		`${upstreamOrigin}/api/v1/access/count/${encodeURIComponent(key)}`,
		{
			method: 'GET',
			headers: {
				authorization: `Bearer ${apiKey}`,
				accept: 'application/json',
			},
		},
	);
	if (!response.ok) {
		console.error('[home.access.count] upstream failed', response.status, await response.text());
		return { key, count: 0, first_hit: null, last_hit: null, enabled: true };
	}
	const payload = (await response.json()) as GetCountOutput;
	return {
		key,
		count: payload.count,
		first_hit: payload.first_hit,
		last_hit: payload.last_hit,
		enabled: true,
	};
}

function readRequestContext(): HomeAccessRequestContext {
	return {};
}

export const recordHomeHit = createServerFn({ method: 'POST' })
	.validator(HitInput)
	.handler(async ({ data }): Promise<{ ok: boolean; reason?: string }> => {
		const envLike = env as unknown as HomeAccessEnv;
		return recordHomeHitImpl(envLike, readRequestContext(), data, getRequestUrl().origin);
	});

export const getHomeCounter = createServerFn({ method: 'GET' })
	.validator(GetInput)
	.handler(async (): Promise<HomeCounterData> => {
		const envLike = env as unknown as HomeAccessEnv;
		return getHomeCounterImpl(envLike, readRequestContext(), getRequestUrl().origin);
	});

// Re-export the upstream types so the rest of the home does not need
// to import from src/http.
export type { RecordHitOutput, GetCountOutput };
