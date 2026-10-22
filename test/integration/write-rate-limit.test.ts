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
 *   - the production middleware ordering (`csrfGuard` → `requireApiKey`
 *     → rate limit → handler) and which layer answers first;
 *   - that a suppressed request never reaches D1;
 *   - that the write budget is **one bucket per principal** shared by
 *     `PUT /api/v1/reactions`, `DELETE /api/v1/reactions` and
 *     `POST /api/v1/access/hit` — not one per route;
 *   - the accepted-vs-rejected matrix that
 *     `scripts/capture-write-rate-limit-report.mjs` screenshots.
 *
 * Window alignment (Issue #668): the local emulation erases its counter
 * at every wall-clock minute, so a spend that straddles a boundary
 * would measure two half-windows instead of one. Every spend below
 * therefore runs inside `spendInsideOneWindow`, which aligns the spend
 * to the current window and retries it if the window changed anyway.
 *
 * Secrets: the API key is stubbed through the existing
 * `withVerifyApiKey` DI seam, so no credential is read, printed, or
 * required. Principal ids are per-test labels, never key material.
 */

const WRITE_LIMIT = RATE_LIMITS.RATE_LIMIT_WRITE.limit;
const RETRY_AFTER = RATE_LIMITS.RATE_LIMIT_WRITE.period;

/**
 * The window of the local rate-limit emulation.
 *
 * miniflare's `ratelimit-object.worker.js` — the local emulation of the
 * Cloudflare Rate Limiting binding — buckets its counter by the
 * wall-clock epoch `Math.floor(Date.now() / (period * 1e3))` and
 * overwrites the bucket when the epoch changes. The shipped binding
 * uses a sliding window; only the local emulation is aligned to the
 * minute, and that alignment is what lets a budget spend that happens
 * to straddle a minute boundary end up "not exhausted": the counter is
 * erased in the middle of the spend and the request after it is
 * accepted instead of suppressed (Issue #668).
 *
 * The helpers below keep every spend inside one window, so the
 * assertions below measure the budget instead of the clock. The
 * binding is **not** stubbed: the budgets are still measured through
 * the real Rate Limiting binding, and only the *timing* of the spend
 * is aligned.
 */
const WINDOW_MS = RETRY_AFTER * 1_000;

/** The wall-clock epoch the local emulation buckets the counter by. */
function windowEpoch(now: number = Date.now()): number {
	return Math.floor(now / WINDOW_MS);
}

/** How much of the current window is left, in milliseconds. */
function windowRemainingMs(now: number = Date.now()): number {
	return WINDOW_MS - (now % WINDOW_MS);
}

/**
 * Whether the window a spend started in is still the current one. A
 * change of epoch is exactly the condition under which the emulation
 * erases the counter.
 */
function windowHeld(epoch: number, now: number = Date.now()): boolean {
	return windowEpoch(now) === epoch;
}

/**
 * The headroom a spend needs before it starts, and the longest spend
 * observed so far. The first spend has no measurement yet, so it gets a
 * conservative budget; later spends use twice the longest observed
 * one, so a slower machine is covered as well.
 *
 * The headroom also bounds the wait: the alignment returns as soon as
 * the window has that much room left, and the window it waits for has
 * the whole period, so the wait never exceeds the headroom.
 */
const MIN_SPEND_HEADROOM_MS = 2_000;
const MAX_SPEND_ATTEMPTS = 3;
let longestSpendMs = 0;

function requiredHeadroomMs(): number {
	return Math.max(MIN_SPEND_HEADROOM_MS, longestSpendMs * 2);
}

/**
 * Wait until the current window has at least `headroomMs` of room left,
 * so the spend that follows cannot reach the next boundary. The wait
 * ends at the next boundary at the latest, so it never costs more than
 * `headroomMs`; when the window still has room it returns at once.
 */
async function awaitWindowHeadroom(headroomMs: number): Promise<void> {
	while (windowRemainingMs() < headroomMs) {
		const wait = Math.max(25, Math.min(200, windowRemainingMs()));
		await new Promise((resolve) => setTimeout(resolve, wait));
	}
}

/**
 * Run a body that spends the write budget inside one rate-limit
 * window.
 *
 * The body is aligned to the current window (see
 * `awaitWindowHeadroom`) and the window is compared before and after.
 * If the window changed while the body ran, the local emulation reset
 * the counter mid-spend, so what the body measured was not one window's
 * budget; the body is then run again in the new window. The attempt
 * number lets the body use attempt-scoped principal ids and actor
 * ids, so a retry starts from an empty bucket and does not reuse a row
 * an earlier attempt wrote.
 *
 * A failure whose window did **not** change is a real failure and is
 * rethrown untouched.
 */
async function spendInsideOneWindow<T>(body: (attempt: number) => Promise<T>): Promise<T> {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < MAX_SPEND_ATTEMPTS; attempt += 1) {
		await awaitWindowHeadroom(requiredHeadroomMs());
		const epoch = windowEpoch();
		const startedAt = Date.now();
		let result: T | undefined;
		let failure: unknown = null;
		try {
			result = await body(attempt);
		} catch (error) {
			failure = error;
		}
		longestSpendMs = Math.max(longestSpendMs, Date.now() - startedAt);
		if (windowHeld(epoch)) {
			// The window held, so what the body measured is one
			// window's budget. A failure here is a real failure.
			if (failure) throw failure;
			return result as T;
		}
		// The window changed under the body: the emulation erased the
		// counter mid-spend, so neither the measurements nor a failure
		// can be trusted. Run the body again in the new window.
		if (failure) lastError = failure;
	}
	throw new Error(
		`the write budget could not be spent inside one rate-limit window: ${String(lastError)}`,
	);
}

/**
 * Inlined DDL (workerd cannot `fs.readFile`). Same convention as
 * `test/integration/reactions.test.ts`: the block named `0002_*` is
 * `migrations/0002_access_counter.sql` **as amended by**
 * `migrations/0005_access_counter_principal.sql` (the per-principal
 * `PRIMARY KEY (key, principal)` shape that actually ships), and
 * `0003_reactions` mirrors `migrations/0003_reactions.sql` including
 * both `reactions` indexes. This suite only needs the columns the
 * write paths touch, but the copies must not drift into a *different*
 * schema than production — see `docs/security/write-rate-limit.md`
 * (検証) for why the real budgets matter more than the schema here.
 */
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
			// 0005 shape: PK is (key, principal), not key alone.
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
		],
	},
];

const AUTH_HEADER = { authorization: 'Bearer mk_home_local-simulation-not-real' };
/**
 * `csrfGuard` (Issue #440) runs before any rate-limit middleware and
 * requires a same-origin signal on unsafe methods. These requests
 * model a first-party browser fetch, which always carries
 * `Sec-Fetch-Site: same-origin`; without it every write below would be
 * refused with `403 csrf_rejected` before authentication or throttling.
 */
const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...AUTH_HEADER, ...SAME_ORIGIN, 'content-type': 'application/json' };
const ANONYMOUS_JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };

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

async function putReaction(
	actorId: string,
	headers: Record<string, string> = JSON_HEADERS,
): Promise<Response> {
	return externalBoundary.request(
		'/api/v1/reactions',
		{ method: 'PUT', headers, body: reactionBody(actorId) },
		env,
	);
}

async function deleteReaction(actorId: string): Promise<Response> {
	return externalBoundary.request(
		'/api/v1/reactions',
		{ method: 'DELETE', headers: JSON_HEADERS, body: reactionBody(actorId) },
		env,
	);
}

async function postHit(index: number, attempt: number): Promise<Response> {
	return externalBoundary.request(
		'/api/v1/access/hit',
		{
			method: 'POST',
			headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(index) },
			body: hitBody(`session-${attempt}-${index}`),
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

/**
 * Burn the whole write budget for the current principal. The actor id
 * is attempt-scoped so a retried spend never reuses a row an earlier
 * attempt wrote.
 */
async function exhaustWriteBudget(attempt: number): Promise<void> {
	for (let i = 0; i < WRITE_LIMIT; i += 1) {
		await putReaction(`burn-${attempt}-${i}`);
	}
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
});

afterEach(() => {
	resetVerifyApiKey();
});

describe('the local rate-limit window (Issue #668)', () => {
	it('erases the counter at every wall-clock minute boundary', () => {
		// The premise the window alignment rests on: the local
		// emulation buckets its counter by the wall-clock epoch, so the
		// budget a spend observes is the budget of the window it
		// started in — until the wall clock crosses into the next one.
		const epoch = windowEpoch(0);
		expect(windowEpoch(0)).toBe(epoch);
		expect(windowEpoch(WINDOW_MS - 1)).toBe(epoch);
		expect(windowEpoch(WINDOW_MS)).toBe(epoch + 1);
		expect(windowHeld(epoch, WINDOW_MS - 1)).toBe(true);
		expect(windowHeld(epoch, WINDOW_MS)).toBe(false);
	});
});

/**
 * Every suite below that spends the write budget runs with an explicit
 * 60 s timeout: the window alignment may wait for the next wall-clock
 * minute, which is longer than vitest's 5 s default. The assertions are
 * about the budget, not about latency, and a wait is the price of
 * measuring one window instead of two.
 */
describe(
	'write rate limit — reactions PUT (ADR-0010 budget, real binding)',
	{ timeout: 60_000 },
	() => {
		it('accepts the documented budget, then suppresses the next request with 429 + Retry-After', async () => {
			await spendInsideOneWindow(async (attempt) => {
				usePrincipal(`rl-put-${attempt}`);
				for (let i = 0; i < WRITE_LIMIT; i += 1) {
					const res = await putReaction(`put-${attempt}-${i}`);
					expect(res.status).toBe(200);
				}
				const blocked = await probe('/api/v1/reactions', {
					method: 'PUT',
					headers: JSON_HEADERS,
					body: reactionBody(`put-${attempt}-over-budget`),
				});
				expect(blocked.status).toBe(429);
				expect(blocked.error).toBe('rate_limited');
				expect(blocked.retryAfter).toBe(String(RETRY_AFTER));
			});
		});

		it('a suppressed write never reaches D1', async () => {
			await spendInsideOneWindow(async (attempt) => {
				usePrincipal(`rl-no-write-${attempt}`);
				await exhaustWriteBudget(attempt);
				const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM reactions').first<{
					n: number;
				}>();
				const res = await putReaction(`never-stored-${attempt}`);
				const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM reactions').first<{
					n: number;
				}>();
				expect(res.status).toBe(429);
				expect(after?.n).toBe(before?.n);
				const row = await env.DB.prepare('SELECT id FROM reactions WHERE actor_id = ?1')
					.bind(`never-stored-${attempt}`)
					.first();
				expect(row).toBeNull();
			});
		});

		it('caps a 100-request burst at the documented budget', async () => {
			await spendInsideOneWindow(async (attempt) => {
				usePrincipal(`rl-burst-${attempt}`);
				const responses = await Promise.all(
					Array.from({ length: 100 }, (_, i) => putReaction(`burst-${attempt}-${i}`)),
				);
				const accepted = responses.filter((r) => r.status === 200).length;
				const suppressed = responses.filter((r) => r.status === 429).length;
				expect(accepted).toBe(WRITE_LIMIT);
				expect(suppressed).toBe(100 - WRITE_LIMIT);
				const stored = await env.DB.prepare(
					'SELECT COUNT(*) AS n FROM reactions WHERE actor_id LIKE ?1',
				)
					.bind(`burst-${attempt}-%`)
					.first<{ n: number }>();
				expect(stored?.n).toBe(WRITE_LIMIT);
			});
		});
	},
);

describe('write rate limit — budget is one bucket per principal', { timeout: 60_000 }, () => {
	it('PUT and DELETE draw from the same budget', async () => {
		await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-shared-routes-${attempt}`);
			for (let i = 0; i < WRITE_LIMIT / 2; i += 1) {
				expect((await putReaction(`share-put-${attempt}-${i}`)).status).toBe(200);
				expect((await deleteReaction(`share-del-${attempt}-${i}`)).status).toBe(200);
			}
			const putBlocked = await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: reactionBody(`share-put-${attempt}-over`),
			});
			const deleteBlocked = await probe('/api/v1/reactions', {
				method: 'DELETE',
				headers: JSON_HEADERS,
				body: reactionBody(`share-del-${attempt}-over`),
			});
			expect(putBlocked.status).toBe(429);
			expect(deleteBlocked.status).toBe(429);
			expect(deleteBlocked.retryAfter).toBe(String(RETRY_AFTER));
		});
	});

	it('the access counter draws from the same budget as reactions', async () => {
		await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-shared-obligations-${attempt}`);
			for (let i = 0; i < WRITE_LIMIT / 2; i += 1) {
				expect((await putReaction(`mix-put-${attempt}-${i}`)).status).toBe(200);
				expect((await postHit(i, attempt)).status).toBe(200);
			}
			const blocked = await probe('/api/v1/access/hit', {
				method: 'POST',
				headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(9999) },
				body: hitBody(`session-${attempt}-over-budget`),
			});
			expect(blocked.status).toBe(429);
			expect(blocked.error).toBe('rate_limited');
			const counter = await env.DB.prepare(
				'SELECT count FROM access_counters WHERE principal = ?1 AND key = ?2',
			)
				.bind(`rl-shared-obligations-${attempt}`, 'rate-limit-counter')
				.first<{ count: number }>();
			// The suppressed hit was refused before D1: the counter still
			// reflects exactly the hits that were accepted.
			expect(counter?.count).toBe(WRITE_LIMIT / 2);
		});
	});

	it('a different API key principal keeps an independent budget', async () => {
		await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-principal-a-${attempt}`);
			await exhaustWriteBudget(attempt);
			expect((await putReaction(`a-${attempt}-over`)).status).toBe(429);

			usePrincipal(`rl-principal-b-${attempt}`);
			expect((await putReaction(`b-${attempt}-first`)).status).toBe(200);
		});
	});
});

describe('write rate limit — what is NOT throttled', { timeout: 60_000 }, () => {
	it('the read budget survives an exhausted write budget', async () => {
		await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-reads-${attempt}`);
			await exhaustWriteBudget(attempt);
			const aggregates = await probe('/api/v1/reactions?target=rate-limit-target', {
				headers: AUTH_HEADER,
			});
			const count = await probe('/api/v1/access/count/rate-limit-counter', {
				headers: AUTH_HEADER,
			});
			expect(aggregates.status).toBe(200);
			expect(count.status).toBe(200);
		});
	});

	it('the public image read is keyed on IP, not on the exhausted principal', async () => {
		await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-image-read-${attempt}`);
			await exhaustWriteBudget(attempt);
			const res = await probe('/api/v1/reaction-images/00000000000000000000000000000000', {
				headers: { 'cf-connecting-ip': '203.0.113.7' },
			});
			expect(res.status).toBe(404);
			expect(res.error).toBe('not_found');
		});
	});

	it('authentication is evaluated before throttling', async () => {
		await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-auth-order-${attempt}`);
			await exhaustWriteBudget(attempt);
			expect((await putReaction(`auth-order-${attempt}-over`)).status).toBe(429);

			// An unauthenticated caller gets 401 even while the principal is
			// throttled — the auth layer answers first.
			const anonymous = await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: ANONYMOUS_JSON_HEADERS,
				body: reactionBody(`anonymous-${attempt}`),
			});
			expect(anonymous.status).toBe(401);
			expect(anonymous.error).toBe('missing_authorization');

			// "401 spends no budget" is deliberately NOT asserted here: with
			// the production route shape a 401 short-circuits before the
			// limiter, so there is no principal whose bucket could shrink —
			// the IP / `anonymous` write bucket is unreachable because every
			// write route sits behind `requireApiKey`. The observable form of
			// the claim lives in `src/http/middleware/rate-limit.test.ts`,
			// which counts the binding's `limit()` calls through the real
			// `requireApiKey → rateLimitWrite → requireResourceAction` chain
			// (401 = 0 calls).
		});
	});

	it('a cross-site write is refused before the write bucket is touched', async () => {
		// `csrfGuard` is mounted before authentication and throttling, so
		// a refused cross-site write spends no budget. Sixty of them in a
		// row must leave the bucket intact: the next same-origin write is
		// accepted, not 429.
		usePrincipal('rl-csrf-order');
		for (let i = 0; i < WRITE_LIMIT; i += 1) {
			const refused = await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' },
				body: reactionBody(`csrf-${i}`),
			});
			expect(refused.status).toBe(403);
			expect(refused.error).toBe('csrf_rejected');
		}
		const accepted = await probe('/api/v1/reactions', {
			method: 'PUT',
			headers: JSON_HEADERS,
			body: reactionBody('csrf-then-allowed'),
		});
		expect(accepted.status).toBe(200);
	});

	it('a missing scope answers 403 and still spends the write budget', async () => {
		// `requireResourceAction` is the FIRST statement inside the
		// handler, i.e. it runs *after* `rateLimitWrite`, so every 403
		// below is charged to the bucket. This is the opposite of the
		// 401 case above and is the reason the operational contract
		// cannot say "認証は予算を消費しない" — a read-only principal can
		// still exhaust the write budget (see
		// `docs/security/write-rate-limit.md`).
		await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-missing-scope-${attempt}`, {
				reactions: ['read'],
				access_counter: ['read'],
			});
			for (let i = 0; i < WRITE_LIMIT; i += 1) {
				const res = await putReaction(`scope-${attempt}-${i}`);
				expect(res.status).toBe(403);
			}
			const overBudget = await probe('/api/v1/reactions', {
				method: 'PUT',
				headers: JSON_HEADERS,
				body: reactionBody(`scope-${attempt}-over-budget`),
			});
			expect(overBudget.status).toBe(429);
			expect(overBudget.error).toBe('rate_limited');
			expect(overBudget.retryAfter).toBe(String(RETRY_AFTER));
		});
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
describe('accepted vs rejected input matrix (measured)', { timeout: 60_000 }, () => {
	it('prints the measured matrix', async () => {
		// The whole matrix — including the exhaustion that produces the
		// suppression rows — has to be measured inside one rate-limit
		// window, so the body is the guarded one and the table is
		// printed once, after the guard accepted the measurements.
		const rows = await spendInsideOneWindow(async (attempt) => {
			usePrincipal(`rl-matrix-${attempt}`);
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
					body: reactionBody(`matrix-${attempt}-ok`),
				}),
			);
			record(
				'DELETE /api/v1/reactions',
				'有効な body / budget 内',
				await probe('/api/v1/reactions', {
					method: 'DELETE',
					headers: JSON_HEADERS,
					body: reactionBody(`matrix-${attempt}-ok`),
				}),
			);
			record(
				'POST /api/v1/access/hit',
				'有効な body / budget 内',
				await probe('/api/v1/access/hit', {
					method: 'POST',
					headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(0) },
					body: hitBody(`matrix-${attempt}-session`),
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
					headers: ANONYMOUS_JSON_HEADERS,
					body: reactionBody(`matrix-${attempt}-anon`),
				}),
			);
			withVerifyApiKey(async () => ({ valid: false, error: 'invalid', key: null }));
			record(
				'PUT /api/v1/reactions',
				'未知の API キー',
				await probe('/api/v1/reactions', {
					method: 'PUT',
					headers: JSON_HEADERS,
					body: reactionBody(`matrix-${attempt}-unknown`),
				}),
			);
			usePrincipal(`rl-matrix-${attempt}`, { reactions: ['read'], access_counter: ['read'] });
			record(
				'PUT /api/v1/reactions',
				'キーに reactions:write が無い',
				await probe('/api/v1/reactions', {
					method: 'PUT',
					headers: JSON_HEADERS,
					body: reactionBody(`matrix-${attempt}-scope`),
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
			usePrincipal(`rl-matrix-write-${attempt}`);
			await exhaustWriteBudget(attempt);
			record(
				'PUT /api/v1/reactions',
				`${WRITE_LIMIT + 1} 回目（上限超過）`,
				await probe('/api/v1/reactions', {
					method: 'PUT',
					headers: JSON_HEADERS,
					body: reactionBody(`matrix-${attempt}-over`),
				}),
			);
			record(
				'DELETE /api/v1/reactions',
				'上限超過',
				await probe('/api/v1/reactions', {
					method: 'DELETE',
					headers: JSON_HEADERS,
					body: reactionBody(`matrix-${attempt}-over`),
				}),
			);
			record(
				'POST /api/v1/access/hit',
				'上限超過',
				await probe('/api/v1/access/hit', {
					method: 'POST',
					headers: { ...JSON_HEADERS, 'user-agent': userAgentFor(9999) },
					body: hitBody(`matrix-${attempt}-session-over`),
				}),
			);
			record(
				'GET /api/v1/reaction-images/:id',
				'未知の id（IP キーの read budget）',
				await probe('/api/v1/reaction-images/00000000000000000000000000000000', {
					headers: { 'cf-connecting-ip': '203.0.113.7' },
				}),
			);

			return rows;
		});

		const header = ['#', 'エンドポイント', '入力 / 条件', 'status', 'error', 'Retry-After'];
		const table = [header, header.map(() => '---'), ...rows]
			.map((row) => `| ${row.join(' | ')} |`)
			.join('\n');
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
