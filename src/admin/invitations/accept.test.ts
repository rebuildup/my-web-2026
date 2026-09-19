import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';

/**
 * Integration tests for the invitation row lifecycle.
 *
 * These tests focus on the D1 schema and the operations that read /
 * write `auth_invitation` rows. The actual server-function flow
 * (good / bad / expired / consumed → user created / session set)
 * is covered by `accept-flow.test.ts` in this directory.
 *
 * Schema setup: `test/setup/better-auth-schema.ts` (registered via
 * `setupFiles` in `vitest.config.ts`) applies the canonical schema
 * once per test file. Better Auth eagerly validates its schema at
 * module load and caches the verdict; resetting the schema between
 * tests would force a stale verdict. We instead truncate row data
 * (DELETE FROM) between tests.
 */

async function clearRows(): Promise<void> {
	await env.DB.prepare('DELETE FROM auth_invitation').run();
	await env.DB.prepare('DELETE FROM user').run();
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('auth_invitation schema + operations', () => {
	beforeEach(async () => {
		await clearRows();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('stores token hashes, never plaintext', async () => {
		const tokenHash = await sha256Hex('plaintext-token-1234567890');
		await env.DB.prepare(
			'INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
		)
			.bind('inv-hash', 'h@test.local', tokenHash, 'admin-id', Date.now() + 60_000, Date.now())
			.run();

		const row = await env.DB.prepare('SELECT token_hash FROM auth_invitation WHERE id = ?')
			.bind('inv-hash')
			.first<{ token_hash: string }>();
		expect(row?.token_hash).toBe(tokenHash);
		// Plaintext is NOT stored.
		expect(row?.token_hash).not.toContain('plaintext-token');
	});

	it('refuses second accept via consumed_at + UNIQUE consistency', async () => {
		const tokenHash = await sha256Hex('once-token-1234567890');
		const now = Date.now();
		await env.DB.prepare(
			'INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
		)
			.bind('inv-once', 'once@test.local', tokenHash, 'admin-id', now + 60_000, now)
			.run();

		// First UPDATE succeeds.
		const first = await env.DB.prepare(
			'UPDATE auth_invitation SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
		)
			.bind(now, 'inv-once')
			.run();
		expect(first.meta?.changes).toBe(1);

		// Second UPDATE finds no row to mark.
		const second = await env.DB.prepare(
			'UPDATE auth_invitation SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
		)
			.bind(now, 'inv-once')
			.run();
		expect(second.meta?.changes).toBe(0);
	});

	it('distinguishes expired from active invitations via expires_at', async () => {
		const past = Date.now() - 1000;
		const future = Date.now() + 60_000;
		const tokenHashPast = await sha256Hex('past-token-1234567890');
		const tokenHashFuture = await sha256Hex('future-token-1234567890');

		await env.DB.prepare(
			'INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
		)
			.bind('inv-past', 'p@test.local', tokenHashPast, 'admin-id', past, past)
			.run();
		await env.DB.prepare(
			'INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
		)
			.bind('inv-future', 'f@test.local', tokenHashFuture, 'admin-id', future, future)
			.run();

		const now = Date.now();
		const expired = await env.DB.prepare(
			'SELECT id FROM auth_invitation WHERE expires_at <= ? AND consumed_at IS NULL',
		)
			.bind(now)
			.all<{ id: string }>();
		const ids = (expired.results ?? []).map((r) => r.id);
		expect(ids).toContain('inv-past');
		expect(ids).not.toContain('inv-future');
	});

	it('revokes an unconsumed invitation via DELETE', async () => {
		const tokenHash = await sha256Hex('revoke-token-1234567890');
		const now = Date.now();
		await env.DB.prepare(
			'INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
		)
			.bind('inv-rev', 'r@test.local', tokenHash, 'admin-id', now + 60_000, now)
			.run();

		const result = await env.DB.prepare(
			'DELETE FROM auth_invitation WHERE id = ? AND consumed_at IS NULL',
		)
			.bind('inv-rev')
			.run();
		expect(result.meta?.changes).toBe(1);
	});

	it('refuses to revoke an already-consumed invitation', async () => {
		const tokenHash = await sha256Hex('consumed-token-1234567890');
		const now = Date.now();
		await env.DB.prepare(
			'INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
		)
			.bind('inv-c', 'c@test.local', tokenHash, 'admin-id', now + 60_000, now, now)
			.run();

		const result = await env.DB.prepare(
			'DELETE FROM auth_invitation WHERE id = ? AND consumed_at IS NULL',
		)
			.bind('inv-c')
			.run();
		expect(result.meta?.changes).toBe(0);
	});
});
