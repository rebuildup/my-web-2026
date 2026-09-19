import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminSession } from '../../admin/auth/load';
import { auth } from '../../../test/helpers/better-auth';
import {
	HOME_REACTIONS_TARGET,
	addHomeReactionImpl,
	getHomeReactionsImpl,
	removeHomeReactionImpl,
} from './load';

/**
 * Home reactions integration tests (Ticket E).
 *
 * Coverage:
 *   1. `getHomeReactionsImpl` short-circuits when the consumer API
 *      key is missing.
 *   2. `addHomeReactionImpl` PUTs through to `/api/v1/reactions`
 *      end-to-end via `SELF.fetch`; the aggregate endpoint then
 *      returns the same emoji via `getHomeReactionsImpl`.
 *   3. `removeHomeReactionImpl` DELETEs through the same boundary;
 *      subsequent aggregates drop the emoji.
 *   4. The `mw_actor_id` cookie is issued on the first PUT (the
 *      caller sees `Set-Cookie` in the response) and is reused on
 *      the second PUT — the dedupe at `(target_key, principal,
 *      actor_id, kind, value)` makes the second one idempotent
 *      (`created: false`).
 *
 * Schema setup mirrors `test/setup/better-auth-schema.ts` for the
 * `apikey` + `user` tables, plus the reactions table from
 * `migrations/0003_reactions.sql`. The setup is duplicated inline so
 * the test is self-contained against `vitest.config.ts`
 * `setupFiles` (which already applies the Better Auth schema).
 */

const REACTIONS_SQL = `
CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    target_key TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    principal TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (target_key, principal, actor_id, kind, value)
);
CREATE TABLE IF NOT EXISTS reaction_images (
    id TEXT PRIMARY KEY,
    content_hash TEXT UNIQUE NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL
);
`;

// Ticket G (branch 39): emoji catalog is DB-backed. Seed the
// minimal vocabulary the end-to-end tests exercise so the slug
// validator accepts `thumbs_up` and `tada` before the upstream PUT.
const CATALOG_SQL = `
CREATE TABLE IF NOT EXISTS reaction_emoji_catalog (
    slug         TEXT    PRIMARY KEY,
    codepoint    TEXT    NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
`;

async function ensureReactionsSchema(): Promise<void> {
	for (const stmt of REACTIONS_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await env.DB.prepare(stmt).run();
	}
	for (const stmt of CATALOG_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await env.DB.prepare(stmt).run();
	}
}

async function seedCatalog(): Promise<void> {
	const now = Date.now();
	const seeds: Array<[string, string]> = [
		['thumbs_up', '👍'],
		['tada', '🎉'],
	];
	for (const [slug, codepoint] of seeds) {
		await env.DB.prepare(
			'INSERT OR REPLACE INTO reaction_emoji_catalog (slug, codepoint, enabled, created_by, created_at, updated_at) VALUES (?1, ?2, 1, NULL, ?3, ?3)',
		)
			.bind(slug, codepoint, now)
			.run();
	}
}

async function clearRows(): Promise<void> {
	for (const table of [
		'reactions',
		'reaction_images',
		'reaction_emoji_catalog',
		'session',
		'account',
		'verification',
		'apikey',
		'user',
	]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

async function bootstrapUser(input: {
	email: string;
	password: string;
	name: string;
}): Promise<string> {
	const result = await auth.api.createUser({
		body: {
			email: input.email,
			password: input.password,
			name: input.name,
			role: 'admin',
		},
	});
	return String(result.user.id);
}

async function firstAdminId(): Promise<string> {
	const row = await env.DB.prepare(
		"SELECT id FROM user WHERE role='admin' ORDER BY id ASC LIMIT 1",
	).first<{ id: string }>();
	if (!row) throw new Error('expected at least one admin user to exist');
	return row.id;
}

async function signInAndGetSession(email: string, password: string): Promise<AdminSession> {
	const signInRes = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (signInRes.status !== 200) {
		throw new Error(`sign-in failed: ${signInRes.status}`);
	}
	const setCookie = signInRes.headers.get('set-cookie') ?? '';
	const match = setCookie.match(/better-auth\.session_token=([^;]+)/);
	if (!match) throw new Error('no session cookie returned');
	const headers = new Headers({ Cookie: `better-auth.session_token=${match[1]}` });
	const sessionRes = await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers });
	if (sessionRes.status !== 200) throw new Error(`get-session failed: ${sessionRes.status}`);
	const body = (await sessionRes.json()) as {
		user: { id: string; email: string; name: string; role: string | null };
		session: { id: string; expiresAt: string };
	};
	return {
		user: {
			id: body.user.id,
			email: body.user.email,
			name: body.user.name,
			role: body.user.role,
		},
		session: {
			id: body.session.id,
			expiresAt: new Date(body.session.expiresAt),
		},
	};
}

async function issueConsumerApiKey(referenceId: string): Promise<string> {
	// Use Better Auth's createApiKey directly — it owns the
	// keyId/keySecret split + hashing, so the validation path can
	// round-trip the returned plaintext against /api/v1/reactions.
	const created = (await auth.api.createApiKey({
		body: {
			name: 'home-self-consumption',
			userId: referenceId,
			prefix: 'mk_home_',
			permissions: { reactions: ['read', 'write'] },
		},
	})) as { id: string; key: string };
	if (!created.key) throw new Error('createApiKey did not return a plaintext key');
	return created.key;
}

describe('home reactions — server-fn impls', () => {
	// Fetcher bound to the worker under test. The home impls call
	// `fetch(url)` internally — that global goes out to the real
	// internet in workerd tests. We inject a SELF.fetch-backed
	// fetcher so the request lands on our local router.
	const selfFetch: typeof fetch = ((input, init) =>
		SELF.fetch(
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
			init,
		)) as typeof fetch;
	beforeEach(async () => {
		await ensureReactionsSchema();
		await clearRows();
		await seedCatalog();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('getHomeReactionsImpl returns enabled=false when the consumer API key is not configured', async () => {
		const result = await getHomeReactionsImpl(
			{},
			{ host: 'example.com', proto: 'https', cookie: undefined },
			HOME_REACTIONS_TARGET,
		);
		expect(result).toEqual({
			target_key: HOME_REACTIONS_TARGET,
			aggregates: [],
			catalog: [],
			enabled: false,
		});
	});

	it('end-to-end: bootstrap user + key → addHomeReaction → aggregate shows up → removeHomeReaction drops it', async () => {
		await bootstrapUser({ email: 'admin@test.local', password: 'correct-horse', name: 'Admin' });
		await signInAndGetSession('admin@test.local', 'correct-horse');
		const keyPlaintext = await issueConsumerApiKey(await firstAdminId());

		const envLike = {
			MY_WEB_2026_CONSUMER_API_KEY: keyPlaintext,
			MY_WEB_2026_REACTIONS_TARGET: HOME_REACTIONS_TARGET,
			DB: env.DB,
		};
		const ctx = { host: 'example.com', proto: 'https', cookie: undefined };

		// 1. add 👍 (slug: thumbs_up) — first time, expect created: true
		const add = await addHomeReactionImpl(
			envLike,
			ctx,
			{
				target: HOME_REACTIONS_TARGET,
				kind: 'emoji',
				value: 'thumbs_up',
			},
			selfFetch,
		);
		expect(add.ok).toBe(true);
		expect(add.created).toBe(true);

		// 2. read aggregates via the upstream endpoint
		const aggregates = await getHomeReactionsImpl(envLike, ctx, HOME_REACTIONS_TARGET, selfFetch);
		expect(aggregates.enabled).toBe(true);
		expect(aggregates.aggregates).toHaveLength(1);
		expect(aggregates.aggregates[0]).toEqual({ kind: 'emoji', value: 'thumbs_up', count: 1 });
		// The DB-backed catalog (Ticket G) is primed at read time and
		// exposed via `catalog` so the widget renders the active set.
		expect(aggregates.catalog.map((c) => c.slug).sort()).toEqual(['tada', 'thumbs_up']);

		// 3. remove 👍 — expect deleted: true. Re-use the actor id
		//    from the just-created row so the DELETE WHERE matches
		//    (otherwise `ctx.cookie=undefined` causes resolveOrIssueActorId
		//    to mint a fresh actor id and the row won't match).
		const rowBefore = await env.DB.prepare(
			'SELECT actor_id FROM reactions WHERE target_key = ?1 ORDER BY created_at ASC LIMIT 1',
		)
			.bind(HOME_REACTIONS_TARGET)
			.first<{ actor_id: string }>();
		if (!rowBefore) throw new Error('expected the first reaction row to exist');
		const ctxWithActor = {
			host: 'example.com',
			proto: 'https',
			cookie: `mw_actor_id=${rowBefore.actor_id}`,
		};
		const remove = await removeHomeReactionImpl(
			envLike,
			ctxWithActor,
			{
				target: HOME_REACTIONS_TARGET,
				kind: 'emoji',
				value: 'thumbs_up',
			},
			selfFetch,
		);
		expect(remove.ok).toBe(true);
		expect(remove.deleted).toBe(true);

		// 4. aggregates empty again
		const after = await getHomeReactionsImpl(envLike, ctx, HOME_REACTIONS_TARGET, selfFetch);
		expect(after.aggregates).toHaveLength(0);
	});

	it('dedup: same actor (re-using the cookie) double-PUTs do not double-count', async () => {
		await bootstrapUser({ email: 'admin@test.local', password: 'correct-horse', name: 'Admin' });
		await signInAndGetSession('admin@test.local', 'correct-horse');
		const keyPlaintext = await issueConsumerApiKey(await firstAdminId());

		const envLike = {
			MY_WEB_2026_CONSUMER_API_KEY: keyPlaintext,
			MY_WEB_2026_REACTIONS_TARGET: HOME_REACTIONS_TARGET,
			DB: env.DB,
		};
		// First call: no cookie → server issues one
		const ctx1 = { host: 'example.com', proto: 'https', cookie: undefined };
		const first = await addHomeReactionImpl(
			envLike,
			ctx1,
			{
				target: HOME_REACTIONS_TARGET,
				kind: 'emoji',
				value: 'tada',
			},
			selfFetch,
		);
		expect(first.ok).toBe(true);

		// Read the actor id from the dedup table — the impls do not
		// surface the Set-Cookie header to the test caller (it's
		// consumed by the SSR response in production). The dedup
		// row records the issued actor id; we reuse it on the second
		// call to simulate a returning visitor.
		const row = await env.DB.prepare(
			'SELECT actor_id FROM reactions WHERE target_key = ?1 ORDER BY created_at ASC LIMIT 1',
		)
			.bind(HOME_REACTIONS_TARGET)
			.first<{ actor_id: string }>();
		if (!row) throw new Error('expected the first reaction row to exist');
		const actorId = row.actor_id;

		// Second call: same actor via cookie → PUT is idempotent
		const ctx2 = { host: 'example.com', proto: 'https', cookie: `mw_actor_id=${actorId}` };
		const second = await addHomeReactionImpl(
			envLike,
			ctx2,
			{
				target: HOME_REACTIONS_TARGET,
				kind: 'emoji',
				value: 'tada',
			},
			selfFetch,
		);
		expect(second.ok).toBe(true);
		expect(second.created).toBe(false);

		// Aggregate still 1, not 2
		const aggregates = await getHomeReactionsImpl(envLike, ctx1, HOME_REACTIONS_TARGET, selfFetch);
		expect(aggregates.aggregates).toEqual([{ kind: 'emoji', value: 'tada', count: 1 }]);
	});

	it('uses an injected fetcher (no SELF.fetch)', async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ target_key: 'home-page', aggregates: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		const result = await getHomeReactionsImpl(
			{ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_x' },
			{ host: 'example.com', proto: 'https', cookie: undefined },
			'home-page',
			fetcher as unknown as typeof fetch,
		);
		expect(result.enabled).toBe(true);
		expect(result.aggregates).toEqual([]);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('addHomeReactionImpl rejects an unknown emoji slug with reason="invalid_body"', async () => {
		const fetcher = vi.fn();
		const result = await addHomeReactionImpl(
			{ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_x' },
			{ host: 'example.com', proto: 'https', cookie: undefined },
			{ target: 'home-page', kind: 'emoji', value: 'unknown_slug' },
			fetcher as unknown as typeof fetch,
		);
		expect(result).toEqual({ ok: false, reason: 'invalid_body' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('removeHomeReactionImpl rejects a malformed emoji slug with reason="invalid_body"', async () => {
		const fetcher = vi.fn();
		const result = await removeHomeReactionImpl(
			{ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_x' },
			{ host: 'example.com', proto: 'https', cookie: undefined },
			{ target: 'home-page', kind: 'emoji', value: 'with-dash' },
			fetcher as unknown as typeof fetch,
		);
		expect(result).toEqual({ ok: false, reason: 'invalid_body' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('addHomeReactionImpl rejects a slug that is in the catalog but disabled', async () => {
		// Disable `thumbs_up` for the duration of this test.
		await env.DB.prepare('UPDATE reaction_emoji_catalog SET enabled = 0 WHERE slug = ?1')
			.bind('thumbs_up')
			.run();
		const fetcher = vi.fn();
		const result = await addHomeReactionImpl(
			{
				MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_x',
				DB: env.DB,
			},
			{ host: 'example.com', proto: 'https', cookie: undefined },
			{ target: 'home-page', kind: 'emoji', value: 'thumbs_up' },
			fetcher as unknown as typeof fetch,
		);
		expect(result).toEqual({ ok: false, reason: 'invalid_body' });
		expect(fetcher).not.toHaveBeenCalled();
	});
});
