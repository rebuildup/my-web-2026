import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseVersionedSecrets } from '../../cloudflare/auth/better-auth';

/**
 * Contract tests for the OAuth / OIDC callback surface the external
 * boundary exposes (Issue #444).
 *
 * What is actually deployed
 * -------------------------
 *
 * `src/cloudflare/auth/better-auth.ts` configures Better Auth with the
 * `admin()` and `apiKey()` plugins and **no** social provider. The
 * OAuth machinery therefore ships in its *unconfigured* form: the
 * `/callback/:id` endpoint and the `/sign-in/social` entry point are
 * reachable, but no provider round-trip can complete. That is the real
 * security boundary this file pins, and it is worth stating plainly
 * rather than overstating:
 *
 *   - A callback can never mint a session on this deployment. There is
 *     no provider to exchange the code with, so the flow always stops
 *     at `oauth_provider_not_found`.
 *   - What IS observable — and what an attacker actually controls — is
 *     the set of gates in front of that stop: the `state` binding
 *     (CSRF nonce + PKCE verifier carrier) and the redirect targets.
 *     Those gates are what this file tests, with fake fixtures.
 *
 * Two gates in front of the handler
 * ---------------------------------
 *
 * An untrusted redirect target is refused twice over, by two owners,
 * and this suite pins both layers:
 *
 *   1. `src/http/security/redirect-guard.ts` (Issue #454) is mounted
 *      in front of the Better Auth handler, so an untrusted
 *      `callbackURL` / `redirectTo` / `errorCallbackURL` /
 *      `newUserCallbackURL` is answered `400
 *      invalid_redirect_target` and never reaches the handler.
 *   2. Better Auth's own origin check then sees only what the project
 *      guard accepted, and refuses a cross-site `Origin` / `Referer`
 *      with `403 INVALID_ORIGIN` (or `MISSING_OR_NULL_ORIGIN`).
 *
 * Which layer answers is part of the contract, so both are asserted.
 *
 * Deliberate deviation: `vitest.config.ts` omits the production-only
 * `BETTER_AUTH_URL` text binding, so the guard's trusted-origin list
 * is empty in this pool and every absolute URL is refused (fail
 * closed). In production the binding is `https://rebuildup.dev`
 * (ADR-0014), so an absolute same-origin target is trusted and
 * downgraded to its path. This suite therefore pins the fail-closed
 * direction, not the pinned-origin production configuration. The
 * accepted form used as positive control is the *relative* target.
 *
 * Fixtures, not credentials
 * -------------------------
 *
 * Every fixture is local: rows written into the workerd test pool's D1
 * and a cookie value signed with the **dummy** `BETTER_AUTH_SECRETS`
 * binding declared in `vitest.config.ts`. No production secret is read,
 * printed, or asserted; `currentSigningSecret()` returns the value only
 * so `crypto.subtle` can HMAC it, and no assertion ever compares
 * against its literal. Nothing here reaches a real IdP, and no test
 * mutates a remote D1/R2.
 *
 * Positive control
 * ----------------
 *
 * A negative-only suite passes just as happily against an endpoint
 * that rejects everything, so each guard is paired with a case that
 * must be ACCEPTED: a correctly bound `state` reaches the provider
 * gate instead of the state gate, and a same-origin `callbackURL`
 * passes the origin check instead of being refused.
 */

/** Origin used for every request; matches `src/http/auth/router.test.ts`. */
const ORIGIN = 'https://example.com';

/** Path Better Auth serves its own error page from (basePath + `/error`). */
const ERROR_PATH = '/api/v1/auth/error';

/** Cookie Better Auth uses to bind the browser to the OAuth `state`. */
const STATE_COOKIE_NAME = 'better-auth.state';

/**
 * A cookie is required for `validateOrigin` to engage at all: Better
 * Auth skips the Origin check when the request carries no cookies (a
 * non-browser caller cannot ride a session). The value is a throwaway
 * flag cookie, not a credential.
 */
const SESSIONLESS_COOKIE = 'better-auth.dont_remember=1';

interface SeededState {
	/** The `state` query parameter the browser is expected to echo back. */
	state: string;
	/** Absolute URL the callback would land on after a successful sign-in. */
	callbackURL: string;
	/** Row lifetime in the `verification` table. */
	expiresAt: number;
	/** Payload-level lifetime; compared by Better Auth against `Date.now()`. */
	payloadExpiresAt: number;
}

/**
 * Current (first-entry) signing key of the test pool's
 * `BETTER_AUTH_SECRETS` binding.
 *
 * Reusing the parser the Worker itself uses
 * (`src/cloudflare/auth/better-auth.ts#parseVersionedSecrets`) keeps the
 * test from hard-coding a second copy of the "first entry wins"
 * rotation rule documented in ADR-0015 §11.2.
 */
function currentSigningSecret(): string {
	const raw = env.BETTER_AUTH_SECRETS;
	if (typeof raw !== 'string' || raw.length === 0) {
		throw new Error('test pool must bind a BETTER_AUTH_SECRETS value to run this suite');
	}
	const first = parseVersionedSecrets(raw)[0];
	if (!first) throw new Error('BETTER_AUTH_SECRETS has no current signing entry');
	return first.value;
}

/**
 * Reproduce the browser-side half of the `state` binding: an HMAC-SHA256
 * signature over the state, base64 encoded, appended after a `.`
 * (`better-call`'s `signCookieValue`).
 */
async function signedStateCookie(state: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(currentSigningSecret()),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(state));
	const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
	return `${state}.${base64}`;
}

/**
 * Write the server-side half of the binding: the `verification` row
 * Better Auth reads the PKCE `codeVerifier` and the post-sign-in
 * `callbackURL` from.
 *
 * The shape mirrors `stateDataSchema` in Better Auth's `state.ts`.
 */
async function seedState(seed: SeededState): Promise<void> {
	await env.DB.prepare(
		`INSERT OR REPLACE INTO verification (id, identifier, value, expiresAt, createdAt, updatedAt)
		 VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			`verif-${seed.state}`,
			seed.state,
			JSON.stringify({
				callbackURL: seed.callbackURL,
				codeVerifier: 'fixture-code-verifier-not-a-real-pkce-secret',
				expiresAt: seed.payloadExpiresAt,
				oauthState: seed.state,
			}),
			seed.expiresAt,
			Date.now(),
			Date.now(),
		)
		.run();
}

/** A well-formed, unexpired state whose row is not yet written. */
function stateFixture(overrides: Partial<SeededState> = {}): SeededState {
	const state = overrides.state ?? `fixture-state-${crypto.randomUUID()}`;
	const now = Date.now();
	return {
		state,
		callbackURL: `${ORIGIN}/admin`,
		expiresAt: now + 10 * 60 * 1000,
		payloadExpiresAt: now + 10 * 60 * 1000,
		...overrides,
	};
}

interface CallbackOptions {
	/** `state` echoed by the browser; omit for the missing-state case. */
	state?: string;
	/** Value of the `better-auth.state` cookie; omit for "no cookie". */
	cookieState?: string;
	/** Raw `Cookie` header value, used verbatim (forged-signature case). */
	rawCookie?: string;
	/** Extra query parameters appended verbatim to the callback URL. */
	extraQuery?: Record<string, string>;
}

/** Drive a real request through the Worker entry to Better Auth's callback. */
async function fetchCallback(path: string, options: CallbackOptions = {}): Promise<Response> {
	const url = new URL(`${ORIGIN}/api/v1/auth/callback/${path}`);
	url.searchParams.set('code', 'fake-authorization-code');
	if (options.state !== undefined) url.searchParams.set('state', options.state);
	for (const [key, value] of Object.entries(options.extraQuery ?? {})) {
		url.searchParams.set(key, value);
	}
	const headers = new Headers();
	if (options.rawCookie !== undefined) {
		headers.set('Cookie', options.rawCookie);
	} else if (options.cookieState !== undefined) {
		headers.set('Cookie', `${STATE_COOKIE_NAME}=${await signedStateCookie(options.cookieState)}`);
	}
	return SELF.fetch(url.toString(), { redirect: 'manual', headers });
}

/** Drive a POST at the OAuth entry point that mints `state`. */
async function fetchSocialSignIn(
	body: Record<string, unknown>,
	headers: HeadersInit = {},
): Promise<Response> {
	return SELF.fetch(`${ORIGIN}/api/v1/auth/sign-in/social`, {
		method: 'POST',
		redirect: 'manual',
		headers: {
			'Content-Type': 'application/json',
			Origin: ORIGIN,
			Cookie: SESSIONLESS_COOKIE,
			...headers,
		},
		body: JSON.stringify(body),
	});
}

async function jsonBody(response: Response): Promise<{ code?: string; message?: string }> {
	return (await response.json()) as { code?: string; message?: string };
}

interface GuardRejection {
	/** Field the guard refused first. */
	param: string;
	/** Stable reason vocabulary from `src/http/security/redirect.ts`. */
	reason: string;
	/** Where the value was found. */
	source: 'query' | 'body';
}

/**
 * The project-owned open-redirect guard refuses the request itself:
 * `400`, a machine-readable body, and **no** `Location` header at all.
 *
 * A redirect is the thing being prevented, so its absence is asserted
 * explicitly rather than inferred from the status code. The body names
 * the field, the reason and the source, and never echoes the value —
 * that is also asserted, by exact equality.
 */
async function expectGuardRejectedWith(
	response: Response,
	expected: GuardRejection,
): Promise<void> {
	expect(response.status).toBe(400);
	expect(response.headers.get('location')).toBeNull();
	expect(await response.json()).toEqual({
		error: 'invalid_redirect_target',
		param: expected.param,
		reason: expected.reason,
		source: expected.source,
	});
}

/**
 * A rejected callback must answer with a redirect that stays on this
 * origin's own error page and carries the machine-readable reason.
 * An attacker who can move that `Location` off-origin has turned the
 * rejection into an open redirect, so the origin is asserted, not just
 * the query parameter.
 */
async function expectCallbackRejectedWith(response: Response, code: string): Promise<URL> {
	expect(response.status).toBe(302);
	const location = response.headers.get('location');
	expect(location).not.toBeNull();
	const url = new URL(location as string);
	expect(url.origin).toBe(ORIGIN);
	expect(url.pathname).toBe(ERROR_PATH);
	expect(url.searchParams.get('error')).toBe(code);
	return url;
}

/** No callback outcome may hand the caller a session. */
async function expectNoSessionIssued(response: Response): Promise<void> {
	expect(response.headers.get('set-cookie') ?? '').not.toContain('session_token');
	const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM session').first<{ c: number }>();
	expect(row?.c ?? 0).toBe(0);
}

describe('oauth callback — state binding', () => {
	beforeEach(async () => {
		await env.DB.prepare('DELETE FROM verification').run();
		await env.DB.prepare('DELETE FROM session').run();
	});
	afterEach(async () => {
		await env.DB.prepare('DELETE FROM verification').run();
		await env.DB.prepare('DELETE FROM session').run();
	});

	// Positive control: without it, "every callback fails" would look
	// like a passing suite.
	it('accepts a correctly bound state and stops at the provider gate', async () => {
		const seeded = stateFixture();
		await seedState(seeded);

		const res = await fetchCallback('google', {
			state: seeded.state,
			cookieState: seeded.state,
		});

		// `state` parsed, so the flow advanced past every state gate and
		// failed at the next one: this deployment configures no social
		// provider, so no code exchange can happen.
		const url = await expectCallbackRejectedWith(res, 'oauth_provider_not_found');
		expect(url.origin).toBe(ORIGIN);
		await expectNoSessionIssued(res);
	});

	it('propagates a provider error when the state is correctly bound', async () => {
		const seeded = stateFixture();
		await seedState(seeded);

		const url = new URL(`${ORIGIN}/api/v1/auth/callback/google`);
		url.searchParams.set('error', 'access_denied');
		url.searchParams.set('state', seeded.state);
		const res = await SELF.fetch(url.toString(), {
			redirect: 'manual',
			headers: { Cookie: `${STATE_COOKIE_NAME}=${await signedStateCookie(seeded.state)}` },
		});

		await expectCallbackRejectedWith(res, 'access_denied');
		await expectNoSessionIssued(res);
	});

	it('rejects a callback that carries no state at all', async () => {
		const res = await fetchCallback('google');

		await expectCallbackRejectedWith(res, 'state_not_found');
		await expectNoSessionIssued(res);
	});

	it('rejects a tampered state that was never issued', async () => {
		const issued = stateFixture();
		// The row is never written: an attacker who mints their own
		// `state` has no server-side half to pair with.
		const tampered = `${issued.state}-tampered`;

		const res = await fetchCallback('google', {
			state: tampered,
			cookieState: tampered,
		});

		await expectCallbackRejectedWith(res, 'state_mismatch');
		await expectNoSessionIssued(res);
	});

	it('rejects a state whose browser cookie was signed for a different state', async () => {
		const victim = stateFixture();
		const other = stateFixture();
		await seedState(victim);

		// Replay shape: the victim's row and query parameter are intact,
		// but the cookie an attacker can supply belongs to another flow.
		const res = await fetchCallback('google', {
			state: victim.state,
			cookieState: other.state,
		});

		await expectCallbackRejectedWith(res, 'state_mismatch');
		await expectNoSessionIssued(res);
	});

	it('rejects a valid server-side state when the browser cookie is absent', async () => {
		const seeded = stateFixture();
		await seedState(seeded);

		// The cookie is the half that proves the callback belongs to the
		// browser that started the flow. Without it the DB row alone is
		// not enough (OWASP ASVS V3 session/state binding).
		const res = await fetchCallback('google', { state: seeded.state });

		await expectCallbackRejectedWith(res, 'state_mismatch');
		await expectNoSessionIssued(res);
	});

	it('rejects an expired state', async () => {
		const past = Date.now() - 60 * 1000;
		const seeded = stateFixture({ expiresAt: past, payloadExpiresAt: past });
		await seedState(seeded);

		const res = await fetchCallback('google', {
			state: seeded.state,
			cookieState: seeded.state,
		});

		await expectCallbackRejectedWith(res, 'state_mismatch');
		await expectNoSessionIssued(res);
	});

	it('rejects a replay of a state that was already consumed', async () => {
		const seeded = stateFixture();
		await seedState(seeded);

		const first = await fetchCallback('google', {
			state: seeded.state,
			cookieState: seeded.state,
		});
		await expectCallbackRejectedWith(first, 'oauth_provider_not_found');

		// Better Auth deletes the verification row while consuming the
		// state, so the same parameters a second time are worthless.
		const second = await fetchCallback('google', {
			state: seeded.state,
			cookieState: seeded.state,
		});
		await expectCallbackRejectedWith(second, 'state_mismatch');
		await expectNoSessionIssued(second);
	});

	it('rejects a forged state cookie even when the server-side row is valid', async () => {
		const seeded = stateFixture();
		await seedState(seeded);

		// Well-formed value, invalid HMAC: the browser half of the
		// binding is present but was not signed by this Worker, so it
		// cannot be trusted to belong to the flow the row describes.
		const res = await fetchCallback('google', {
			state: seeded.state,
			rawCookie: `${STATE_COOKIE_NAME}=${seeded.state}.forged-signature`,
		});

		await expectCallbackRejectedWith(res, 'state_mismatch');
		await expectNoSessionIssued(res);
	});

	it('refuses a redirect target injected on the callback request', async () => {
		const seeded = stateFixture();
		await seedState(seeded);

		// `callbackURL` on the **callback** request is attacker-controlled
		// and is not where the post-sign-in target comes from: that value
		// lives in the signed state. The boundary refuses the request
		// before any handler runs, so there is no redirect for a browser
		// to follow to the attacker's host.
		const res = await fetchCallback('google', {
			state: seeded.state,
			cookieState: seeded.state,
			extraQuery: {
				callbackURL: 'https://attacker.example/collect',
				redirectTo: 'https://attacker.example/collect',
				errorCallbackURL: 'https://attacker.example/collect',
			},
		});

		await expectGuardRejectedWith(res, {
			param: 'callbackURL',
			reason: 'external_origin',
			source: 'query',
		});
		await expectNoSessionIssued(res);
	});
});

describe('oauth entry point — redirect and origin guards', () => {
	it('accepts a relative callbackURL (positive control)', async () => {
		// Passing the project guard *and* Better Auth's origin check means
		// the request reached the provider lookup; the 404 is the honest
		// answer for a deployment that configures no provider.
		const res = await fetchSocialSignIn({ provider: 'google', callbackURL: '/admin' });

		expect(res.status).toBe(404);
		expect((await jsonBody(res)).code).toBe('PROVIDER_NOT_FOUND');
		await expectNoSessionIssued(res);
	});

	it('refuses an absolute same-origin callbackURL while BETTER_AUTH_URL is unbound', async () => {
		// Fail-closed, and observed on purpose. The test pool has no
		// `BETTER_AUTH_URL`, so the guard's trusted-origin list is empty
		// and even this origin's own absolute URL is refused. With the
		// production binding (ADR-0014) the same value is trusted and
		// downgraded to `/admin`, which this pool cannot represent.
		const res = await fetchSocialSignIn({ provider: 'google', callbackURL: `${ORIGIN}/admin` });

		await expectGuardRejectedWith(res, {
			param: 'callbackURL',
			reason: 'external_origin',
			source: 'body',
		});
	});

	it('rejects an off-origin callbackURL', async () => {
		const res = await fetchSocialSignIn({
			provider: 'google',
			callbackURL: 'https://attacker.example/collect',
		});

		await expectGuardRejectedWith(res, {
			param: 'callbackURL',
			reason: 'external_origin',
			source: 'body',
		});
		await expectNoSessionIssued(res);
	});

	it('rejects a protocol-relative callbackURL', async () => {
		// `//attacker.example` inherits the current scheme and is the
		// classic way to smuggle a host past a naive prefix check.
		const res = await fetchSocialSignIn({
			provider: 'google',
			callbackURL: '//attacker.example/collect',
		});

		await expectGuardRejectedWith(res, {
			param: 'callbackURL',
			reason: 'protocol_relative',
			source: 'body',
		});
		await expectNoSessionIssued(res);
	});

	it('rejects an off-origin errorCallbackURL', async () => {
		const res = await fetchSocialSignIn({
			provider: 'google',
			errorCallbackURL: 'https://attacker.example/collect',
		});

		await expectGuardRejectedWith(res, {
			param: 'errorCallbackURL',
			reason: 'external_origin',
			source: 'body',
		});
		await expectNoSessionIssued(res);
	});

	it('rejects an off-origin newUserCallbackURL', async () => {
		const res = await fetchSocialSignIn({
			provider: 'google',
			newUserCallbackURL: 'https://attacker.example/collect',
		});

		await expectGuardRejectedWith(res, {
			param: 'newUserCallbackURL',
			reason: 'external_origin',
			source: 'body',
		});
		await expectNoSessionIssued(res);
	});

	it('rejects an off-origin redirectTo', async () => {
		const res = await fetchSocialSignIn({
			provider: 'google',
			redirectTo: 'https://attacker.example/collect',
		});

		await expectGuardRejectedWith(res, {
			param: 'redirectTo',
			reason: 'external_origin',
			source: 'body',
		});
		await expectNoSessionIssued(res);
	});

	it('rejects a cross-site Origin header', async () => {
		const res = await fetchSocialSignIn(
			{ provider: 'google' },
			{ Origin: 'https://attacker.example' },
		);

		expect(res.status).toBe(403);
		expect((await jsonBody(res)).code).toBe('INVALID_ORIGIN');
		await expectNoSessionIssued(res);
	});

	it('rejects a cross-site Referer when no Origin is sent', async () => {
		const res = await fetchSocialSignIn(
			{ provider: 'google' },
			{ Origin: '', Referer: 'https://attacker.example/form' },
		);

		expect(res.status).toBe(403);
		expect((await jsonBody(res)).code).toBe('INVALID_ORIGIN');
		await expectNoSessionIssued(res);
	});

	it('rejects a cookie-bearing request with no Origin and no Referer', async () => {
		const res = await fetchSocialSignIn({ provider: 'google' }, { Origin: '' });

		expect(res.status).toBe(403);
		expect((await jsonBody(res)).code).toBe('MISSING_OR_NULL_ORIGIN');
		await expectNoSessionIssued(res);
	});
});
