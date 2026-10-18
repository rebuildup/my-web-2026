/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdminSession } from '../../src/admin/auth/load';
import { deleteApiKeyImpl } from '../../src/admin/keys/load';
import { auth } from '../../test/helpers/better-auth';

/**
 * API key scope + revocation regression matrix (Issue #442).
 *
 * The existing suites pin the *middleware* contract with a stubbed
 * verifier (`src/http/api-keys/middleware.test.ts`) and pin the
 * *boundary input* matrix with a stubbed key
 * (`test/integration/input-validation.test.ts`). Neither one runs a
 * real Better Auth key through the boundary, so the denial paths that
 * matter operationally — revoked, disabled, expired, wrong hash —
 * had no automated evidence at all: they are decided inside
 * `@better-auth/api-key@1.7.5`'s `validateApiKey`, not in our
 * middleware.
 *
 * This suite closes that gap **without stubbing anything auth**:
 *
 *   - every key is minted by the real `auth.api.createApiKey` against
 *     the local D1 binding (local workerd pool, Miniflare),
 *   - every request is a real `SELF.fetch` through the Worker entry
 *     (`src/server.ts` → Hono `externalBoundary` → `requireApiKey` →
 *     `requireResourceAction`),
 *   - the status / error code printed in the matrix is read back from
 *     the response, never copied from the contract.
 *
 * Scope guard: this suite never touches production. It writes only to
 * the per-test Miniflare D1 database that `@cloudflare/vitest-plugin`
 * provides, and it never reads a real credential, a real key
 * plaintext, or an operator account. See
 * `docs/security/api-key-scope.md` for the operational contract.
 *
 * Reproduce the verification artefact committed at
 * `docs/verification/security/api-key-scope-matrix.webp` with:
 *
 *     pnpm run verification:api-key-scope
 *
 * Schema note: workerd cannot `fs.readFile`, so the DDL below is
 * inlined and MUST stay byte-identical to the corresponding
 * `migrations/*.sql` files (`0002` + `0005` for the counter tables,
 * `0003` for reactions). The `apikey` / `user` / `session` tables are
 * applied globally by `test/setup/better-auth-schema.ts`, which
 * mirrors `migrations/0001_better_auth.sql`.
 */

const MIGRATIONS = [
	{
		name: '0002_access_counter + 0005_principal',
		queries: [
			`CREATE TABLE IF NOT EXISTS access_counters (
    key        TEXT    NOT NULL,
    principal  TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL,
    PRIMARY KEY (key, principal)
)`,
			`CREATE TABLE IF NOT EXISTS access_dedup (
    counter_key TEXT    NOT NULL,
    principal   TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (counter_key, principal, session_id)
)`,
			'CREATE INDEX IF NOT EXISTS idx_access_dedup_expires\n    ON access_dedup(expires_at)',
		],
	},
	{
		name: '0003_reactions',
		queries: [
			`CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        target_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        principal TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
        value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (target_key, principal, actor_id, kind, value)
    )`,
			'CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_key)',
			'CREATE INDEX IF NOT EXISTS idx_reactions_target_kind ON reactions(target_key, kind)',
			`CREATE TABLE IF NOT EXISTS reaction_images (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
    )`,
			'CREATE INDEX IF NOT EXISTS idx_reaction_images_hash ON reaction_images(content_hash)',
		],
	},
];

const COUNTER_KEY = 'home-page';
const REACTION_TARGET = 'home-page';
const READ_PATH = `/api/v1/access/count/${COUNTER_KEY}`;
const WRITE_PATH = '/api/v1/access/hit';
const REACTIONS_READ_PATH = `/api/v1/reactions?target=${REACTION_TARGET}`;
/** Not a bot per `src/http/access-counter/filter.ts`. */
const HUMAN_UA =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const MATRIX_START = '<!-- api-key-scope-matrix:start -->';
const MATRIX_END = '<!-- api-key-scope-matrix:end -->';

type Resource = 'access_counter' | 'reactions';
type Action = 'read' | 'write';
type Permissions = Partial<Record<Resource, Action[]>>;

const FULL_SCOPES: Permissions = {
	access_counter: ['read', 'write'],
	reactions: ['read', 'write'],
};

/**
 * Every plaintext minted by this run. Two invariants use it: no
 * response body may echo key material (checked inside `observe`),
 * and the printed matrix may not contain it.
 */
const ISSUED_PLAINTEXTS: string[] = [];

interface MatrixRow {
	/** Fixture label — a name, never the key. */
	fixture: string;
	/** `GET /path`, `POST /path` — no headers, no bodies. */
	request: string;
	/** Contract expectation, rendered next to the measured result. */
	expected: string;
	status: number;
	/** Stable `error` code from the body, or `—`. */
	code: string;
}

const MATRIX: MatrixRow[] = [];

interface IssuedKey {
	id: string;
	/** Test-local plaintext. Never logged, never rendered. */
	plaintext: string;
}

let userId = '';
let hitSequence = 0;

async function clearRows(): Promise<void> {
	for (const table of [
		'access_counters',
		'access_dedup',
		'reactions',
		'reaction_images',
		'session',
		'account',
		'verification',
		'apikey',
		'user',
	]) {
		await env.DB.prepare(`DELETE FROM ${table}`).run();
	}
}

/**
 * Mint a key through the production admin plugin call
 * (`auth.api.createApiKey`, the same call `createApiKeyImpl` makes).
 * Omitting `permissions` models a key that was created without a
 * permission block — Better Auth stores a NULL `permissions` column,
 * which the middleware must treat as "no scope", never as a crash.
 */
async function issueKey(name: string, permissions?: Permissions): Promise<IssuedKey> {
	const created = (await auth.api.createApiKey({
		body: {
			name,
			userId,
			...(permissions ? { permissions } : {}),
		},
	})) as { id: string; key?: string };
	if (!created.id || typeof created.key !== 'string' || created.key.length === 0) {
		throw new Error(`fixture key ${name} could not be minted`);
	}
	ISSUED_PLAINTEXTS.push(created.key);
	return { id: created.id, plaintext: created.key };
}

async function createUser(email: string): Promise<string> {
	const result = await auth.api.createUser({
		body: { email, password: 'correct-horse-battery-staple', name: 'Matrix Admin', role: 'admin' },
	});
	return String(result.user.id);
}

async function signIn(email: string): Promise<{ headers: Headers; session: AdminSession }> {
	const res = await SELF.fetch('https://example.com/api/v1/auth/sign-in/email', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
	});
	if (res.status !== 200) throw new Error(`fixture sign-in failed: ${res.status}`);
	const match = (res.headers.get('set-cookie') ?? '').match(/better-auth\.session_token=([^;]+)/);
	if (!match) throw new Error('fixture sign-in returned no session cookie');
	const headers = new Headers({ Cookie: `better-auth.session_token=${match[1]}` });
	const sessionRes = await SELF.fetch('https://example.com/api/v1/auth/get-session', { headers });
	if (sessionRes.status !== 200)
		throw new Error(`fixture get-session failed: ${sessionRes.status}`);
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

/** Flip the final character of a plaintext: same length, different hash. */
function tamper(plaintext: string): string {
	const last = plaintext.slice(-1);
	const replacement = last === 'A' ? 'B' : 'A';
	return plaintext.slice(0, -1) + replacement;
}

interface Call {
	/** Fixture label rendered in the matrix. */
	fixture: string;
	method: 'GET' | 'POST';
	path: string;
	/** `Authorization` value; omitted entirely when `undefined`. */
	authorization?: string;
	/** Raw `Authorization` header, for the malformed-header case. */
	rawAuthorization?: string;
	body?: unknown;
	/** Contract expectation, e.g. `403 missing_scope`. */
	expected: string;
}

interface Observed {
	status: number;
	code: string;
	/** Raw body text — used only for the leak assertions. */
	text: string;
}

/**
 * Perform one real request through the Worker entry and record the
 * measured outcome. Every leak assertion runs here so a row can never
 * carry key material into the printed matrix.
 */
async function observe(call: Call): Promise<Observed> {
	const headers: Record<string, string> = {};
	if (call.rawAuthorization !== undefined) {
		headers.authorization = call.rawAuthorization;
	} else if (call.authorization !== undefined) {
		headers.authorization = `Bearer ${call.authorization}`;
	}
	if (call.body !== undefined) {
		headers['content-type'] = 'application/json';
	}
	if (call.method === 'POST') {
		// The access-counter pre-D1 filter rejects bot UAs and repeat
		// (ip|ua|path) triples inside a 5-minute LRU window; a unique
		// pair per fixture keeps every positive write meaningful.
		hitSequence += 1;
		headers['user-agent'] = `${HUMAN_UA} fixture-${hitSequence}`;
		headers['cf-connecting-ip'] = `203.0.113.${hitSequence}`;
	}

	const res = await SELF.fetch(`https://example.com${call.path}`, {
		method: call.method,
		headers,
		...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
	});
	const text = await res.text();
	const code = readErrorCode(text);
	MATRIX.push({
		fixture: call.fixture,
		request: `${call.method} ${call.path}`,
		expected: call.expected,
		status: res.status,
		code,
	});

	// Invariant: no response body may echo any key minted in this run.
	for (const plaintext of ISSUED_PLAINTEXTS) {
		expect(text, `response body echoed key material (${call.fixture})`).not.toContain(plaintext);
	}
	// Invariant: no response header may echo key material either.
	for (const [name, value] of res.headers.entries()) {
		for (const plaintext of ISSUED_PLAINTEXTS) {
			expect(value, `response header ${name} echoed key material`).not.toContain(plaintext);
		}
	}
	return { status: res.status, code, text };
}

function readErrorCode(text: string): string {
	try {
		const parsed = JSON.parse(text) as { error?: unknown };
		return typeof parsed.error === 'string' ? parsed.error : '—';
	} catch {
		return '—';
	}
}

async function hitBody(sessionId: string): Promise<{ key: string; session_id: string }> {
	return { key: COUNTER_KEY, session_id: sessionId };
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
});

beforeEach(async () => {
	// `MATRIX` and `hitSequence` deliberately accumulate for the whole
	// file: the matrix is printed once in `afterAll`, and a monotonic
	// hit sequence keeps every POST on a fresh `(ip, ua, path)` triple
	// so the access counter's 5-minute LRU filter can never mask a row.
	await clearRows();
	userId = await createUser('api-key-matrix@test.local');
});

afterEach(async () => {
	await clearRows();
});

afterAll(() => {
	const rows = [
		MATRIX_START,
		'| # | fixture | request | expected | status | error code |',
		'| --- | --- | --- | --- | --- | --- |',
		...MATRIX.map((row, index) => {
			const request = `\`${row.request}\``;
			return `| ${index + 1} | ${row.fixture} | ${request} | ${row.expected} | ${row.status} | ${row.code} |`;
		}),
		MATRIX_END,
	];
	// The matrix is the committed artefact's only data source. Guard
	// the print itself: a leaked `mk_*` string must never reach CI logs.
	const printed = rows.join('\n');
	expect(printed).not.toMatch(/mk_[A-Za-z0-9]/);
	console.log(printed);
});

describe('API key scope — granted permissions are honoured', () => {
	it('read + write round-trip through the external boundary', async () => {
		const key = await issueKey('scope-full', FULL_SCOPES);

		const readBefore = await observe({
			fixture: 'access_counter:read+write',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '200',
		});
		expect(readBefore.status).toBe(200);

		const write = await observe({
			fixture: 'access_counter:read+write',
			method: 'POST',
			path: WRITE_PATH,
			authorization: key.plaintext,
			body: await hitBody('scope-full-s1'),
			expected: '200 incremented',
		});
		expect(write.status).toBe(200);
		expect(JSON.parse(write.text)).toMatchObject({ incremented: true, count: 1 });

		const readAfter = await observe({
			fixture: 'access_counter:read+write',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '200 count=1',
		});
		expect(readAfter.status).toBe(200);
		expect(JSON.parse(readAfter.text)).toMatchObject({ count: 1 });
	});

	it('reactions:read is granted independently of access_counter', async () => {
		const key = await issueKey('reactions-read', { reactions: ['read'] });
		const res = await observe({
			fixture: 'reactions:read',
			method: 'GET',
			path: REACTIONS_READ_PATH,
			authorization: key.plaintext,
			expected: '200',
		});
		expect(res.status).toBe(200);
	});
});

describe('API key scope — missing permissions are refused', () => {
	it('read-only key cannot write the counter', async () => {
		const key = await issueKey('scope-read-only', { access_counter: ['read'] });
		const read = await observe({
			fixture: 'access_counter:read',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '200',
		});
		expect(read.status).toBe(200);

		const write = await observe({
			fixture: 'access_counter:read',
			method: 'POST',
			path: WRITE_PATH,
			authorization: key.plaintext,
			body: await hitBody('scope-read-only-s1'),
			expected: '403 missing_scope',
		});
		expect(write.status).toBe(403);
		expect(write.code).toBe('missing_scope');
		// The refusal happens before any D1 write.
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM access_counters').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('write-only key cannot read the counter', async () => {
		const key = await issueKey('scope-write-only', { access_counter: ['write'] });
		const write = await observe({
			fixture: 'access_counter:write',
			method: 'POST',
			path: WRITE_PATH,
			authorization: key.plaintext,
			body: await hitBody('scope-write-only-s1'),
			expected: '200 incremented',
		});
		expect(write.status).toBe(200);

		const read = await observe({
			fixture: 'access_counter:write',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '403 missing_scope',
		});
		expect(read.status).toBe(403);
		expect(read.code).toBe('missing_scope');
	});

	it('access_counter scope does not grant reactions', async () => {
		const key = await issueKey('scope-counter-only', { access_counter: ['read'] });
		const res = await observe({
			fixture: 'access_counter:read',
			method: 'GET',
			path: REACTIONS_READ_PATH,
			authorization: key.plaintext,
			expected: '403 missing_scope',
		});
		expect(res.status).toBe(403);
		expect(res.code).toBe('missing_scope');
	});

	it('a key with no permission block is refused, not crashed', async () => {
		const key = await issueKey('scope-none');
		const row = await env.DB.prepare('SELECT permissions FROM apikey WHERE id = ?1')
			.bind(key.id)
			.first<{ permissions: string | null }>();
		expect(row?.permissions ?? null).toBeNull();

		const res = await observe({
			fixture: 'no permission block',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '403 missing_scope',
		});
		expect(res.status).toBe(403);
		expect(res.code).toBe('missing_scope');
	});

	it('a reactions-scoped key cannot read the counter (no wildcard)', async () => {
		// The inverse of the row above: ADR-0009 §5 defines
		// `access_counter` + `reactions` as independent scopes, so the
		// check must be a per-resource lookup rather than "any key
		// that is valid may read".
		const key = await issueKey('scope-reactions-only', { reactions: ['read', 'write'] });
		const res = await observe({
			fixture: 'reactions:read+write',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '403 missing_scope',
		});
		expect(res.status).toBe(403);
		expect(res.code).toBe('missing_scope');
	});
});

describe('API key lifecycle — revoked, disabled, expired, wrong hash', () => {
	it('admin revoke (row deleted) stops consumer access', async () => {
		const key = await issueKey('lifecycle-revoked', FULL_SCOPES);
		const before = await observe({
			fixture: 'revoked (admin delete)',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '200',
		});
		expect(before.status).toBe(200);

		const { headers, session } = await signIn('api-key-matrix@test.local');
		const revoked = await deleteApiKeyImpl(session, headers, { id: key.id });
		expect(revoked).toEqual({ deleted: true });

		const after = await observe({
			fixture: 'revoked (admin delete)',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '401 invalid_api_key',
		});
		expect(after.status).toBe(401);
		expect(after.code).toBe('invalid_api_key');
	});

	it('a disabled key (enabled = 0) is refused', async () => {
		const key = await issueKey('lifecycle-disabled', FULL_SCOPES);
		await auth.api.updateApiKey({
			body: { keyId: key.id, userId, enabled: false },
		});
		const row = await env.DB.prepare('SELECT enabled FROM apikey WHERE id = ?1')
			.bind(key.id)
			.first<{ enabled: number }>();
		expect(row?.enabled).toBe(0);

		const res = await observe({
			fixture: 'disabled (enabled=0)',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '401 invalid_api_key',
		});
		expect(res.status).toBe(401);
		expect(res.code).toBe('invalid_api_key');
	});

	it('an expired key is refused and its row is reaped', async () => {
		const key = await issueKey('lifecycle-expired', FULL_SCOPES);
		// `expiresIn` cannot be set below the plugin's `minExpiresIn`
		// (1 day), so the fixture writes an already-expired row
		// directly. Local D1 only — see the doc for the rationale.
		await env.DB.prepare('UPDATE apikey SET expiresAt = ?1 WHERE id = ?2')
			.bind(Date.now() - 60_000, key.id)
			.run();

		const res = await observe({
			fixture: 'expired (expiresAt in the past)',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext,
			expected: '401 invalid_api_key',
		});
		expect(res.status).toBe(401);
		expect(res.code).toBe('invalid_api_key');

		// Better Auth deletes an expired row on first verification; the
		// second attempt is then indistinguishable from an unknown key.
		const row = await env.DB.prepare('SELECT id FROM apikey WHERE id = ?1')
			.bind(key.id)
			.first<{ id: string }>();
		expect(row).toBeNull();
	});

	it('an expired key is refused on the write path too', async () => {
		const key = await issueKey('lifecycle-expired-write', FULL_SCOPES);
		await env.DB.prepare('UPDATE apikey SET expiresAt = ?1 WHERE id = ?2')
			.bind(Date.now() - 60_000, key.id)
			.run();
		const res = await observe({
			fixture: 'expired (expiresAt in the past)',
			method: 'POST',
			path: WRITE_PATH,
			authorization: key.plaintext,
			body: await hitBody('expired-write-s1'),
			expected: '401 invalid_api_key',
		});
		expect(res.status).toBe(401);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM access_counters').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('a tampered plaintext (wrong hash) is refused', async () => {
		const key = await issueKey('lifecycle-tampered', FULL_SCOPES);
		const res = await observe({
			fixture: 'wrong hash (tampered plaintext)',
			method: 'GET',
			path: READ_PATH,
			authorization: tamper(key.plaintext),
			expected: '401 invalid_api_key',
		});
		expect(res.status).toBe(401);
		expect(res.code).toBe('invalid_api_key');
	});

	it('a truncated plaintext is refused', async () => {
		const key = await issueKey('lifecycle-truncated', FULL_SCOPES);
		const res = await observe({
			fixture: 'wrong hash (truncated plaintext)',
			method: 'GET',
			path: READ_PATH,
			authorization: key.plaintext.slice(0, -4),
			expected: '401 invalid_api_key',
		});
		expect(res.status).toBe(401);
		expect(res.code).toBe('invalid_api_key');
	});

	it('the four denial reasons return byte-identical 401 bodies', async () => {
		// Stability + no oracle: unknown / wrong hash / revoked /
		// disabled must be indistinguishable to a caller, so the
		// response cannot be used to probe which keys exist.
		const unknown = await observe({
			fixture: 'unknown key',
			method: 'GET',
			path: READ_PATH,
			authorization: 'mk_fixture_never-issued-000000',
			expected: '401 invalid_api_key',
		});
		const tamperedKey = await issueKey('lifecycle-identical-tampered', FULL_SCOPES);
		const tampered = await observe({
			fixture: 'wrong hash (tampered plaintext)',
			method: 'GET',
			path: READ_PATH,
			authorization: tamper(tamperedKey.plaintext),
			expected: '401 invalid_api_key',
		});
		const revokedKey = await issueKey('lifecycle-identical-revoked', FULL_SCOPES);
		const { headers, session } = await signIn('api-key-matrix@test.local');
		expect(await deleteApiKeyImpl(session, headers, { id: revokedKey.id })).toEqual({
			deleted: true,
		});
		const revoked = await observe({
			fixture: 'revoked (admin delete)',
			method: 'GET',
			path: READ_PATH,
			authorization: revokedKey.plaintext,
			expected: '401 invalid_api_key',
		});
		const disabledKey = await issueKey('lifecycle-identical-disabled', FULL_SCOPES);
		await auth.api.updateApiKey({ body: { keyId: disabledKey.id, userId, enabled: false } });
		const disabled = await observe({
			fixture: 'disabled (enabled=0)',
			method: 'GET',
			path: READ_PATH,
			authorization: disabledKey.plaintext,
			expected: '401 invalid_api_key',
		});

		const bodies = [unknown, tampered, revoked, disabled].map((r) => r.text);
		expect(bodies.every((body) => body === bodies[0])).toBe(true);
		expect(JSON.parse(bodies[0] ?? '{}')).toEqual({ error: 'invalid_api_key' });
	});
});

describe('API key presentation — no secret material is stored or echoed', () => {
	it('stores a hash, never the plaintext', async () => {
		const key = await issueKey('storage-hash', FULL_SCOPES);
		const row = await env.DB.prepare('SELECT key, prefix, start FROM apikey WHERE id = ?1')
			.bind(key.id)
			.first<{ key: string; prefix: string | null; start: string | null }>();
		expect(row).not.toBeNull();
		expect(row?.key).not.toBe(key.plaintext);
		expect(row?.key).not.toContain(key.plaintext);
		// SHA-256, base64url encoded → 43 characters.
		expect(row?.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(row?.prefix).toBe('mk_');
		// `start` is Better Auth's non-sensitive display prefix.
		expect(row?.start).toBe(key.plaintext.slice(0, 6));
		expect(ISSUED_PLAINTEXTS).toContain(key.plaintext);
	});

	it('the 403 scope refusal names no resource, action, or key', async () => {
		const key = await issueKey('refusal-shape', { access_counter: ['read'] });
		const res = await observe({
			fixture: 'access_counter:read',
			method: 'POST',
			path: WRITE_PATH,
			authorization: key.plaintext,
			body: await hitBody('refusal-shape-s1'),
			expected: '403 missing_scope',
		});
		expect(res.status).toBe(403);
		expect(JSON.parse(res.text)).toEqual({ error: 'missing_scope', status: 403 });
		expect(res.text).not.toContain('access_counter');
		expect(res.text).not.toContain(key.id);
	});
});

describe('API key presentation — malformed Authorization header', () => {
	it('rejects a missing header without calling the verifier', async () => {
		const res = await observe({
			fixture: 'no Authorization header',
			method: 'GET',
			path: READ_PATH,
			expected: '401 missing_authorization',
		});
		expect(res.status).toBe(401);
		expect(res.code).toBe('missing_authorization');
	});

	it('rejects a non-Bearer header', async () => {
		const res = await observe({
			fixture: 'non-Bearer header',
			method: 'GET',
			path: READ_PATH,
			rawAuthorization: 'Basic bWstaGZpeHR1cmU=',
			expected: '401 missing_authorization',
		});
		expect(res.status).toBe(401);
		expect(res.code).toBe('missing_authorization');
	});

	it('rejects an empty Bearer value', async () => {
		const res = await observe({
			fixture: 'empty Bearer value',
			method: 'GET',
			path: READ_PATH,
			rawAuthorization: 'Bearer    ',
			expected: '401 missing_authorization',
		});
		expect(res.status).toBe(401);
		expect(res.code).toBe('missing_authorization');
	});
});
