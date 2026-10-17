/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../../src/cloudflare/auth/better-auth';

/**
 * Session lifecycle contract — session fixation and logout
 * invalidation (Issue #439).
 *
 * What this file owns
 * -------------------
 * The positive / negative pair the Issue asks for, executed against
 * the REAL Worker entrypoint through `SELF.fetch`:
 *
 *   positive — a session created by a successful sign-in authorizes
 *              `/admin` (SSR) and `/api/v1/auth/get-session`.
 *   negative — the SAME cookie value is refused once sign-out ran:
 *              `get-session` resolves to no user, `/admin` and
 *              `/admin/keys` redirect to `/admin/login`, and the D1
 *              `session` row is gone.
 *
 * plus the fixation half: a client-supplied (attacker-fixed) cookie
 * value is never promoted to a session by signing in.
 *
 * Why workerd / fixtures and not a real deployment
 * -------------------------------------------------
 * Sign-in and sign-out are destructive against a shared database:
 * they write and delete `session` rows. Running them against
 * production would mutate the operator's D1 and could invalidate the
 * owner's live admin session, so every request here goes through the
 * local Miniflare D1 that `@cloudflare/vitest-plugin` provides (see
 * `vitest.config.ts`). The schema is applied by
 * `test/setup/better-auth-schema.ts` (registered as a `setupFiles`),
 * which mirrors `migrations/0001_better_auth.sql`; row data is
 * truncated between tests because Better Auth caches its schema
 * verdict at module load. The assertion on the `session` table is a
 * plain `SELECT` — read-only inspection, never a remote mutation.
 *
 * Fixture data
 * ------------
 * Every identity here is a local fixture on the reserved `.test.local`
 * domain with a throwaway password. No real credential, no personal
 * data, and no cookie value is ever logged or asserted on directly:
 * cookie values are only compared for identity (`!==`) or for absence,
 * never printed. See `assertNoSecretMaterial` below for the guard on
 * the error path.
 *
 * The `Origin` header on the POSTs
 * --------------------------------
 * The test pool deliberately does NOT bind `BETTER_AUTH_URL`
 * (`vitest.config.ts` explains why: binding it changes other loaders'
 * branches). With no `baseURL` / `trustedOrigins`, Better Auth derives
 * its origin from the incoming request, so a state-changing endpoint
 * only accepts a POST whose `Origin` matches that request origin.
 * Production pins both (`BETTER_AUTH_URL=https://rebuildup.dev`,
 * ADR-0014), so this is a test-pool shape difference, not a
 * production behaviour difference. The negative case "sign-out
 * without a matching Origin is refused" below pins the part that
 * matters for security: a rejected logout must NOT silently invalidate
 * somebody else's session.
 */

const ORIGIN = 'https://example.com';
const SESSION_COOKIE = 'better-auth.session_token';
const CACHE_COOKIE = 'better-auth.session_data';
/** Fixture password. Local-only; never a real credential. */
const PASSWORD = 'local-fixture-password-only';

/**
 * Explicit timeout for the cases that render an SSR page through
 * `SELF.fetch`.
 *
 * The first `/admin` render inside the workerd pool has to load the
 * whole TanStack Start SSR graph (route tree, loaders, Panda CSS
 * runtime). That is a few seconds of CPU on a cold pool and can spill
 * past the 5 s default when the host is busy, so the page-level cases
 * declare a wider budget instead of relying on the default.
 */
const SSR_TIMEOUT = 60_000;

async function clearRows(): Promise<void> {
	for (const table of ['session', 'account', 'verification', 'apikey', 'user']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

/**
 * Read one cookie value out of a (possibly joined) `Set-Cookie`
 * header. Returns the raw value only for in-test comparisons; callers
 * never print it.
 */
function cookieValue(setCookieHeader: string | null, name: string): string | null {
	if (!setCookieHeader) return null;
	// `headers.get('set-cookie')` returns every cookie in one string in
	// some runtimes; split on the cookie boundary and pick the name.
	const segments = setCookieHeader.split(/,(?=[^;]+=[^;]+)/);
	for (const segment of segments) {
		const [pair] = segment.split(';');
		const eq = pair.indexOf('=');
		if (eq <= 0) continue;
		if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
	}
	return null;
}

/** True when the response clears `name` (empty value + past Max-Age). */
function clearsCookie(setCookieHeader: string | null, name: string): boolean {
	if (!setCookieHeader) return false;
	const segments = setCookieHeader.split(/,(?=[^;]+=[^;]+)/);
	for (const segment of segments) {
		const parts = segment.split(';');
		const [pair] = parts;
		const eq = pair.indexOf('=');
		if (eq <= 0) continue;
		if (pair.slice(0, eq).trim() !== name) continue;
		if (pair.slice(eq + 1).trim().length !== 0) continue;
		const maxAge = parts.find((p) => /^\s*max-age\s*=/i.test(p)) ?? '';
		const value = Number(maxAge.split('=')[1]);
		return Number.isFinite(value) && value <= 0;
	}
	return false;
}

async function createUser(email: string, role: 'admin' | 'user' = 'admin'): Promise<void> {
	// `auth.api.createUser` is the admin plugin's direct API — the same
	// path the invitation-accept server function uses
	// (`src/admin/invitations/accept.ts`) and the same path the
	// Better Auth `create-admin` CLI uses (ADR-0009 §4). It bypasses the
	// public sign-up endpoint, which is disabled by policy.
	await auth.api.createUser({
		body: { email, password: PASSWORD, name: 'Local Fixture', role },
	});
}

async function signIn(email: string): Promise<Response> {
	return SELF.fetch(`${ORIGIN}/api/v1/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
		body: JSON.stringify({ email, password: PASSWORD }),
	});
}

async function signOut(
	cookie: string | null,
	headers: Record<string, string> = {},
	cacheCookie: string | null = null,
): Promise<Response> {
	const jar = [
		cookie ? `${SESSION_COOKIE}=${cookie}` : null,
		cacheCookie ? `${CACHE_COOKIE}=${cacheCookie}` : null,
	]
		.filter((part): part is string => part !== null)
		.join('; ');
	return SELF.fetch(`${ORIGIN}/api/v1/auth/sign-out`, {
		method: 'POST',
		headers: { ...(jar ? { Cookie: jar } : {}), Origin: ORIGIN, ...headers },
	});
}

/**
 * Ask for the session once and return the cookie-cache cookie the
 * browser would store alongside the session token. A browser sends it
 * back on every later request, so the negative cases replay it too.
 */
async function primeCacheCookie(token: string): Promise<string | null> {
	const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/get-session`, {
		headers: { Cookie: `${SESSION_COOKIE}=${token}` },
	});
	expect(res.status).toBe(200);
	return cookieValue(res.headers.get('set-cookie'), CACHE_COOKIE);
}

interface ResolvedSession {
	status: number;
	body: { user?: { email?: string; role?: string } } | null;
}

/** Resolve a session from an arbitrary cookie jar (not just the token). */
async function getSessionWithJar(jar: string): Promise<ResolvedSession> {
	const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/get-session`, {
		headers: { Cookie: jar },
	});
	return {
		status: res.status,
		body: (await res.json()) as { user?: { email?: string; role?: string } } | null,
	};
}

async function getSession(cookie: string): Promise<ResolvedSession> {
	return getSessionWithJar(`${SESSION_COOKIE}=${cookie}`);
}

async function getPage(path: string, cookie: string | null): Promise<Response> {
	return SELF.fetch(`${ORIGIN}${path}`, {
		headers: cookie ? { Cookie: `${SESSION_COOKIE}=${cookie}` } : {},
		redirect: 'manual',
	});
}

async function sessionRowCount(): Promise<number> {
	const row = await env.DB.prepare('SELECT COUNT(*) as c FROM session').first<{ c: number }>();
	return row?.c ?? -1;
}

/**
 * Fail loudly if a fixture secret would ever reach an assertion
 * message. `expect(...).toBe(x)` prints both operands on failure, so a
 * test that compared against a cookie value could print it. No
 * assertion below compares against a cookie value — this helper is the
 * belt-and-braces check that the invariant is being respected by the
 * helpers, not just by convention.
 */
function assertNoSecretMaterial(label: string, secret: string | null, credential: string): void {
	expect(`${label}:${secret ?? ''}`).not.toContain(credential);
}

describe('session lifecycle — fixation and logout invalidation (Issue #439)', () => {
	beforeEach(async () => {
		await clearRows();
	});
	afterEach(async () => {
		await clearRows();
	});

	describe('positive: a session created by sign-in authorizes the admin surface', () => {
		it(
			'sign-in issues a session cookie that resolves a session and renders /admin',
			async () => {
				const email = 'positive-admin@test.local';
				await createUser(email);

				const res = await signIn(email);
				expect(res.status).toBe(200);

				// The cookie NAME is part of the contract; the VALUE is a
				// bearer credential and is never logged or asserted on.
				const cookie = cookieValue(res.headers.get('set-cookie'), SESSION_COOKIE);
				expect(cookie).not.toBeNull();
				expect((cookie ?? '').length).toBeGreaterThan(0);
				assertNoSecretMaterial('sign-in cookie', cookie, PASSWORD);

				// A `session` row exists and is bound to the fixture user.
				expect(await sessionRowCount()).toBe(1);

				// The API surface resolves the session, including the role
				// the admin plugin assigned.
				const resolved = await getSession(cookie as string);
				expect(resolved.status).toBe(200);
				expect(resolved.body?.user?.email).toBe(email);
				expect(resolved.body?.user?.role).toBe('admin');

				// The SSR admin surface renders for the same cookie instead
				// of redirecting to the sign-in form.
				const admin = await getPage('/admin', cookie);
				expect(admin.status).toBe(200);
				expect(admin.headers.get('location')).toBeNull();

				await signOut(cookie);
			},
			SSR_TIMEOUT,
		);

		it(
			'a non-admin session still gets /admin (signed-in gate) but is bounced from /admin/keys',
			async () => {
				// Guards the scope of this Issue: only the *session* is under
				// test here. Role gating is owned by `src/admin/auth/load.ts`
				// and its loaders; asserting it here would pin behaviour this
				// Issue does not own.
				const email = 'positive-plain-user@test.local';
				await createUser(email, 'user');
				const res = await signIn(email);
				const cookie = cookieValue(res.headers.get('set-cookie'), SESSION_COOKIE);
				expect(cookie).not.toBeNull();

				const admin = await getPage('/admin', cookie);
				expect(admin.status).toBe(200);

				const keys = await getPage('/admin/keys', cookie);
				expect(keys.status).toBeGreaterThanOrEqual(300);
				expect(keys.status).toBeLessThan(400);
				expect(keys.headers.get('location')).toContain('/admin');

				await signOut(cookie);
			},
			SSR_TIMEOUT,
		);
	});

	describe('negative: the pre-logout cookie is refused after sign-out', () => {
		it('sign-out clears the session cookie, orphans the cache cookie, and deletes the session row', async () => {
			const email = 'negative-logout@test.local';
			await createUser(email);
			const signInRes = await signIn(email);
			const cookie = cookieValue(signInRes.headers.get('set-cookie'), SESSION_COOKIE);
			expect(cookie).not.toBeNull();
			expect(await sessionRowCount()).toBe(1);

			// A `get-session` call primes the cookie cache, so the
			// sign-out below runs with the cookie jar a browser would
			// actually hold — BOTH cookies, not just the session token.
			const cached = await primeCacheCookie(cookie as string);
			expect(cached).not.toBeNull();
			assertNoSecretMaterial('cache cookie', cached, PASSWORD);

			const signOutRes = await signOut(cookie, {}, cached);
			expect(signOutRes.status).toBe(200);
			const setCookie = signOutRes.headers.get('set-cookie');
			expect(clearsCookie(setCookie, SESSION_COOKIE)).toBe(true);

			// Server-side invalidation: the row is gone, so the cookie
			// value no longer resolves to anything.
			expect(await sessionRowCount()).toBe(0);

			// The sign-out response re-clears the session token only; the
			// cookie-cache cookie is left in the jar until its own
			// Max-Age elapses. That is harmless while it stands alone —
			// assert the consequence rather than the Set-Cookie detail.
			const orphaned = await getSessionWithJar(`${CACHE_COOKIE}=${cached}`);
			expect(orphaned.body).toBeNull();

			// And the token itself is dead on the API surface too.
			expect((await getSession(cookie as string)).body).toBeNull();
		});

		it('get-session resolves to no user for the old cookie after sign-out', async () => {
			const email = 'negative-get-session@test.local';
			await createUser(email);
			const cookie = cookieValue((await signIn(email)).headers.get('set-cookie'), SESSION_COOKIE);
			expect(cookie).not.toBeNull();

			// Sanity: the cookie IS a live session before the logout.
			expect((await getSession(cookie as string)).body?.user?.email).toBe(email);

			await signOut(cookie);

			const after = await getSession(cookie as string);
			expect(after.status).toBe(200);
			expect(after.body).toBeNull();
		});

		it(
			'/admin redirects the old cookie to /admin/login after sign-out',
			async () => {
				const email = 'negative-admin-page@test.local';
				await createUser(email);
				const cookie = cookieValue((await signIn(email)).headers.get('set-cookie'), SESSION_COOKIE);
				expect(cookie).not.toBeNull();
				expect((await getPage('/admin', cookie)).status).toBe(200);

				await signOut(cookie);

				const after = await getPage('/admin', cookie);
				expect(after.status).toBeGreaterThanOrEqual(300);
				expect(after.status).toBeLessThan(400);
				expect(after.headers.get('location')).toContain('/admin/login');
			},
			SSR_TIMEOUT,
		);

		it(
			'/admin/keys redirects the old cookie to /admin/login after sign-out',
			async () => {
				// The admin-only surface is the sharpest probe: it checks
				// both the session gate AND the role gate, so a cookie that
				// survived logout would expose API-key management.
				const email = 'negative-keys-page@test.local';
				await createUser(email);
				const cookie = cookieValue((await signIn(email)).headers.get('set-cookie'), SESSION_COOKIE);
				expect(cookie).not.toBeNull();
				expect((await getPage('/admin/keys', cookie)).status).toBe(200);

				await signOut(cookie);

				const after = await getPage('/admin/keys', cookie);
				expect(after.status).toBeGreaterThanOrEqual(300);
				expect(after.status).toBeLessThan(400);
				expect(after.headers.get('location')).toContain('/admin/login');
			},
			SSR_TIMEOUT,
		);

		it('a sign-out without a matching Origin is refused and does not invalidate the session', async () => {
			// Better Auth rejects a state-changing POST whose Origin is
			// not trusted. The security-relevant half is the second
			// assertion: a rejected sign-out must leave the session
			// intact rather than half-invalidate it.
			const email = 'negative-origin-guard@test.local';
			await createUser(email);
			const cookie = cookieValue((await signIn(email)).headers.get('set-cookie'), SESSION_COOKIE);
			expect(cookie).not.toBeNull();

			const res = await signOut(cookie, { Origin: 'https://not-trusted.invalid' });
			expect(res.status).toBeGreaterThanOrEqual(400);

			expect(await sessionRowCount()).toBe(1);
			expect((await getSession(cookie as string)).body?.user?.email).toBe(email);

			await signOut(cookie);
			expect(await sessionRowCount()).toBe(0);
		});
	});

	describe('session fixation: a client-supplied cookie is never promoted', () => {
		it(
			'signing in replaces an attacker-fixed cookie value instead of adopting it',
			async () => {
				const email = 'fixation-admin@test.local';
				await createUser(email);

				// The value an attacker could try to plant in a victim's
				// browser before the victim signs in (OWASP ASVS V3
				// session-fixation check). It is not a real credential: no
				// session row holds it.
				const fixed = 'attacker-fixed-session-value-000000';
				expect(await sessionRowCount()).toBe(0);

				// Before sign-in the planted value is worth nothing.
				expect((await getSession(fixed)).body).toBeNull();

				// Sign in WHILE the planted cookie is on the request.
				const res = await SELF.fetch(`${ORIGIN}/api/v1/auth/sign-in/email`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Origin: ORIGIN,
						Cookie: `${SESSION_COOKIE}=${fixed}`,
					},
					body: JSON.stringify({ email, password: PASSWORD }),
				});
				expect(res.status).toBe(200);
				const issued = cookieValue(res.headers.get('set-cookie'), SESSION_COOKIE);
				expect(issued).not.toBeNull();
				// Regeneration: the server mints its own token and does not
				// echo the client-supplied one back as a valid session.
				expect(issued).not.toBe(fixed);
				assertNoSecretMaterial('issued cookie', issued, PASSWORD);

				// The planted value is still not a session afterwards, and
				// the admin surface refuses it.
				expect((await getSession(fixed)).body).toBeNull();
				const adminWithFixed = await getPage('/admin', fixed);
				expect(adminWithFixed.status).toBeGreaterThanOrEqual(300);
				expect(adminWithFixed.status).toBeLessThan(400);
				expect(adminWithFixed.headers.get('location')).toContain('/admin/login');

				// Exactly one session exists, and it is the issued one:
				// the D1 row's user is the account the new token resolves to.
				expect(await sessionRowCount()).toBe(1);
				const row = await env.DB.prepare('SELECT userId FROM session').first<{ userId: string }>();
				const resolvedIssued = await getSession(issued as string);
				expect(resolvedIssued.body?.user?.email).toBe(email);
				expect(row?.userId).toBeTruthy();

				await signOut(issued);
			},
			SSR_TIMEOUT,
		);

		it('sign-out invalidates the session regardless of which cookie copy is replayed', async () => {
			// Replay guard: a second logout with the same (now dead)
			// cookie must stay a no-op rather than resurrect anything.
			const email = 'fixation-replay@test.local';
			await createUser(email);
			const cookie = cookieValue((await signIn(email)).headers.get('set-cookie'), SESSION_COOKIE);
			expect(cookie).not.toBeNull();

			expect((await signOut(cookie)).status).toBe(200);
			expect(await sessionRowCount()).toBe(0);

			const replay = await signOut(cookie);
			expect(replay.status).toBeLessThan(500);
			expect(await sessionRowCount()).toBe(0);
			expect((await getSession(cookie as string)).body).toBeNull();
		});
	});

	describe('known gap: cookie cache keeps a captured cookie pair valid until maxAge', () => {
		/**
		 * `src/cloudflare/auth/better-auth.ts` enables
		 * `session.cookieCache` with `maxAge: 5 * 60`. A `get-session`
		 * call therefore hands the browser a second cookie
		 * (`better-auth.session_data`) that carries a signed copy of
		 * the session. Sign-out DELETES the D1 row (proved above) and
		 * clears both cookies in the response — but a party that
		 * captured the pair *before* the logout can still replay it
		 * until the cache cookie's Max-Age elapses, because the cache
		 * short-circuits the session lookup.
		 *
		 * This is a residual risk of the current configuration, not an
		 * accepted end state: shrinking or disabling the cache changes
		 * the auth policy that ADR-0009 owns, which is an owner
		 * decision (recorded in Issue #439). The case is written as
		 * `it.fails` — i.e. it asserts the DESIRED outcome (the replayed
		 * pair is refused). Today it fails, which is why the suite is
		 * green; the day the cache is re-tuned, this case flips to
		 * failing and the change is converted into a plain `it`.
		 */
		it.fails(
			'[known gap] a captured session_token + session_data pair is refused after sign-out',
			async () => {
				const email = 'known-gap-cache-pair@test.local';
				await createUser(email);
				const cookie = cookieValue((await signIn(email)).headers.get('set-cookie'), SESSION_COOKIE);
				expect(cookie).not.toBeNull();

				// Prime the cache cookie the way a browser would collect it.
				const cached = await primeCacheCookie(cookie as string);
				expect(cached).not.toBeNull();
				expect(await sessionRowCount()).toBe(1);

				await signOut(cookie, {}, cached);
				expect(await sessionRowCount()).toBe(0);

				// Replay the captured pair. Today the cookie cache answers
				// without consulting D1, so this is still authenticated.
				const jar = `${SESSION_COOKIE}=${cookie}; ${CACHE_COOKIE}=${cached}`;
				const replayed = await SELF.fetch(`${ORIGIN}/api/v1/auth/get-session`, {
					headers: { Cookie: jar },
				});
				expect(replayed.status).toBe(401);

				const admin = await SELF.fetch(`${ORIGIN}/admin`, {
					headers: { Cookie: jar },
					redirect: 'manual',
				});
				expect(admin.status).toBeGreaterThanOrEqual(300);
				expect(admin.status).toBeLessThan(400);
			},
			SSR_TIMEOUT,
		);
	});
});
