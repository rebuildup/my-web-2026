/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../../src/cloudflare/auth/better-auth';

/**
 * Issue #440 — the cross-site request forgery contract, exercised
 * through the real Worker (`SELF.fetch`).
 *
 * Why `SELF` and not a router unit test
 * ------------------------------------
 * The contract spans both HTTP layers of the Worker entry
 * (`src/server.ts`):
 *
 *   - `/api/v1/*`  -> Hono boundary, guarded by `csrfGuard`
 *     (`src/http/middleware/csrf.ts`).
 *   - `/_serverFn/*` -> TanStack Start, guarded by the framework's
 *     **default** CSRF middleware, which is only installed while no
 *     custom `startInstance` exists (ADR-0002 §2).
 *
 * Only `SELF` reaches both. A unit test on either middleware would
 * happily pass while the Worker entry dispatched the request to the
 * wrong layer, which is precisely the failure mode ADR-0002 warns
 * about.
 *
 * Safety
 * ------
 * Nothing here touches a real environment: the D1 binding is
 * Miniflare's local one, the API key is minted through Better Auth
 * against that binding, and no request leaves the test process. The
 * key's plaintext lives in a local variable and is never logged,
 * printed, or asserted on — only the request's outcome is.
 *
 * The "positive" cases carry a real `Authorization: Bearer` key so
 * that the ONLY thing standing between the negative case and a D1
 * write is the origin check itself. Asserting 403 with an
 * unauthenticated request would prove nothing: `requireApiKey`
 * answers 401 by itself.
 */

/** The Worker entry answers on this origin for every request below. */
const ORIGIN = 'https://example.com';
/** A hostile page's origin — never registered anywhere in this repo. */
const CROSS_SITE_ORIGIN = 'https://attacker.example';

const MIGRATIONS = [
	{
		name: '0003_reactions',
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
			'CREATE INDEX IF NOT EXISTS idx_reaction_images_hash ON reaction_images(content_hash)',
		],
	},
];

const TARGET = 'csrf-contract-target';
const ACTOR = 'csrf-contract-actor';
const REACTION_BODY = JSON.stringify({
	target_key: TARGET,
	actor_id: ACTOR,
	kind: 'emoji',
	value: '👍',
});

/**
 * Mint a real consumer API key against the local D1 binding.
 *
 * `createApiKey` is called without request headers on purpose: the
 * plugin guards `permissions` with a SERVER_ONLY_PROPERTY check that
 * fires when the call looks like a client request — the same reason
 * `createApiKeyImpl` (src/admin/keys/load.ts) drops the headers.
 *
 * The plaintext is returned to the caller, held in a module-local
 * variable, and never logged, printed, or asserted on.
 */
async function mintConsumerKey(): Promise<string> {
	const user = await auth.api.createUser({
		body: {
			email: 'csrf-contract@contract.invalid',
			password: 'csrf-contract-password',
			name: 'CSRF Contract Consumer',
			role: 'user',
		},
	});
	const created = (await auth.api.createApiKey({
		body: {
			name: 'csrf-contract',
			userId: String(user.user.id),
			permissions: { reactions: ['read', 'write'] },
		},
	})) as { key: string };
	return created.key;
}

async function countReactions(): Promise<number> {
	const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM reactions').first<{ c: number }>();
	return row?.c ?? 0;
}

/**
 * Minted once per suite run: the `user` / `apikey` rows are unique
 * per email, so re-minting per test would fail on the second call.
 * The write-side budget (60 req/60 s per key, ADR-0010) comfortably
 * covers the handful of writes below.
 */
let apiKey = '';

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
	apiKey = await mintConsumerKey();
});

beforeEach(async () => {
	await env.DB.prepare('DELETE FROM reactions').run();
});

describe('Hono boundary: cross-site writes are refused (negative case)', () => {
	it('refuses a cross-site PUT (CORS owns this origin refusal) and leaves no row behind', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				origin: CROSS_SITE_ORIGIN,
				referer: `${CROSS_SITE_ORIGIN}/attack.html`,
				'sec-fetch-site': 'cross-site',
			},
			body: REACTION_BODY,
		});

		expect(res.status).toBe(403);
		// The request carries an origin outside the CORS allow-list, and
		// the CORS layer (Issue #455) is mounted ahead of this guard, so
		// it owns the refusal. The outcome the CSRF contract requires —
		// a write with a valid credential never reaches D1 — is the same.
		expect(await res.json()).toEqual({
			error: 'cors_origin_rejected',
			class: 'credentialed',
		});
		// The credential was valid; the origin check is what stopped it.
		expect(await countReactions()).toBe(0);
	});

	it('refuses a cross-site DELETE and leaves the row untouched', async () => {
		const seed = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				origin: ORIGIN,
				'sec-fetch-site': 'same-origin',
			},
			body: REACTION_BODY,
		});
		expect(seed.status).toBe(200);
		expect(await countReactions()).toBe(1);

		const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'DELETE',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				// A CORS-allow-listed Origin, but browser fetch metadata
				// says the request started cross-site: the CSRF guard,
				// not the CORS layer, must refuse this one.
				origin: ORIGIN,
				'sec-fetch-site': 'cross-site',
			},
			body: REACTION_BODY,
		});

		expect(res.status).toBe(403);
		expect(((await res.json()) as { error: string }).error).toBe('csrf_rejected');
		expect(await countReactions()).toBe(1);
	});

	it('refuses a same-site but cross-origin write (sibling subdomain is not us)', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				origin: 'https://evil.rebuildup.dev',
				'sec-fetch-site': 'same-site',
			},
			body: REACTION_BODY,
		});
		expect(res.status).toBe(403);
		expect(await countReactions()).toBe(0);
	});

	it('refuses a cookie-bearing write with no origin evidence at all', async () => {
		// The shape a cross-site `no-cors` form POST produces: ambient
		// cookie attached by the browser, no fetch metadata, no Origin.
		const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'POST',
			headers: {
				cookie: 'mw_actor_id=csrf-contract-actor',
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: 'target_key=x',
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'csrf_rejected', reason: 'origin_check_missing' });
	});
});

describe('Hono boundary: same-origin writes are accepted (positive case)', () => {
	it('accepts a same-origin PUT and records the row', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				origin: ORIGIN,
				'sec-fetch-site': 'same-origin',
			},
			body: REACTION_BODY,
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { created: boolean }).created).toBe(true);
		expect(await countReactions()).toBe(1);
	});

	it('accepts the Home self-call shape (Bearer + declared Origin, no fetch metadata)', async () => {
		// `recordHomeHitImpl` / `addHomeReactionImpl` self-call the
		// boundary from inside the Worker: bearer credential, declared
		// origin, and none of the browser fetch-metadata headers. This
		// is the first-party path that Issue #440 had to keep working.
		const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${apiKey}`,
				accept: 'application/json',
				'content-type': 'application/json',
				origin: ORIGIN,
			},
			body: REACTION_BODY,
		});
		expect(res.status).toBe(200);
		expect(await countReactions()).toBe(1);
	});

	it('leaves safe reads alone, cross-site metadata or not', async () => {
		const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions?target=${TARGET}`, {
			headers: {
				authorization: `Bearer ${apiKey}`,
				accept: 'application/json',
				origin: CROSS_SITE_ORIGIN,
				'sec-fetch-site': 'cross-site',
			},
		});
		expect(res.status).toBe(200);
		expect(await countReactions()).toBe(0);
	});
});

describe('no write side effect is reachable through GET', () => {
	it('repeated cross-site GETs never create a row', async () => {
		for (let i = 0; i < 3; i += 1) {
			const res = await SELF.fetch(`${ORIGIN}/api/v1/reactions?target=${TARGET}`, {
				headers: {
					authorization: `Bearer ${apiKey}`,
					accept: 'application/json',
					origin: CROSS_SITE_ORIGIN,
				},
			});
			expect(res.status).toBe(200);
		}
		expect(await countReactions()).toBe(0);
	});

	it('an aggregate read reflects only writes that passed the origin check', async () => {
		const rejected = await SELF.fetch(`${ORIGIN}/api/v1/reactions`, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${apiKey}`,
				'content-type': 'application/json',
				origin: CROSS_SITE_ORIGIN,
			},
			body: REACTION_BODY,
		});
		expect(rejected.status).toBe(403);

		const read = await SELF.fetch(`${ORIGIN}/api/v1/reactions?target=${TARGET}`, {
			headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', origin: ORIGIN },
		});
		expect(read.status).toBe(200);
		expect(((await read.json()) as { aggregates: unknown[] }).aggregates).toEqual([]);
	});
});

// TanStack Start layer
// ---------------------
// No `it()` here on purpose. Behaviour and structure for this half are
// asserted elsewhere — `e2e/csrf.spec.ts` (built preview server) and
// `scripts/check-csrf-contract.mjs` (Node environment; the workerd pool
// sandboxes `node:fs`, so it cannot read the repository tree) — and an
// `expect(typeof apiKey).toBe('string')` placeholder here would only
// pad the SELF case count while proving nothing about CSRF. The reason
// the Start half cannot be asserted from this pool is spelled out at
// the bottom of this file.

// Why the Start-layer BEHAVIOUR is not asserted here
// --------------------------------------------------
// The framework's CSRF middleware only guards `/_serverFn/*`, and the
// workerd pool does not wire that URL: `TSS_SERVER_FN_BASE` is injected
// by the Vite plugin's `define`, which the vitest worker bundle does
// not apply, so `createStartHandler` skips its server-function branch
// and the router answers 404 instead. Probing it from this pool would
// test the harness, not the contract.
//
// The behavioural proof therefore lives in `e2e/csrf.spec.ts`, which
// drives the built preview server where the define IS applied, and in
// `scripts/check-csrf-contract.mjs`, which runs in the Node environment
// (the workerd pool sandboxes `node:fs`) and owns the structural half.
