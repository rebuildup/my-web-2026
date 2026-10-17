import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../../src/cloudflare/auth/better-auth';

/**
 * Issue #443 — login enumeration / credential brute-force audit.
 *
 * Both halves of the audit run against the **real** Worker entrypoint
 * (`SELF.fetch` → `src/server.ts` → `externalBoundary` → `authRouter`
 * → `auth.handler`), inside the local workerd pool, against the local
 * Miniflare D1. Nothing here touches a deployed environment, and no
 * credential, cookie value, or personal field is ever printed: the
 * matrix this suite emits carries status codes, Better Auth error codes,
 * and the retry hint only.
 *
 * What it pins down:
 *
 *   1. Enumeration parity — a wrong password on an **existing** account
 *      and an attempt on a **non-existent** account must be
 *      indistinguishable: same status, same body, same header set. The
 *      evidence matrix renders both rows side by side so a regression
 *      that separates them is visible, not just failing.
 *
 *   2. Brute-force throttle — `/sign-in/email` is limited per client IP
 *      (3 attempts / 10 s, pinned in `src/cloudflare/auth/better-auth.ts`).
 *      The burst below crosses the limit locally and asserts the 429
 *      carries a retry hint, applies **before** credential verification
 *      (so a correct password is refused while throttled — the control
 *      cannot be used as an existence oracle), is identical for existing
 *      and unknown accounts, and is scoped to one client so it cannot be
 *      turned into a global lockout.
 *
 * Client IPs
 * ----------
 * The throttle is keyed on the resolved client IP, and its counter lives
 * in module-level memory that survives `beforeEach` for the whole test
 * file. Every fixture therefore allocates a **fresh** synthetic IP
 * (RFC 5737 TEST-NET-2, never routable) and a burst reuses one IP for its
 * attempts — which is exactly what "per client IP" means.
 *
 * Schema/data handling mirrors `src/http/auth/router.test.ts`: the
 * canonical schema is applied once by `test/setup/better-auth-schema.ts`
 * and Better Auth caches its schema verdict at module load, so rows are
 * truncated between tests instead of re-running migrations.
 *
 * Account under test
 * ------------------
 * `EXISTING_EMAIL` is a **local fixture only**: it is created in
 * `beforeEach` against the Miniflare D1, its address is a reserved
 * `.test.local` domain (RFC 6762), and it exists for the length of one
 * test. It carries `role: 'admin'` on purpose — the "correct credentials
 * while throttled" case signs in as that same account, so the throttle is
 * shown to refuse the strongest account in the schema before any
 * credential or role check runs. No admin capability is otherwise
 * exercised and none is claimed: the only things proved about a
 * successful sign-in are the `200`, the issued session cookie, and
 * exactly one session row.
 */

const SIGN_IN_PATH = '/api/v1/auth/sign-in/email';

const EXISTING_EMAIL = 'audit-existing@test.local';
const UNKNOWN_EMAIL = 'audit-unknown@test.local';
const CORRECT_PASSWORD = 'local-fixture-password-only';
const WRONG_PASSWORD = 'wrong-password-guess-only';

let ipSequence = 0;

/** A synthetic client IP no other case in this file has used. */
function newClientIp(): string {
	ipSequence += 1;
	return `198.51.${100 + Math.floor((ipSequence - 1) / 250)}.${((ipSequence - 1) % 250) + 1}`;
}

async function clearRows(): Promise<void> {
	for (const table of ['session', 'account', 'verification', 'apikey', 'user']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

async function signIn(email: string, password: string, ip: string): Promise<Response> {
	return SELF.fetch(`https://example.com${SIGN_IN_PATH}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
		body: JSON.stringify({ email, password }),
	});
}

/** Everything a caller can observe about a response, as comparable data. */
async function observe(response: Response): Promise<{
	status: number;
	headers: [string, string][];
	body: string;
}> {
	const headers = [...response.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
	return { status: response.status, headers, body: await response.text() };
}

/** `code` field of a Better Auth error body, or `—` when absent. */
function errorCode(body: string): string {
	try {
		const parsed = JSON.parse(body) as { code?: string };
		return parsed.code ?? '—';
	} catch {
		return '—';
	}
}

interface MatrixRow {
	endpoint: string;
	condition: string;
	status: number;
	code: string;
	retry: string;
}

const matrix: MatrixRow[] = [];

async function measure(
	condition: string,
	run: () => Promise<Response>,
): Promise<{ response: Response; observed: Awaited<ReturnType<typeof observe>> }> {
	const response = await run();
	const observed = await observe(response);
	matrix.push({
		endpoint: SIGN_IN_PATH,
		condition,
		status: observed.status,
		code: errorCode(observed.body),
		retry: response.headers.get('x-retry-after') ?? '—',
	});
	return { response, observed };
}

function renderMatrix(): string {
	const lines = matrix.map(
		(row) => `| ${row.endpoint} | ${row.condition} | ${row.status} | ${row.code} | ${row.retry} |`,
	);
	return [
		'| endpoint | input / condition | status | error | X-Retry-After |',
		'| --- | --- | --- | --- | --- |',
		...lines,
	].join('\n');
}

/** Drive `count` failed attempts from one client IP; returns the statuses. */
async function failedBurst(count: number, ip: string): Promise<number[]> {
	const statuses: number[] = [];
	for (let attempt = 1; attempt <= count; attempt += 1) {
		const response = await signIn(EXISTING_EMAIL, `${WRONG_PASSWORD}-${attempt}`, ip);
		statuses.push(response.status);
	}
	return statuses;
}

describe('login enumeration + brute-force throttle (Issue #443)', () => {
	beforeEach(async () => {
		await clearRows();
		matrix.length = 0;
		await auth.api.createUser({
			body: {
				email: EXISTING_EMAIL,
				password: CORRECT_PASSWORD,
				name: 'Audit Fixture',
				role: 'admin',
			},
		});
	});

	afterEach(async () => {
		await clearRows();
	});

	it('answers every failure identically whether or not the account exists', async () => {
		const wrongPassword = await measure('existing account / wrong password', () =>
			signIn(EXISTING_EMAIL, WRONG_PASSWORD, newClientIp()),
		);
		const unknownAccount = await measure('unknown account / any password', () =>
			signIn(UNKNOWN_EMAIL, WRONG_PASSWORD, newClientIp()),
		);

		expect(wrongPassword.observed.status).toBe(401);
		expect(unknownAccount.observed.status).toBe(401);
		// Identical responses: an attacker cannot tell the two apart from
		// status, body, or any header.
		expect(unknownAccount.observed).toEqual(wrongPassword.observed);
		expect(wrongPassword.observed.body).toContain('INVALID_EMAIL_OR_PASSWORD');
		// Pinned header **set**, not just parity: the 401 carries
		// `content-type` and nothing else — no `set-cookie`, no
		// `www-authenticate`, no hint about which account was addressed.
		// An upstream library change that adds a header therefore surfaces
		// here instead of quietly widening the response contract.
		expect(wrongPassword.observed.headers.map(([name]) => name)).toEqual(['content-type']);
	}, 120_000);

	it('keeps the failure response free of the submitted identity and the password', async () => {
		const existing = await signIn(EXISTING_EMAIL, WRONG_PASSWORD, newClientIp());
		const existingBody = await existing.text();
		const unknown = await signIn(UNKNOWN_EMAIL, WRONG_PASSWORD, newClientIp());
		const unknownBody = await unknown.text();

		for (const body of [existingBody, unknownBody]) {
			expect(body).not.toContain(EXISTING_EMAIL);
			expect(body).not.toContain(UNKNOWN_EMAIL);
			expect(body).not.toContain(WRONG_PASSWORD);
			expect(body).not.toContain('@test.local');
		}
		// A failed attempt must not mint a session in either direction.
		expect(existing.headers.get('set-cookie')).toBeNull();
		expect(unknown.headers.get('set-cookie')).toBeNull();
		const sessions = await env.DB.prepare('SELECT COUNT(*) as c FROM session').first<{
			c: number;
		}>();
		expect(sessions?.c).toBe(0);
	}, 120_000);

	it('still signs in when the credentials are right (the negative is not "always 401")', async () => {
		const good = await measure('existing account / correct password', () =>
			signIn(EXISTING_EMAIL, CORRECT_PASSWORD, newClientIp()),
		);

		expect(good.response.status).toBe(200);
		expect(good.response.headers.get('set-cookie')).toContain('better-auth.session_token=');
		const sessions = await env.DB.prepare('SELECT COUNT(*) as c FROM session').first<{
			c: number;
		}>();
		expect(sessions?.c).toBe(1);
	}, 120_000);

	it('throttles a burst of failed logins per client IP and tells the caller when to retry', async () => {
		// Cross the pinned 3-per-10s budget from one client IP.
		const statuses: number[] = [];
		const attackerIp = newClientIp();
		for (let attempt = 1; attempt <= 4; attempt += 1) {
			const measured = await measure(`brute force burst #${attempt} (same client IP)`, () =>
				signIn(EXISTING_EMAIL, `${WRONG_PASSWORD}-${attempt}`, attackerIp),
			);
			statuses.push(measured.response.status);
		}

		// The budget is the pinned `customRules['/sign-in/email']` value,
		// so a library default change shows up here instead of silently
		// loosening the control. The window is a rolling 10 s, so the four
		// requests must stay inside it — they are consecutive local
		// requests, and the 120 s case timeout is the only thing that could
		// stretch them.
		expect(statuses).toEqual([401, 401, 401, 429]);

		// Retry control: the throttle tells the client how long to wait.
		const throttled = await signIn(EXISTING_EMAIL, WRONG_PASSWORD, attackerIp);
		expect(throttled.status).toBe(429);
		const retryAfter = Number(throttled.headers.get('x-retry-after'));
		expect(Number.isInteger(retryAfter)).toBe(true);
		expect(retryAfter).toBeGreaterThan(0);
		expect(retryAfter).toBeLessThanOrEqual(10);
	}, 120_000);

	it('refuses even correct credentials while throttled, so the limit is not an existence oracle', async () => {
		const existingIp = newClientIp();
		expect(await failedBurst(3, existingIp)).toEqual([401, 401, 401]);

		const throttledButCorrect = await measure(
			'existing account / CORRECT password while throttled',
			() => signIn(EXISTING_EMAIL, CORRECT_PASSWORD, existingIp),
		);
		expect(throttledButCorrect.response.status).toBe(429);

		// …and the throttled answer for an account that does not exist is
		// the same answer, so "429" says nothing about existence either.
		const unknownIp = newClientIp();
		expect(await failedBurst(3, unknownIp)).toEqual([401, 401, 401]);
		const throttledUnknown = await measure('unknown account / any password while throttled', () =>
			signIn(UNKNOWN_EMAIL, WRONG_PASSWORD, unknownIp),
		);
		expect(throttledUnknown.response.status).toBe(429);
		expect(throttledUnknown.observed.body).toBe(throttledButCorrect.observed.body);
		// `x-retry-after` is the only header allowed to differ: it is a
		// countdown that legitimately differs per client.
		const withoutRetry = (headers: [string, string][]) =>
			headers.filter(([name]) => name !== 'x-retry-after');
		expect(withoutRetry(throttledUnknown.observed.headers)).toEqual(
			withoutRetry(throttledButCorrect.observed.headers),
		);

		const sessions = await env.DB.prepare('SELECT COUNT(*) as c FROM session').first<{
			c: number;
		}>();
		expect(sessions?.c).toBe(0);
	}, 120_000);

	it('scopes the throttle to one client so it cannot lock everyone out', async () => {
		const attackerIp = newClientIp();
		expect(await failedBurst(4, attackerIp)).toEqual([401, 401, 401, 429]);
		expect((await signIn(EXISTING_EMAIL, WRONG_PASSWORD, attackerIp)).status).toBe(429);

		// A different client IP is unaffected: this is a per-client
		// throttle, not a lockout an attacker can aim at the operator.
		const otherClient = await signIn(EXISTING_EMAIL, CORRECT_PASSWORD, newClientIp());
		expect(otherClient.status).toBe(200);

		// The budget is keyed per path and per client: signing in elsewhere
		// hands no extra attempts to the throttled one.
		expect((await signIn(EXISTING_EMAIL, WRONG_PASSWORD, attackerIp)).status).toBe(429);
	}, 120_000);

	it('emits the measured evidence matrix for the verification report', async () => {
		await measure('existing account / correct password', () =>
			signIn(EXISTING_EMAIL, CORRECT_PASSWORD, newClientIp()),
		);
		await measure('existing account / wrong password', () =>
			signIn(EXISTING_EMAIL, WRONG_PASSWORD, newClientIp()),
		);
		await measure('unknown account / any password', () =>
			signIn(UNKNOWN_EMAIL, WRONG_PASSWORD, newClientIp()),
		);

		const attackerIp = newClientIp();
		for (let attempt = 1; attempt <= 4; attempt += 1) {
			await measure(`brute force burst #${attempt} (same client IP)`, () =>
				signIn(EXISTING_EMAIL, `${WRONG_PASSWORD}-${attempt}`, attackerIp),
			);
		}
		await measure('existing account / CORRECT password while throttled', () =>
			signIn(EXISTING_EMAIL, CORRECT_PASSWORD, attackerIp),
		);
		await measure('another client IP / correct password', () =>
			signIn(EXISTING_EMAIL, CORRECT_PASSWORD, newClientIp()),
		);

		// The printed block is the ONLY artefact
		// `scripts/capture-login-rate-limit-report.mjs` renders into the
		// committed screenshot, so it must stay credential-free by
		// construction.
		const rendered = renderMatrix();
		expect(rendered).not.toContain(CORRECT_PASSWORD);
		expect(rendered).not.toContain(WRONG_PASSWORD);
		expect(rendered).not.toContain(EXISTING_EMAIL);
		expect(rendered).not.toContain('@test.local');
		// Printed so `scripts/capture-login-rate-limit-report.mjs` can
		// render the measured matrix into the committed verification
		// artefact; it carries status codes and error codes only.
		console.log(
			`\n<!-- login-rate-limit-matrix:start -->\n${rendered}\n<!-- login-rate-limit-matrix:end -->\n`,
		);
	}, 120_000);
});
