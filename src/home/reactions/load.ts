import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader, getRequestUrl, setResponseHeader } from '@tanstack/react-start/server';
import { z } from 'zod';
import type { ReactionAggregate } from '../../http/reactions/schema';
import type { CatalogEntry } from '../../reactions/emoji-catalog';
import {
	insertCatalogEntry,
	loadCatalog,
	validateCodepoint,
	validateSlug,
} from '../../reactions/emoji-catalog';
import {
	buildActorCookieSetHeader,
	generateActorId,
	isWellFormedActorId,
	readActorIdFromCookieHeader,
} from './cookie';
import { MAX_EMOJI_SLUG_LEN, validateEmojiSlug } from './emoji-catalog';

/**
 * The TanStack Start import-protection plugin forbids
 * `@tanstack/react-start/server` imports from code reachable on the
 * client (i.e. files reachable from `src/router.tsx` through
 * `src/home/public.ts`). The plugin's static analyser treats free
 * functions as client-reachable; only the body of a
 * `createServerFn().handler()` callback is recognised as
 * server-only.
 *
 * Therefore the upstream origin is **passed in** to every impl as a
 * required `upstreamOrigin` parameter. The handler resolves it
 * inline via `getRequestUrl().origin` (which is allowed inside
 * `.handler()`); tests / scripts pass a literal so `getRequestUrl`
 * never runs outside the server runtime (where it throws `No
 * StartEvent found in AsyncLocalStorage`).
 */

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
 * out of scope.
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
 *
 * Upstream origin: the loader self-calls `/api/v1/reactions` and
 * `/api/v1/access/*` against the same origin it was invoked from.
 * In dev that is `http://127.0.0.1:3000` (Vite speaks plain HTTP and
 * does not inject `x-forwarded-proto`); in production it is
 * `https://rebuildup.dev` via `wrangler.production.jsonc`'s
 * `BETTER_AUTH_URL`. TanStack Start's `getRequestUrl()` returns a
 * URL with the right protocol in both environments, so the impls
 * use its `.origin` for the upstream URL. The `upstreamOrigin`
 * parameter lets tests / scripts inject a literal origin without
 * going through the server runtime (which would throw — see
 * `getRequestUrl`'s `No StartEvent found in AsyncLocalStorage`).
 */

const TargetKeySchema = z.string().min(1).max(256);
const ReactionKindSchema = z.enum(['emoji', 'image']);
// Slug validation runs at the catalog seam — rejects malformed
// values before they reach the upstream reactions API. The schema
// itself only enforces "non-empty ≤ MAX_EMOJI_SLUG_LEN" so the
// failure carries a domain-specific error message.
const ReactionValueSchema = z.string().min(1).max(MAX_EMOJI_SLUG_LEN);
// Optional codepoint supplied by the picker — used to auto-register
// unknown emoji slugs at click time. See `addHomeReactionImpl` for
// the full contract.
const ReactionCodepointSchema = z.string().min(1).max(16);

const GetInput = z.object({ target: TargetKeySchema });
const PutInput = z.object({
	target: TargetKeySchema,
	kind: ReactionKindSchema,
	value: ReactionValueSchema,
	codepoint: ReactionCodepointSchema.optional(),
});
const DeleteInput = z.object({
	target: TargetKeySchema,
	kind: ReactionKindSchema,
	value: ReactionValueSchema,
});

export interface HomeReactionsData {
	target_key: string;
	aggregates: readonly ReactionAggregate[];
	/**
	 * This visitor's current reactions on the target — flat
	 * `{kind, value}[]` filtered by `(target_key, principal,
	 * actor_id)`. Drives the widget's toggle predicate (P1 review
	 * finding: the previous widget code conflated the public
	 * aggregate count with "this visitor's selection", so a second
	 * visitor to click an existing emoji optimistically sent
	 * DELETE on a row they never owned). Empty for first-time
	 * visitors (no `mw_actor_id` cookie yet).
	 */
	viewer_reactions: readonly { kind: 'emoji' | 'image'; value: string }[];
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

/** Default target key — single canonical home page. */
export const HOME_REACTIONS_TARGET = 'home-page';

export interface HomeReactionsEnv {
	MY_WEB_2026_CONSUMER_API_KEY?: string;
	MY_WEB_2026_REACTIONS_TARGET?: string;
	BETTER_AUTH_URL?: string;
	DB?: D1Database;
}

export interface HomeReactionsRequestContext {
	/** Forwarded protocol header (used for the cookie Secure flag). */
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
	upstreamOrigin: string,
	fetcher: typeof fetch = fetch,
	db: D1Database | null = (envLike.DB ?? null) as D1Database | null,
): Promise<HomeReactionsData> {
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) {
		console.warn('[home.reactions] consumer API key not configured — returning empty');
		return {
			target_key: target,
			aggregates: [],
			viewer_reactions: [],
			catalog: [],
			enabled: false,
		};
	}
	// Forward the visitor's actor id (if any) so the upstream GET
	// returns `viewer_reactions` alongside the public aggregates.
	// First-time visitors have no cookie yet → no `actor_id` query
	// param → upstream returns the legacy shape (no viewer state),
	// which we mirror as `[]` here.
	const existingActorId = readActorIdFromCookieHeader(ctx.cookie);
	const query = new URLSearchParams({ target });
	if (existingActorId) query.set('actor_id', existingActorId);
	const upstream = `${upstreamOrigin}/api/v1/reactions?${query.toString()}`;
	const [response, catalog] = await Promise.all([
		fetcher(upstream, {
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
		return { target_key: target, aggregates: [], viewer_reactions: [], catalog, enabled: true };
	}
	const payload = (await response.json()) as {
		target_key?: string;
		aggregates?: readonly ReactionAggregate[];
		viewer_reactions?: readonly { kind: 'emoji' | 'image'; value: string }[];
	};
	return {
		target_key: payload.target_key ?? target,
		aggregates: payload.aggregates ?? [],
		viewer_reactions: payload.viewer_reactions ?? [],
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
	input: { target: string; kind: 'emoji' | 'image'; value: string; codepoint?: string },
	actorId: string,
	upstreamOrigin: string,
	fetcher: typeof fetch = fetch,
): Promise<HomeReactionMutationResult> {
	const apiKey = envLike.MY_WEB_2026_CONSUMER_API_KEY;
	if (!apiKey || apiKey.length === 0) return { ok: false, reason: 'api_key_unconfigured' };
	if (input.kind === 'emoji') {
		let slug: string;
		try {
			slug = validateSlug(input.value);
		} catch {
			return { ok: false, reason: 'invalid_body' };
		}
		const db = (envLike.DB ?? null) as D1Database | null;
		const catalog = await loadCatalogForWrite(envLike);
		const existing = catalog.find((entry) => entry.slug === slug);
		if (existing && !existing.enabled) {
			// Admin explicitly disabled this slug — even auto-register
			// must not silently re-enable a curated entry.
			return { ok: false, reason: 'invalid_body' };
		}
		if (!existing) {
			// Unknown slug → try visitor-driven auto-register so any
			// emoji the picker surfaces is recordable. The picker
			// (ealush/emoji-picker-react) bundles Unicode metadata for
			// its UX layer; this catalog write is the bridge that lets
			// any visitor-clicked emoji land in our DB-backed storage
			// without operator intervention.
			if (!input.codepoint) return { ok: false, reason: 'invalid_body' };
			let codepoint: string;
			try {
				codepoint = validateCodepoint(input.codepoint);
			} catch {
				return { ok: false, reason: 'invalid_body' };
			}
			if (!db) return { ok: false, reason: 'invalid_body' };
			try {
				await insertCatalogEntry(db, { slug, codepoint, created_by: 'visitor' }, Date.now());
			} catch (err) {
				console.error('[home.reactions.add] auto-register failed', err);
				return { ok: false, reason: 'invalid_body' };
			}
		}
		// `slug` is the validated form of `input.value`; both are
		// equal because `validateSlug` returns its input unchanged
		// when it matches the grammar. Forward `input.value` directly
		// rather than reassigning the function parameter (biome
		// `noParameterAssign`).
	}
	// `actorId` is resolved by the `createServerFn` handler — see
	// `addHomeReaction` below. Doing it here would duplicate the
	// resolution and race the handler's Set-Cookie: the first call
	// would mint ID=A for the PUT body, the second would mint ID=B
	// for the cookie, and the next request would read B and not find
	// the row the visitor just created (P1 review finding).
	if (!isWellFormedActorId(actorId)) return { ok: false, reason: 'invalid_body' };
	const upstream = `${upstreamOrigin}/api/v1/reactions`;
	const response = await fetcher(upstream, {
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
	actorId: string,
	upstreamOrigin: string,
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
	// Same `actorId` atomicity note as `addHomeReactionImpl` above —
	// resolved in the handler so PUT body and Set-Cookie agree.
	if (!isWellFormedActorId(actorId)) return { ok: false, reason: 'invalid_body' };
	const upstream = `${upstreamOrigin}/api/v1/reactions`;
	const response = await fetcher(upstream, {
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
	const cookie = getRequestHeader('cookie');
	return {
		proto,
		cookie,
	};
}

export const getHomeReactions = createServerFn({ method: 'GET' })
	.validator(GetInput)
	.handler(async ({ data }): Promise<HomeReactionsData> => {
		const envLike = env as unknown as HomeReactionsEnv;
		return getHomeReactionsImpl(envLike, readRequestContext(), data.target, getRequestUrl().origin);
	});

export const addHomeReaction = createServerFn({ method: 'POST' })
	.validator(PutInput)
	.handler(async ({ data }): Promise<HomeReactionMutationResult> => {
		const envLike = env as unknown as HomeReactionsEnv;
		const ctx = readRequestContext();
		// Resolve the visitor's actor id ONCE so the PUT body and
		// the Set-Cookie carry the same value (P1 review finding —
		// see `addHomeReactionImpl` for the rationale).
		const { actorId, setCookieHeader } = resolveOrIssueActorId(ctx.cookie, ctx.proto === 'https');
		if (!isWellFormedActorId(actorId)) return { ok: false, reason: 'invalid_body' };
		const result = await addHomeReactionImpl(envLike, ctx, data, actorId, getRequestUrl().origin);
		if (setCookieHeader && result.ok) setResponseHeader('Set-Cookie', setCookieHeader);
		return result;
	});

export const removeHomeReaction = createServerFn({ method: 'POST' })
	.validator(DeleteInput)
	.handler(async ({ data }): Promise<HomeReactionMutationResult> => {
		const envLike = env as unknown as HomeReactionsEnv;
		const ctx = readRequestContext();
		const { actorId, setCookieHeader } = resolveOrIssueActorId(ctx.cookie, ctx.proto === 'https');
		if (!isWellFormedActorId(actorId)) return { ok: false, reason: 'invalid_body' };
		const result = await removeHomeReactionImpl(
			envLike,
			ctx,
			data,
			actorId,
			getRequestUrl().origin,
		);
		if (setCookieHeader && result.ok) setResponseHeader('Set-Cookie', setCookieHeader);
		return result;
	});
