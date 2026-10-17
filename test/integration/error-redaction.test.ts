import { env } from 'cloudflare:test';
/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetVerifyApiKey, withVerifyApiKey } from '../../src/http/api-keys/middleware';
import { externalBoundary } from '../../src/http/hono';

/**
 * Public error redaction — local worker verification (Issue #457).
 *
 * The Issue asks for two things at once:
 *
 *   1. proof that the boundary's 5xx bodies carry no stack, SQL,
 *      secret name, or binding name; and
 *   2. that this holds for BOTH an accepted request and a rejected
 *      one, reproduced against the real Worker in the local workerd
 *      pool rather than a hand-written fixture of a response nobody
 *      ever saw.
 *
 * So the requests below go through the REAL `externalBoundary` —
 * real request-id middleware, real auth middleware (verifier stubbed
 * through the documented DI seam), real rate-limit binding, real D1.
 * Only two things are substituted, both stated at the call site:
 *
 *   * the API-key verifier (better-auth state is out of scope here);
 *   * the D1 / R2 binding, in the two 503 cases, where a binding
 *     that fails for real cannot be produced locally. The injected
 *     error messages are the real provider shapes.
 *
 * The D1 500 case is NOT injected: `reactions` is dropped from the
 * local database so the real query fails with a real
 * `D1_ERROR: no such table: reactions: SQLITE_ERROR`, and the table is
 * restored right after.
 *
 * Every case also emits a `[capture]` line so
 * `scripts/capture-error-redaction-report.mjs` can render the
 * verification screenshot (`docs/verification/security/error-redaction-page.png`)
 * from responses the Worker actually produced. Nothing secret is
 * captured: the verifier stub is a literal fake key, and only
 * statuses / bodies / correlation ids are printed.
 */

const CAPTURE_PREFIX = '[capture]';

/**
 * Byte-identical to the `reactions` table in
 * `migrations/0003_reactions.sql` (workerd cannot read files).
 *
 * `D1Database.exec` treats every line as its own statement, so each
 * CREATE has to stay on one line; `applyD1Migrations` would be the
 * other option, but it records applied names in `d1_migrations` and
 * would then skip the restore that follows the deliberate drop below.
 */
const CREATE_REACTIONS_TABLE =
	"CREATE TABLE IF NOT EXISTS reactions (id TEXT PRIMARY KEY, target_key TEXT NOT NULL, actor_id TEXT NOT NULL, principal TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')), value TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (target_key, principal, actor_id, kind, value))";

const CREATE_REACTION_IMAGES_TABLE =
	'CREATE TABLE IF NOT EXISTS reaction_images (id TEXT PRIMARY KEY, content_hash TEXT UNIQUE NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, r2_key TEXT NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at INTEGER NOT NULL)';

const STUB_KEY_ID = '00000000-0000-0000-0000-0000000000a1';

interface CapturedCase {
	case: string;
	meaning: 'accepted' | 'rejected' | 'failed';
	request: string;
	status: number;
	body: unknown;
	request_id?: string | null;
	leaked: string[];
}

function emit(entry: CapturedCase): void {
	console.log(CAPTURE_PREFIX + JSON.stringify(entry));
}

function stubApiKey(permissions: Record<string, string[]>): void {
	withVerifyApiKey(async () => ({
		valid: true,
		error: null,
		key: {
			id: STUB_KEY_ID,
			referenceId: 'capture-ref',
			permissions,
			prefix: 'mk_home_',
		},
	}));
}

/** Strings that must never appear in a client-visible body. */
const FORBIDDEN = [
	'SQLITE_ERROR',
	'SQLITE_IOERR',
	'D1_ERROR',
	'no such table',
	'SELECT ',
	'INSERT INTO',
	'BETTER_AUTH_SECRET',
	'MY_WEB_2026_CONSUMER_API_KEY',
	'mk_home_',
	'at Object.',
	'.ts:',
	'.mjs:',
	'reaction_images',
	'binding_error',
];

/**
 * Call the real boundary and capture the client-visible result.
 * `bindings` replaces `env` (used only for the 503 fixtures).
 */
async function call(
	label: string,
	meaning: CapturedCase['meaning'],
	request: { path: string; init?: RequestInit },
	bindings?: unknown,
): Promise<{ res: Response; text: string; body: Record<string, unknown> }> {
	const res = await externalBoundary.request(request.path, request.init, (bindings ?? env) as Env);
	const text = await res.text();
	let body: Record<string, unknown> = {};
	try {
		body = JSON.parse(text) as Record<string, unknown>;
	} catch {
		body = { raw: text };
	}
	const leaked = FORBIDDEN.filter((needle) => text.includes(needle));
	emit({
		case: label,
		meaning,
		request: `${request.init?.method ?? 'GET'} ${request.path}`,
		status: res.status,
		body,
		request_id: res.headers.get('x-request-id'),
		leaked,
	});
	return { res, text, body };
}

beforeAll(async () => {
	await env.DB.exec(CREATE_REACTIONS_TABLE);
	await env.DB.exec(CREATE_REACTION_IMAGES_TABLE);
});

beforeEach(async () => {
	await env.DB.exec(CREATE_REACTIONS_TABLE);
	await env.DB.exec(CREATE_REACTION_IMAGES_TABLE);
	await env.DB.prepare('DELETE FROM reactions').run();
	await env.DB.prepare('DELETE FROM reaction_images').run();
});

afterEach(() => {
	resetVerifyApiKey();
});

describe('accepted input stays a normal success response (Issue #457)', () => {
	it('GET /api/v1/reactions answers 200 with the public aggregate shape', async () => {
		stubApiKey({ reactions: ['read', 'write'] });
		const { res, body } = await call('GET /api/v1/reactions?target=home-page', 'accepted', {
			path: '/api/v1/reactions?target=home-page',
			init: { headers: { authorization: 'Bearer mk_home_capture_stub' } },
		});
		expect(res.status).toBe(200);
		expect(body.target_key).toBe('home-page');
		expect(body.aggregates).toEqual([]);
	});

	it('GET /api/v1/db/ping keeps its documented 200 probe shape', async () => {
		const { res, body } = await call('GET /api/v1/db/ping', 'accepted', {
			path: '/api/v1/db/ping',
		});
		expect(res.status).toBe(200);
		expect(body.status).toBe('ok');
		expect(body.one).toBe(1);
	});
});

describe('rejected input is named, not leaked (Issue #457)', () => {
	it('missing credentials answer 401 with the documented code only', async () => {
		const { res, text, body } = await call(
			'GET /api/v1/reactions?target=home-page (no Authorization)',
			'rejected',
			{ path: '/api/v1/reactions?target=home-page' },
		);
		expect(res.status).toBe(401);
		expect(body.error).toBe('missing_authorization');
		expect(text).not.toContain('mk_home');
	});

	it('a key without the scope answers 403 with the documented code only', async () => {
		stubApiKey({ reactions: ['read'] });
		const { res, body } = await call(
			'PUT /api/v1/reactions (reactions:write missing)',
			'rejected',
			{
				path: '/api/v1/reactions',
				init: {
					method: 'PUT',
					headers: {
						authorization: 'Bearer mk_home_capture_stub',
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						target_key: 'home-page',
						actor_id: 'visitor-1',
						kind: 'emoji',
						value: 'thumbs_up',
					}),
				},
			},
		);
		expect(res.status).toBe(403);
		expect(body.error).toBe('missing_scope');
	});

	it('an unknown image id answers 422 without naming the backing table', async () => {
		// Regression: the 422 used to carry
		// `reason: "image id '…' does not exist in reaction_images"`,
		// publishing a table name to any caller with a valid key.
		stubApiKey({ reactions: ['read', 'write'] });
		const { res, text, body } = await call(
			'PUT /api/v1/reactions (kind=image, unknown id)',
			'rejected',
			{
				path: '/api/v1/reactions',
				init: {
					method: 'PUT',
					headers: {
						authorization: 'Bearer mk_home_capture_stub',
						'content-type': 'application/json',
					},
					body: JSON.stringify({
						target_key: 'home-page',
						actor_id: 'visitor-1',
						kind: 'image',
						value: '00000000-0000-0000-0000-000000000000',
					}),
				},
			},
		);
		expect(res.status).toBe(422);
		expect(body.error).toBe('unknown_image_id');
		expect(body.reason).toBeUndefined();
		expect(text).not.toContain('reaction_images');
		expect(text).not.toContain('does not exist in');
	});

	it('a counter key containing a space answers 400, not 500 (Issue #457)', async () => {
		// Regression: `HitInput` bounds the key length but not its
		// character set, so a key with a space passed zod and then
		// threw out of `validateCounterKey`. The throw reached the
		// global onError, so a plain client mistake was answered
		// with 500 `internal_error`.
		stubApiKey({ access_counter: ['read', 'write'] });
		const { res, body } = await call('POST /api/v1/access/hit (key with a space)', 'rejected', {
			path: '/api/v1/access/hit',
			init: {
				method: 'POST',
				headers: {
					authorization: 'Bearer mk_home_capture_stub',
					'content-type': 'application/json',
				},
				body: JSON.stringify({ key: 'home page', session_id: 'session-1' }),
			},
		});
		expect(res.status).toBe(400);
		expect(body.error).toBe('invalid_key');
	});
});

describe('failed input is redacted but still correlatable (Issue #457)', () => {
	it('a real D1 failure answers 500 with no SQL and a correlation id', async () => {
		// Force a genuine storage failure: the aggregate query runs
		// against a table that is not there, so the Worker sees the
		// provider's own message.
		await env.DB.exec('DROP TABLE IF EXISTS reactions');
		try {
			stubApiKey({ reactions: ['read'] });
			const { res, text, body } = await call('GET /api/v1/reactions (D1 table missing)', 'failed', {
				path: '/api/v1/reactions?target=home-page',
				init: {
					headers: {
						authorization: 'Bearer mk_home_capture_stub',
						'X-Request-Id': 'capture-457-correlation',
					},
				},
			});
			expect(res.status).toBe(500);
			expect(body.error).toBe('internal_error');
			expect(typeof body.message).toBe('string');
			expect(body.request_id).toBe('capture-457-correlation');
			expect(res.headers.get('x-request-id')).toBe('capture-457-correlation');
			// The provider message the log line received.
			for (const needle of ['SQLITE_ERROR', 'no such table', 'D1_ERROR', 'SELECT ']) {
				expect(text).not.toContain(needle);
			}
			// Nothing about the stack, either.
			expect(text).not.toContain('.ts:');
		} finally {
			await env.DB.exec(CREATE_REACTIONS_TABLE);
		}
	});

	it('a failing D1 probe answers 503 without naming the binding', async () => {
		const brokenD1 = {
			prepare: () => {
				throw new Error('D1_ERROR: D1 database is unreachable');
			},
		};
		const { res, text, body } = await call(
			'GET /api/v1/db/ping (binding failure)',
			'failed',
			{ path: '/api/v1/db/ping' },
			{ DB: brokenD1 },
		);
		expect(res.status).toBe(503);
		expect(body.error).toBe('service_unavailable');
		expect(body.binding).toBeUndefined();
		expect(text).not.toContain('D1');
		expect(text).not.toContain('binding');
	});

	it('a failing R2 probe answers 503 without naming the bucket', async () => {
		const brokenR2 = {
			head: async () => {
				throw new Error('The specified bucket does not exist. (my-web-2026)');
			},
		};
		const { res, text, body } = await call(
			'GET /api/v1/media/ping (binding failure)',
			'failed',
			{ path: '/api/v1/media/ping' },
			{ MEDIA: brokenR2 },
		);
		expect(res.status).toBe(503);
		expect(body.error).toBe('service_unavailable');
		expect(body.binding).toBeUndefined();
		expect(text).not.toContain('my-web-2026');
		expect(text).not.toContain('bucket');
	});
});
