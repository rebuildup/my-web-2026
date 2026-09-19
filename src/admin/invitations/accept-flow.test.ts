import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { acceptInvitationImpl, probeInvitationImpl } from './accept';
import { auth } from '../../cloudflare/auth/better-auth';

/**
 * Acceptance flow tests for the invitation accept server function.
 *
 * Issue #33 requires automated acceptance for:
 *
 *   - good / bad / expired / consumed tokens
 *   - user created in the `user` table
 *   - session set on subsequent sign-in
 *
 * The existing `accept.test.ts` covers the `auth_invitation` row
 * lifecycle (token-hash storage, consumed_at gating, expires_at
 * gating, DELETE) at the D1 layer. This sibling covers the full
 * server-fn path: the inner handler is extracted from the
 * `createServerFn` wrapper so the AsyncLocalStorage context that
 * TanStack Start expects is not required.
 *
 * Schema setup: `test/setup/better-auth-schema.ts` (registered via
 * `setupFiles` in `vitest.config.ts`) applies the canonical Better
 * Auth + auth_invitation schema once per test file, before the auth
 * module is imported. Better Auth eagerly validates its schema at
 * module load and caches the verdict; resetting the schema between
 * tests would force a stale verdict. We instead truncate row data
 * (DELETE FROM) between tests, which keeps the cached schema verdict
 * valid for the duration of the test file.
 */

async function clearRows(): Promise<void> {
	for (const table of ['session', 'account', 'verification', 'apikey', 'auth_invitation', 'user']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface InsertInvitationInput {
	id: string;
	email: string;
	token: string;
	invitedBy: string;
	expiresAt: number;
	consumedAt?: number | null;
}

async function insertInvitation(input: InsertInvitationInput): Promise<string> {
	const tokenHash = await sha256Hex(input.token);
	await env.DB.prepare(
		`INSERT INTO auth_invitation
			(id, email, token_hash, invited_by, expires_at, consumed_at, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			input.id,
			input.email,
			tokenHash,
			input.invitedBy,
			input.expiresAt,
			input.consumedAt ?? null,
			Date.now(),
		)
		.run();
	return tokenHash;
}

describe('acceptInvitation — token lifecycle', () => {
	beforeEach(async () => {
		await clearRows();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('good token: creates the user, marks the invitation consumed', async () => {
		const token = 'good-token-aaaaaaaaaaaaaaaaaaaa';
		await insertInvitation({
			id: 'inv-good',
			email: 'good@test.local',
			token,
			invitedBy: 'admin-id',
			expiresAt: Date.now() + 60_000,
		});

		const result = await acceptInvitationImpl({
			token,
			name: 'Good Person',
			password: 'correct-horse-battery-staple',
		});

		expect(result.ok).toBe(true);
		expect(result.user?.email).toBe('good@test.local');
		expect(result.user?.name).toBe('Good Person');
		expect(result.failure).toBeUndefined();

		// User row exists with the admin plugin's default role = 'user'.
		const user = await env.DB.prepare('SELECT id, email, name, role FROM user WHERE email = ?')
			.bind('good@test.local')
			.first<{ id: string; email: string; name: string; role: string | null }>();
		expect(user).not.toBeNull();
		expect(user?.email).toBe('good@test.local');
		expect(user?.role).toBe('user');

		// Invitation row is marked consumed.
		const invitation = await env.DB.prepare('SELECT consumed_at FROM auth_invitation WHERE id = ?')
			.bind('inv-good')
			.first<{ consumed_at: number | null }>();
		expect(invitation?.consumed_at).not.toBeNull();
	});

	it('bad token: returns token_invalid and does not create a user', async () => {
		const result = await acceptInvitationImpl({
			token: 'no-such-token-aaaaaaaaaaaaaaaa',
			name: 'Should Not Exist',
			password: 'correct-horse-battery-staple',
		});

		expect(result.ok).toBe(false);
		expect(result.failure).toBe('token_invalid');

		const userCount = await env.DB.prepare('SELECT COUNT(*) as c FROM user').first<{ c: number }>();
		expect(userCount?.c).toBe(0);
	});

	it('expired token: returns token_expired and does not create a user', async () => {
		const token = 'expired-token-aaaaaaaaaaaaaaaa';
		await insertInvitation({
			id: 'inv-expired',
			email: 'expired@test.local',
			token,
			invitedBy: 'admin-id',
			expiresAt: Date.now() - 1000, // already past
		});

		const result = await acceptInvitationImpl({
			token,
			name: 'Expired Person',
			password: 'correct-horse-battery-staple',
		});

		expect(result.ok).toBe(false);
		expect(result.failure).toBe('token_expired');

		const userCount = await env.DB.prepare('SELECT COUNT(*) as c FROM user').first<{ c: number }>();
		expect(userCount?.c).toBe(0);
	});

	it('consumed token: returns token_consumed on second accept', async () => {
		const token = 'consumed-token-aaaaaaaaaaaaaaa';
		await insertInvitation({
			id: 'inv-consumed',
			email: 'consumed@test.local',
			token,
			invitedBy: 'admin-id',
			expiresAt: Date.now() + 60_000,
		});

		const first = await acceptInvitationImpl({
			token,
			name: 'First Person',
			password: 'correct-horse-battery-staple',
		});
		expect(first.ok).toBe(true);

		const second = await acceptInvitationImpl({
			token,
			name: 'Second Person',
			password: 'different-horse-battery-staple',
		});
		expect(second.ok).toBe(false);
		expect(second.failure).toBe('token_consumed');

		// Only one user row was created from this email.
		const users = await env.DB.prepare('SELECT email FROM user WHERE email = ?')
			.bind('consumed@test.local')
			.all<{ email: string }>();
		expect(users.results ?? []).toHaveLength(1);
	});

	it('session is set: subsequent sign-in via Better Auth returns a session cookie', async () => {
		const token = 'session-token-aaaaaaaaaaaaaaaaaa';
		const email = 'signin@test.local';
		const password = 'correct-horse-battery-staple';
		await insertInvitation({
			id: 'inv-signin',
			email,
			token,
			invitedBy: 'admin-id',
			expiresAt: Date.now() + 60_000,
		});

		const accept = await acceptInvitationImpl({
			token,
			name: 'Signin Person',
			password,
		});
		expect(accept.ok).toBe(true);

		// Sign in through the same Better Auth endpoint the AcceptForm
		// uses after `acceptInvitationImpl` returns. The HTTP boundary
		// (SELF.fetch) goes through the real Hono router + auth.handler.
		const res = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
		});
		expect(res.status).toBe(200);
		const setCookie = res.headers.get('set-cookie') ?? '';
		expect(setCookie).toMatch(/better-auth\.session_token=/);
	});

	it('probeInvitationImpl distinguishes valid / expired / consumed / unknown', async () => {
		const goodToken = 'probe-good-aaaaaaaaaaaaaaaaaaa';
		const expiredToken = 'probe-expired-aaaaaaaaaaaaaaa';
		const consumedToken = 'probe-consumed-aaaaaaaaaaaaaaa';
		await insertInvitation({
			id: 'inv-pg',
			email: 'pg@test.local',
			token: goodToken,
			invitedBy: 'admin-id',
			expiresAt: Date.now() + 60_000,
		});
		await insertInvitation({
			id: 'inv-pe',
			email: 'pe@test.local',
			token: expiredToken,
			invitedBy: 'admin-id',
			expiresAt: Date.now() - 1000,
		});
		await insertInvitation({
			id: 'inv-pc',
			email: 'pc@test.local',
			token: consumedToken,
			invitedBy: 'admin-id',
			expiresAt: Date.now() + 60_000,
			consumedAt: Date.now() - 5000,
		});

		expect(await probeInvitationImpl({ token: goodToken })).toEqual({
			found: true,
			email: 'pg@test.local',
		});
		expect(await probeInvitationImpl({ token: expiredToken })).toEqual({
			found: true,
			email: 'pe@test.local',
			expired: true,
		});
		expect(await probeInvitationImpl({ token: consumedToken })).toEqual({
			found: true,
			email: 'pc@test.local',
			consumed: true,
		});
		expect(await probeInvitationImpl({ token: 'no-such-aaaaaaaaaaaaaaaaaaa' })).toEqual({
			found: false,
		});
	});

	it('email-already-exists: refuses accept when a user with the same email exists', async () => {
		const token = 'taken-token-aaaaaaaaaaaaaaaaaaa';
		await insertInvitation({
			id: 'inv-taken',
			email: 'taken@test.local',
			token,
			invitedBy: 'admin-id',
			expiresAt: Date.now() + 60_000,
		});
		// Bootstrap a user via Better Auth admin plugin's direct API
		// (mirrors the CLI create-admin pattern documented in ADR-0009 §4).
		await auth.api.createUser({
			body: {
				email: 'taken@test.local',
				password: 'existing-password-12345',
				name: 'Already Here',
				role: 'user',
			},
		});

		const result = await acceptInvitationImpl({
			token,
			name: 'Should Not Win',
			password: 'correct-horse-battery-staple',
		});
		expect(result.ok).toBe(false);
		expect(result.failure).toBe('email_taken');

		// Invitation was NOT consumed because we refused the accept.
		const invitation = await env.DB.prepare('SELECT consumed_at FROM auth_invitation WHERE id = ?')
			.bind('inv-taken')
			.first<{ consumed_at: number | null }>();
		expect(invitation?.consumed_at).toBeNull();
	});
});
