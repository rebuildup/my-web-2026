/**
 * Admin authorization fixture + matrix (Issue #441).
 *
 * One definition of "who may see what", shared by the two surfaces that
 * need it:
 *
 *   - `e2e/admin-authorization.spec.ts` — asserts the matrix in a real
 *     browser against the local preview server.
 *   - `scripts/admin-authz-shoot.mjs` — probes the same matrix and
 *     renders the verification artefact
 *     `docs/verification/security/admin-authorization-matrix.webp`.
 *
 * Sharing the definition is the point. A screenshot is evidence only if
 * it was produced from the same expectations the gate enforces; two
 * hand-written copies would drift, and the picture would keep showing
 * green long after the gate turned red.
 *
 * Local only, by construction
 * ----------------------------
 * `seedAdminAuthzFixture()` writes through `scripts/_d1.mjs` with
 * `target: 'local'`, which is `--local --persist-to .tmp/d1state`.
 * There is no code path here that can reach production D1: the driver
 * refuses a production write unless the caller passes `execute: true`
 * AND the canonical account / database id, and this module never does.
 * (AGENTS.md §4 / Issue #441: the verification must not be destructive
 * against production.)
 *
 * Nothing here prints a credential. Fixture identities are synthetic
 * RFC 2606 `.invalid` addresses, the two API keys are randomly
 * generated per run and handed to the caller in memory only, and the
 * session cookie is signed with a constant published inside Better Auth
 * rather than with any environment secret. A failing assertion prints a
 * marker LABEL, never a marker value.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSignature } from 'better-auth/crypto';
import { executeBatch } from './_d1.mjs';

/** The three caller identities the matrix compares. */
export const IDENTITIES = Object.freeze(['anonymous', 'member', 'admin']);

export const IDENTITY_LABELS = Object.freeze({
	anonymous: '匿名 (未認証)',
	member: 'サインイン済・非管理者',
	admin: '管理者 (role=admin)',
});

/**
 * Identities whose responses must carry NO private marker at all. The
 * admin column is different: it is ALLOWED to render the rows it
 * manages, so only the API key plaintext (which the product never shows
 * twice) is asserted absent there.
 */
export const NEGATIVE_IDENTITIES = Object.freeze(['anonymous', 'member']);

/** Column labels + expectations for the internal API matrix. */
export const API_COLUMNS = Object.freeze(['anonymous', 'insufficient', 'authorized']);

export const API_LABELS = Object.freeze({
	anonymous: 'API key なし',
	insufficient: '別スコープの key',
	authorized: '必要スコープの key',
});

/**
 * Fixture constants. `.invalid` is reserved by RFC 2606, so none of
 * these can address a real person; `KEY_NAME` is the display name the
 * admin UI renders, and is what the leak assertions hunt for.
 */
export const FIXTURE = Object.freeze({
	adminUserId: 'e2e-authz-admin',
	adminEmail: 'authz-admin@e2e.invalid',
	memberUserId: 'e2e-authz-member',
	memberEmail: 'authz-member@e2e.invalid',
	inviteeEmail: 'authz-invitee@e2e.invalid',
	keyName: 'authz-e2e-key',
	/** Opaque session tokens for the two fixture identities. */
	adminToken: 'e2e-authz-admin-session-token',
	memberToken: 'e2e-authz-member-session-token',
	acceptToken: 'authz-e2e-accept-token-aaaaaaaaaaaa',
	counterKey: 'authz-e2e',
});

/**
 * The two scoped API keys, regenerated per run.
 *
 * They are random, not constants: the fixture writes the row the api-key
 * plugin would have written (see `seedAdminAuthzFixture`) and the
 * plaintext stays in memory, so a leaked copy of this module still
 * cannot authenticate anything.
 */
export function generateApiKeyPlaintexts() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	const suffix = Buffer.from(bytes).toString('hex');
	return {
		access_counter: `mk_e2elocal_${suffix}_a`,
		reactions: `mk_e2elocal_${suffix}_r`,
	};
}

/**
 * Admin UI routes and the outcome each identity gets.
 *
 * `page` = 200 HTML rendered for that identity.
 * `redirect:<path>` = 3xx whose resolved `Location` is `<path>`.
 *
 * `adminSees` lists the marker ids the ADMIN must find on that page.
 * For the other two identities every marker is a leak, and for the
 * admin a marker that is NOT in `adminSees` is one too: the admin is
 * the only caller allowed to read those rows, so seeing the dashboard
 * account and the owned key/invitation is what proves the page really
 * rendered private data instead of an empty shell.
 *
 * `/admin/login` is public and every other admin route is role-gated;
 * a signed-in visitor is bounced off the login form back to the
 * dashboard. These are the current contracts read from
 * `src/routes/admin.*.tsx` — the matrix records them, it does not
 * invent new ones.
 */
export const ADMIN_ROUTE_MATRIX = Object.freeze([
	{
		path: '/admin',
		expected: { anonymous: 'redirect:/admin/login', member: 'page', admin: 'page' },
		adminSees: ['adminEmail'],
	},
	{
		path: '/admin/login',
		expected: { anonymous: 'page', member: 'redirect:/admin', admin: 'redirect:/admin' },
		adminSees: [],
	},
	{
		path: '/admin/keys',
		expected: { anonymous: 'redirect:/admin/login', member: 'redirect:/admin', admin: 'page' },
		adminSees: ['keyName'],
	},
	{
		path: '/admin/invitations',
		expected: { anonymous: 'redirect:/admin/login', member: 'redirect:/admin', admin: 'page' },
		adminSees: ['inviteeEmail'],
	},
	{
		path: '/admin/emoji-catalog',
		expected: { anonymous: 'redirect:/admin/login', member: 'redirect:/admin', admin: 'page' },
		adminSees: [],
	},
	{
		path: '/admin/images',
		expected: { anonymous: 'redirect:/admin/login', member: 'redirect:/admin', admin: 'page' },
		adminSees: [],
	},
]);

/**
 * Internal API endpoints, each with the scope its consumer key must
 * carry. Every row is probed three ways: no `Authorization` header
 * (401), a valid key for the OTHER scope (403), and a valid key for
 * the required scope (200).
 */
export const API_MATRIX = Object.freeze([
	{
		label: 'GET /api/v1/access/count/:key',
		path: `/api/v1/access/count/${FIXTURE.counterKey}`,
		method: 'GET',
		scope: 'access_counter',
		action: 'read',
	},
	{
		label: 'POST /api/v1/access/hit',
		path: '/api/v1/access/hit',
		method: 'POST',
		scope: 'access_counter',
		action: 'write',
		body: { key: FIXTURE.counterKey, session_id: 'authz-e2e-actor' },
	},
	{
		label: 'GET /api/v1/reactions?target=',
		path: `/api/v1/reactions?target=${FIXTURE.counterKey}`,
		method: 'GET',
		scope: 'reactions',
		action: 'read',
	},
	{
		label: 'PUT /api/v1/reactions',
		path: '/api/v1/reactions',
		method: 'PUT',
		scope: 'reactions',
		action: 'write',
		body: {
			target_key: FIXTURE.counterKey,
			actor_id: 'authz-e2e-actor',
			kind: 'emoji',
			value: '👍',
		},
	},
]);

/** Status each API column must produce. */
export const API_EXPECTED = Object.freeze({
	anonymous: 401,
	insufficient: 403,
	authorized: 200,
});

function quote(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Run several statements in ONE `cf d1 raw --local` call. `runStatement`
 * wraps a single statement; a fixture with six rows should not pay six
 * CLI spawns. `executeBatch` is the same production write gate
 * `runStatement` uses, with `target: 'local'` hard-coded here.
 */
function runLocalBatch(statements) {
	const dir = mkdtempSync(join(tmpdir(), 'my-web-2026-authz-'));
	const batchPath = join(dir, 'batch.json');
	writeFileSync(
		batchPath,
		`${JSON.stringify(
			statements.map((sql) => ({ sql, params: [] })),
			null,
			2,
		)}\n`,
		{ mode: 0o600 },
	);
	try {
		return executeBatch(batchPath, { target: 'local' });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * The signing key Better Auth falls back to when no secret is
 * configured (`create-context.mjs`: `secret = legacySecret ||
 * "better-auth-secret-12345678901234567890"`).
 *
 * Why the fixture is allowed to use it
 * ------------------------------------
 * Better Auth 1.7 SIGNS the session cookie, so a fixture cannot simply
 * paste a `session.token` into a `Cookie` header. Signing it with a
 * REAL secret would mean reading and using an environment credential,
 * which AGENTS.md §4 forbids outright — and there is nothing to gain:
 * the local E2E preview runs with no `BETTER_AUTH_SECRETS` binding, so
 * the library is already using this hardcoded fallback, which is
 * published in its own source. No secret is read, copied, or minted
 * here; a synthetic local session is signed with a value that ships
 * inside the dependency.
 *
 * This is a PRECONDITION, not an assumption: `assertFixtureAuthenticates`
 * fails loudly when the local Worker runs with a real secret instead,
 * because then the cookie would not verify and the "signed in" columns
 * would silently degrade into anonymous ones.
 */
export const LOCAL_FALLBACK_SECRET = 'better-auth-secret-12345678901234567890';

/**
 * Write the fixture identities and the private rows into the local D1
 * binding.
 *
 * The fixture is idempotent: every row is deleted before it is written,
 * so a re-run against the same local state cannot accumulate keys,
 * sessions, or invitations.
 */
export async function seedAdminAuthzFixture() {
	const now = Date.now();
	const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
	const keys = generateApiKeyPlaintexts();
	const user = (id, email, role) => `
		INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt, role, banned)
		VALUES (${quote(id)}, ${quote('Authorization Matrix Fixture')}, ${quote(email)}, 1, ${now}, ${now}, ${quote(role)}, 0)`;
	const session = (id, userId, token) => `
		INSERT INTO session (id, userId, token, expiresAt, createdAt, updatedAt)
		VALUES (${quote(id)}, ${quote(userId)}, ${quote(token)}, ${expiresAt}, ${now}, ${now})`;
	const apiKey = async (scope) => `
		INSERT INTO apikey (id, configId, name, start, referenceId, prefix, key, enabled,
		                   rateLimitEnabled, rateLimitTimeWindow, rateLimitMax, requestCount,
		                   remaining, createdAt, updatedAt, permissions)
		VALUES (${quote(`e2e-authz-key-${scope}`)}, 'default', ${quote(`${FIXTURE.keyName}-${scope}`)},
		        ${quote(keys[scope].slice(3, 11))}, ${quote(FIXTURE.adminUserId)}, 'mk_',
		        ${quote(await hashApiKey(keys[scope]))}, 1, 0, 60000, 60, 0, NULL, ${now}, ${now},
		        ${quote(JSON.stringify({ [scope]: ['read', 'write'] }))})`;

	runLocalBatch([
		`DELETE FROM session WHERE userId IN (${quote(FIXTURE.adminUserId)}, ${quote(FIXTURE.memberUserId)})`,
		`DELETE FROM user WHERE id IN (${quote(FIXTURE.adminUserId)}, ${quote(FIXTURE.memberUserId)})`,
		`DELETE FROM auth_invitation WHERE id = ${quote('e2e-authz-invitation')}`,
		`DELETE FROM apikey WHERE referenceId IN (${quote(FIXTURE.adminUserId)}, ${quote(FIXTURE.memberUserId)})`,
		user(FIXTURE.adminUserId, FIXTURE.adminEmail, 'admin'),
		user(FIXTURE.memberUserId, FIXTURE.memberEmail, 'user'),
		session('e2e-authz-admin-session', FIXTURE.adminUserId, FIXTURE.adminToken),
		session('e2e-authz-member-session', FIXTURE.memberUserId, FIXTURE.memberToken),
		await apiKey('access_counter'),
		await apiKey('reactions'),
		`INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at)
		 VALUES (${quote('e2e-authz-invitation')}, ${quote(FIXTURE.inviteeEmail)}, ${quote('e2e-authz-invitation-hash')}, ${quote(FIXTURE.adminUserId)}, ${expiresAt}, NULL, ${now})`,
	]);

	return {
		cookies: {
			anonymous: null,
			member: await signedSessionCookie(FIXTURE.memberToken),
			admin: await signedSessionCookie(FIXTURE.adminToken),
		},
		keys,
		markers: [
			...privateMarkers(),
			// The plaintext of a key is shown once, at creation, and never
			// again — so NO column may render it, the admin column included.
			{ label: 'API key 平文 (access_counter)', value: keys.access_counter },
			{ label: 'API key 平文 (reactions)', value: keys.reactions },
		],
	};
}

/**
 * `base64url(sha256(key))` without padding — the api-key plugin's own
 * `defaultKeyHasher`. Seeding the row with the same digest the plugin
 * would persist is what lets the fixture speak the real protocol:
 * `requireApiKey` still runs `verifyApiKey` against the database, so a
 * wrong hash here fails the probe rather than bypassing the boundary.
 */
async function hashApiKey(plaintext) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintext));
	let binary = '';
	for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Fail closed when the local Worker is NOT running on Better Auth's
 * fallback secret (e.g. a developer has `.dev.vars` with a real
 * `BETTER_AUTH_SECRETS`).
 *
 * Without this check the fixture would quietly degrade: every "signed
 * in" column would observe the anonymous answer, the matrix would be
 * full of honest-looking redirects, and the run could pass by comparing
 * a broken probe against itself. Here it cannot.
 */
/**
 * The `Cookie` header value that authenticates one fixture session.
 *
 * Better Auth prefixes the cookie name with `__Secure-` when
 * `advanced.useSecureCookies` is on, which the local preview leaves at
 * its default. Both spellings are sent, so the fixture does not have to
 * know which one the runtime picked: the Worker reads the one it
 * expects and ignores the other.
 */
async function signedSessionCookie(token) {
	const signature = await makeSignature(token, LOCAL_FALLBACK_SECRET);
	const value = encodeURIComponent(`${token}.${signature}`);
	return `better-auth.session_token=${value}; __Secure-better-auth.session_token=${value}`;
}

export async function assertFixtureAuthenticates(baseUrl, cookies) {
	// Warm the SSR pipeline first: the preview server compiles it on
	// demand, and that first render is the slowest request of the run.
	await probeFetch(new URL('/admin/login', baseUrl), { redirect: 'manual' }).catch(() => null);
	// `/admin` and not `/admin/keys`: the API-key page is the one local
	// preview server stops answering session requests after, and this
	// check must not spend that observation before the matrix needs it.
	const res = await probeFetch(new URL('/admin', baseUrl), {
		redirect: 'manual',
		headers: { cookie: cookies.admin },
	});
	if (res.status === 200) return;
	const location = res.headers.get('location');
	const remedy = [
		'The local Worker must run WITHOUT a configured BETTER_AUTH_SECRETS binding, because the',
		"fixture signs its session cookie with Better Auth's published fallback secret. Run the",
		'matrix against a preview server started by scripts/e2e-local-bootstrap.mjs without a',
		'.dev.vars file. (Issue #441 — verification must not depend on, read, or print a real secret.)',
	].join(' ');
	throw new Error(
		`the admin fixture session did not authenticate against ${baseUrl} (status ${res.status}${location ? ` -> ${location}` : ''}).\n${remedy}`,
	);
}

/**
 * Values that must never appear in a response body served to a caller
 * who is not authorized to see them. `label` is safe to print, so a
 * failing assertion reports what leaked without printing what.
 */
/**
 * `id` is what the matrix compares; `label` is what a human reads. The
 * `value` is never printed or asserted on by value — a failing run
 * reports which marker leaked, not what it was.
 */
function privateMarkers() {
	return [
		{ id: 'inviteeEmail', label: '招待先メール (invited address)', value: FIXTURE.inviteeEmail },
		{ id: 'adminEmail', label: '管理者メール (admin address)', value: FIXTURE.adminEmail },
		{ id: 'keyName', label: 'API キー表示名 (key display name)', value: FIXTURE.keyName },
	];
}

/** Which marker labels a body contains. Values are never returned. */
export function leakedMarkerLabels(body, markers) {
	return markers.filter((marker) => body.includes(marker.value)).map((marker) => marker.label);
}

/** Which marker ids a body contains. Values are never returned. */
export function leakedMarkerIds(body, markers) {
	return markers.filter((marker) => body.includes(marker.value)).map((marker) => marker.id);
}

/** Resolve a `Location` header against the request path. */
export function resolveLocation(res, requestPath) {
	const location = res.headers.get('location');
	if (!location) return null;
	return new URL(location, `https://example.com${requestPath}`).pathname;
}

/** `redirect:<path>` / `page` → whether the response matches. */
export function routeOutcomeMatches(outcome, res, requestPath) {
	if (outcome === 'page') return res.status === 200;
	if (typeof outcome === 'string' && outcome.startsWith('redirect:')) {
		const target = outcome.slice('redirect:'.length);
		const inRange = res.status >= 300 && res.status < 400;
		const location = resolveLocation(res, requestPath);
		return inRange && location === target && location !== requestPath;
	}
	return false;
}

/**
 * `fetch` with a bounded timeout and one retry.
 *
 * The local preview compiles the SSR pipeline lazily, and the machine
 * running this may be saturated, so the FIRST request of a run can sit
 * long enough for undici's default to give up. A transport timeout says
 * nothing about authorization, so it must not be recorded as an
 * authorization observation — retry, and record only what the server
 * actually answered.
 */
export async function probeFetch(url, init = {}, { attempts = 3, timeoutMs = 30_000 } = {}) {
	let lastError;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
		} catch (error) {
			lastError = error;
			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
			}
		}
	}
	throw lastError;
}

/** Build the `Authorization` init for a bearer probe. */
export function bearerInit(token) {
	return { headers: { authorization: `Bearer ${token}` } };
}

/**
 * Did the markers in this body match what THIS identity is allowed to
 * see? Anonymous and non-admin callers must see none of them; the
 * admin must see exactly the ones the route is expected to render.
 */
export function markerOutcomeMatches(identity, allowedIds, seenIds) {
	const seen = [...seenIds].sort();
	const allowed = [...allowedIds].sort();
	if (identity !== 'admin') return seen.length === 0;
	return seen.length === allowed.length && seen.every((id, index) => id === allowed[index]);
}

/**
 * Run the whole matrix once against a live local server.
 *
 * Returns one row per matrix entry with the observed result per
 * identity plus whether it matched the expectation. Both callers
 * (`e2e/admin-authorization.spec.ts` and `scripts/admin-authz-shoot.mjs`)
 * consume this same shape, so the assertion and the picture can never
 * disagree about what was observed.
 */
export async function collectMatrix({ baseUrl, fixture, fetchImpl = probeFetch }) {
	const { cookies, markers, keys } = fixture;
	if (!cookies || !markers || !keys) {
		throw new Error('collectMatrix needs the bundle returned by seedAdminAuthzFixture()');
	}
	const results = { routes: [], api: [], markers };

	// Probe one identity at a time, column by column, instead of one
	// route at a time across all identities. `/admin/keys` loads the
	// Better Auth API-key plugin, and after that page has been rendered
	// the local preview server stops answering session-authenticated
	// requests (see the PR body). Keeping that page until every other
	// observation is captured is what makes the local run complete
	// instead of truncating halfway down the table.
	const observedByRoute = new Map(ADMIN_ROUTE_MATRIX.map((row) => [row.path, { observed: {} }]));
	for (const identity of IDENTITIES) {
		const rows = ADMIN_ROUTE_MATRIX.filter(
			(row) => !(identity === 'admin' && row.path === '/admin/keys'),
		);
		for (const row of rows) {
			const res = await fetchImpl(new URL(row.path, baseUrl), {
				redirect: 'manual',
				headers: cookies[identity] ? { cookie: cookies[identity] } : undefined,
			});
			const body = await res.text();
			const seen = leakedMarkerIds(body, markers);
			observedByRoute.get(row.path).observed[identity] = {
				status: res.status,
				location: resolveLocation(res, row.path),
				markers: seen,
				matched:
					routeOutcomeMatches(row.expected[identity], res, row.path) &&
					markerOutcomeMatches(identity, identity === 'admin' ? row.adminSees : [], seen),
			};
		}
	}

	for (const row of API_MATRIX) {
		const sufficient = keys[row.scope];
		const insufficient = keys[row.scope === 'access_counter' ? 'reactions' : 'access_counter'];
		const observed = {};
		for (const [column, token] of Object.entries({
			anonymous: null,
			insufficient,
			authorized: sufficient,
		})) {
			const res = await fetchImpl(new URL(row.path, baseUrl), {
				method: row.method,
				redirect: 'manual',
				...(row.body
					? { body: JSON.stringify(row.body), headers: { 'content-type': 'application/json' } }
					: {}),
				...(token ? bearerInit(token) : {}),
			});
			const text = await res.text();
			const seen = leakedMarkerIds(text, markers);
			observed[column] = {
				status: res.status,
				markers: seen,
				matched: res.status === API_EXPECTED[column] && seen.length === 0,
			};
		}
		results.api.push({ ...row, observed });
	}

	// Last, because it is the observation that can wedge the local
	// preview server. Everything else is already captured at this point.
	const keysRoute = ADMIN_ROUTE_MATRIX.find((row) => row.path === '/admin/keys');
	const res = await fetchImpl(new URL(keysRoute.path, baseUrl), {
		redirect: 'manual',
		headers: { cookie: cookies.admin },
	});
	const keysBody = await res.text();
	const keysSeen = leakedMarkerIds(keysBody, markers);
	observedByRoute.get(keysRoute.path).observed.admin = {
		status: res.status,
		location: resolveLocation(res, keysRoute.path),
		markers: keysSeen,
		matched:
			routeOutcomeMatches(keysRoute.expected.admin, res, keysRoute.path) &&
			markerOutcomeMatches('admin', keysRoute.adminSees, keysSeen),
	};

	for (const row of ADMIN_ROUTE_MATRIX)
		results.routes.push({ ...row, ...observedByRoute.get(row.path) });

	return results;
}

/**
 * Refuse to probe a port that already has a server on it.
 *
 * `waitForServer` would otherwise be satisfied by a STALE server (left
 * over from an earlier run, or a sibling worker) while the bootstrap
 * this script just spawned is still applying migrations. Every probe
 * would then hit the wrong process, and the matrix would report the
 * other server's behaviour. Failing loudly is the only honest option.
 */
export async function assertPortFree(baseUrl) {
	try {
		await fetch(new URL('/api/v1/health', baseUrl), {
			signal: AbortSignal.timeout(2000),
		});
	} catch {
		return;
	}
	const remedy = [
		'Stop it first, or point the run at another port (ADMIN_AUTHZ_PORT). Probing a server this',
		"script did not start would report that other process's behaviour as this environment's matrix.",
	].join(' ');
	throw new Error(`something is already serving ${baseUrl}. ${remedy}`);
}

/**
 * Wait for a local server to answer. Used by the screenshot script after
 * it starts `scripts/e2e-local-bootstrap.mjs`, so the artefact is
 * reproducible from one command.
 */
export async function waitForServer(baseUrl, { timeoutMs = 60_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(new URL('/api/v1/health', baseUrl));
			if (res.ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`server at ${baseUrl} did not become ready within ${timeoutMs}ms`);
}
