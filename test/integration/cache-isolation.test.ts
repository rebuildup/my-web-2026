/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetVerifyApiKey, withVerifyApiKey } from '../../src/http/api-keys/middleware';
import { externalBoundary } from '../../src/http/hono';
import { PRIVATE_NO_STORE } from '../../src/http/middleware/cache-policy';
import { uploadImage } from '../../src/http/reactions/images';
import { putReaction } from '../../src/http/reactions/reactions';

/**
 * Cache isolation contract (Issue #460).
 *
 * Acceptance criterion #1 — 「異なるauth contextのキャッシュが共用されない」 —
 * is a property of a *store*, not of a single response, so a test that
 * only asserts one header would not prove it. These tests therefore
 * model the cache in front of the Worker (`SharedCache` below, a
 * deliberately literal reading of RFC 9111 §3 storage rules) and drive
 * real requests through it.
 *
 * Two auth contexts are used, both fully local:
 *
 *   - `Authorization: Bearer test-key-alpha` -> API key id `key-alpha`
 *   - `Authorization: Bearer test-key-beta`  -> API key id `key-beta`
 *
 * `withVerifyApiKey` is the seam the API-key middleware already
 * exposes for tests (`src/http/api-keys/middleware.ts`); the key
 * VALUES are literals in this file and are not credentials. Data is
 * seeded into the workerd / Miniflare D1 + R2 bindings through
 * inlined migrations and local inserts — no remote resource, no
 * production row, and no deploy is touched anywhere in this file.
 *
 * Scope split:
 *   - the external boundary runs in-isolate through
 *     `externalBoundary.request(path, init, env)`, because the key
 *     verifier is a module-level stub and `SELF.fetch` runs in a
 *     separate isolate that the stub cannot reach;
 *   - the SSR document / server-function half runs through
 *     `SELF.fetch`, because `applyHtmlCachePolicy` lives in the Worker
 *     entry and no in-isolate call can observe its headers.
 */

const MIGRATIONS = [
	{
		name: '0003_reactions_for_cache_isolation',
		queries: [
			`CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        target_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (target_key, principal, actor_id, kind, value)
    )`,
			'CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_key)',
			'CREATE INDEX IF NOT EXISTS idx_reactions_target_kind ON reactions(target_key, kind)',
			`CREATE TABLE IF NOT EXISTS reaction_images (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
    )`,
			'CREATE INDEX IF NOT EXISTS idx_reactions_images_hash ON reaction_images(content_hash)',
		],
	},
	{
		name: '0004_emoji_catalog_for_cache_isolation',
		queries: [
			`CREATE TABLE IF NOT EXISTS reaction_emoji_catalog (
        slug         TEXT    PRIMARY KEY,
        codepoint    TEXT    NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_by   TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
    )`,
			`INSERT OR IGNORE INTO reaction_emoji_catalog (slug, codepoint, enabled, created_by, created_at, updated_at) VALUES
    ('thumbs_up', '👍', 1, NULL, 1, 1),
    ('fire', '🔥', 1, NULL, 1, 1)`,
		],
	},
	{
		name: '0005_access_counter_for_cache_isolation',
		queries: [
			`CREATE TABLE IF NOT EXISTS access_counters (
        key        TEXT    NOT NULL,
        principal  TEXT    NOT NULL,
        count      INTEGER NOT NULL DEFAULT 0,
        first_hit  INTEGER NOT NULL,
        last_hit   INTEGER NOT NULL,
        PRIMARY KEY (key, principal)
    )`,
			`CREATE TABLE IF NOT EXISTS access_dedup (
        counter_key TEXT    NOT NULL,
        principal   TEXT    NOT NULL,
        session_id  TEXT    NOT NULL,
        expires_at  INTEGER NOT NULL,
        PRIMARY KEY (counter_key, principal, session_id)
    )`,
		],
	},
];

const D1 = () => env.DB;

/** API key literals → the principal (API key id) each one resolves to. */
const KEY_PRINCIPALS: Record<string, string> = {
	'test-key-alpha': 'key-alpha',
	'test-key-beta': 'key-beta',
};

/** One visitor, two API-key contexts — the "different auth context" axis. */
const VISITOR_ACTOR = 'f'.repeat(32);
const TARGET = 'cache-isolation-probe';
const COUNTER_KEY = 'cache-isolation-counter';

/** Bearer header for a local test key. */
function authHeader(key: keyof typeof KEY_PRINCIPALS): Record<string, string> {
	return { authorization: `Bearer ${key}` };
}

interface CacheDecision {
	path: string;
	stored: boolean;
	reason: string;
}

interface CachedResponse {
	status: number;
	body: string;
	cacheControl: string | null;
	vary: string | null;
	/** Did the modelled shared cache answer without reaching the Worker? */
	fromCache: boolean;
}

/**
 * A deliberately literal model of a shared cache in front of the
 * Worker (RFC 9111 §3 storage rules). It exists so the tests can ask
 * the real question — "would a CDN keep this response?" — instead of
 * asserting that one header contains one substring.
 *
 * Rules implemented, in the order a cache evaluates them:
 *   1. `no-store` in the response                      -> refuse (RFC 9111 §5.2.2.5)
 *   2. `private` in the response                       -> refuse (§5.2.2.7)
 *   3. request carried `Authorization`, response is not
 *      `public` / `s-maxage` / `must-revalidate`        -> refuse (§3.5)
 *   4. request carried `Cookie`, response is not
 *      `public`                                       -> refuse (§3.5)
 *   5. response carries `Set-Cookie`                   -> refuse (RFC 6265 §5.3)
 *   6. no explicit `public` opt-in                     -> refuse (Cloudflare does
 *      not cache Worker-generated responses by default either)
 *   7. no positive freshness (`max-age` / `s-maxage`)   -> refuse
 */
class SharedCache {
	private readonly entries = new Map<string, { status: number; body: string }>();
	readonly decisions: CacheDecision[] = [];
	hits = 0;
	misses = 0;

	storedCount(): number {
		return this.entries.size;
	}

	private decide(path: string, request: Request, response: Response): CacheDecision {
		const control = (response.headers.get('cache-control') ?? '').toLowerCase();
		const has = (name: string) => control.split(/[,;]/).some((part) => part.trim() === name);
		const refuses = (reason: string): CacheDecision => ({ path, stored: false, reason });
		if (has('no-store')) return refuses('response carries no-store');
		if (has('private')) return refuses('response carries private');
		if (request.headers.has('authorization') && !(has('public') || has('s-maxage'))) {
			return refuses('authenticated request, response is not public (RFC 9111 §3.5)');
		}
		if (request.headers.has('cookie') && !has('public')) {
			return refuses('request carried a cookie, response is not public (RFC 9111 §3.5)');
		}
		if (response.headers.has('set-cookie')) return refuses('response sets a cookie');
		if (!has('public')) return refuses('no explicit public opt-in');
		if (!/\b(s-maxage|max-age)=[1-9]/.test(control)) {
			return refuses('no positive freshness');
		}
		return { path, stored: true, reason: 'explicitly public with freshness' };
	}

	/**
	 * One request through the cache. A hit is served from the stored
	 * entry without touching the Worker; a miss goes to the boundary
	 * and the response is offered to the storage rules.
	 */
	async fetch(path: string, init: RequestInit = {}): Promise<CachedResponse> {
		const url = new URL(path, 'https://example.com').toString();
		const cached = this.entries.get(url);
		if (cached) {
			this.hits += 1;
			return { ...cached, cacheControl: null, vary: null, fromCache: true };
		}
		this.misses += 1;
		const res = await externalBoundary.request(path, init, env);
		const body = await res.clone().text();
		const decision = this.decide(path, new Request(url, init), res);
		this.decisions.push(decision);
		if (decision.stored) this.entries.set(url, { status: res.status, body });
		return {
			status: res.status,
			body,
			cacheControl: res.headers.get('cache-control'),
			vary: res.headers.get('vary'),
			fromCache: false,
		};
	}
}

beforeAll(async () => {
	await applyD1Migrations(D1(), MIGRATIONS);
});

beforeEach(async () => {
	// The key verifier is a module-level seam in the API-key middleware;
	// it must be restored after every test so no stub leaks into a
	// neighbouring suite in the same isolate.
	withVerifyApiKey(async ({ body }) => {
		const principal = KEY_PRINCIPALS[body.key];
		if (!principal) return { valid: false, error: null, key: null };
		return {
			valid: true,
			error: null,
			key: {
				id: principal,
				referenceId: principal,
				// The scopes this suite reads through. They are local
				// test literals, not credentials (ADR-0009 §3 tuples).
				permissions: { access_counter: ['read'], reactions: ['read'] },
				prefix: null,
			},
		};
	});
	await D1().batch([
		D1().prepare('DELETE FROM reactions'),
		D1().prepare('DELETE FROM reaction_images'),
		D1().prepare('DELETE FROM access_counters'),
		D1().prepare('DELETE FROM access_dedup'),
	]);
	// Principal alpha reacted; principal beta did not. Same URL, same
	// visitor cookie, different `Authorization` — the responses below
	// must differ, and a shared cache must not be able to collapse
	// them into one entry.
	await putReaction(D1(), {
		target_key: TARGET,
		actor_id: VISITOR_ACTOR,
		principal: 'key-alpha',
		kind: 'emoji',
		value: 'thumbs_up',
	});
	await D1().batch([
		D1()
			.prepare(
				'INSERT INTO access_counters (key, principal, count, first_hit, last_hit) VALUES (?,?,?,?,?)',
			)
			.bind(COUNTER_KEY, 'key-alpha', 7, 1, 1),
		D1()
			.prepare(
				'INSERT INTO access_counters (key, principal, count, first_hit, last_hit) VALUES (?,?,?,?,?)',
			)
			.bind(COUNTER_KEY, 'key-beta', 3, 1, 1),
	]);
});

afterEach(() => {
	resetVerifyApiKey();
});

describe('external boundary cache isolation (Issue #460)', () => {
	it('two API-key contexts reading the same URL are not collapsed by a shared cache', async () => {
		const cache = new SharedCache();
		const path = `/api/v1/access/count/${COUNTER_KEY}`;

		const asAlpha = await cache.fetch(path, { headers: authHeader('test-key-alpha') });
		const asBeta = await cache.fetch(path, { headers: authHeader('test-key-beta') });

		// Premise: the two contexts genuinely hold different data
		// (ADR-0012 §3 per-principal counters). If this ever stops
		// being true the test below would pass vacuously.
		expect((JSON.parse(asAlpha.body) as { count: number }).count).toBe(7);
		expect((JSON.parse(asBeta.body) as { count: number }).count).toBe(3);
		expect(asAlpha.body).not.toBe(asBeta.body);

		// Contract: neither response is offered to the shared cache, so
		// beta can never be handed alpha's body — and each request
		// really did reach the Worker.
		expect(asAlpha.cacheControl).toBe(PRIVATE_NO_STORE);
		expect(asBeta.cacheControl).toBe(PRIVATE_NO_STORE);
		expect(asAlpha.fromCache).toBe(false);
		expect(asBeta.fromCache).toBe(false);
		expect(cache.storedCount()).toBe(0);
		expect(cache.hits).toBe(0);
		expect(cache.decisions.map((d) => d.stored)).toEqual([false, false]);
		// Refused by an explicit isolation directive, which is the
		// first rule a conforming shared cache evaluates.
		expect(cache.decisions[1]?.reason).toMatch(/no-store|private/);
	});

	it('visitor-scoped reaction state stays with the visitor that owns it', async () => {
		const cache = new SharedCache();
		const path = `/api/v1/reactions?target=${TARGET}&actor_id=${VISITOR_ACTOR}`;

		// The actor cookie arrives on the request the way the home
		// loader forwards it; `Authorization` is what separates the
		// two contexts here.
		const asAlpha = await cache.fetch(path, {
			headers: { ...authHeader('test-key-alpha'), cookie: `mw_actor_id=${VISITOR_ACTOR}` },
		});
		const asBeta = await cache.fetch(path, {
			headers: { ...authHeader('test-key-beta'), cookie: `mw_actor_id=${VISITOR_ACTOR}` },
		});

		expect(
			(JSON.parse(asAlpha.body) as { viewer_reactions: { value: string }[] }).viewer_reactions,
		).toEqual([{ kind: 'emoji', value: 'thumbs_up' }]);
		expect((JSON.parse(asBeta.body) as { viewer_reactions: unknown[] }).viewer_reactions).toEqual(
			[],
		);
		expect(asAlpha.body).not.toBe(asBeta.body);

		expect(asAlpha.cacheControl).toBe(PRIVATE_NO_STORE);
		expect(asAlpha.vary).toBe('Cookie, Authorization');
		expect(cache.storedCount()).toBe(0);
	});

	it('isolates a session response that Better Auth already marked no-store', async () => {
		const cache = new SharedCache();
		const res = await externalBoundary.request('/api/v1/auth/get-session', undefined, env);
		expect(res.status).toBe(200);
		// The origin's own decision is preserved and strengthened, and
		// the response now names the auth context it varies on.
		expect(res.headers.get('cache-control')).toBe(PRIVATE_NO_STORE);
		expect(res.headers.get('vary')).toBe('Cookie, Authorization');
		expect(cache.storedCount()).toBe(0);
	});

	it('isolates unauthenticated and error responses too', async () => {
		const missingKey = await externalBoundary.request(
			`/api/v1/reactions?target=${TARGET}`,
			undefined,
			env,
		);
		expect(missingKey.status).toBe(401);
		expect(missingKey.headers.get('cache-control')).toBe(PRIVATE_NO_STORE);

		const unknownPath = await externalBoundary.request('/api/v1/nope', undefined, env);
		expect(unknownPath.status).toBe(404);
		expect(unknownPath.headers.get('cache-control')).toBe(PRIVATE_NO_STORE);
	});

	it('keeps the one genuinely public payload cacheable (no over-blocking)', async () => {
		// Negative control for the whole suite: a policy that denied
		// everything would pass every assertion above while silently
		// destroying public image delivery.
		const uploaded = await uploadImage(D1(), env.MEDIA, {
			contentType: 'image/png',
			bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			uploadedBy: 'cache-isolation-test',
		});
		const cache = new SharedCache();
		const path = `/api/v1/reaction-images/${uploaded.image.id}`;

		const first = await cache.fetch(path);
		const second = await cache.fetch(path);

		expect(first.status).toBe(200);
		expect(first.cacheControl).toBe('public, max-age=31536000, immutable');
		// No `Vary` on a public immutable asset: fragmenting it per
		// cookie would cost cache hits without changing correctness.
		expect(first.vary).toBeNull();
		expect(cache.storedCount()).toBe(1);
		expect(second.fromCache).toBe(true);
		expect(second.body).toBe(first.body);
	});
});

describe('SSR document + server function cache isolation (Issue #460)', () => {
	async function selfFetchHeaders(
		path: string,
		init?: RequestInit,
	): Promise<{ status: number; cacheControl: string | null; vary: string | null }> {
		const res = await SELF.fetch(`https://example.com${path}`, { redirect: 'manual', ...init });
		return {
			status: res.status,
			cacheControl: res.headers.get('cache-control'),
			vary: res.headers.get('vary'),
		};
	}

	it('the home document is private once the caller is identifiable', async () => {
		// The home page renders this visitor's own reaction
		// selection out of the `mw_actor_id` cookie, so its body is
		// caller-specific: `no-cache` alone still permits a shared
		// cache to STORE it, and `private` is what forbids that.
		const withCookie = await selfFetchHeaders('/', {
			headers: { cookie: `mw_actor_id=${VISITOR_ACTOR}` },
		});
		expect(withCookie.status).toBe(200);
		expect(withCookie.cacheControl).toBe('private, no-cache');
		expect(withCookie.vary).toBe('Cookie, Authorization');
	}, 60_000);

	it('an anonymous document keeps the Issue #291 revalidation policy', async () => {
		const anonymous = await selfFetchHeaders('/');
		expect(anonymous.status).toBe(200);
		expect(anonymous.cacheControl).toBe('no-cache');
		expect(anonymous.vary).toBeNull();
	}, 60_000);

	it('admin stays no-store and now names its auth context', async () => {
		const admin = await selfFetchHeaders('/admin/login');
		expect(admin.status).toBe(200);
		expect(admin.cacheControl).toBe('no-store');
		expect(admin.vary).toBe('Cookie, Authorization');
	});

	it('server-function payloads are isolated by path, JSON or not', async () => {
		// Path-decided for the same reason the `/admin` rule is: the
		// payload is not a document, so a content-type guard would let
		// it through. An unknown server-fn id is enough to observe the
		// headers without depending on a generated function id.
		const serverFn = await selfFetchHeaders('/_serverFn/unknown-function-id', {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie: `mw_actor_id=${VISITOR_ACTOR}` },
			body: '{}',
		});
		expect(serverFn.cacheControl).toBe(PRIVATE_NO_STORE);
		expect(serverFn.vary).toBe('Cookie, Authorization');
	});
});
