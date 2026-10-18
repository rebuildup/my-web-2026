import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
	STEP_UP_MAX_AGE_MS,
	STEP_UP_MAX_AGE_SECONDS,
	StepUpError,
	assertStepUpGranted,
	evaluateStepUp,
	lapseStepUpStatus,
	readStepUpGrant,
	readStepUpStatus,
	writeStepUpGrant,
} from './step-up';

/**
 * Step-up gate unit coverage (Issue #445).
 *
 * Scope here is the parts that need no Better Auth session: the
 * freshness decision and the D1 grant round-trip. The credential
 * verification itself (positive / negative confirmation against a real
 * signed-in session) lives in
 * `test/integration/admin-step-up-auth.test.ts`, which owns the
 * contract for the whole gate.
 *
 * No credential, token, or account email appears in this file.
 */
const SESSION_ID = 'session-stepup-unit-fixture';
const USER_ID = 'user-stepup-unit-fixture';
const SESSION_TOKEN = 'token-stepup-unit-fixture';

/**
 * The grant row carries `REFERENCES session(id)` / `user(id)`, so a unit
 * test that writes one needs the rows it points at. These are local D1
 * rows inside the workerd pool; no credential material is involved (the
 * password column stays NULL because nothing here hashes one).
 */
async function seedSession(): Promise<void> {
	await env.DB.prepare(
		`INSERT OR REPLACE INTO user (id, name, email, emailVerified, createdAt, updatedAt, role)
		 VALUES (?, ?, ?, 1, ?, ?, 'admin')`,
	)
		.bind(USER_ID, 'Step-up Unit', 'stepup-unit@test.local', 1, 1)
		.run();
	await env.DB.prepare(
		`INSERT OR REPLACE INTO session (id, userId, token, expiresAt, createdAt, updatedAt)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(SESSION_ID, USER_ID, SESSION_TOKEN, 4_102_444_800_000, 1, 1)
		.run();
}

async function clearGrants(): Promise<void> {
	await env.DB.prepare('DELETE FROM admin_step_up_grant').run();
	await env.DB.prepare('DELETE FROM session WHERE id = ?').bind(SESSION_ID).run();
	await env.DB.prepare('DELETE FROM user WHERE id = ?').bind(USER_ID).run();
}

describe('evaluateStepUp — the freshness decision', () => {
	it('no confirmation is `required` with no window to render', () => {
		expect(evaluateStepUp(null, 1_000)).toEqual({
			state: 'required',
			confirmedAtMs: null,
			expiresAtMs: null,
		});
	});

	it('a confirmation inside the window is `confirmed` and reports when it lapses', () => {
		const now = 10_000_000;
		const status = evaluateStepUp(now - 1_000, now);
		expect(status.state).toBe('confirmed');
		expect(status.confirmedAtMs).toBe(now - 1_000);
		expect(status.expiresAtMs).toBe(now - 1_000 + STEP_UP_MAX_AGE_MS);
	});

	it('a confirmation at the exact boundary is already `expired`', () => {
		const now = 10_000_000;
		expect(evaluateStepUp(now - STEP_UP_MAX_AGE_MS, now).state).toBe('expired');
		// One millisecond earlier is still inside the window.
		expect(evaluateStepUp(now - STEP_UP_MAX_AGE_MS + 1, now).state).toBe('confirmed');
	});

	it('the window is five minutes and is not redefined by the UI', () => {
		expect(STEP_UP_MAX_AGE_MS).toBe(300_000);
		expect(STEP_UP_MAX_AGE_SECONDS).toBe(300);
	});
});

/**
 * The client-side lapse. A tab left open across the end of the window
 * has no request to make, so this is what turns the panel's `confirmed`
 * badge into `expired` without waiting for a refused create — the same
 * thing the server would have said for that grant.
 */
describe('lapseStepUpStatus — what a client adopts when its clock passes the window', () => {
	const confirmedAtMs = 10_000_000;
	const confirmed = evaluateStepUp(confirmedAtMs, confirmedAtMs + 1_000);
	const expiresAtMs = confirmedAtMs + STEP_UP_MAX_AGE_MS;

	it('reports nothing while the window is still open', () => {
		expect(lapseStepUpStatus(confirmed, confirmedAtMs)).toBeNull();
		expect(lapseStepUpStatus(confirmed, expiresAtMs - 1)).toBeNull();
	});

	it('reports the lapsed status at the boundary, keeping both timestamps', () => {
		expect(lapseStepUpStatus(confirmed, expiresAtMs)).toEqual({
			state: 'expired',
			confirmedAtMs,
			expiresAtMs,
		});
		expect(lapseStepUpStatus(confirmed, expiresAtMs + 90_000)?.state).toBe('expired');
	});

	it('agrees with the server on the same grant and clock', () => {
		// The client is not inventing a rule here: whatever it adopts is
		// exactly what `readStepUpStatus` reports for the stored grant.
		expect(lapseStepUpStatus(confirmed, expiresAtMs + 1)).toEqual(
			evaluateStepUp(confirmedAtMs, expiresAtMs + 1),
		);
	});

	it('has nothing to report for a status that has no open window', () => {
		expect(
			lapseStepUpStatus({ state: 'required', confirmedAtMs: null, expiresAtMs: null }, 1),
		).toBeNull();
		expect(
			lapseStepUpStatus({ state: 'expired', confirmedAtMs, expiresAtMs }, expiresAtMs),
		).toBeNull();
		// Defensive: a `confirmed` status without an expiry cannot be
		// compared against a clock, so it does not lapse on a guess.
		expect(
			lapseStepUpStatus({ state: 'confirmed', confirmedAtMs, expiresAtMs: null }, expiresAtMs),
		).toBeNull();
	});
});

describe('admin_step_up_grant — D1 round-trip', () => {
	it('write then read returns the stored confirmation for that session', async () => {
		await seedSession();
		await writeStepUpGrant(env.DB, {
			sessionId: SESSION_ID,
			userId: USER_ID,
			confirmedAtMs: 1_700_000_000_000,
		});
		const grant = await readStepUpGrant(env.DB, SESSION_ID);
		expect(grant).toEqual({
			sessionId: SESSION_ID,
			userId: USER_ID,
			confirmedAtMs: 1_700_000_000_000,
		});
		await clearGrants();
	});

	it('confirming twice refreshes the row instead of duplicating it', async () => {
		await seedSession();
		await writeStepUpGrant(env.DB, {
			sessionId: SESSION_ID,
			userId: USER_ID,
			confirmedAtMs: 1_000,
		});
		await writeStepUpGrant(env.DB, {
			sessionId: SESSION_ID,
			userId: USER_ID,
			confirmedAtMs: 2_000,
		});
		const rows = await env.DB.prepare(
			'SELECT COUNT(*) AS c FROM admin_step_up_grant WHERE session_id = ?',
		)
			.bind(SESSION_ID)
			.first<{ c: number }>();
		expect(rows?.c).toBe(1);
		expect((await readStepUpGrant(env.DB, SESSION_ID))?.confirmedAtMs).toBe(2_000);
		await clearGrants();
	});

	it('an unknown session has no grant, so the gate sees `required`', async () => {
		const status = await readStepUpStatus(env.DB, 'session-never-confirmed', Date.now());
		expect(status.state).toBe('required');
	});

	it('a grant cannot be written for a session that does not exist', async () => {
		// The foreign key is what keeps the table honest: a grant always
		// hangs off a live Better Auth session, so there is no way to
		// leave a row behind for a session that never existed.
		await clearGrants();
		await expect(
			writeStepUpGrant(env.DB, {
				sessionId: 'session-does-not-exist',
				userId: USER_ID,
				confirmedAtMs: 1_000,
			}),
		).rejects.toThrow(/FOREIGN KEY/i);
	});
});

describe('assertStepUpGranted — the gate decision', () => {
	const session = {
		user: { id: USER_ID, email: 'admin@test.local', name: 'Admin', role: 'admin' },
		session: { id: SESSION_ID, expiresAt: new Date('2999-01-01T00:00:00.000Z') },
	};

	it('refuses with `step_up_required` when nothing was confirmed', async () => {
		await seedSession();
		await expect(assertStepUpGranted(env.DB, session)).rejects.toMatchObject({
			name: 'StepUpError',
			reason: 'step_up_required',
		});
	});

	it('refuses with `step_up_required` once the window has lapsed', async () => {
		await seedSession();
		const confirmedAtMs = 5_000_000;
		await writeStepUpGrant(env.DB, { sessionId: SESSION_ID, userId: USER_ID, confirmedAtMs });
		// Same row, evaluated one millisecond past the boundary.
		await expect(
			assertStepUpGranted(env.DB, session, confirmedAtMs + STEP_UP_MAX_AGE_MS),
		).rejects.toMatchObject({ reason: 'step_up_required' });
		await clearGrants();
	});

	it('admits the operation inside the window and reports the remaining time', async () => {
		await seedSession();
		const confirmedAtMs = 5_000_000;
		await writeStepUpGrant(env.DB, { sessionId: SESSION_ID, userId: USER_ID, confirmedAtMs });
		const status = await assertStepUpGranted(env.DB, session, confirmedAtMs + 1_000);
		expect(status.state).toBe('confirmed');
		expect(status.expiresAtMs).toBe(confirmedAtMs + STEP_UP_MAX_AGE_MS);
		await clearGrants();
	});
});

describe('StepUpError', () => {
	it('carries a machine-readable reason and no account detail', () => {
		const required = new StepUpError('step_up_required');
		expect(required.name).toBe('StepUpError');
		expect(required.reason).toBe('step_up_required');
		expect(required.message).toBe('step_up_required');
		expect(new StepUpError('step_up_rejected').reason).toBe('step_up_rejected');
	});
});
