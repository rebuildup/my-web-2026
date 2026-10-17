/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../../scripts/_cloudflare-contract.mjs';
import { resetVerifyApiKey, withVerifyApiKey } from '../../src/http/api-keys/middleware';
import { externalBoundary } from '../../src/http/hono';

/**
 * Write-path rate limit — local worker simulation (Issue #456).
 *
 * Every case below is a real HTTP request executed against the
 * production external boundary (`src/http/hono.ts`) inside the local
 * workerd pool, with the **real** Cloudflare Rate Limiting bindings
 * declared in `vitest.config.ts`. The binding is not stubbed: the
 * pool's `ratelimits` option reproduces the shipped budgets from
 * `RATE_LIMITS` (`scripts/_cloudflare-contract.mjs`), so "60 writes
 * per principal per minute" is measured here rather than declared.
 *
 * What this proves that the middleware unit test cannot:
 *   - the production middleware ordering (`requireApiKey` → rate limit
 *     → handler) and which layer answers first;
 *   - that a suppressed request never reaches D1;
 *   - that the write budget is **one bucket per principal** shared by
 *     `PUT /api/v1/reactions`, `DELETE /api/v1/reactions` and
 *     `POST /api/v1/access/hit` — not one per route;
 *   - the accepted-vs-rejected matrix that
 *     `scripts/capture-write-rate-limit-report.mjs` screenshots.
 *
 * Secrets: the API key is stubbed through the existing
 * `withVerifyApiKey` DI seam, so no credential is read, printed, or
 * required. Principal ids are per-test labels, never key material.
 */

const WRITE_LIMIT = RATE_LIMITS.RATE_LIMIT_WRITE.limit;
const RETRY_AFTER = RATE_LIMITS.RATE_LIMIT_WRITE.period;

const MIGRATIONS = [
	{
		name: '0002_access_counter',
		queries: [
			`CREATE TABLE IF NOT EXISTS access_dedup (
        counter_key TEXT    NOT NULL,
        principal   TEXT    NOT NULL,
        session_id  TEXT    NOT NULL,
        expires_at  INTEGER NOT NULL,
        PRIMARY KEY (counter_key, principal, session_id)
    )`,
			'CREATE INDEX IF NOT EXISTS idx_access_dedup_expires ON access_dedup(expires_at)',
			`CREATE TABLE IF NOT EXISTS access_counters (
        key        TEXT    NOT NULL,
        principal  TEXT    NOT NULL,
        count      INTEGER NOT NULL DEFAULT 0,
        first_hit  INTEGER NOT NULL,
        last_hit   INTEGER NOT NULL,
        PRIMARY KEY (key, principal)
    )`,
		],
	},
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
			`CREATE TABLE IF NOT EXISTS reaction_images (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
    )`,
		],
	},
];

const AUTH_HEADER = { authorization: 'Bearer mk_home_local-simulation-not-real' };
const JSON_HEADERS = { ...AUTH_HEADER, 'content-type': 'application/json' };

/**
 * Browser-shaped UA per request index. The access-counter ingress
 * filter rejects bot-looking / prefetching requests and dedupes on
 * `ip|ua|path`, so a per-request UA keeps every write in the burst a
 * distinct, accepted request. No real UA is copied here.
 */
function userAgentFor(index: number): string {
	return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 local-simulation-${index}`;
}

function reactionBody(actorId: string): string {
	return JSON.stringify({
		target_key: 'rate-limit-target',
		actor_id: actorId,
		kind: 'emoji',
		value: '👍',
	});
}

function hitBody(sessionId: string): string {
	return JSON.stringify({ key: 'rate-limit-counter', session_id: sessionId });
}

interface Probe {
	status: number;
	error: string | null;
	retryAfter: string | null;
}

async function probe(path: string, init: RequestInit): Promise<Probe> {
	const res = await externalBoundary.request(path, init, env);
	let error: string | null = null;
	try {
		error = ((await res.json()) as { error?: string }).error ?? null;
	} catch {
		error = null;
	}
	return {
		status: res.status,
		error,
		retryAfter: res.headers.get('Retry-After'),
	};
}

function putReaction(
	actorId: string,
	headers: Record<string, string> = JSON_HEADERS,
): Promise<Response> {
	return externalBoundary.request(
		'/api/v1/reactions',
		{ method: 'PUT', headers, body: reactionBody(actorId) },
		env,
	);
}

function deleteReaction(actorId: string): Promise<Response> {
	return externalBoundary.request(
		'/api/v1/reactions',
		{ method: 'DELETE', headers: JSON_HEADERS, body: reactionBody(actorId) },
		env,
	);
}

function postHit(index: number): Promise<Response> {
	return externalBoundary.request(
		'/api/v1/access/hit',
		{
			method: 'POST',
			headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(index) },
			body: hitBody(`session-${index}`),
		},
		env,
	);
}

/**
 * Bind the API-key verifier to one principal. The id is the rate-limit
 * principal (ADR-0010), so every test uses its own label and never
 * shares a budget with another case.
 */
function usePrincipal(
	principal: string,
	permissions: Record<string, string[]> = {
		reactions: ['read', 'write'],
		access_counter: ['read', 'write'],
	},
): void {
	withVerifyApiKey(async () => ({
		valid: true,
		error: null,
		key: { id: principal, referenceId: 'ref-local-simulation', permissions, prefix: 'mk_home_' },
	}));
}

/** Burn the whole write budget for the current principal. */
async function exhaustWriteBudget(): Promise<void> {
	for (let i = 0; i < WRITE_LIMIT; i += 1) {
		await putReaction(`burn-${i}`);
	}
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
});

afterEach(() => {
	resetVerifyApiKey();
});

describe('write rate limit — reactions PUT (ADR-0010 budget, real binding)', () => {
	it('accepts the documented budget, then suppresses the next request with 429 + Retry-After', async () => {
		usePrincipal('rl-put');
		for (let i = 0; i < WRITE_LIMIT; i += 1) {
			const res = await putReaction(`put-${i}`);
			expect(res.status).toBe(200);
		}
		const blocked = await probe('/api/v1/reactions', {
			method: 'PUT',
			headers: JSON_HEADERS,
			body: reactionBody('put-over-budget'),
		});
		expect(blocked.status).toBe(429);
		expect(blocked.error).toBe('rate_limited');
		expect(blocked.retryAfter).toBe(String(RETRY_AFTER));
	});

	it('a suppressed write never reaches D1', async () => {
		usePrincipal('rl-no-write');
		await exhaustWriteBudget();
		const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM reactions').first<{
			n: number;
		}>();
		const res = await putReaction('never-stored');
		const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM reactions').first<{
			n: number;
		}>();
		expect(res.status).toBe(429);
		expect(after?.n).toBe(before?.n);
		const row = await env.DB.prepare('SELECT id FROM reactions WHERE actor_id = ?1')
			.bind('never-stored')
			.first();
		expect(row).toBeNull();
	});

	it('caps a 100-request burst at the documented budget', async () => {
		usePrincipal('rl-burst');
		const responses = await Promise.all(
			Array.from({ length: 100 }, (_, i) => putReaction(`burst-${i}`)),
		);
		const accepted = responses.filter((r) => r.status === 200).length;
		const suppressed = responses.filter((r) => r.status === 429).length;
		expect(accepted).toBe(WRITE_LIMIT);
		expect(suppressed).toBe(100 - WRITE_LIMIT);
		const stored = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM reactions WHERE actor_id LIKE ?1',
		)
			.bind('burst-%')
			.first<{ n: number }>();
		expect(stored?.n).toBe(WRITE_LIMIT);
	});
});

describe('write rate limit — budget is one bucket per principal', () => {
	it('PUT and DELETE draw from the same budget', async () => {
		usePrincipal('rl-shared-routes');
		for (let i = 0; i < WRITE_LIMIT / 2; i += 1) {
			expect((await putReaction(`share-put-${i}`)).status).toBe(200);
			expect((await deleteReaction(`share-del-${i}`)).status).toBe(200);
		}
		const putBlocked = await probe('/api/v1/reactions', {
			method: 'PUT',
			headers: JSON_HEADERS,
			body: reactionBody('share-put-over'),
		});
		const deleteBlocked = await probe('/api/v1/reactions', {
			method: 'DELETE',
			headers: JSON_HEADERS,
			body: reactionBody('share-del-over'),
		});
		expect(putBlocked.status).toBe(429);
		expect(deleteBlocked.status).toBe(429);
		expect(deleteBlocked.retryAfter).toBe(String(RETRY_AFTER));
	});

	it('the access counter draws from the same budget as reactions', async () => {
		usePrincipal('rl-shared-obligations');
		for (let i = 0; i < WRITE_LIMIT / 2; i += 1) {
			expect((await putReaction(`mix-put-${i}`)).status).toBe(200);
			expect((await postHit(i)).status).toBe(200);
		}
		const blocked = await probe('/api/v1/access/hit', {
			method: 'POST',
			headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(9999) },
			body: hitBody('session-over-budget'),
		});
		expect(blocked.status).toBe(429);
		expect(blocked.error).toBe('rate_limited');
		const counter = await env.DB.prepare(
			'SELECT count FROM access_counters WHERE principal = ?1 AND key = ?2',
		)
			.bind('rl-shared-obligations', 'rate-limit-counter')
			.first<{ count: number }>();
		// The suppressed hit was refused before D1: the counter still
		// reflects exactly the hits that were accepted.
		expect(counter?.count).toBe(WRITE_LIMIT / 2);
	});

	it('a different API key principal keeps an independent budget', async () => {
		usePrincipal('rl-principal-a');
		await exhaustWriteBudget();
		expect((await putReaction('a-over')).status).toBe(429);

		usePrincipal('rl-principal-b');
		expect((await putReaction('b-first')).status).toBe(200);
	});
});

describe('write rate limit — what is NOT throttled', () => {
	it('the read budget survives an exhausted write budget', async () => {
		usePrincipal('rl-reads');
		await exhaustWriteBudget();
		const aggregates = await probe('/api/v1/reactions?target=rate-limit-target', {
			headers: AUTH_HEADER,
		});
		const count = await probe('/api/v1/access/count/rate-limit-counter', {
			headers: AUTH_HEADER,
		});
		expect(aggregates.status).toBe(200);
		expect(count.status).toBe(200);
	});

	it('the public image read is keyed on IP, not on the exhausted principal', async () => {
		usePrincipal('rl-image-read');
		await exhaustWriteBudget();
		const res = await probe('/api/v1/reaction-images/00000000000000000000000000000000', {
			headers: { 'cf-connecting-ip': '203.0.113.7' },
		});
		expect(res.status).toBe(404);
		expect(res.error).toBe('not_found');
	});

	it('authentication is evaluated before throttling, and spends no budget', async () => {
		usePrincipal('rl-auth-order');
		await exhaustWriteBudget();
		expect((await putReaction('auth-order-over')).status).toBe(429);

		// An unauthenticated caller gets 401 even while the principal is
		// throttled — the auth layer answers first.
		const anonymous = await probe('/api/v1/reactions', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: reactionBody('anonymous'),
		});
		expect(anonymous.status).toBe(401);
		expect(anonymous.error).toBe('missing_authorization');

		// Unauthenticated spam never reaches the limiter: a second
		// principal is still at full budget after five rejected calls.
		for (let i = 0; i < 5; i += 1) {
			await putReaction('anonymous', { 'content-type': 'application/json' });
		}
		usePrincipal('rl-auth-order-fresh');
		for (let i = 0; i < WRITE_LIMIT; i += 1) {
			expect((await putReaction(`fresh-${i}`)).status).toBe(200);
		}
	});

	it('a rejected body inside the budget answers 400, not 429', async () => {
		usePrincipal('rl-invalid-body');
		const malformed = await probe('/api/v1/reactions', {
			method: 'PUT',
			headers: JSON_HEADERS,
			body: JSON.stringify({ target_key: 'rate-limit-target', actor_id: 'a', kind: 'sticker' }),
		});
		expect(malformed.status).toBe(400);
		expect(malformed.error).toBe('invalid_body');
		expect(malformed.retryAfter).toBeNull();
	});
});

/**
 * Accepted vs rejected input matrix. Printed between the markers so
 * `scripts/capture-write-rate-limit-report.mjs` can render the
 * MEASURED table into the committed screenshot. Every cell is read back
 * from a real response; the assertions above are the gate.
 */
describe('accepted vs rejected input matrix (measured)', () => {
	it('prints the measured matrix', async () => {
		usePrincipal('rl-matrix');
		const rows: string[][] = [];
		let index = 0;
		const record = (endpoint: string, input: string, result: Probe) => {
			index += 1;
			rows.push([
				String(index),
				endpoint,
				input,
				String(result.status),
				result.error ?? '—',
				result.retryAfter ?? '—',
			]);
		};

		record(
			'PUT /api/v1/reactions',
			'有効な body / budget 内',
			await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: reactionBody('matrix-ok'),
			}),
		);
		record(
			'DELETE /api/v1/reactions',
			'有効な body / budget 内',
			await probe('/api/v1/reactions', {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: reactionBody('matrix-ok'),
			}),
		);
		record(
			'POST /api/v1/access/hit',
			'有効な body / budget 内',
			await probe('/api/v1/access/hit', {
				method: 'POST',
				headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(0) },
				body: hitBody('matrix-session'),
			}),
		);
		record(
			'PUT /api/v1/reactions',
			'kind が未定義値',
			await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: JSON.stringify({ target_key: 'rate-limit-target', actor_id: 'a', kind: 'sticker' }),
			}),
		);
		record(
			'PUT /api/v1/reactions',
			'Authorization ヘッダー無し',
			await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: reactionBody('matrix-anon'),
			}),
		);
		withVerifyApiKey(async () => ({ valid: false, error: 'invalid', key: null }));
		record(
			'PUT /api/v1/reactions',
			'未知の API キー',
			await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: reactionBody('matrix-unknown'),
			}),
		);
		usePrincipal('rl-matrix', { reactions: ['read'], access_counter: ['read'] });
		record(
			'PUT /api/v1/reactions',
			'キーに reactions:write が無い',
			await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: reactionBody('matrix-scope'),
			}),
		);
		record(
			'GET /api/v1/reactions',
			'target 指定（read budget）',
			await probe('/api/v1/reactions?target=rate-limit-target', {
				headers: AUTH_HEADER,
			}),
		);
		record(
			'GET /api/v1/access/count/:key',
			'read budget',
			await probe('/api/v1/access/count/rate-limit-counter', {
				headers: AUTH_HEADER,
			}),
		);

		// A dedicated principal so the "over budget" rows below are the
		// exact 61st request, not "whatever budget was left".
		usePrincipal('rl-matrix-write');
		await exhaustWriteBudget();
		record(
			'PUT /api/v1/reactions',
			`${WRITE_LIMIT + 1} 回目（上限超過）`,
			await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: reactionBody('matrix-over'),
			}),
		);
		record(
			'DELETE /api/v1/reactions',
			'上限超過',
			await probe('/api/v1/reactions', {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: reactionBody('matrix-over'),
			}),
		);
		record(
			'POST /api/v1/access/hit',
			'上限超過',
			await probe('/api/v1/access/hit', {
				method: 'POST',
				headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(9999) },
				body: hitBody('matrix-session-over'),
			}),
		);
		record(
			'GET /api/v1/reaction-images/:id',
			'未知の id（IP キーの read budget）',
			await probe('/api/v1/reaction-images/00000000000000000000000000000000', {
				headers: { 'cf-connecting-ip': '203.0.113.7' },
			}),
		);

		const header = ['#', 'エンドポイント', '入力 / 条件', 'status', 'error', 'Retry-After'];
		const table = [header, ...rows].map((row) => `| ${row.join(' | ')} |`).join('\n');
		console.log('<!-- write-rate-limit-matrix:start -->');
		console.log(table);
		console.log('<!-- write-rate-limit-matrix:end -->');

		expect(rows.length).toBe(13);
		// The suppression half of the matrix is asserted, not just printed.
		const suppression = rows.slice(9);
		expect(suppression.map((row) => [row[0], row[3], row[4], row[5]])).toEqual([
			['10', '429', 'rate_limited', String(RETRY_AFTER)],
			['11', '429', 'rate_limited', String(RETRY_AFTER)],
			['12', '429', 'rate_limited', String(RETRY_AFTER)],
			// The public image read is on the IP-keyed read budget: it is
			// unaffected by the exhausted write budget and answers 404.
			['13', '404', 'not_found', '—'],
		]);
	});
});
