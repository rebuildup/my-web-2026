import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import { z } from 'zod';
import type { RecordHitOutput, GetCountOutput } from '../../http/access-counter/counter';

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

export interface HomeAccessRequestContext {
	host: string | undefined;
	proto: string | undefined;
}

export const HOME_COUNTER_KEY_DEFAULT = 'home-page';

export async function recordHomeHitImpl(
	envLike: HomeAccessEnv,
	ctx: HomeAccessRequestContext,
	input: { session_id?: string },
	fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean; reason?: 'api_key_unconfigured' | 'upstream_error' | 'rate_limited' }> {
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) return { ok: false, reason: 'api_key_unconfigured' };
	const key = envLike.MY_WEB_2026_COUNTER_KEY ?? HOME_COUNTER_KEY_DEFAULT;
	const session_id = input.session_id ?? crypto.randomUUID();
	const baseUrl = ctx.host
		? `${ctx.proto ?? 'https'}://${ctx.host}`
		: (envLike.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
	const response = await fetcher(`${baseUrl}/api/v1/access/hit`, {
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
	fetcher: typeof fetch = fetch,
): Promise<HomeCounterData> {
	const key = envLike.MY_WEB_2026_COUNTER_KEY ?? HOME_COUNTER_KEY_DEFAULT;
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) {
		return { key, count: 0, first_hit: null, last_hit: null, enabled: false };
	}
	const baseUrl = ctx.host
		? `${ctx.proto ?? 'https'}://${ctx.host}`
		: (envLike.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
	const response = await fetcher(`${baseUrl}/api/v1/access/count/${encodeURIComponent(key)}`, {
		method: 'GET',
		headers: {
			authorization: `Bearer ${apiKey}`,
			accept: 'application/json',
		},
	});
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
	return {
		proto: getRequestHeader('x-forwarded-proto'),
		host: getRequestHeader('host'),
	};
}

export const recordHomeHit = createServerFn({ method: 'POST' })
	.validator(HitInput)
	.handler(async ({ data }): Promise<{ ok: boolean; reason?: string }> => {
		const envLike = env as unknown as HomeAccessEnv;
		return recordHomeHitImpl(envLike, readRequestContext(), data);
	});

export const getHomeCounter = createServerFn({ method: 'GET' })
	.validator(GetInput)
	.handler(async (): Promise<HomeCounterData> => {
		const envLike = env as unknown as HomeAccessEnv;
		return getHomeCounterImpl(envLike, readRequestContext());
	});

// Re-export the upstream types so the rest of the home does not need
// to import from src/http.
export type { RecordHitOutput, GetCountOutput };
