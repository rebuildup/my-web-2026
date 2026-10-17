/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminSession } from '../../src/admin/auth/load';
import {
	STEP_UP_MAX_AGE_MS,
	StepUpError,
	assertStepUpGranted,
	confirmStepUpImpl,
	evaluateStepUp,
	readStepUpGrant,
} from '../../src/admin/auth/step-up';
import { createApiKeyImpl } from '../../src/admin/keys/load';
import { auth } from '../../src/cloudflare/auth/better-auth';

/**
 * Step-up re-authentication gate — end-to-end contract (Issue #445).
 *
 * This is the positive / negative pair the Issue asks for, executed
 * against the REAL pieces rather than mocks: the local workerd pool
 * (`SELF.fetch` for the sign-in and the boundary request), the real
 * D1 binding, the real Better Auth instance and its password
 * verification, and the real gate `assertStepUpGranted` that
 * `createApiKey` calls in production.
 *
 * Cases
 * -----
 *   negative  a session that never confirmed is refused by the gate
 *             (`step_up_required`) and no grant row exists.
 *   negative  a confirmation with the wrong password is refused
 *             (`step_up_rejected`), writes NOTHING, and leaves the
 *             gate refusing.
 *   positive  a confirmation with the correct password opens the
 *             window, the gate admits, and the gated operation
 *             (API key creation) persists its row.
 *   boundary  over HTTP, `/api/v1/auth/verify-password` — the endpoint
 *             the gate delegates to — answers 400 `INVALID_PASSWORD`
 *             vs 200 `{ status: true }`, so "denied" is distinguishable
 *             from "wrong request" at the boundary too.
 *
 * Hygiene this suite asserts
 * --------------------------
 *   - nothing is logged, asserted, or returned that carries the
 *     submitted password, the session token, or the account email
 *     (assertions are on status / reason / code only);
 *   - the grant row holds a session id, a user id and a timestamp —
 *     no credential material — so a read-only inspection can answer
 *     "is this session confirmed?" without handling a secret;
 *   - a revoked session loses its grant, because the row belongs to
 *     the session and not to the account.
 *
 * Fixture account: role `admin`, local D1 only. The project defines no
 * other roles (ADR-0009 §1), so no permission is invented here, and no
 * production account, credential, or database is touched.
 */

const FIXTURE_EMAIL = 'stepup-admin@test.local';
const FIXTURE_PASSWORD = 'fixture-only-not-a-real-credential';

async function ensureSchema(): Promise<void> {
	// Mirrors `migrations/0008_admin_step_up.sql`. The canonical setup
	// file (`test/setup/better-auth-schema.ts`) normally applies this
	// before any suite loads; repeating it with IF NOT EXISTS keeps this
	// file self-contained the way `src/admin/keys/load.test.ts` is.
	for (const stmt of [
		`CREATE TABLE IF NOT EXISTS admin_step_up_grant (
			session_id TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
			user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
			confirmed_at INTEGER NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_admin_step_up_grant_user
			ON admin_step_up_grant(user_id, confirmed_at)`,
	]) {
		await env.DB.prepare(stmt).run();
	}
}

async function clearRows(): Promise<void> {
	await env.DB.prepare('DELETE FROM admin_step_up_grant').run();
	for (const table of ['session', 'account', 'verification', 'apikey', 'user']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

async function bootstrapAdmin(): Promise<void> {
	await auth.api.createUser({
		body: {
			email: FIXTURE_EMAIL,
			password: FIXTURE_PASSWORD,
			name: 'Step-up Admin',
			role: 'admin',
		},
	});
}

/**
 * Sign in through the Worker entrypoint and resolve the session the way
 * the server functions do (`getCurrentHeaders` → Better Auth). Only the
 * cookie value is passed around; it is never printed or asserted on.
 */
async function signInAsAdmin(): Promise<{ headers: Headers; session: AdminSession }> {
	const res = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: FIXTURE_EMAIL, password: FIXTURE_PASSWORD }),
	});
	if (res.status !== 200) throw new Error(`fixture sign-in failed: ${res.status}`);
	const cookie = (res.headers.get('set-cookie') ?? '').match(
		/better-auth\.session_token=([^;]+)/,
	)?.[1];
	if (!cookie) throw new Error('fixture sign-in returned no session cookie');
	const headers = new Headers({ Cookie: `better-auth.session_token=${cookie}` });

	const sessionRes = await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers });
	if (sessionRes.status !== 200) throw new Error(`get-session failed: ${sessionRes.status}`);
	const body = (await sessionRes.json()) as {
		user: { id: string; email: string; name: string; role: string | null };
		session: { id: string; expiresAt: string };
	};
	return {
		headers,
		session: {
			user: {
				id: body.user.id,
				email: body.user.email,
				name: body.user.name,
				role: body.user.role,
			},
			session: { id: body.session.id, expiresAt: new Date(body.session.expiresAt) },
		},
	};
}

/** Read-only inspection of the grant table (no credential material). */
async function readGrantRows(): Promise<
	Array<{ session_id: string; user_id: string; confirmed_at: number }>
> {
	const rows = await env.DB.prepare(
		'SELECT session_id, user_id, confirmed_at FROM admin_step_up_grant',
	).all<{ session_id: string; user_id: string; confirmed_at: number }>();
	return rows.results ?? [];
}

describe('step-up gate (Issue #445)', () => {
	beforeEach(async () => {
		await ensureSchema();
		await clearRows();
		await bootstrapAdmin();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('negative: an unconfirmed session cannot pass the gate API-key creation calls', async () => {
		const { session } = await signInAsAdmin();

		// The gate every gated server function calls. Nothing was
		// confirmed, so the operation is refused BEFORE it can mint a
		// key — and the refusal names the missing step, not the account.
		await expect(assertStepUpGranted(env.DB, session)).rejects.toMatchObject({
			name: 'StepUpError',
			reason: 'step_up_required',
		});

		// No key row exists: the refusal happened at the gate, not after.
		const keys = await env.DB.prepare('SELECT COUNT(*) AS c FROM apikey').first<{ c: number }>();
		expect(keys?.c).toBe(0);

		// And nothing about the refusal was recorded.
		expect(await readGrantRows()).toEqual([]);
	});

	it('negative: a wrong password is rejected and leaves the gate closed', async () => {
		const { headers, session } = await signInAsAdmin();

		await expect(
			confirmStepUpImpl(session, headers, { password: 'wrong-password-fixture' }),
		).rejects.toMatchObject({ name: 'StepUpError', reason: 'step_up_rejected' });

		// A rejected attempt writes nothing, so a retry cannot inherit
		// a half-written grant.
		expect(await readGrantRows()).toEqual([]);
		await expect(assertStepUpGranted(env.DB, session)).rejects.toMatchObject({
			reason: 'step_up_required',
		});
	});

	it('positive: the correct password opens the window and the gated operation runs', async () => {
		const { headers, session } = await signInAsAdmin();

		const status = await confirmStepUpImpl(session, headers, { password: FIXTURE_PASSWORD });
		expect(status.state).toBe('confirmed');
		expect(status.confirmedAtMs).toBeGreaterThan(0);
		expect(status.expiresAtMs).toBe((status.confirmedAtMs ?? 0) + STEP_UP_MAX_AGE_MS);

		// The gate admits, and reports how much of the window is left —
		// a duration, never a credential.
		const granted = await assertStepUpGranted(env.DB, session);
		expect(granted.state).toBe('confirmed');
		expect(granted.expiresAtMs).toBe(status.expiresAtMs);

		// Read-only inspection: the row identifies session + user and a
		// timestamp. A database reader can answer "is this session
		// confirmed?" without seeing anything sensitive.
		const rows = await readGrantRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.session_id).toBe(session.session.id);
		expect(rows[0]?.user_id).toBe(session.user.id);
		expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['confirmed_at', 'session_id', 'user_id']);

		// The gated operation itself: `createApiKey` runs
		// `assertStepUpGranted` and then this impl, so exercising the
		// impl with a granted session is the post-gate half of the
		// production path.
		const created = await createApiKeyImpl(session, headers, {
			name: 'step-up-fixture-key',
			permissions: { access_counter: ['write'] },
		});
		expect(created.key.name).toBe('step-up-fixture-key');
		const persisted = await env.DB.prepare('SELECT COUNT(*) AS c FROM apikey').first<{
			c: number;
		}>();
		expect(persisted?.c).toBe(1);
	});

	it('the window lapses: a confirmation older than the step-up age is refused again', async () => {
		const { session } = await signInAsAdmin();
		const confirmedAtMs = Date.now();
		await env.DB.prepare(
			`INSERT INTO admin_step_up_grant (session_id, user_id, confirmed_at)
			 VALUES (?, ?, ?)`,
		)
			.bind(session.session.id, session.user.id, confirmedAtMs)
			.run();

		// The same row, read at the moment the window closes: `expired`
		// is what the UI shows, `step_up_required` is what the gate
		// throws. The two must not collapse into one another.
		const status = await readStepUpGrant(env.DB, session.session.id);
		expect(
			evaluateStepUp(status?.confirmedAtMs ?? null, confirmedAtMs + STEP_UP_MAX_AGE_MS).state,
		).toBe('expired');
		await expect(
			assertStepUpGranted(env.DB, session, confirmedAtMs + STEP_UP_MAX_AGE_MS),
		).rejects.toMatchObject({ reason: 'step_up_required' });
	});

	it('boundary: Better Auth answers the confirmation endpoint differently per outcome', async () => {
		const { headers } = await signInAsAdmin();
		// `Origin` is required by Better Auth's own origin check on every
		// POST (`MISSING_OR_NULL_ORIGIN` otherwise) and a browser sends it
		// on a same-origin fetch, so the fixture reproduces that.
		const post = (body: { password: string }) =>
			SELF.fetch('https://example.com/api/v1/auth/verify-password', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Origin: 'https://example.com',
					Cookie: headers.get('Cookie') ?? '',
				},
				body: JSON.stringify(body),
			});

		const denied = await post({ password: 'wrong-password-fixture' });
		expect(denied.status).toBe(400);
		expect(await denied.json()).toMatchObject({ code: 'INVALID_PASSWORD' });

		const allowed = await post({ password: FIXTURE_PASSWORD });
		expect(allowed.status).toBe(200);
		expect(await allowed.json()).toEqual({ status: true });
	});

	it('a revoked session loses its grant, so a stale row cannot authorise anything', async () => {
		const { headers, session } = await signInAsAdmin();
		await confirmStepUpImpl(session, headers, { password: FIXTURE_PASSWORD });
		expect(await readGrantRows()).toHaveLength(1);

		// Revoke every session for the fixture account (no token is
		// handled here — the point of the case is the session, not the
		// credential).
		await auth.api.revokeSessions({ headers });

		// The session no longer authenticates, so its grant is both
		// unreachable and (via the session cascade) gone.
		const after = await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers });
		expect(after.status).toBe(200);
		expect(await after.json()).toBeNull();
		expect(await readGrantRows()).toEqual([]);
	});

	it('StepUpError reasons stay distinct so the UI can tell them apart', () => {
		expect(new StepUpError('step_up_required').reason).toBe('step_up_required');
		expect(new StepUpError('step_up_rejected').reason).toBe('step_up_rejected');
	});
});
