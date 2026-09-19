import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '../../cloudflare/auth/better-auth';

/**
 * Acceptance tests for the Hono external-boundary Better Auth router
 * mounted at `/api/v1/auth/*` (`src/http/auth/router.ts`).
 *
 * Issue #33 requires automated acceptance for:
 *
 *   - sign-in success / failure / role check
 *
 * The router forwards every `/api/v1/auth/<path>` request to
 * `auth.handler(c.req.raw)` — Better Auth owns cookies, status
 * codes, and the session shape end-to-end. We exercise the real
 * Worker entrypoint via `SELF.fetch` so the request flows through
 * `src/server.ts` → `externalBoundary` → `authRouter` → `auth.handler`.
 *
 * Schema setup: `test/setup/better-auth-schema.ts` (registered via
 * `setupFiles` in `vitest.config.ts`) applies the canonical Better
 * Auth schema once per test file, before the auth module is imported.
 * Better Auth eagerly validates its schema at module load and caches
 * the verdict; resetting the schema between tests would force a stale
 * verdict. We instead truncate row data (DELETE FROM) between tests,
 * which keeps the cached schema verdict valid for the duration of
 * the test file.
 */

async function clearRows(): Promise<void> {
	for (const table of ['session', 'account', 'verification', 'apikey', 'user']) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

interface BootstrapInput {
	email: string;
	password: string;
	name: string;
	role?: 'admin' | 'user';
}

async function bootstrapUser(input: BootstrapInput): Promise<string> {
	const result = await auth.api.createUser({
		body: {
			email: input.email,
			password: input.password,
			name: input.name,
			role: input.role ?? 'user',
		},
	});
	return String(result.user.id);
}

function parseCookie(setCookieHeader: string | null, name: string): string | null {
	if (!setCookieHeader) return null;
	// setCookieHeader is a single Set-Cookie header value (the first one).
	// `headers.get('set-cookie')` returns joined cookies in some runtimes;
	// split on the cookie boundary and pick the one we want.
	const segments = setCookieHeader.split(/,(?=[^;]+=[^;]+)/);
	for (const segment of segments) {
		const [pair] = segment.split(';');
		const eq = pair.indexOf('=');
		if (eq <= 0) continue;
		const key = pair.slice(0, eq).trim();
		if (key === name) return pair.slice(eq + 1).trim();
	}
	return null;
}

async function signIn(email: string, password: string): Promise<Response> {
	return SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
}

async function getSession(cookieValue: string): Promise<Response> {
	return SELF.fetch('https://example.com/api/v1/auth/get-session', {
		headers: { Cookie: `better-auth.session_token=${cookieValue}` },
	});
}

describe('auth router — sign-in', () => {
	beforeEach(async () => {
		await clearRows();
	});
	afterEach(async () => {
		await clearRows();
	});

	it('sign-in success: returns 200 and sets the session cookie', async () => {
		await bootstrapUser({
			email: 'admin@test.local',
			password: 'correct-horse-battery-staple',
			name: 'Admin',
			role: 'admin',
		});

		const res = await signIn('admin@test.local', 'correct-horse-battery-staple');

		expect(res.status).toBe(200);
		const cookie = parseCookie(res.headers.get('set-cookie'), 'better-auth.session_token');
		expect(cookie).not.toBeNull();
		expect(cookie?.length).toBeGreaterThan(0);

		// A `session` row was written.
		const sessionRows = await env.DB.prepare('SELECT userId FROM session').all<{
			userId: string;
		}>();
		expect(sessionRows.results ?? []).toHaveLength(1);
	});

	it('sign-in failure: wrong password returns 401 and no cookie', async () => {
		await bootstrapUser({
			email: 'user@test.local',
			password: 'correct-horse-battery-staple',
			name: 'User',
		});

		const res = await signIn('user@test.local', 'wrong-password');

		expect(res.status).toBe(401);
		const cookie = parseCookie(res.headers.get('set-cookie'), 'better-auth.session_token');
		// No session cookie should be set; the cookie header (if any) must
		// not include a fresh session token.
		if (cookie) {
			// Some Better Auth versions still set a clearing cookie on
			// failure — assert it's not a usable token by checking the
			// session table is empty.
			const rows = await env.DB.prepare('SELECT COUNT(*) as c FROM session').first<{ c: number }>();
			expect(rows?.c).toBe(0);
		} else {
			expect(cookie).toBeNull();
		}

		const sessionRows = await env.DB.prepare('SELECT COUNT(*) as c FROM session').first<{
			c: number;
		}>();
		expect(sessionRows?.c).toBe(0);
	});

	it('sign-in failure: unknown email returns 401 and no session row', async () => {
		const res = await signIn('nobody@test.local', 'any-password');

		expect(res.status).toBe(401);

		const sessionRows = await env.DB.prepare('SELECT COUNT(*) as c FROM session').first<{
			c: number;
		}>();
		expect(sessionRows?.c).toBe(0);
	});

	it('role check: get-session returns the user with role = admin', async () => {
		await bootstrapUser({
			email: 'admin@test.local',
			password: 'correct-horse-battery-staple',
			name: 'Admin Person',
			role: 'admin',
		});

		const signInRes = await signIn('admin@test.local', 'correct-horse-battery-staple');
		expect(signInRes.status).toBe(200);
		const cookie = parseCookie(signInRes.headers.get('set-cookie'), 'better-auth.session_token');
		expect(cookie).not.toBeNull();

		const sessionRes = await getSession(cookie as string);
		expect(sessionRes.status).toBe(200);
		const body = (await sessionRes.json()) as {
			user: { email: string; name: string; role: string | null };
		};
		expect(body.user.email).toBe('admin@test.local');
		expect(body.user.name).toBe('Admin Person');
		expect(body.user.role).toBe('admin');
	});

	it('role check: get-session returns role = user for non-admin accounts', async () => {
		await bootstrapUser({
			email: 'user@test.local',
			password: 'correct-horse-battery-staple',
			name: 'Plain User',
			role: 'user',
		});

		const signInRes = await signIn('user@test.local', 'correct-horse-battery-staple');
		expect(signInRes.status).toBe(200);
		const cookie = parseCookie(signInRes.headers.get('set-cookie'), 'better-auth.session_token');
		expect(cookie).not.toBeNull();

		const sessionRes = await getSession(cookie as string);
		expect(sessionRes.status).toBe(200);
		const body = (await sessionRes.json()) as {
			user: { email: string; name: string; role: string | null };
		};
		expect(body.user.role).toBe('user');
	});

	it('sign-up is disabled: public POST /sign-up/email returns 400', async () => {
		// The public sign-up endpoint must be closed; only the admin
		// invitation accept flow (which calls `auth.api.createUser`
		// directly) creates users. Documented in ADR-0009 §1.
		const res = await SELF.fetch('https://example.com/api/v1/auth/sign-up/email', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: 'open@test.local',
				password: 'correct-horse-battery-staple',
				name: 'Open Signup',
			}),
		});
		expect(res.status).toBe(400);
		const userCount = await env.DB.prepare('SELECT COUNT(*) as c FROM user').first<{ c: number }>();
		expect(userCount?.c).toBe(0);
	});
});
