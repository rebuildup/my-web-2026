import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { z } from 'zod';
import { auth } from '../../cloudflare/auth/better-auth';
import type { AdminSession } from './load';
import { requireAdmin } from './require-admin';

/**
 * Step-up re-authentication for high-risk admin operations (Issue #445).
 *
 * Why this exists
 * ---------------
 * A Better Auth session is good enough to *browse* the admin surface
 * (30-day `session.expiresIn`, 24h rolling refresh — ADR-0009 §8). It is
 * not good enough to MINT STANDING AUTHORITY: an API key created at
 * `/admin/keys` keeps `access_counter` / `reactions` write access for
 * as long as the key lives, long after the click that made it. OWASP
 * ASVS V2 puts the same requirement in the open checklist the Issue
 * cites: re-authenticate before a sensitive operation rather than
 * trusting ambient session age.
 *
 * So the gate asks for a *recent* password confirmation (step-up) on
 * the one operation Issue #445 scoped: **API key creation**. The gate
 * is a plain function over a D1 grant row, so the next high-risk
 * operation is gated by calling `assertStepUpGranted` — not by
 * inventing a second mechanism.
 *
 * The three states the Issue requires to stay distinguishable
 * -----------------------------------------------------------
 *
 *   required   no grant, or a grant older than `STEP_UP_MAX_AGE_MS`.
 *              `assertStepUpGranted` throws
 *              `StepUpError('step_up_required')`; the admin UI asks
 *              for the password.
 *   confirmed  a grant inside the window. The gated operation runs.
 *              `getStepUpStatus` reports the remaining window so the
 *              UI can show when it lapses.
 *   rejected   a confirmation attempt whose password Better Auth
 *              refused. `confirmStepUpImpl` throws
 *              `StepUpError('step_up_rejected')` and records NOTHING.
 *
 * Why the grant lives in D1 and not in a cookie
 * ---------------------------------------------
 * A cookie would need a signing key to be unforgeable, and this
 * repository has no signing key that is not a Better Auth secret
 * (ADR-0015 §1 keeps runtime secret ownership with Infisical, and
 * `wrangler.jsonc#secrets.required` declares names only). Minting a
 * new secret is an operator decision this ticket does not get to make.
 * A D1 row keyed by the session id Better Auth already resolved from
 * the request needs no new secret, is inspectable read-only, and cannot
 * be forged by anyone holding only the session cookie: writing a row
 * still requires passing `verifyPassword`.
 *
 * Why `verifyPassword` and not `signInEmail`
 * ------------------------------------------
 * Re-authenticating by signing in again would mint a SECOND session and
 * leave the previous session row valid in D1 — a strictly worse
 * outcome for a confirmation step. Better Auth's own `/verify-password`
 * endpoint is built for this: it runs behind `sensitiveSessionMiddleware`
 * (authoritative session, cookie cache bypassed, so a revoked session
 * fails immediately), compares against the stored hash, and returns
 * `{ status: true }` without touching session state.
 *
 * What is deliberately NOT here
 * -----------------------------
 * No logging of the submitted password, the session token, or the
 * account email. No new role, no new permission, no invented operator
 * preference. Revoking an existing key is deliberately ungated: it
 * removes authority rather than granting it, and Issue #445 scoped one
 * operation.
 */

/**
 * How long one confirmation keeps a session authorised for gated
 * operations. Five minutes is the project's step-up window: long enough
 * to fill in a short form, short enough that a walk-away-from-keyboard
 * attacker does not inherit the window indefinitely.
 *
 * Exported so the admin UI can render "confirm again within N minutes"
 * from the same constant the gate enforces, instead of restating "5" in
 * copy that could drift from the code.
 */
export const STEP_UP_MAX_AGE_MS = 5 * 60 * 1000;

/** The window the grant covers, in seconds, for UI copy / diagnostics. */
export const STEP_UP_MAX_AGE_SECONDS = STEP_UP_MAX_AGE_MS / 1000;

/**
 * Step-up lifecycle, as reported to the UI and asserted by the gate.
 *
 * `expired` is a refinement of `required` for display: the admin DID
 * confirm at some point, and the UI can say so, but the gate treats
 * both as "ask again".
 */
export type StepUpState = 'required' | 'confirmed' | 'expired';

export interface StepUpStatus {
	state: StepUpState;
	/** UNIX ms of the last successful confirmation, or `null` if never. */
	confirmedAtMs: number | null;
	/** UNIX ms at which the current confirmation lapses, or `null`. */
	expiresAtMs: number | null;
}

/** The two things that can be refused, and what the gate must say. */
export type StepUpErrorReason = 'step_up_required' | 'step_up_rejected';

/**
 * Thrown by the gate (`step_up_required`) and by the confirmation
 * (`step_up_rejected`). The message carries nothing about the account.
 *
 * NOTE: `reason` is NOT a wire contract. TanStack Start serialises a
 * thrown `Error` with `ShallowErrorPlugin`, which keeps only `message`
 * and drops own properties, so a client that branched on `err.reason`
 * would see `undefined`. Server functions that must be branched on
 * therefore translate the throw into a returned outcome —
 * `confirmStepUpOutcome` below.
 */
export class StepUpError extends Error {
	constructor(public reason: StepUpErrorReason) {
		super(reason);
		this.name = 'StepUpError';
	}
}

/**
 * Freshness decision, as a pure function of the stored timestamp.
 *
 * `nowMs` and `maxAgeMs` are parameters rather than `Date.now()`
 * reads so the window is testable at its boundary without sleeping, and
 * so no caller can accidentally evaluate freshness against a clock it
 * invented.
 */
export function evaluateStepUp(
	confirmedAtMs: number | null,
	nowMs: number,
	maxAgeMs: number = STEP_UP_MAX_AGE_MS,
): StepUpStatus {
	if (confirmedAtMs === null) {
		return { state: 'required', confirmedAtMs: null, expiresAtMs: null };
	}
	const expiresAtMs = confirmedAtMs + maxAgeMs;
	// `<` so the boundary is spent, not granted: at exactly
	// `confirmedAtMs + maxAgeMs` the window is over.
	const state: StepUpState = nowMs < expiresAtMs ? 'confirmed' : 'expired';
	return { state, confirmedAtMs, expiresAtMs };
}

/**
 * The status a client should adopt once its own clock crosses the
 * window, or `null` while the window is still open.
 *
 * The gate above is only reached when the session actually issues a
 * key, but the UI has to stop claiming a window it no longer has: a tab
 * left open across the boundary would otherwise keep the `confirmed`
 * badge, keep the re-auth form hidden, and keep the create button
 * enabled until someone happened to press it. Nothing here is trusted
 * — `lapseStepUpStatus` re-evaluates through `evaluateStepUp`, so the
 * status it returns is exactly the one the server would have returned
 * for the same grant, and the gate still refuses the click that
 * follows. It exists so the countdown and the badge cannot disagree
 * about when the window ends.
 *
 * Only a status that is currently `confirmed` can lapse: `required`
 * has no window, and `expired` is already the answer.
 */
export function lapseStepUpStatus(status: StepUpStatus, nowMs: number): StepUpStatus | null {
	if (status.state !== 'confirmed' || status.expiresAtMs === null) return null;
	const lapsed = evaluateStepUp(status.confirmedAtMs, nowMs);
	return lapsed.state === 'expired' ? lapsed : null;
}

/**
 * The stored grant. `D1Database` is passed explicitly (not read from
 * `cloudflare:workers` inside these helpers) so the read / write halves
 * are callable against any binding — the workerd pool passes the real
 * one, and no test needs a `vi.mock` of the env module.
 */
export interface StepUpGrant {
	sessionId: string;
	userId: string;
	confirmedAtMs: number;
}

export async function readStepUpGrant(
	db: D1Database,
	sessionId: string,
): Promise<StepUpGrant | null> {
	const row = await db
		.prepare(
			'SELECT session_id, user_id, confirmed_at FROM admin_step_up_grant WHERE session_id = ?',
		)
		.bind(sessionId)
		.first<{ session_id: string; user_id: string; confirmed_at: number }>();
	if (!row) return null;
	return {
		sessionId: row.session_id,
		userId: row.user_id,
		confirmedAtMs: Number(row.confirmed_at),
	};
}

/**
 * Idempotent by `session_id`: confirming again refreshes the window
 * rather than failing on the primary key, so a user who mistypes once
 * and retries lands on a single row.
 */
export async function writeStepUpGrant(db: D1Database, grant: StepUpGrant): Promise<void> {
	await db
		.prepare(
			`INSERT INTO admin_step_up_grant (session_id, user_id, confirmed_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(session_id) DO UPDATE SET
				user_id = excluded.user_id,
				confirmed_at = excluded.confirmed_at`,
		)
		.bind(grant.sessionId, grant.userId, grant.confirmedAtMs)
		.run();
}

/** Current step-up status for a session, without touching credentials. */
export async function readStepUpStatus(
	db: D1Database,
	sessionId: string,
	nowMs: number = Date.now(),
): Promise<StepUpStatus> {
	const grant = await readStepUpGrant(db, sessionId);
	return evaluateStepUp(grant?.confirmedAtMs ?? null, nowMs);
}

/**
 * The gate. Call this immediately after `requireAdmin()` in any server
 * function that grants standing authority.
 *
 * Returns the granted status on success so the caller can log the
 * remaining window (a duration, never a credential) if it wants to.
 */
export async function assertStepUpGranted(
	db: D1Database,
	session: AdminSession,
	nowMs: number = Date.now(),
): Promise<StepUpStatus> {
	const status = await readStepUpStatus(db, session.session.id, nowMs);
	if (status.state !== 'confirmed') {
		throw new StepUpError('step_up_required');
	}
	return status;
}

/**
 * Better Auth's `APIError` shape for a refused password:
 * `APIError('BAD_REQUEST', 'INVALID_PASSWORD')`. Narrowing on it keeps
 * an expired session (UNAUTHORIZED) reported as an expired session
 * instead of being laundered into "wrong password".
 */
function isInvalidPassword(error: unknown): boolean {
	const candidate = error as { status?: unknown; body?: { code?: unknown } } | null;
	return candidate?.status === 'BAD_REQUEST' && candidate.body?.code === 'INVALID_PASSWORD';
}

/**
 * Confirm the admin's password and open the step-up window for THIS
 * session. On a refused password nothing is written and
 * `StepUpError('step_up_rejected')` is thrown; the submitted password is
 * never logged, echoed, or stored.
 */
export async function confirmStepUpImpl(
	db: D1Database,
	session: AdminSession,
	headers: Headers,
	data: { password: string },
	nowMs: number = Date.now(),
): Promise<StepUpStatus> {
	try {
		await auth.api.verifyPassword({ headers, body: { password: data.password } });
	} catch (error) {
		if (isInvalidPassword(error)) {
			throw new StepUpError('step_up_rejected');
		}
		// Anything else (unauthorised session, adapter failure) is not a
		// verdict about the password, so it propagates unchanged rather
		// than being reported as one.
		throw error;
	}
	await writeStepUpGrant(db, {
		sessionId: session.session.id,
		userId: session.user.id,
		confirmedAtMs: nowMs,
	});
	return evaluateStepUp(nowMs, nowMs);
}

const ConfirmStepUpInput = z.object({
	// The cap is an input bound only: `verifyPassword` never sets a
	// password, it compares one. Better Auth refuses to store anything
	// above `emailAndPassword.maxPasswordLength` (128 by default), so
	// this stays wider than any password the project can hold rather
	// than duplicating Better Auth's limit as a second source of
	// truth that could drift.
	password: z.string().min(1).max(256),
});

/**
 * Wire-safe result of the confirmation.
 *
 * A thrown `StepUpError` loses `reason` in transit (see the class
 * comment), so the refusal travels as a returned value. Errors that
 * are NOT a verdict about the password — an expired session, an
 * adapter failure — still throw, because "we could not check" must not
 * be rendered as "wrong password".
 */
export type ConfirmStepUpOutcome =
	| { ok: true; status: StepUpStatus }
	| { ok: false; reason: Extract<StepUpErrorReason, 'step_up_rejected'> };

/**
 * The confirmation as the server function runs it: `confirmStepUpImpl`
 * plus the throw-to-outcome translation, in one function, so the whole
 * production path is callable from a test without TanStack Start's
 * request context.
 */
export async function confirmStepUpOutcome(
	db: D1Database,
	session: AdminSession,
	headers: Headers,
	data: { password: string },
	nowMs: number = Date.now(),
): Promise<ConfirmStepUpOutcome> {
	try {
		return { ok: true, status: await confirmStepUpImpl(db, session, headers, data, nowMs) };
	} catch (error) {
		if (error instanceof StepUpError && error.reason === 'step_up_rejected') {
			return { ok: false, reason: 'step_up_rejected' };
		}
		throw error;
	}
}

/**
 * Read-only status probe for the admin UI. Server-fn wrapper (the
 * obligation that owns the session composes it), so the route never
 * imports the D1 helpers.
 *
 * `D1Database` and `Headers` are passed into the `*Impl` / `*Outcome`
 * helpers rather than read from `cloudflare:workers` inside them, and
 * `getRequestHeaders()` is read in the wrapper rather than in the
 * helper: both are ambient context that exists only inside a server
 * function. Taking them as parameters is what makes the same
 * composition runnable in the workerd pool, where neither ambient
 * value exists. The asymmetry is deliberate, not an oversight.
 */
export const getStepUpStatus = createServerFn({ method: 'GET' }).handler(
	async (): Promise<StepUpStatus> => {
		const session = await requireAdmin();
		return readStepUpStatus(env.DB, session.session.id);
	},
);

/** Password confirmation for the step-up window. */
export const confirmStepUp = createServerFn({ method: 'POST' })
	.validator(ConfirmStepUpInput)
	.handler(async ({ data }): Promise<ConfirmStepUpOutcome> => {
		const session = await requireAdmin();
		return confirmStepUpOutcome(env.DB, session, getRequestHeaders(), data);
	});
