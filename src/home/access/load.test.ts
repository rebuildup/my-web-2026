import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '../../../test/helpers/better-auth';
import { getHomeCounterImpl, recordHomeHitImpl } from './load';

/**
 * Home → access counter integration tests (Ticket F, branch 38).
 *
 * Coverage:
 *   1. `getHomeCounterImpl` short-circuits when the consumer API
 *      key is missing.
 *   2. `recordHomeHitImpl` POSTs through to `/api/v1/access/hit`
 *      end-to-end via `SELF.fetch`; a second POST with the same
 *      `session_id` does not increment again (dedup window).
 *   3. `recordHomeHitImpl` with a different `session_id` increments.
 *   4. `getHomeCounterImpl` returns the live count after the hits.
 *   5. `getHomeCounterImpl` accepts an injected fetcher (DI seam).
 */

const ACCESS_COUNTER_SQL = `
CREATE TABLE IF NOT EXISTS access_counters (
    key        TEXT PRIMARY KEY,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_dedup (
    counter_key TEXT    NOT NULL,
    principal   TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (counter_key, principal, session_id)
);
CREATE INDEX IF NOT EXISTS idx_access_dedup_expires
    ON access_dedup(expires_at);
`;

async function ensureSchema(): Promise<void> {
	for (const stmt of ACCESS_COUNTER_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await env.DB.prepare(stmt).run();
	}
}

async function clearRows(): Promise<void> {
	for (const table of [
		'access_counters',
		'access_dedup',
		'apikey',
		'user',
		'session',
		'account',
		'verification',
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
		body: { email: input.email, password: input.password, name: input.name, role: 'admin' },
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

async function issueConsumerApiKey(referenceId: string): Promise<string> {
	const created = (await auth.api.createApiKey({
		body: {
			name: 'home-self-consumption',
			userId: referenceId,
			prefix: 'mk_home_',
			permissions: { access_counter: ['read', 'write'] },
		},
	})) as { id: string; key: string };
	if (!created.key) throw new Error('createApiKey did not return a plaintext key');
	return created.key;
}

describe('home access counter — server-fn impls', () => {
	const selfFetch: typeof fetch = ((input, init) =>
		SELF.fetch(
			typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
			init,
		)) as typeof fetch;

	beforeEach(async () => {
		await ensureSchema();
		await clearRows();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('getHomeCounterImpl returns enabled=false when the consumer API key is not configured', async () => {
		const result = await getHomeCounterImpl({}, { host: 'example.com', proto: 'https' }, selfFetch);
		expect(result.enabled).toBe(false);
		expect(result.count).toBe(0);
		expect(result.key).toBe('home-page');
	});

	it('end-to-end: record + read returns the same count', async () => {
		await bootstrapUser({ email: 'admin@test.local', password: 'correct-horse', name: 'Admin' });
		const keyPlaintext = await issueConsumerApiKey(await firstAdminId());

		const envLike = {
			MY_WEB_2026_CONSUMER_API_KEY: keyPlaintext,
			MY_WEB_2026_COUNTER_KEY: 'home-page',
		};
		const ctx = { host: 'example.com', proto: 'https' };

		const r1 = await recordHomeHitImpl(envLike, ctx, { session_id: 's1' }, selfFetch);
		expect(r1.ok).toBe(true);
		const r2 = await recordHomeHitImpl(envLike, ctx, { session_id: 's2' }, selfFetch);
		expect(r2.ok).toBe(true);

		const counter = await getHomeCounterImpl(envLike, ctx, selfFetch);
		expect(counter.enabled).toBe(true);
		expect(counter.count).toBe(2);
		expect(counter.key).toBe('home-page');
		expect(counter.first_hit).not.toBeNull();
		expect(counter.last_hit).not.toBeNull();
	});

	it('recordHomeHitImpl: same session_id inside the dedup window does not double-count', async () => {
		await bootstrapUser({ email: 'admin@test.local', password: 'correct-horse', name: 'Admin' });
		const keyPlaintext = await issueConsumerApiKey(await firstAdminId());

		const envLike = {
			MY_WEB_2026_CONSUMER_API_KEY: keyPlaintext,
			MY_WEB_2026_COUNTER_KEY: 'home-page',
		};
		const ctx = { host: 'example.com', proto: 'https' };

		await recordHomeHitImpl(envLike, ctx, { session_id: 's1' }, selfFetch);
		await recordHomeHitImpl(envLike, ctx, { session_id: 's1' }, selfFetch);

		const counter = await getHomeCounterImpl(envLike, ctx, selfFetch);
		expect(counter.count).toBe(1);
	});

	it('recordHomeHitImpl: missing API key short-circuits with reason=api_key_unconfigured', async () => {
		const result = await recordHomeHitImpl(
			{},
			{ host: 'example.com', proto: 'https' },
			{ session_id: 's1' },
			vi.fn() as unknown as typeof fetch,
		);
		expect(result).toEqual({ ok: false, reason: 'api_key_unconfigured' });
	});

	it('getHomeCounterImpl: uses an injected fetcher (no SELF.fetch)', async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ count: 42, first_hit: 1, last_hit: 2 }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		const result = await getHomeCounterImpl(
			{ MY_WEB_2026_CONSUMER_API_KEY: 'mk_home_x' },
			{ host: 'example.com', proto: 'https' },
			fetcher as unknown as typeof fetch,
		);
		expect(result.enabled).toBe(true);
		expect(result.count).toBe(42);
		expect(result.first_hit).toBe(1);
		expect(result.last_hit).toBe(2);
		expect(fetcher).toHaveBeenCalledOnce();
	});
});
