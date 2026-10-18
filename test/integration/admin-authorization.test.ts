/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { auth } from '../helpers/better-auth';

/**
 * Admin authorization matrix (Issue #441).
 *
 * What this file proves
 * ---------------------
 * The admin surface has TWO independent gates, and both are compared
 * here for three caller identities — anonymous, signed-in-but-not-admin,
 * and admin — across every route and internal API in the set:
 *
 *   1. Admin UI routes (`/admin/*`) — gated by each route loader
 *      (`getCurrentSession()` + `role === 'admin'`).
 *   2. Internal APIs (`/api/v1/access/*`, `/api/v1/reactions/*`) —
 *      gated by `requireApiKey` + `requireResourceAction` in
 *      `src/http/api-keys/middleware.ts`.
 *
 * Both gates are exercised through `SELF.fetch`, i.e. the real Worker
 * entry `src/server.ts`, so the assertions cover the SSR pipeline and
 * the Hono external boundary exactly as production serves them. A unit
 * test on the loader or the middleware alone would pass under a
 * mis-wired route: the redirect a browser actually receives is decided
 * by TanStack Start, and the JSON body a consumer actually receives is
 * decided by `src/http/hono.ts`'s `onError` mapping.
 *
 * No private data in the negative cases
 * -------------------------------------
 * Each negative assertion ALSO asserts that no private marker (the
 * invited address, the admin address, the API key display name, the
 * session token, the API key plaintext) appears anywhere in the
 * response body. A 403 that renders the row it refused to hand over is
 * still a leak; the status code alone would not catch it.
 *
 * Nothing here touches production. Every row is created inside the
 * workerd test pool's isolated D1 binding, and the assertions never
 * print a marker value — a failing assertion reports the marker LABEL
 * only, so a red run cannot leak a session token or key into CI logs
 * (AGENTS.md §4 / Issue #441).
 */

/**
 * Fixtures the admin loaders read. The inlined SQL MUST stay
 * byte-identical to the migration files (the workerd pool cannot
 * `fs.readFile`), for the same reason
 * `test/integration/reactions.test.ts` inlines 0003: a test that
 * validates a schema production does not run proves nothing.
 */
const MIGRATIONS = [
	{
		name: '0002_access_counter',
		queries: [
			`CREATE TABLE IF NOT EXISTS access_counters (
    key        TEXT PRIMARY KEY,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL
)`,
			`CREATE TABLE IF NOT EXISTS access_dedup (
    counter_key TEXT    NOT NULL,
    principal   TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (counter_key, principal, session_id)
)`,
			`CREATE INDEX IF NOT EXISTS idx_access_dedup_expires
    ON access_dedup(expires_at)`,
		],
	},
	{
		name: '0003_reactions',
		queries: [
			`CREATE TABLE reactions (
    id TEXT PRIMARY KEY,
    target_key TEXT NOT NULL,
    actor_id TEXT NOT NULL,            -- consumer-supplied opaque visitor id
    principal TEXT NOT NULL,           -- API key id (consumer)
    kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
    value TEXT NOT NULL,               -- emoji char or image id
    created_at INTEGER NOT NULL,
    UNIQUE (target_key, principal, actor_id, kind, value)
)`,
			'CREATE INDEX idx_reactions_target ON reactions(target_key)',
			'CREATE INDEX idx_reactions_target_kind ON reactions(target_key, kind)',
			`CREATE TABLE reaction_images (
    id TEXT PRIMARY KEY,
    content_hash TEXT UNIQUE NOT NULL,
    content_type TEXT NOT NULL,        -- image/png, image/jpeg, image/webp, image/gif
    size INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL
)`,
			'CREATE INDEX idx_reaction_images_hash ON reaction_images(content_hash)',
		],
	},
	{
		name: '0004_emoji_catalog',
		queries: [
			`CREATE TABLE IF NOT EXISTS reaction_emoji_catalog (
    slug         TEXT    PRIMARY KEY,
    codepoint    TEXT    NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
)`,
			`CREATE INDEX IF NOT EXISTS idx_reaction_emoji_catalog_enabled
    ON reaction_emoji_catalog(enabled)`,
			`INSERT OR IGNORE INTO reaction_emoji_catalog (slug, codepoint, enabled, created_by, created_at, updated_at)
VALUES
    ('thumbs_up', '👍', 1, NULL, 0, 0),
    ('tada', '🎉', 1, NULL, 0, 0),
    ('fire', '🔥', 1, NULL, 0, 0),
    ('eyes', '👀', 1, NULL, 0, 0),
    ('sparkles', '✨', 1, NULL, 0, 0),
    ('rocket', '🚀', 1, NULL, 0, 0),
    ('heart', '❤', 1, NULL, 0, 0),
    ('laughing', '😄', 1, NULL, 0, 0),
    ('thinking', '🤔', 1, NULL, 0, 0),
    ('clap', '👏', 1, NULL, 0, 0),
    ('wave', '👋', 1, NULL, 0, 0),
    ('check', '✅', 1, NULL, 0, 0),
    ('cross', '❌', 1, NULL, 0, 0),
    ('warning', '⚠️', 1, NULL, 0, 0),
    ('star', '⭐', 1, NULL, 0, 0),
    ('bulb', '💡', 1, NULL, 0, 0)`,
		],
	},
	{
		name: '0005_access_counter_principal',
		queries: [
			'DROP TABLE IF EXISTS access_counters',
			`CREATE TABLE access_counters (
    key        TEXT    NOT NULL,
    principal  TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL,
    PRIMARY KEY (key, principal)
)`,
		],
	},
];

/**
 * Fixture identities. `.invalid` is reserved by RFC 2606, so an address
 * in this namespace can never resolve to a real person — these are
 * synthetic local fixtures, not personal data.
 */
const ADMIN_EMAIL = 'authz-matrix-admin@e2e.invalid';
const MEMBER_EMAIL = 'authz-matrix-member@e2e.invalid';
const INVITEE_EMAIL = 'authz-matrix-invitee@e2e.invalid';
const KEY_NAME = 'authz-matrix-key';
const ACCEPT_TOKEN = 'authz-matrix-accept-token-aaaaaaaaaaaaaaaaaa';
/** Local-only fixture credential. Never a real password; never printed. */
const FIXTURE_PASSWORD = 'authz-matrix-fixture-password';

interface Marker {
	/** Human-readable name, safe to print in a failing assertion. */
	label: string;
	value: string;
}

interface Identity {
	cookie: string | null;
}

/**
 * Marker set rebuilt per test so the live session tokens are included.
 *
 * The non-admin fixture's OWN address is deliberately NOT a marker: the
 * dashboard renders the signed-in address it belongs to, and that is the
 * caller's own data, not a leak. The admin's address IS a marker,
 * because no non-admin caller may see it.
 */
let privateMarkers: Marker[] = [];

function expectNoPrivateData(body: string, markers: readonly Marker[] = privateMarkers): void {
	const leaked = markers.filter((marker) => body.includes(marker.value)).map((m) => m.label);
	expect(leaked).toEqual([]);
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a fixture user through Better Auth's own server-side admin API
 * (the same `create-user` path the invitation-accept flow uses), then
 * sign in over the real `/api/v1/auth/sign-in/email` endpoint to obtain
 * a genuine session cookie. No password hash is fabricated: the session
 * is one Better Auth itself minted and would accept.
 */
async function createIdentity(
	email: string,
	role: 'admin' | 'user',
): Promise<{ id: string; identity: Identity }> {
	const created = await auth.api.createUser({
		body: { email, password: FIXTURE_PASSWORD, name: 'Authz Matrix Fixture', role },
	});
	const id = String(created.user.id);

	const signIn = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email, password: FIXTURE_PASSWORD }),
	});
	if (signIn.status !== 200) {
		throw new Error(`fixture sign-in failed with status ${signIn.status}`);
	}
	const token = /better-auth\.session_token=([^;]+)/.exec(
		signIn.headers.get('set-cookie') ?? '',
	)?.[1];
	if (!token) {
		throw new Error('fixture sign-in returned no session cookie');
	}
	return { id, identity: { cookie: `better-auth.session_token=${token}` } };
}

interface ApiKeyFixture {
	/** Bearer credential. Used only in request headers; never printed. */
	token: string;
}

async function createApiKeyFixture(
	userId: string,
	name: string,
	permissions: Record<string, string[]>,
): Promise<ApiKeyFixture> {
	// Server-side `auth.api.createApiKey` mirrors what
	// `src/admin/keys/load.ts#createApiKeyImpl` does after `requireAdmin()`
	// has already gated the caller: the admin's own user id is the
	// `referenceId`, and the plaintext comes back exactly once.
	const created = (await auth.api.createApiKey({
		body: { name, userId, permissions },
	})) as { key?: string };
	if (!created.key) {
		throw new Error(`fixture API key ${name} was not created`);
	}
	return { token: created.key };
}

/** `redirect: 'manual'` — the browser follows these; the matrix must not. */
async function getRoute(path: string, identity: Identity): Promise<Response> {
	return SELF.fetch(`https://example.com${path}`, {
		redirect: 'manual',
		headers: identity.cookie ? { cookie: identity.cookie } : undefined,
	});
}

function locationPath(res: Response, requestPath: string): string {
	const location = res.headers.get('location') ?? '';
	return new URL(location, `https://example.com${requestPath}`).pathname;
}

/** Admin UI routes and the contract each identity gets. */
const ADMIN_ROUTES = [
	{ path: '/admin', anonymous: 'redirect:/admin/login', member: 'page', admin: 'page' },
	{ path: '/admin/login', anonymous: 'page', member: 'redirect:/admin', admin: 'redirect:/admin' },
	{
		path: '/admin/keys',
		anonymous: 'redirect:/admin/login',
		member: 'redirect:/admin',
		admin: 'page',
	},
	{
		path: '/admin/invitations',
		anonymous: 'redirect:/admin/login',
		member: 'redirect:/admin',
		admin: 'page',
	},
	{
		path: '/admin/emoji-catalog',
		anonymous: 'redirect:/admin/login',
		member: 'redirect:/admin',
		admin: 'page',
	},
	{
		path: '/admin/images',
		anonymous: 'redirect:/admin/login',
		member: 'redirect:/admin',
		admin: 'page',
	},
] as const;

/**
 * One fixture set for the whole file.
 *
 * The workerd pool shares one D1 binding across the tests in a file, so
 * the fixture is built once in `beforeAll` and only read afterwards.
 * Re-creating it per test would fail on the `user.email` UNIQUE
 * constraint (`src/admin/keys/load.test.ts` deletes its rows instead;
 * this file asserts against a stable snapshot, which is what a matrix
 * wants — every row must describe the same three identities).
 */
let anonymous: Identity;
let member: Identity;
let admin: Identity;
let accessKey: ApiKeyFixture;
let reactionsKey: ApiKeyFixture;

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);

	const adminUser = await createIdentity(ADMIN_EMAIL, 'admin');
	const memberUser = await createIdentity(MEMBER_EMAIL, 'user');
	admin = adminUser.identity;
	member = memberUser.identity;
	anonymous = { cookie: null };

	// One invited address plus one API key row: the private data the
	// negative cases must never see, in the two shapes the admin UI
	// renders them (an email list entry, a key display name).
	await env.DB.prepare(
		`INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at)
		 VALUES (?, ?, ?, ?, ?, NULL, ?)`,
	)
		.bind(
			'authz-matrix-inv',
			INVITEE_EMAIL,
			await sha256Hex(ACCEPT_TOKEN),
			adminUser.id,
			Date.now() + 60_000,
			Date.now(),
		)
		.run();

	accessKey = await createApiKeyFixture(adminUser.id, KEY_NAME, {
		access_counter: ['read', 'write'],
	});
	reactionsKey = await createApiKeyFixture(adminUser.id, KEY_NAME, {
		reactions: ['read', 'write'],
	});

	const tokens = [admin.cookie, member.cookie]
		.filter((cookie): cookie is string => Boolean(cookie))
		.map((cookie) => cookie.split('=')[1] ?? '')
		.filter((token) => token.length > 0);
	privateMarkers = [
		{ label: 'invited address', value: INVITEE_EMAIL },
		{ label: 'admin address', value: ADMIN_EMAIL },
		{ label: 'API key display name', value: KEY_NAME },
		...tokens.map((token, index) => ({ label: `session token #${index + 1}`, value: token })),
		{ label: 'access-scope API key plaintext', value: accessKey.token },
		{ label: 'reactions-scope API key plaintext', value: reactionsKey.token },
	];
});

function expectRouteOutcome(res: Response, outcome: string, requestPath: string): void {
	if (outcome.startsWith('redirect:')) {
		const target = outcome.slice('redirect:'.length);
		expect(res.status, `${requestPath} should redirect`).toBeGreaterThanOrEqual(300);
		expect(res.status, `${requestPath} should redirect`).toBeLessThan(400);
		expect(locationPath(res, requestPath)).toBe(target);
		// A redirect to itself is the Issue #106 regression: the caller
		// would loop forever and never reach any content.
		expect(locationPath(res, requestPath)).not.toBe(requestPath);
		return;
	}
	expect(res.status, `${requestPath} should render`).toBe(200);
	expect(res.headers.get('location')).toBeNull();
}

describe('admin UI routes — authorization matrix (Issue #441)', () => {
	for (const route of ADMIN_ROUTES) {
		it(`anonymous ${route.path} → ${route.anonymous}`, async () => {
			const res = await getRoute(route.path, anonymous);
			expectRouteOutcome(res, route.anonymous, route.path);
			expectNoPrivateData(await res.text());
		});

		it(`non-admin ${route.path} → ${route.member}`, async () => {
			const res = await getRoute(route.path, member);
			expectRouteOutcome(res, route.member, route.path);
			expectNoPrivateData(await res.text());
		});

		it(`admin ${route.path} → ${route.admin}`, async () => {
			const res = await getRoute(route.path, admin);
			expectRouteOutcome(res, route.admin, route.path);
		});
	}
});

describe('the negative columns are not vacuous (Issue #441)', () => {
	it('the admin column really renders the private rows the other columns must not', async () => {
		// A "no private data in the HTML" assertion is only meaningful if
		// the authorized column demonstrably CONTAINS that data. If the
		// SSR payload ever stopped inlining loader data, every negative
		// assertion below would keep passing while proving nothing.
		const dashboardHtml = await (await getRoute('/admin', admin)).text();
		expect(dashboardHtml).toContain(ADMIN_EMAIL);

		const keysHtml = await (await getRoute('/admin/keys', admin)).text();
		expect(keysHtml).toContain(KEY_NAME);
		expect(keysHtml).not.toContain(accessKey.token);
		expect(keysHtml).not.toContain(reactionsKey.token);

		const invitationsHtml = await (await getRoute('/admin/invitations', admin)).text();
		expect(invitationsHtml).toContain(INVITEE_EMAIL);
	});
});

describe('admin UI routes — the invitation-accept page stays token-gated, not session-gated', () => {
	it('is reachable anonymously for a valid token and leaks nothing else', async () => {
		// `/admin/invitations/accept` is PUBLIC by contract (ADR-0009 §4):
		// the token is the credential. Recording it as "allowed for all
		// three identities" is the honest matrix entry — asserting an
		// admin gate here would be fabricating a restriction the product
		// does not have. What must hold is that a page reachable without a
		// session renders ONLY the invited address behind a valid token.
		// The token itself is echoed back into the form by design (the
		// view posts it to `acceptInvitation`), so it is not a marker; the
		// admin surface's data is.
		const path = `/admin/invitations/accept?token=${encodeURIComponent(ACCEPT_TOKEN)}`;
		for (const identity of [anonymous, member, admin]) {
			const res = await getRoute(path, identity);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain(INVITEE_EMAIL);
			expectNoPrivateData(html, [
				{ label: 'admin address', value: ADMIN_EMAIL },
				{ label: 'API key display name', value: KEY_NAME },
				{ label: 'access-scope API key plaintext', value: accessKey.token },
				{ label: 'reactions-scope API key plaintext', value: reactionsKey.token },
			]);
		}
	});

	it('rejects an unknown token without revealing whether an address exists', async () => {
		const res = await getRoute(
			'/admin/invitations/accept?token=authz-matrix-unknown-token-0000',
			anonymous,
		);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).not.toContain(INVITEE_EMAIL);
		expectNoPrivateData(html);
	});
});

describe('internal APIs — API key scope matrix (Issue #441)', () => {
	/**
	 * The case list names the SCOPE, not the key fixture: `beforeAll`
	 * mints the keys, so a module-level array cannot capture the
	 * fixture objects by value. Resolving them inside the test keeps the
	 * positive and negative columns on the same row.
	 */
	const apiCases = [
		{
			label: 'GET /api/v1/access/count/:key',
			path: '/api/v1/access/count/authz-matrix',
			scope: 'access_counter',
		},
		{
			label: 'GET /api/v1/reactions?target=',
			path: '/api/v1/reactions?target=authz-matrix',
			scope: 'reactions',
		},
	] as const;

	function keyFor(scope: 'access_counter' | 'reactions'): ApiKeyFixture {
		return scope === 'access_counter' ? accessKey : reactionsKey;
	}

	function bearer(key: ApiKeyFixture): RequestInit {
		return { headers: { authorization: `Bearer ${key.token}` } };
	}

	for (const apiCase of apiCases) {
		it(`${apiCase.label} — anonymous → 401 missing_authorization`, async () => {
			const res = await SELF.fetch(`https://example.com${apiCase.path}`);
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ error: 'missing_authorization' });
		});

		it(`${apiCase.label} — authenticated but wrong scope → 403 missing_scope`, async () => {
			const insufficient = apiCase.scope === 'access_counter' ? reactionsKey : accessKey;
			const res = await SELF.fetch(`https://example.com${apiCase.path}`, bearer(insufficient));
			expect(res.status).toBe(403);
			const body = (await res.json()) as { error?: string; status?: number };
			expect(body.error).toBe('missing_scope');
			expect(body.status).toBe(403);
			expectNoPrivateData(JSON.stringify(body));
		});

		it(`${apiCase.label} — authorized scope → 200`, async () => {
			const res = await SELF.fetch(
				`https://example.com${apiCase.path}`,
				bearer(keyFor(apiCase.scope)),
			);
			expect(res.status).toBe(200);
		});
	}

	it('a scoped read returns only this principal’s own aggregate shape', async () => {
		// Per-principal isolation (ADR-0012 §3): the counter read is keyed
		// by the authenticated key id, so a scoped-but-empty read returns
		// a zeroed aggregate and no field that names another principal.
		// The assertion is about the SHAPE, never about a specific count.
		const res = await SELF.fetch(
			'https://example.com/api/v1/access/count/authz-matrix',
			bearer(accessKey),
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toEqual({ count: 0, first_hit: null, last_hit: null });
		expect(Object.keys(body).sort()).toEqual(['count', 'first_hit', 'last_hit']);
		expectNoPrivateData(JSON.stringify(body));
	});
});

describe('internal APIs — write paths and the public image read (Issue #441)', () => {
	it('POST /api/v1/access/hit — anonymous → 401, wrong scope → 403, scoped → 200', async () => {
		const url = 'https://example.com/api/v1/access/hit';
		const body = JSON.stringify({ key: 'authz-matrix', session_id: 'authz-matrix-actor' });

		const anon = await SELF.fetch(url, { method: 'POST', body });
		expect(anon.status).toBe(401);
		expect(await anon.json()).toEqual({ error: 'missing_authorization' });

		const wrongScope = await SELF.fetch(url, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${reactionsKey.token}`,
				'content-type': 'application/json',
			},
			body,
		});
		expect(wrongScope.status).toBe(403);
		expect(((await wrongScope.json()) as { error?: string }).error).toBe('missing_scope');

		const authorized = await SELF.fetch(url, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${accessKey.token}`,
				'content-type': 'application/json',
			},
			body,
		});
		expect(authorized.status).toBe(200);
		expectNoPrivateData(await authorized.text());
	});

	it('PUT /api/v1/reactions — anonymous → 401, wrong scope → 403, scoped → 200', async () => {
		const url = 'https://example.com/api/v1/reactions';
		const body = JSON.stringify({
			target_key: 'authz-matrix',
			actor_id: 'authz-matrix-actor',
			kind: 'emoji',
			value: '👍',
		});

		const anon = await SELF.fetch(url, { method: 'PUT', body });
		expect(anon.status).toBe(401);

		const wrongScope = await SELF.fetch(url, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${accessKey.token}`,
				'content-type': 'application/json',
			},
			body,
		});
		expect(wrongScope.status).toBe(403);
		expect(((await wrongScope.json()) as { error?: string }).error).toBe('missing_scope');

		const authorized = await SELF.fetch(url, {
			method: 'PUT',
			headers: {
				authorization: `Bearer ${reactionsKey.token}`,
				'content-type': 'application/json',
			},
			body,
		});
		expect(authorized.status).toBe(200);
		expectNoPrivateData(await authorized.text());
	});

	it('GET /api/v1/reaction-images/:id stays public — no key is required, and none is invented', async () => {
		// Reaction images are public data by contract
		// (`src/http/reactions/router.ts`), so "no API key required" is
		// the honest expectation. The matrix records it as public rather
		// than asserting a 401 the product does not promise.
		const res = await SELF.fetch('https://example.com/api/v1/reaction-images/authz-missing-image');
		expect(res.status).toBe(404);
		expect(((await res.json()) as { error?: string }).error).toBe('not_found');
	});
});
