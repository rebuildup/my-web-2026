/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { applyD1Migrations, env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetVerifyApiKey, withVerifyApiKey } from '../../src/http/api-keys/middleware';
import { externalBoundary } from '../../src/http/hono';
import { MAX_EMOJI_LEN } from '../../src/http/reactions/schema';
import { createD1PortfolioLoader } from '../../src/portfolio/load';
import { getCatalogEntry } from '../../src/reactions/emoji-catalog';
import {
	ALL_PAYLOADS,
	INJECTION_PAYLOADS,
	MALFORMED_INPUT_PAYLOADS,
	UNIVERSAL_PAYLOADS,
	hasControlOrWhitespace,
	withinMaxLength,
	withoutWhitespace,
} from './fixtures/injection-payloads';

/**
 * D1 parameter-binding suite (Issue #452).
 *
 * The production rule under test is narrow and absolute: **every D1
 * statement that user input reaches must bind that input as a
 * parameter, never splice it into the statement text.** The proof is
 * not "the code looked fine" — this suite proves it at runtime against
 * a real workerd D1 binding.
 *
 * How it proves it
 * ----------------
 * `createRecorder()` wraps `env.DB` in a recording proxy that keeps
 * the SQL text of every `prepare()` call and every value `.bind()`-ed
 * to it. Requests then go through the real external boundary
 * (`externalBoundary`, i.e. `/api/v1/*` with the API-key middleware
 * and the rate-limit middleware in place) or through the D1 loaders
 * directly. That yields three classes of assertion:
 *
 *   1. **Query structure is input-independent** — the recorded SQL
 *      text sequence for an attack payload is byte-identical to the
 *      sequence for a benign value on the same endpoint.
 *   2. **The payload is only ever a bound value** — no recorded
 *      statement text contains any payload, and the attack payload
 *      appears among the bound values.
 *   3. **Table contents are maintained** — a full snapshot of every
 *      table this suite writes is compared before/after, and the
 *      "predicate did not widen" property is asserted directly: a
 *      tautology payload returns zero rows even though sibling rows
 *      exist, because `WHERE target_key = ?1` stayed an equality.
 *
 * Representative endpoints — the ones that actually exist today
 * (Issue #452 forbids inventing a surface):
 *
 *   POST /api/v1/access/hit              counter key + session_id write
 *   GET  /api/v1/access/count/:key       counter key read (path param)
 *   PUT  /api/v1/reactions               target_key / actor_id / value write
 *   DELETE /api/v1/reactions             same key tuple, delete
 *   GET  /api/v1/reactions?target&actor  aggregate + viewer-scoped read
 *   GET  /api/v1/reaction-images/:id     image id read (path param)
 *   portfolio loader                     slug read by `loadPortfolioProject`
 *   emoji catalog                        slug read by `getCatalogEntry`
 *
 * Auth / security boundary: unchanged. The API-key verifier is stubbed
 * through the existing `withVerifyApiKey` DI seam exactly like
 * `test/integration/reactions.test.ts`; no production auth path, no
 * Cloudflare binding, and no Tool Registry dependency is touched. The
 * boundary CSRF guard (Issue #440) is satisfied by declaring the local
 * request origin in the shared header helpers, which is the same
 * signal a first-party caller sends — no guard is stubbed out and no
 * request is weakened to get past it.
 *
 * Schema: inlined below because workerd cannot `fs.readFile`. The
 * `CREATE TABLE` / `DROP TABLE` statements are copied verbatim from
 * `migrations/0002`, `0003`, `0004`, `0005` and `0007`, except that
 * three classes of statement are deliberately left out because no
 * assertion in this suite reads them: SQL comments, every `CREATE
 * INDEX` statement, and 0004's 16-row `INSERT OR IGNORE` seed. The
 * suite therefore does not need the seeds or the indexes — it inserts
 * its own fixtures — but the schema it applies is otherwise the
 * migrated one. `0001` / `0006` are absent on purpose: both operate on
 * the better-auth tables, which this suite never creates.
 */

/** The API key id the stubbed verifier resolves every request to. */
const PRINCIPAL = '00000000-0000-0000-0000-0000000c0de1';
/** A second consumer key id — its rows must stay invisible to PRINCIPAL. */
const OTHER_PRINCIPAL = '00000000-0000-0000-0000-0000000beef1';

/** A benign value used as the structural baseline for every endpoint. */
const BENIGN_TARGET = 'blog-intro';

const SEEDED_AT = 1_700_000_000_000;

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
		],
	},
	{
		// 0005 replaces the 0002 primary key with `(key, principal)`.
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
		],
	},
	{
		name: '0007_portfolio',
		queries: [
			`CREATE TABLE IF NOT EXISTS portfolio_project (
    id                  TEXT    PRIMARY KEY,
    slug                TEXT    NOT NULL UNIQUE,
    title               TEXT    NOT NULL,
    summary             TEXT    NOT NULL,
    role                TEXT    NOT NULL,
    period_start        INTEGER NOT NULL,
    period_end          INTEGER,
    period_label        TEXT,
    motivation_md       TEXT    NOT NULL DEFAULT '',
    architecture_md     TEXT,
    constraints_md      TEXT,
    implementation_md   TEXT,
    evidence_md         TEXT,
    retrospective_md    TEXT,
    facets              TEXT    NOT NULL DEFAULT '[]',
    technologies        TEXT    NOT NULL DEFAULT '[]',
    visibility          TEXT    NOT NULL DEFAULT 'public'
        CHECK (visibility IN ('public', 'unlisted', 'draft')),
    status              TEXT    NOT NULL DEFAULT 'published'
        CHECK (status IN ('published', 'archived')),
    pinned              INTEGER NOT NULL DEFAULT 0,
    display_order       INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
)`,
			`CREATE TABLE IF NOT EXISTS portfolio_link (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    kind            TEXT    NOT NULL
        CHECK (kind IN ('repo', 'demo', 'release', 'article', 'shop', 'video', 'other')),
    label           TEXT,
    url             TEXT    NOT NULL,
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
)`,
			`CREATE TABLE IF NOT EXISTS portfolio_media (
    id              TEXT    PRIMARY KEY,
    project_id      TEXT    NOT NULL REFERENCES portfolio_project(id) ON DELETE CASCADE,
    r2_key          TEXT    NOT NULL,
    content_type    TEXT    NOT NULL,
    width           INTEGER,
    height          INTEGER,
    alt             TEXT    NOT NULL,
    caption         TEXT,
    is_cover        INTEGER NOT NULL DEFAULT 0,
    display_order   INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL
)`,
		],
	},
];

/* ------------------------------------------------------------------ *
 * Recording D1 proxy
 * ------------------------------------------------------------------ */

interface RecordedStatement {
	/** The SQL text handed to `prepare()`. */
	sql: string;
	/** Every value `.bind()`-ed to the statement, in order. */
	binds: unknown[];
}

interface Recorder {
	/** Env whose `DB` records every statement instead of hiding it. */
	env: Env;
	/** Statements recorded so far, in prepare order. */
	statements: RecordedStatement[];
}

/**
 * Wrap the real D1 binding in a proxy that records the statement text
 * and the bound values. Reads and writes still hit the live binding —
 * the recorder observes, it does not substitute.
 */
function createRecorder(): Recorder {
	const statements: RecordedStatement[] = [];
	const db = new Proxy(env.DB, {
		get(target, property) {
			if (property === 'prepare') {
				return (sql: string): D1PreparedStatement => {
					const record: RecordedStatement = { sql, binds: [] };
					statements.push(record);
					const prepared = target.prepare(sql);
					return new Proxy(prepared, {
						get(statementTarget, statementProperty) {
							if (statementProperty === 'bind') {
								return (...values: unknown[]): D1PreparedStatement => {
									record.binds.push(...values);
									return statementTarget.bind(...values);
								};
							}
							const value = Reflect.get(statementTarget, statementProperty) as unknown;
							return typeof value === 'function' ? value.bind(statementTarget) : value;
						},
					});
				};
			}
			const value = Reflect.get(target, property) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	return { env: { ...env, DB: db } as unknown as Env, statements };
}

function sqlTexts(recorder: Recorder): string[] {
	return recorder.statements.map((statement) => statement.sql);
}

/**
 * The invariant that makes injection impossible here: no attacker
 * string is ever part of a statement's text. Binding is the only
 * channel, and a bound value cannot change the parse tree.
 */
function expectNoPayloadInStatementText(recorder: Recorder): void {
	for (const statement of recorder.statements) {
		for (const payload of ALL_PAYLOADS) {
			expect(
				statement.sql,
				`payload '${payload.id}' leaked into SQL text: ${statement.sql}`,
			).not.toContain(payload.value);
		}
	}
}

/** Assert that `value` never reached SQLite — neither as SQL text nor as a bind. */
function expectPayloadNeverBound(recorder: Recorder, value: string): void {
	for (const statement of recorder.statements) {
		expect(statement.sql).not.toContain(value);
		expect(statement.binds).not.toContain(value);
	}
}

/** Assert that at least one statement of the run bound `payload` verbatim. */
function expectPayloadWasBound(recorder: Recorder, payload: string): void {
	const bound = recorder.statements.some((statement) =>
		statement.binds.some((value) => value === payload),
	);
	expect(bound, `payload ${JSON.stringify(payload)} never reached D1 as a bound value`).toBe(true);
}

/* ------------------------------------------------------------------ *
 * Table snapshots — "テーブル内容が維持される"
 * ------------------------------------------------------------------ */

type TableSnapshot = Record<string, unknown[]>;

async function snapshot(): Promise<TableSnapshot> {
	const read = async (sql: string): Promise<unknown[]> =>
		(await env.DB.prepare(sql).all<Record<string, unknown>>()).results ?? [];
	return {
		reactions: await read('SELECT * FROM reactions ORDER BY id'),
		accessCounters: await read('SELECT * FROM access_counters ORDER BY key, principal'),
		accessDedup: await read('SELECT * FROM access_dedup ORDER BY counter_key, session_id'),
		catalog: await read('SELECT * FROM reaction_emoji_catalog ORDER BY slug'),
		portfolio: await read('SELECT * FROM portfolio_project ORDER BY slug'),
	};
}

/* ------------------------------------------------------------------ *
 * Fixture
 * ------------------------------------------------------------------ */

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
});

let requestSeq = 0;

/**
 * Origin every request below is served from.
 *
 * `externalBoundary.request('/api/v1/…', …)` resolves a relative path
 * against `http://localhost` (Hono's `app.request`), so that is the
 * request origin `csrfGuard` compares `Origin` against
 * (`src/http/middleware/csrf.ts`). The boundary refuses an unsafe
 * method with no same-origin signal (Issue #440), exactly like a
 * first-party caller must declare itself: `Origin: <the origin it is
 * calling>`. Declaring the local origin here keeps these cases about
 * D1 parameter binding; the refusal behaviour itself is covered by
 * `test/integration/csrf-contract.test.ts`.
 */
const BOUNDARY_ORIGIN = 'http://localhost';

/**
 * Distinct `cf-connecting-ip` per request. The access-counter router
 * runs an in-memory LRU dedupe keyed on `ip|ua|path` (Issue #170);
 * reusing one IP would make the second hit return `reason: 'dedupe'`
 * without touching D1, and the statement comparison would compare
 * nothing against nothing.
 */
function hitHeaders(): Record<string, string> {
	requestSeq += 1;
	return {
		authorization: 'Bearer mk_home_fixture-not-a-real-key',
		'cf-connecting-ip': `10.0.0.${requestSeq % 250}`,
		origin: BOUNDARY_ORIGIN,
	};
}

function authHeaders(): Record<string, string> {
	return { authorization: 'Bearer mk_home_fixture-not-a-real-key', origin: BOUNDARY_ORIGIN };
}

beforeEach(async () => {
	// API key verification is stubbed through the documented DI seam
	// so the suite never depends on a Better Auth apikey row.
	withVerifyApiKey(async () => ({
		valid: true,
		error: null,
		key: {
			id: PRINCIPAL,
			referenceId: 'ref-home',
			permissions: {
				access_counter: ['read', 'write'],
				reactions: ['read', 'write'],
			},
			prefix: 'mk_home_',
		},
	}));

	await env.DB.batch([
		env.DB.prepare('DELETE FROM reactions'),
		env.DB.prepare('DELETE FROM access_dedup'),
		env.DB.prepare('DELETE FROM access_counters'),
		env.DB.prepare('DELETE FROM reaction_emoji_catalog'),
		env.DB.prepare('DELETE FROM portfolio_link'),
		env.DB.prepare('DELETE FROM portfolio_media'),
		env.DB.prepare('DELETE FROM portfolio_project'),
	]);

	// One benign row per table. The suite asserts this exact content
	// survives every payload, and that a payload never reads it.
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO reactions (id, target_key, actor_id, principal, kind, value, created_at)
       VALUES ('r-seed', ?1, 'actor-seed', ?2, 'emoji', '👍', ?3)`,
		).bind(BENIGN_TARGET, PRINCIPAL, SEEDED_AT),
		env.DB.prepare(
			`INSERT INTO reactions (id, target_key, actor_id, principal, kind, value, created_at)
       VALUES ('r-other-principal', ?1, 'actor-seed', ?2, 'emoji', '🎉', ?3)`,
		).bind(BENIGN_TARGET, OTHER_PRINCIPAL, SEEDED_AT),
		env.DB.prepare(
			`INSERT INTO access_counters (key, principal, count, first_hit, last_hit)
       VALUES (?1, ?2, 7, ?3, ?3)`,
		).bind(BENIGN_TARGET, PRINCIPAL, SEEDED_AT),
		env.DB.prepare(
			`INSERT INTO reaction_emoji_catalog (slug, codepoint, enabled, created_by, created_at, updated_at)
       VALUES ('thumbs_up', '👍', 1, NULL, ?1, ?1)`,
		).bind(SEEDED_AT),
		env.DB.prepare(
			`INSERT INTO portfolio_project (id, slug, title, summary, role, period_start, motivation_md,
        facets, technologies, visibility, status, pinned, display_order, created_at, updated_at)
       VALUES ('p-seed', 'alpha', 'Alpha', 'summary', 'Solo developer', ?1, '',
        '["develop"]', '["TypeScript"]', 'public', 'published', 0, 10, ?1, ?1)`,
		).bind(SEEDED_AT),
	]);
});

afterEach(() => {
	resetVerifyApiKey();
});

/* ------------------------------------------------------------------ *
 * Access counter — POST /api/v1/access/hit
 * ------------------------------------------------------------------ */

describe('POST /api/v1/access/hit — counter key and session_id', () => {
	it('stores a metacharacter payload as data, without changing the query', async () => {
		// The baseline uses its OWN key so the seeded `blog-intro`
		// counter row stays at 7 and every payload assertion about it
		// is about the seed, not about a baseline side effect.
		const benign = createRecorder();
		const benignRes = await recordHit(benign.env, 'baseline-benign', 'session-benign');
		expect(benignRes.status).toBe(200);

		// The access-counter key/session validators reject whitespace
		// and control characters, so only the compact payloads can
		// reach SQLite on this surface. The rest are asserted to be
		// rejected further down.
		for (const payload of withoutWhitespace(INJECTION_PAYLOADS)) {
			const before = await snapshot();
			const recorder = createRecorder();
			const res = await recordHit(recorder.env, payload.value, payload.value);
			expect(res.status).toBe(200);

			// 1. Query structure is input-independent.
			expect(sqlTexts(recorder), `payload '${payload.id}' changed the statement`).toEqual(
				sqlTexts(benign),
			);
			// 2. The payload travelled as a bound value only.
			expectNoPayloadInStatementText(recorder);
			expectPayloadWasBound(recorder, payload.value);
			// 3. Stored verbatim, and the seeded rows are untouched.
			const rows = await env.DB.prepare('SELECT key, count FROM access_counters ORDER BY key').all<{
				key: string;
				count: number;
			}>();
			const stored = rows.results ?? [];
			expect(stored.find((row) => row.key === payload.value)?.count).toBe(1);
			expect(stored.find((row) => row.key === BENIGN_TARGET)?.count).toBe(7);
			const reactions = await env.DB.prepare('SELECT COUNT(*) AS c FROM reactions').first<{
				c: number;
			}>();
			expect(reactions?.c, 'the reactions table the payload names must survive').toBe(2);
			// Only the payload's own counter row is new; every
			// pre-existing row and every other table is byte-identical.
			const after = await snapshot();
			const added = after.accessCounters.filter(
				(row) => !before.accessCounters.some((prior) => sameRow(prior, row)),
			);
			expect(added).toHaveLength(1);
			expect(added[0]).toMatchObject({ key: payload.value, count: 1, principal: PRINCIPAL });
			for (const row of before.accessCounters) {
				expect(after.accessCounters).toContainEqual(row);
			}
			expect(after.reactions).toEqual(before.reactions);
			expect(after.catalog).toEqual(before.catalog);
			expect(after.portfolio).toEqual(before.portfolio);
		}
	});

	it('rejects payloads the counter validators refuse, without touching D1', async () => {
		const rejected = [
			...MALFORMED_INPUT_PAYLOADS,
			...INJECTION_PAYLOADS.filter(
				(payload) => !withoutWhitespace(INJECTION_PAYLOADS).includes(payload),
			),
		];
		for (const payload of rejected) {
			const before = await snapshot();
			const recorder = createRecorder();
			const res = await recordHit(recorder.env, payload.value, 'session-benign');
			// Rejected: never a success response ...
			expect(res.ok, `payload '${payload.id}' was accepted`).toBe(false);
			// ... and never a D1 statement: validation and the
			// pre-D1 ingress filter both run before `recordHit`.
			expect(recorder.statements, `payload '${payload.id}' reached D1`).toEqual([]);
			expect(await snapshot()).toEqual(before);
		}
	});
});

/* ------------------------------------------------------------------ *
 * Access counter — GET /api/v1/access/count/:key
 * ------------------------------------------------------------------ */

describe('GET /api/v1/access/count/:key — path-parameter read', () => {
	it('a tautology payload matches nothing and does not widen the predicate', async () => {
		const benign = createRecorder();
		await externalBoundary.request(
			`/api/v1/access/count/${encodeURIComponent(BENIGN_TARGET)}`,
			{ headers: authHeaders() },
			benign.env,
		);

		const payload = "'OR'1'='1";
		const before = await snapshot();
		const attack = createRecorder();
		const res = await externalBoundary.request(
			`/api/v1/access/count/${encodeURIComponent(payload)}`,
			{ headers: authHeaders() },
			attack.env,
		);
		expect(res.status).toBe(200);
		// The counter row for `blog-intro` exists for this principal.
		// Had `key = ?1` been spliced into the statement, the
		// tautology would have returned its count (7) instead.
		const body = (await res.json()) as { count: number; first_hit: number | null };
		expect(body.count).toBe(0);
		expect(body.first_hit).toBeNull();

		expect(sqlTexts(attack)).toEqual(sqlTexts(benign));
		expectNoPayloadInStatementText(attack);
		expectPayloadWasBound(attack, payload);
		expect(await snapshot()).toEqual(before);
	});

	it('still returns the caller-owned count for a benign key (control)', async () => {
		const res = await externalBoundary.request(
			`/api/v1/access/count/${encodeURIComponent(BENIGN_TARGET)}`,
			{ headers: authHeaders() },
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { count: number };
		expect(body.count).toBe(7);
	});
});

/* ------------------------------------------------------------------ *
 * Reactions — PUT /api/v1/reactions
 * ------------------------------------------------------------------ */

describe('PUT /api/v1/reactions — target_key / actor_id / value', () => {
	it('accepts a metacharacter target_key and stores it verbatim', async () => {
		const benign = createRecorder();
		const benignRes = await putReaction(benign.env, {
			target_key: BENIGN_TARGET,
			actor_id: 'actor-1',
			value: '👍',
		});
		expect(benignRes.status).toBe(200);

		for (const payload of INJECTION_PAYLOADS) {
			const recorder = createRecorder();
			const res = await putReaction(recorder.env, {
				target_key: payload.value,
				actor_id: 'actor-attack',
				value: '👍',
			});
			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ created: true });

			expect(sqlTexts(recorder), `payload '${payload.id}' changed the statement`).toEqual(
				sqlTexts(benign),
			);
			expectNoPayloadInStatementText(recorder);
			expectPayloadWasBound(recorder, payload.value);
		}

		const rows = await env.DB.prepare('SELECT target_key FROM reactions WHERE actor_id = ?1')
			.bind('actor-attack')
			.all<{ target_key: string }>();
		expect([...(rows.results ?? [])].map((row) => row.target_key).sort()).toEqual(
			INJECTION_PAYLOADS.map((payload) => payload.value).sort(),
		);
	});

	it('accepts a metacharacter actor_id and emoji value as bound data', async () => {
		for (const payload of UNIVERSAL_PAYLOADS) {
			const recorder = createRecorder();
			const res = await putReaction(recorder.env, {
				target_key: BENIGN_TARGET,
				actor_id: payload.value,
				value: payload.value,
			});
			expect(res.status).toBe(200);
			expectNoPayloadInStatementText(recorder);
			expectPayloadWasBound(recorder, payload.value);
		}
		const rows = await env.DB.prepare('SELECT actor_id FROM reactions WHERE target_key = ?1')
			.bind(BENIGN_TARGET)
			.all<{ actor_id: string }>();
		expect(
			(rows.results ?? [])
				.map((row) => row.actor_id)
				.filter((actorId) => actorId !== 'actor-seed')
				.sort(),
		).toEqual(UNIVERSAL_PAYLOADS.map((payload) => payload.value).sort());
		// `MAX_EMOJI_LEN` is a length bound, not a charset filter, so a
		// payload may not simply be dropped — it must be stored as data.
		for (const payload of UNIVERSAL_PAYLOADS) {
			expect(payload.value.length).toBeLessThanOrEqual(MAX_EMOJI_LEN);
		}
	});

	it('rejects an image-kind value carrying SQL metacharacters before D1', async () => {
		const before = await snapshot();
		for (const payload of INJECTION_PAYLOADS) {
			const recorder = createRecorder();
			const res = await putReaction(recorder.env, {
				target_key: BENIGN_TARGET,
				actor_id: 'actor-image',
				value: payload.value,
				kind: 'image',
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe('invalid_body');
			expect(recorder.statements).toEqual([]);
		}
		expect(await snapshot()).toEqual(before);
	});

	it('rejects an over-length target_key / actor_id before D1', async () => {
		const before = await snapshot();
		const oversized = MALFORMED_INPUT_PAYLOADS[0];
		for (const field of ['target_key', 'actor_id'] as const) {
			const recorder = createRecorder();
			const res = await putReaction(recorder.env, {
				target_key: BENIGN_TARGET,
				actor_id: 'actor-1',
				value: '👍',
				[field]: oversized.value,
			});
			expect(res.status).toBe(400);
			expect(recorder.statements).toEqual([]);
		}
		expect(await snapshot()).toEqual(before);
	});
});

describe('DELETE /api/v1/reactions — a payload deletes only its own row', () => {
	it('a tautology payload removes nothing', async () => {
		const before = await snapshot();
		const payload = "' OR '1'='1";
		const recorder = createRecorder();
		const res = await externalBoundary.request(
			'/api/v1/reactions',
			{
				method: 'DELETE',
				headers: authHeaders(),
				body: JSON.stringify({
					target_key: payload,
					actor_id: 'actor-seed',
					kind: 'emoji',
					value: '👍',
				}),
			},
			recorder.env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ deleted: false });
		expectNoPayloadInStatementText(recorder);
		expectPayloadWasBound(recorder, payload);
		// The seeded rows — the exact tuple the payload "matched" — are
		// still there.
		expect(await snapshot()).toEqual(before);
	});
});

/* ------------------------------------------------------------------ *
 * Reactions — GET /api/v1/reactions?target&actor_id
 * ------------------------------------------------------------------ */

describe('GET /api/v1/reactions — aggregate + viewer-scoped read', () => {
	it('an aggregate query with a tautology target returns nothing', async () => {
		const benign = createRecorder();
		const benignRes = await externalBoundary.request(
			`/api/v1/reactions?target=${encodeURIComponent(BENIGN_TARGET)}`,
			{ headers: authHeaders() },
			benign.env,
		);
		expect(benignRes.status).toBe(200);

		const payload = "' OR '1'='1";
		const before = await snapshot();
		const attack = createRecorder();
		const res = await externalBoundary.request(
			`/api/v1/reactions?target=${encodeURIComponent(payload)}`,
			{ headers: authHeaders() },
			attack.env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { target_key: string; aggregates: unknown[] };
		// Rows exist for `blog-intro` (this principal AND another
		// one). A spliced tautology would have aggregated both.
		expect(body.aggregates).toEqual([]);
		expect(body.target_key).toBe(payload);

		expect(sqlTexts(attack)).toEqual(sqlTexts(benign));
		expectNoPayloadInStatementText(attack);
		expectPayloadWasBound(attack, payload);
		expect(await snapshot()).toEqual(before);
	});

	it('keeps aggregate scopes principal-isolated (benign control)', async () => {
		const res = await externalBoundary.request(
			`/api/v1/reactions?target=${encodeURIComponent(BENIGN_TARGET)}`,
			{ headers: authHeaders() },
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			aggregates: Array<{ kind: string; value: string; count: number }>;
		};
		// Only this principal's 👍 row; the other principal's 🎉 row
		// must not appear.
		expect(body.aggregates).toEqual([{ kind: 'emoji', value: '👍', count: 1 }]);
	});

	it('an actor_id payload selects only that actor, and is bound', async () => {
		const payload = "' OR 1=1 --";
		const before = await snapshot();
		const recorder = createRecorder();
		const res = await externalBoundary.request(
			`/api/v1/reactions?target=${encodeURIComponent(BENIGN_TARGET)}&actor_id=${encodeURIComponent(payload)}`,
			{ headers: authHeaders() },
			recorder.env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { viewer_reactions: unknown[]; aggregates: unknown[] };
		expect(body.viewer_reactions).toEqual([]);
		// The aggregate is unaffected by the actor_id payload.
		expect(body.aggregates).toHaveLength(1);
		expectNoPayloadInStatementText(recorder);
		expectPayloadWasBound(recorder, payload);
		expect(await snapshot()).toEqual(before);
	});

	it('rejects an over-length target and an over-length actor_id', async () => {
		const before = await snapshot();
		const oversized = MALFORMED_INPUT_PAYLOADS[0];
		for (const query of [
			`target=${encodeURIComponent(oversized.value)}`,
			`target=${encodeURIComponent(BENIGN_TARGET)}&actor_id=${encodeURIComponent(oversized.value)}`,
		]) {
			const recorder = createRecorder();
			const res = await externalBoundary.request(
				`/api/v1/reactions?${query}`,
				{ headers: authHeaders() },
				recorder.env,
			);
			expect(res.status).toBe(400);
			// The aggregate statement for the (benign) target may run
			// before `actor_id` is validated — that is fine. What must
			// never happen is the rejected value reaching SQLite.
			expectPayloadNeverBound(recorder, oversized.value);
			expectNoPayloadInStatementText(recorder);
		}
		expect(await snapshot()).toEqual(before);
	});
});

/* ------------------------------------------------------------------ *
 * Reaction images — GET /api/v1/reaction-images/:id
 * ------------------------------------------------------------------ */

describe('GET /api/v1/reaction-images/:id — image id path param', () => {
	it('rejects a metacharacter id before D1', async () => {
		const before = await snapshot();
		for (const payload of INJECTION_PAYLOADS) {
			const recorder = createRecorder();
			const res = await externalBoundary.request(
				`/api/v1/reaction-images/${encodeURIComponent(payload.value)}`,
				{},
				recorder.env,
			);
			// `/:id` is constrained to `[A-Za-z0-9_-]{1,64}`; every
			// payload carries a quote or a wildcard, so it is refused.
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: string };
			expect(body.error).toBe('invalid_id');
			expect(recorder.statements).toEqual([]);
		}
		expect(await snapshot()).toEqual(before);
	});
});

/* ------------------------------------------------------------------ *
 * Portfolio loader — slug read by a user-controlled URL segment
 * ------------------------------------------------------------------ */

describe('portfolio loader — slug read by a user-controlled URL segment', () => {
	it('a metacharacter slug resolves to null without changing the statement', async () => {
		// Baseline: a benign miss runs exactly one statement, which is
		// what a payload miss must run as well.
		const baselineRecorder = createRecorder();
		expect(
			await createD1PortfolioLoader({ DB: baselineRecorder.env.DB }).loadPortfolioProject(
				'no-such-slug',
			),
		).toBeNull();
		const baseline = sqlTexts(baselineRecorder);
		expect(baseline).not.toEqual([]);

		const before = await snapshot();
		for (const payload of INJECTION_PAYLOADS) {
			const recorder = createRecorder();
			const scoped = createD1PortfolioLoader({ DB: recorder.env.DB });
			const project = await scoped.loadPortfolioProject(payload.value);
			// `alpha` exists and is public. A spliced payload would have
			// returned it (or every row).
			expect(project).toBeNull();
			expect(sqlTexts(recorder), `payload '${payload.id}' changed the statement`).toEqual(baseline);
			expectNoPayloadInStatementText(recorder);
			expectPayloadWasBound(recorder, payload.value);
		}
		expect(await snapshot()).toEqual(before);
		// The public row is still reachable by its real slug.
		expect(
			await createD1PortfolioLoader({ DB: env.DB }).loadPortfolioProject('alpha'),
		).not.toBeNull();
	});

	it('an adjacent-navigation read with a payload slug returns no neighbours', async () => {
		const payload = "' OR 1=1 --";
		const before = await snapshot();
		const recorder = createRecorder();
		const adjacent = await createD1PortfolioLoader({ DB: recorder.env.DB }).loadPortfolioAdjacent(
			payload,
		);
		expect(adjacent).toEqual({ prev: null, next: null });
		expectNoPayloadInStatementText(recorder);
		expectPayloadWasBound(recorder, payload);
		expect(await snapshot()).toEqual(before);
	});
});

/* ------------------------------------------------------------------ *
 * Emoji catalog — slug read shared by home + admin
 * ------------------------------------------------------------------ */

describe('emoji catalog — slug read', () => {
	it('a metacharacter slug misses the catalog and is still bound', async () => {
		const recorder = createRecorder();
		for (const payload of INJECTION_PAYLOADS) {
			expect(await getCatalogEntry(recorder.env.DB, payload.value)).toBeNull();
		}
		expect(recorder.statements.map((statement) => statement.sql)).toEqual(
			INJECTION_PAYLOADS.map(
				() => 'SELECT slug, codepoint, enabled FROM reaction_emoji_catalog WHERE slug = ?1',
			),
		);
		expectNoPayloadInStatementText(recorder);
		for (const payload of INJECTION_PAYLOADS) {
			expectPayloadWasBound(recorder, payload.value);
		}
		// The catalog row is intact and still reachable.
		expect(await getCatalogEntry(env.DB, 'thumbs_up')).toMatchObject({ slug: 'thumbs_up' });
	});
});

/* ------------------------------------------------------------------ *
 * Fixture self-checks
 * ------------------------------------------------------------------ */

describe('fixture self-checks', () => {
	it('the compact payloads survive the access-counter no-whitespace rule', () => {
		const compact = withoutWhitespace(INJECTION_PAYLOADS);
		// Each one must be able to reach SQLite as a *value*, so a
		// regression in the counter's validator that silently widened
		// the reject set would shrink this list.
		expect(compact.map((payload) => payload.id).sort()).toEqual([
			'tautology-compact',
			'union-compact',
			'wildcard-compact',
		]);
		for (const payload of compact) {
			expect(payload.value.length).toBeLessThanOrEqual(256);
			expect(hasControlOrWhitespace(payload.value)).toBe(false);
		}
	});

	it('the emoji-length subset is what the value validator accepts', () => {
		expect(withinMaxLength(INJECTION_PAYLOADS, MAX_EMOJI_LEN)).toEqual(UNIVERSAL_PAYLOADS);
		expect(UNIVERSAL_PAYLOADS.length).toBeLessThan(INJECTION_PAYLOADS.length);
	});

	it('classifies every payload exactly once', () => {
		const ids = ALL_PAYLOADS.map((payload) => payload.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
	});
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

interface PutReactionBody {
	target_key: string;
	actor_id: string;
	value: string;
	kind?: 'emoji' | 'image';
}

function putReaction(workerEnv: Env, body: PutReactionBody): Promise<Response> | Response {
	return externalBoundary.request(
		'/api/v1/reactions',
		{
			method: 'PUT',
			headers: authHeaders(),
			body: JSON.stringify({ kind: 'emoji', ...body }),
		},
		workerEnv,
	);
}

function recordHit(workerEnv: Env, key: string, sessionId: string): Promise<Response> | Response {
	return externalBoundary.request(
		'/api/v1/access/hit',
		{
			method: 'POST',
			headers: hitHeaders(),
			body: JSON.stringify({ key, session_id: sessionId }),
		},
		workerEnv,
	);
}

/** Deep-equality helper for snapshot rows. */
function sameRow(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
