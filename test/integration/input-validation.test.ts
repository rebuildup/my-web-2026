/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetVerifyApiKey, withVerifyApiKey } from '../../src/http/api-keys/middleware';
import { externalBoundary } from '../../src/http/hono';
import { MAX_JSON_BODY_BYTES } from '../../src/http/validation';

/**
 * Input-validation matrix (Issue #450).
 *
 * Every row below is a **real HTTP request** driven through
 * `externalBoundary` — the same Hono app the Worker entry dispatches to
 * — inside the local workerd pool, with real D1 / R2 bindings. The
 * matrix is therefore measured, not declared: the rendered table is
 * printed from the observed status + `error` code of each response.
 *
 * The three representative endpoints required by the issue are the
 * `body`, `query`, and `path` groups below; the `protocol` and `auth`
 * groups pin the two guards that protect those three.
 *
 * Reproduce the verification artefact committed at
 * `docs/verification/security/input-validation-matrix.webp` with:
 *
 *     pnpm run verification:input-matrix
 *
 * Schema note: workerd cannot `fs.readFile`, so the DDL below is
 * inlined and MUST stay byte-identical to the corresponding
 * `migrations/*.sql` files.
 */

const MIGRATIONS = [
	{
		name: '0002_access_counter',
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
			`CREATE TABLE IF NOT EXISTS reaction_images (
        id TEXT PRIMARY KEY,
        content_hash TEXT UNIQUE NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL
    )`,
		],
	},
];

const STUB_KEY_ID = '00000000-0000-0000-0000-0000000000a1';
const AUTH = { authorization: 'Bearer mk_home_matrix-fixture' };
/** Not a bot per `src/http/access-counter/filter.ts` (no UA => rejected). */
const HUMAN_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) matrix-fixture';
/**
 * `externalBoundary.request(<path>)` resolves relative paths against
 * `http://localhost` (Hono's own default). Unsafe writes must declare a
 * same-origin signal or the boundary's CSRF guard (Issue #440) answers
 * `403 csrf_rejected` before routing, authentication, or validation
 * runs — which would hide every row this matrix measures.
 */
const ORIGIN = 'http://localhost';
const JSON_HEADERS = {
	...AUTH,
	origin: ORIGIN,
	'content-type': 'application/json',
	'user-agent': HUMAN_UA,
};

/**
 * Dimensions under test — the four input classes the issue names,
 * plus `accepted` (reached the handler) and `auth` (proves the
 * middleware order: authentication runs before validation).
 */
type Dimension = 'accepted' | 'size' | 'format' | 'protocol' | 'type' | 'auth';
type Group = 'body' | 'query' | 'path' | 'protocol' | 'auth';

interface MatrixCase {
	group: Group;
	endpoint: string;
	dimension: Dimension;
	/** What the request carries — rendered in the artefact table. */
	label: string;
	request: { method: string; path: string; headers?: Record<string, string>; body?: string };
	status: number;
	/** Expected `error` code; omitted when the request is accepted. */
	code?: string;
	/** Header the response must carry (protocol guard). */
	header?: [name: string, value: string];
}

const LONG = 'x'.repeat(300);
const ACTOR = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
/** Valid `PUT` / `DELETE /api/v1/reactions` body (emoji kind). */
const REACTION_BODY = {
	target_key: 'home-page',
	actor_id: ACTOR,
	kind: 'emoji',
	value: '👍',
} as const;

const CASES: readonly MatrixCase[] = [
	// ---------------------------------------------------------------- body
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'accepted',
		label: 'valid JSON body',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: JSON.stringify({ key: 'home-page', session_id: ACTOR }),
		},
		status: 200,
	},
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'type',
		label: '`key` is a number',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: JSON.stringify({ key: 42, session_id: ACTOR }),
		},
		status: 400,
		code: 'invalid_body',
	},
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'type',
		label: '`session_id` absent',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: JSON.stringify({ key: 'home-page' }),
		},
		status: 400,
		code: 'invalid_body',
	},
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'format',
		label: '`key` contains a space (was 500)',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: JSON.stringify({ key: 'home page', session_id: ACTOR }),
		},
		status: 400,
		code: 'invalid_key',
	},
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'format',
		label: '`session_id` contains NUL',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: JSON.stringify({ key: 'home-page', session_id: `a${String.fromCharCode(0)}b` }),
		},
		status: 400,
		code: 'invalid_session_id',
	},
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'protocol',
		label: 'Content-Type: text/plain',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: {
				...AUTH,
				origin: ORIGIN,
				'content-type': 'text/plain',
				'user-agent': HUMAN_UA,
			},
			body: JSON.stringify({ key: 'home-page', session_id: ACTOR }),
		},
		status: 415,
		code: 'unsupported_media_type',
	},
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'size',
		label: `body > ${MAX_JSON_BODY_BYTES / 1024} KiB`,
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: JSON.stringify({ key: 'home-page', session_id: 'a'.repeat(MAX_JSON_BODY_BYTES) }),
		},
		status: 413,
		code: 'payload_too_large',
	},
	{
		group: 'body',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'type',
		label: 'body is not JSON',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: 'not json at all',
		},
		status: 400,
		code: 'invalid_body',
	},
	// ------------------------------------------------- body (reactions)
	{
		group: 'body',
		endpoint: 'PUT /api/v1/reactions',
		dimension: 'accepted',
		label: 'valid JSON body',
		request: {
			method: 'PUT',
			path: '/api/v1/reactions',
			headers: JSON_HEADERS,
			body: JSON.stringify(REACTION_BODY),
		},
		status: 200,
	},
	{
		group: 'body',
		endpoint: 'PUT /api/v1/reactions',
		dimension: 'protocol',
		label: 'form-encoded (curl --data default)',
		request: {
			method: 'PUT',
			path: '/api/v1/reactions',
			headers: {
				...AUTH,
				origin: ORIGIN,
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: JSON.stringify(REACTION_BODY),
		},
		status: 415,
		code: 'unsupported_media_type',
	},
	{
		group: 'body',
		endpoint: 'PUT /api/v1/reactions',
		dimension: 'type',
		label: '`kind` is not emoji/image',
		request: {
			method: 'PUT',
			path: '/api/v1/reactions',
			headers: JSON_HEADERS,
			body: JSON.stringify({ ...REACTION_BODY, kind: 'sticker' }),
		},
		status: 400,
		code: 'invalid_body',
	},
	{
		group: 'body',
		endpoint: 'PUT /api/v1/reactions',
		dimension: 'size',
		label: `body > ${MAX_JSON_BODY_BYTES / 1024} KiB`,
		request: {
			method: 'PUT',
			path: '/api/v1/reactions',
			headers: JSON_HEADERS,
			body: JSON.stringify({ ...REACTION_BODY, actor_id: 'a'.repeat(MAX_JSON_BODY_BYTES) }),
		},
		status: 413,
		code: 'payload_too_large',
	},
	{
		group: 'body',
		endpoint: 'DELETE /api/v1/reactions',
		dimension: 'accepted',
		label: 'valid JSON body, absent row',
		request: {
			method: 'DELETE',
			path: '/api/v1/reactions',
			headers: JSON_HEADERS,
			body: JSON.stringify({ ...REACTION_BODY, target_key: 'never-put-page' }),
		},
		status: 200,
	},
	{
		group: 'body',
		endpoint: 'DELETE /api/v1/reactions',
		dimension: 'format',
		label: '`actor_id` is empty',
		request: {
			method: 'DELETE',
			path: '/api/v1/reactions',
			headers: JSON_HEADERS,
			body: JSON.stringify({ ...REACTION_BODY, actor_id: '' }),
		},
		status: 400,
		code: 'invalid_body',
	},
	// --------------------------------------------------------------- query
	{
		group: 'query',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'accepted',
		label: '?target=home-page',
		request: { method: 'GET', path: '/api/v1/reactions?target=home-page', headers: AUTH },
		status: 200,
	},
	{
		group: 'query',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'accepted',
		label: '?target + ?actor_id',
		request: {
			method: 'GET',
			path: `/api/v1/reactions?target=home-page&actor_id=${ACTOR}`,
			headers: AUTH,
		},
		status: 200,
	},
	{
		group: 'query',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'format',
		label: '`target` absent',
		request: { method: 'GET', path: '/api/v1/reactions', headers: AUTH },
		status: 400,
		code: 'missing_target',
	},
	{
		group: 'query',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'size',
		label: '`target` = 300 chars',
		request: { method: 'GET', path: `/api/v1/reactions?target=${LONG}`, headers: AUTH },
		status: 400,
		code: 'invalid_target',
	},
	{
		group: 'query',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'size',
		label: '`actor_id` = 300 chars',
		request: {
			method: 'GET',
			path: `/api/v1/reactions?target=home-page&actor_id=${LONG}`,
			headers: AUTH,
		},
		status: 400,
		code: 'invalid_actor_id',
	},
	{
		group: 'query',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'format',
		label: '`target` present but empty (was missing_target)',
		request: { method: 'GET', path: '/api/v1/reactions?target=', headers: AUTH },
		status: 400,
		code: 'invalid_target',
	},
	{
		group: 'query',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'protocol',
		label: '?target=a&target=b (parameter pollution)',
		request: {
			method: 'GET',
			path: '/api/v1/reactions?target=home-page&target=other-page',
			headers: AUTH,
		},
		status: 400,
		code: 'invalid_query',
	},
	// ---------------------------------------------------------------- path
	{
		group: 'path',
		endpoint: 'GET /api/v1/access/count/:key',
		dimension: 'accepted',
		label: ':key = home-page',
		request: { method: 'GET', path: '/api/v1/access/count/home-page', headers: AUTH },
		status: 200,
	},
	{
		group: 'path',
		endpoint: 'GET /api/v1/access/count/:key',
		dimension: 'format',
		label: ':key percent-encoded space (was 500)',
		request: { method: 'GET', path: '/api/v1/access/count/home%20page', headers: AUTH },
		status: 400,
		code: 'invalid_key',
	},
	{
		group: 'path',
		endpoint: 'GET /api/v1/access/count/:key',
		dimension: 'size',
		label: ':key = 300 chars',
		request: { method: 'GET', path: `/api/v1/access/count/${LONG}`, headers: AUTH },
		status: 400,
		code: 'invalid_key',
	},
	{
		group: 'path',
		endpoint: 'GET /api/v1/reaction-images/:id',
		dimension: 'format',
		label: ':id with a space',
		request: { method: 'GET', path: '/api/v1/reaction-images/not%20an%20id', headers: {} },
		status: 400,
		code: 'invalid_id',
	},
	{
		group: 'path',
		endpoint: 'GET /api/v1/reaction-images/:id',
		dimension: 'accepted',
		label: ':id well-formed, absent row',
		request: { method: 'GET', path: '/api/v1/reaction-images/deadbeef', headers: {} },
		status: 404,
		code: 'not_found',
	},
	// ------------------------------------------------------------ protocol
	{
		group: 'protocol',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'protocol',
		label: 'PUT on a POST-only path',
		request: {
			method: 'PUT',
			path: '/api/v1/access/hit',
			headers: JSON_HEADERS,
			body: JSON.stringify({ key: 'home-page', session_id: ACTOR }),
		},
		status: 405,
		code: 'method_not_allowed',
		header: ['allow', 'POST'],
	},
	{
		group: 'protocol',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'protocol',
		label: 'PATCH on /api/v1/reactions',
		request: {
			method: 'PATCH',
			path: '/api/v1/reactions?target=home-page',
			headers: JSON_HEADERS,
			body: '{}',
		},
		status: 405,
		code: 'method_not_allowed',
		header: ['allow', 'GET, PUT, DELETE'],
	},
	{
		group: 'protocol',
		endpoint: 'GET /api/v1/access/count/:key',
		dimension: 'protocol',
		label: 'POST on a GET-only path',
		request: {
			method: 'POST',
			path: '/api/v1/access/count/home-page',
			headers: { ...AUTH, origin: ORIGIN },
		},
		status: 405,
		code: 'method_not_allowed',
		header: ['allow', 'GET'],
	},
	{
		group: 'protocol',
		endpoint: 'GET /api/v1/reaction-images/:id',
		dimension: 'protocol',
		label: 'POST on the public image path',
		request: {
			method: 'POST',
			path: '/api/v1/reaction-images/deadbeef',
			headers: { origin: ORIGIN },
		},
		status: 405,
		code: 'method_not_allowed',
		header: ['allow', 'GET'],
	},
	// ---------------------------------------------------------------- auth
	{
		group: 'auth',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'protocol',
		label: 'no Authorization header',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: { origin: ORIGIN, 'content-type': 'application/json', 'user-agent': HUMAN_UA },
			body: JSON.stringify({ key: 'home-page', session_id: ACTOR }),
		},
		status: 401,
		code: 'missing_authorization',
	},
	{
		group: 'auth',
		endpoint: 'GET /api/v1/reactions',
		dimension: 'protocol',
		label: 'no Authorization header',
		request: { method: 'GET', path: '/api/v1/reactions?target=home-page' },
		status: 401,
		code: 'missing_authorization',
	},
	{
		group: 'auth',
		endpoint: 'POST /api/v1/access/hit',
		dimension: 'auth',
		label: 'no Authorization, oversized + text/plain body',
		request: {
			method: 'POST',
			path: '/api/v1/access/hit',
			headers: { origin: ORIGIN, 'content-type': 'text/plain', 'user-agent': HUMAN_UA },
			body: 'x'.repeat(MAX_JSON_BODY_BYTES + 1),
		},
		status: 401,
		code: 'missing_authorization',
	},
];

/**
 * Rejection codes produced by `src/http/validation.ts`. They carry the
 * canonical `{ error, reason }` envelope. The codes NOT in this set
 * (`missing_target`, `missing_authorization`, `not_found`) predate
 * Issue #450 and come from the auth middleware / router bodies.
 */
const VALIDATION_CODES = new Set([
	'invalid_body',
	'invalid_target',
	'invalid_actor_id',
	'invalid_query',
	'invalid_key',
	'invalid_id',
	'unsupported_media_type',
	'payload_too_large',
	'method_not_allowed',
]);

interface MatrixResult extends MatrixCase {
	actualStatus: number;
	actualCode: string;
}

const results: MatrixResult[] = [];

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
});

beforeEach(() => {
	// DI seam (`src/http/api-keys/middleware.ts`): the fixture key
	// stands in for the Better Auth api-key row so the matrix never
	// depends on provisioning state — and never on a real credential.
	withVerifyApiKey(async () => ({
		valid: true,
		error: null,
		key: {
			id: STUB_KEY_ID,
			referenceId: 'ref-matrix',
			permissions: {
				access_counter: ['read', 'write'],
				reactions: ['read', 'write'],
			},
			prefix: 'mk_home_',
		},
	}));
});

afterEach(() => {
	resetVerifyApiKey();
});

afterAll(() => {
	// Emitted for `scripts/capture-input-validation-matrix.mjs`, which
	// turns this table into the committed verification artefact. The
	// assertions in the cases above are the gate; this block is only
	// the report, so it never decides pass / fail on its own.
	const header = '| # | endpoint | dimension | input | status | error code |';
	const divider = '| -- | ------- | --------- | ----- | ------ | ---------- |';
	const rows = results.map((row, index) => {
		const code = row.actualCode === '—' ? '—' : `\`${row.actualCode}\``;
		return `| ${index + 1} | \`${row.endpoint}\` | ${row.dimension} | ${row.label} | ${row.actualStatus} | ${code} |`;
	});
	console.log(
		`\n<!-- input-validation-matrix:start -->\n${[header, divider, ...rows].join('\n')}\n<!-- input-validation-matrix:end -->\n`,
	);
});

describe('boundary input-validation matrix (Issue #450)', () => {
	it.each(
		CASES.map((row) => ({ ...row, title: `${row.endpoint} — ${row.dimension}: ${row.label}` })),
	)('$title', async (row) => {
		const res = await externalBoundary.request(
			row.request.path,
			{
				method: row.request.method,
				headers: row.request.headers ?? {},
				...(row.request.body === undefined ? {} : { body: row.request.body }),
			},
			env,
		);
		const text = await res.text();
		const parsed = safeJson(text) as { error?: string } | null;
		const code = parsed?.error ?? '—';
		results.push({ ...row, actualStatus: res.status, actualCode: code });

		const where = `${row.request.method} ${row.request.path} (${row.label})`;
		expect(res.status, where).toBe(row.status);
		expect(code, where).toBe(row.code ?? '—');
		if (row.code !== undefined && VALIDATION_CODES.has(row.code)) {
			// The canonical envelope for every boundary validation
			// rejection. A missing `reason` here would mean a handler
			// bypassed `src/http/validation.ts`.
			expect(parsed, where).toMatchObject({
				error: row.code,
				reason: expect.any(String),
			});
		}
		if (row.header) {
			expect(res.headers.get(row.header[0]), where).toBe(row.header[1]);
		}
	});
});

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}
