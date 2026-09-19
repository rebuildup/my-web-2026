import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader, setResponseHeader } from '@tanstack/react-start/server';
import { z } from 'zod';
import type { CatalogEntry } from '../../http/reactions/emoji-catalog';
import { loadCatalog } from '../../http/reactions/emoji-catalog';
import type { ReactionAggregate } from '../../http/reactions/schema';
import {
	buildActorCookieSetHeader,
	generateActorId,
	isWellFormedActorId,
	readActorIdFromCookieHeader,
} from './cookie';
import { MAX_EMOJI_SLUG_LEN, validateEmojiSlug } from './emoji-catalog';

/**
 * Home → reactions integration (ADR-0011, Ticket E / branch 37;
 * Ticket G / branch 39 extends this with a DB-backed catalog).
 *
 * The home is its **own consumer** of the reactions API: it holds an
 * API key in `env.MY_WEB_2026_CONSUMER_API_KEY` (provisioned once per
 * environment via `scripts/bootstrap-home-api-key.mjs`) and self-calls
 * `/api/v1/reactions` over the same `fetch` boundary that the
 * external API uses.
 *
 * Visitor identity round-trips via the anonymous `mw_actor_id`
 * cookie. On a first visit we generate a fresh 32-hex value, set the
 * `Set-Cookie` header on the SSR response, and forward it as
 * `actor_id` on PUT/DELETE. On subsequent visits the same value is
 * read from the request cookie and reused — the reactions API
 * dedupes at `(target_key, principal, actor_id, kind, value)`, so a
 * returning visitor sees their own reactions.
 *
 * Aggregate scope: per ADR-0011 §3, the home sees aggregates scoped
 * to its own principal (API key id). Cross-principal rolls up are
 * out of scope for 0.3.0.
 *
 * Catalog source: Ticket G (branch 39) replaces the hard-coded
 * catalog that lived in `emoji-catalog.ts` with the DB-backed
 * `reaction_emoji_catalog` table. The loader primes the active
 * catalog once per SSR pass and threads it through
 * `HomeReactionsData.catalog` so the widget renders the up-to-date
 * slug set; the write path validates against the same catalog.
 *
 * Graceful degradation: if the API key is missing (operator has not
 * run the bootstrap yet), `getHomeReactions` returns an empty list
 * and the write fns short-circuit. The widget renders a disabled
 * state in that case — see `widget.tsx`.
 */

const TargetKeySchema = z.string().min(1).max(256);
const ReactionKindSchema = z.enum(['emoji', 'image']);
// Slug validation runs at the catalog seam — rejects malformed
// values before they reach the upstream reactions API. The schema
// itself only enforces "non-empty ≤ MAX_EMOJI_SLUG_LEN" so the
// failure carries a domain-specific error message.
const ReactionValueSchema = z.string().min(1).max(MAX_EMOJI_SLUG_LEN);

const GetInput = z.object({ target: TargetKeySchema });
const PutInput = z.object({
	target: TargetKeySchema,
	kind: ReactionKindSchema,
	value: ReactionValueSchema,
});
const DeleteInput = z.object({
	target: TargetKeySchema,
	kind: ReactionKindSchema,
	value: ReactionValueSchema,
});

export interface HomeReactionsData {
	target_key: string;
	aggregates: readonly ReactionAggregate[];
	/** DB-backed active catalog (Ticket G, branch 39). Sorted by slug. */
	catalog: readonly CatalogEntry[];
	enabled: boolean;
}

export interface HomeReactionMutationResult {
	ok: boolean;
	reason?: 'api_key_unconfigured' | 'upstream_error' | 'invalid_body' | 'rate_limited';
	created?: boolean;
	deleted?: boolean;
}

/** Default target key — single canonical home page in 0.3.0. */
export const HOME_REACTIONS_TARGET = 'home-page';

export interface HomeReactionsEnv {
	MY_WEB_2026_CONSUMER_API_KEY?: string;
	MY_WEB_2026_REACTIONS_TARGET?: string;
	BETTER_AUTH_URL?: string;
	DB?: D1Database;
}

export interface HomeReactionsRequestContext {
	/** Incoming `Host` header (used to build the upstream URL). */
	host: string | undefined;
	/** Forwarded protocol header (used for the upstream URL + cookie Secure flag). */
	proto: string | undefined;
	/** Incoming `Cookie` header (read for `mw_actor_id`). */
	cookie: string | undefined;
}

/**
 * Read-only upstream caller for `getHomeReactions`. Returns the parsed
 * payload; callers decide how to render. Returns `enabled: false`
 * when the upstream API key is not configured so the caller can
 * short-circuit to the disabled widget state.
 *
 * Also reads the DB-backed catalog (`reaction_emoji_catalog`) once
 * per call. The loader runs inside the Worker, so `env.DB` is the
 * canonical D1 binding.
 */
export async function getHomeReactionsImpl(
	envLike: HomeReactionsEnv,
	ctx: HomeReactionsRequestContext,
	target: string,
	fetcher: typeof fetch = fetch,
	db: D1Database | null = (envLike.DB ?? null) as D1Database | null,
): Promise<HomeReactionsData> {
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) {
		console.warn('[home.reactions] consumer API key not configured — returning empty');
		return { target_key: target, aggregates: [], catalog: [], enabled: false };
	}
	const baseUrl = ctx.host
		? `${ctx.proto ?? 'https'}://${ctx.host}`
		: (envLike.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
	const [response, catalog] = await Promise.all([
		fetcher(`${baseUrl}/api/v1/reactions?target=${encodeURIComponent(target)}`, {
			method: 'GET',
			headers: {
				authorization: `Bearer ${apiKey}`,
				accept: 'application/json',
			},
		}),
		db ? loadCatalog(db) : Promise.resolve([] as readonly CatalogEntry[]),
	]);
	if (!response.ok) {
		console.error('[home.reactions] upstream failed', response.status, await response.text());
		return { target_key: target, aggregates: [], catalog, enabled: true };
	}
	const payload = (await response.json()) as {
		target_key?: string;
		aggregates?: readonly ReactionAggregate[];
	};
	return {
		target_key: payload.target_key ?? target,
		aggregates: payload.aggregates ?? [],
		catalog,
		enabled: true,
	};
}

/**
 * Read the existing actor id from the request cookie, or generate a
 * fresh one and return a `Set-Cookie` header value the caller can
 * attach to the SSR response.
 */
export function resolveOrIssueActorId(
	cookieHeader: string | undefined | null,
	secure: boolean,
): {
	actorId: string;
	setCookieHeader: string | null;
} {
	const existing = readActorIdFromCookieHeader(cookieHeader);
	if (existing) return { actorId: existing, setCookieHeader: null };
	const fresh = generateActorId();
	return { actorId: fresh, setCookieHeader: buildActorCookieSetHeader(fresh, secure) };
}

async function loadCatalogForWrite(envLike: HomeReactionsEnv): Promise<readonly CatalogEntry[]> {
	const db = (envLike.DB ?? null) as D1Database | null;
	if (!db) return [];
	return loadCatalog(db);
}

export async function addHomeReactionImpl(
	envLike: HomeReactionsEnv,
	ctx: HomeReactionsRequestContext,
	input: { target: string; kind: 'emoji' | 'image'; value: string },
	fetcher: typeof fetch = fetch,
): Promise<HomeReactionMutationResult> {
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) return { ok: false, reason: 'api_key_unconfigured' };
	if (input.kind === 'emoji') {
		try {
			const catalog = await loadCatalogForWrite(envLike);
			validateEmojiSlug(catalog, input.value);
		} catch {
			return { ok: false, reason: 'invalid_body' };
		}
	}
	const { actorId } = resolveOrIssueActorId(ctx.cookie, ctx.proto === 'https');
	if (!isWellFormedActorId(actorId)) return { ok: false, reason: 'invalid_body' };
	const baseUrl = ctx.host
		? `${ctx.proto ?? 'https'}://${ctx.host}`
		: (envLike.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
	const response = await fetcher(`${baseUrl}/api/v1/reactions`, {
		method: 'PUT',
		headers: {
			authorization: `Bearer ${apiKey}`,
			accept: 'application/json',
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			target_key: input.target,
			actor_id: actorId,
			kind: input.kind,
			value: input.value,
		}),
	});
	if (response.status === 429) return { ok: false, reason: 'rate_limited' };
	if (!response.ok) {
		console.error('[home.reactions.add] upstream failed', response.status, await response.text());
		return { ok: false, reason: 'upstream_error' };
	}
	const payload = (await response.json()) as { created?: boolean };
	return { ok: true, created: payload.created === true };
}

export async function removeHomeReactionImpl(
	envLike: HomeReactionsEnv,
	ctx: HomeReactionsRequestContext,
	input: { target: string; kind: 'emoji' | 'image'; value: string },
	fetcher: typeof fetch = fetch,
): Promise<HomeReactionMutationResult> {
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) return { ok: false, reason: 'api_key_unconfigured' };
	if (input.kind === 'emoji') {
		try {
			const catalog = await loadCatalogForWrite(envLike);
			validateEmojiSlug(catalog, input.value);
		} catch {
			return { ok: false, reason: 'invalid_body' };
		}
	}
	const { actorId } = resolveOrIssueActorId(ctx.cookie, ctx.proto === 'https');
	if (!isWellFormedActorId(actorId)) return { ok: false, reason: 'invalid_body' };
	const baseUrl = ctx.host
		? `${ctx.proto ?? 'https'}://${ctx.host}`
		: (envLike.BETTER_AUTH_URL ?? '').replace(/\/$/, '');
	const response = await fetcher(`${baseUrl}/api/v1/reactions`, {
		method: 'DELETE',
		headers: {
			authorization: `Bearer ${apiKey}`,
			accept: 'application/json',
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			target_key: input.target,
			actor_id: actorId,
			kind: input.kind,
			value: input.value,
		}),
	});
	if (response.status === 429) return { ok: false, reason: 'rate_limited' };
	if (!response.ok) return { ok: false, reason: 'upstream_error' };
	const payload = (await response.json()) as { deleted?: boolean };
	return { ok: true, deleted: payload.deleted === true };
}

function readRequestContext(): HomeReactionsRequestContext {
	const proto = getRequestHeader('x-forwarded-proto');
	const host = getRequestHeader('host');
	const cookie = getRequestHeader('cookie');
	return {
		host,
		proto,
		cookie,
	};
}

export const getHomeReactions = createServerFn({ method: 'GET' })
	.validator(GetInput)
	.handler(async ({ data }): Promise<HomeReactionsData> => {
		const envLike = env as unknown as HomeReactionsEnv;
		return getHomeReactionsImpl(envLike, readRequestContext(), data.target);
	});

export const addHomeReaction = createServerFn({ method: 'POST' })
	.validator(PutInput)
	.handler(async ({ data }): Promise<HomeReactionMutationResult> => {
		const envLike = env as unknown as HomeReactionsEnv;
		const ctx = readRequestContext();
		const result = await addHomeReactionImpl(envLike, ctx, data);
		// Surface the `Set-Cookie` for a freshly-issued actor id so
		// the SSR response carries it. The impl already issued one
		// internally; we re-resolve here so we can attach the header
		// to the response object that createServerFn will return.
		const { setCookieHeader } = resolveOrIssueActorId(ctx.cookie, ctx.proto === 'https');
		if (setCookieHeader && result.ok) setResponseHeader('Set-Cookie', setCookieHeader);
		return result;
	});

export const removeHomeReaction = createServerFn({ method: 'POST' })
	.validator(DeleteInput)
	.handler(async ({ data }): Promise<HomeReactionMutationResult> => {
		const envLike = env as unknown as HomeReactionsEnv;
		const ctx = readRequestContext();
		const result = await removeHomeReactionImpl(envLike, ctx, data);
		const { setCookieHeader } = resolveOrIssueActorId(ctx.cookie, ctx.proto === 'https');
		if (setCookieHeader && result.ok) setResponseHeader('Set-Cookie', setCookieHeader);
		return result;
	});
