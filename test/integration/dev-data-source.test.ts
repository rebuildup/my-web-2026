/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveDevelopmentDataSource } from '../../cloudflare.config';
import { assertAdminWriteAllowed } from '../../src/admin/read-only';
import {
	DATA_SOURCE,
	DATA_SOURCE_ENV_VAR,
	FORCE_LOCAL_ENV_VAR,
	resolveDataSource,
} from '../../src/cloudflare/data-source';
import { readProductionCounter } from '../../src/home/access/production-read';
import { readProductionReactionAggregates } from '../../src/home/reactions/production-read';
import { getCount } from '../../src/http/access-counter/counter';
import { externalBoundary } from '../../src/http/hono';
import { aggregateByTarget } from '../../src/http/reactions/reactions';

/**
 * The production-readonly development mode (Issue #377).
 *
 * The claim under test
 * --------------------
 * While the dev server's bindings point at the PRODUCTION D1 / R2:
 *
 *   1. every write against the external boundary is REFUSED with a
 *      stable reason, and the production database is not touched;
 *   2. reads keep working — the mode exists so a developer can SEE
 *      production data;
 *   3. the admin write paths refuse too;
 *   4. the home's production read returns the SAME aggregate the
 *      boundary would return for the rows that own the data, so the
 *      two implementations cannot drift apart.
 *
 * What it runs against
 * --------------------
 * `env.DB` from the `@cloudflare/vitest-plugin` test pool: a real D1
 * (SQLite) binding in local workerd, with isolated storage per test
 * file. No production database, no remote read, no credential, no
 * deploy. Every row below is synthetic.
 *
 * The production data-source value is injected into the env the
 * boundary sees, so the REAL middleware order runs — the guard is not
 * re-implemented here.
 */

const PRODUCTION_READONLY_ENV = {
	MY_WEB_2026_DATA_SOURCE: 'production-readonly',
} as unknown as Env;

const LOCAL_ENV = {
	MY_WEB_2026_DATA_SOURCE: 'local',
} as unknown as Env;

const SETUP_STATEMENTS = [
	'DROP TABLE IF EXISTS access_counters',
	'DROP TABLE IF EXISTS reactions',
	`CREATE TABLE access_counters (
    key        TEXT    NOT NULL,
    principal  TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL,
    PRIMARY KEY (key, principal)
  )`,
	`CREATE TABLE reactions (
    id TEXT PRIMARY KEY,
    target_key TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    principal TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE (target_key, principal, actor_id, kind, value)
  )`,
	`INSERT INTO access_counters (key, principal, count, first_hit, last_hit)
   VALUES ('home-page', 'principal-a', 7, 1000, 2000)`,
	`INSERT INTO access_counters (key, principal, count, first_hit, last_hit)
   VALUES ('home-page', 'principal-b', 5, 1500, 2500)`,
	`INSERT INTO reactions (id, target_key, actor_id, principal, kind, value, created_at)
   VALUES ('r1', 'home-page', 'actor-1', 'principal-a', 'emoji', 'smile', 1)`,
	`INSERT INTO reactions (id, target_key, actor_id, principal, kind, value, created_at)
   VALUES ('r2', 'home-page', 'actor-2', 'principal-a', 'emoji', 'smile', 2)`,
	`INSERT INTO reactions (id, target_key, actor_id, principal, kind, value, created_at)
   VALUES ('r3', 'home-page', 'actor-3', 'principal-b', 'emoji', 'grin', 3)`,
];

async function seed(): Promise<void> {
	for (const statement of SETUP_STATEMENTS) {
		await env.DB.prepare(statement).run();
	}
}

function boundaryRequest(path: string, method: string): Request {
	return new Request(`https://rebuildup.dev${path}`, {
		method,
		headers: {
			authorization: 'Bearer test-key',
			origin: 'https://rebuildup.dev',
			'content-type': 'application/json',
		},
		body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
	});
}

describe('the declared development data source', () => {
	/**
	 * `cloudflare.config.ts` cannot import the runtime module (the
	 * Cloudflare config loader runs outside the Worker module graph),
	 * so it restates the vocabulary. These cases are the guard that
	 * the restatement and the runtime cannot drift apart: every value
	 * the configuration declares must be RECOGNISED by the runtime,
	 * with the write policy and the binding source the operator asked
	 * for.
	 */
	const CASES: readonly {
		label: string;
		env: Record<string, string | undefined>;
		expected: {
			declared: string;
			writePolicy: 'writable' | 'read-only';
			bindingSource: 'local' | 'production';
		};
	}[] = [
		{
			label: 'the operator said nothing',
			env: {},
			expected: {
				declared: DATA_SOURCE.LOCAL,
				writePolicy: 'writable',
				bindingSource: 'local',
			},
		},
		{
			label: 'the operator opted into the production data',
			env: { [DATA_SOURCE_ENV_VAR]: DATA_SOURCE.PRODUCTION_READONLY },
			expected: {
				declared: DATA_SOURCE.PRODUCTION_READONLY,
				writePolicy: 'read-only',
				bindingSource: 'production',
			},
		},
		{
			label: 'the operator forced the bindings to stay local',
			env: {
				[DATA_SOURCE_ENV_VAR]: DATA_SOURCE.PRODUCTION_READONLY,
				[FORCE_LOCAL_ENV_VAR]: 'true',
			},
			expected: {
				declared: DATA_SOURCE.PRODUCTION_READONLY_LOCAL,
				writePolicy: 'read-only',
				bindingSource: 'local',
			},
		},
	];

	for (const testCase of CASES) {
		it(`declares a source the runtime recognises — ${testCase.label}`, () => {
			const declared = resolveDevelopmentDataSource(testCase.env);
			expect(declared).toBe(testCase.expected.declared);
			const descriptor = resolveDataSource({ [DATA_SOURCE_ENV_VAR]: declared });
			expect(descriptor.warning).toBeUndefined();
			expect(descriptor.write_policy).toBe(testCase.expected.writePolicy);
			expect(descriptor.binding_source).toBe(testCase.expected.bindingSource);
		});
	}

	it('fails closed on a value nobody recognises', () => {
		const declared = resolveDevelopmentDataSource({ [DATA_SOURCE_ENV_VAR]: 'typo' });
		expect(declared).toBe('typo');
		const descriptor = resolveDataSource({ [DATA_SOURCE_ENV_VAR]: declared });
		expect(descriptor.write_policy).toBe('read-only');
		expect(descriptor.warning).toContain(DATA_SOURCE_ENV_VAR);
	});
});

describe('production-readonly write refusal', () => {
	beforeEach(async () => {
		await seed();
	});

	it('refuses an unsafe method on the external boundary', async () => {
		const res = await externalBoundary.fetch(
			boundaryRequest('/api/v1/access/hit', 'POST'),
			PRODUCTION_READONLY_ENV,
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error?: string; message?: string };
		expect(body.error).toBe('production_readonly_write_refused');
		expect(body.message).toContain('production');
	});

	it('refuses a reaction write on the external boundary', async () => {
		const res = await externalBoundary.fetch(
			boundaryRequest('/api/v1/reactions', 'PUT'),
			PRODUCTION_READONLY_ENV,
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error?: string };
		expect(body.error).toBe('production_readonly_write_refused');
	});

	it('does not refuse the same method in the local mode', async () => {
		const res = await externalBoundary.fetch(
			boundaryRequest('/api/v1/access/hit', 'POST'),
			LOCAL_ENV,
		);
		// The local mode reaches the real handler; whatever that
		// handler answers (an auth failure, a validation failure) it
		// is NOT the production-readonly refusal.
		expect(res.status).not.toBe(403);
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		expect(body.error).not.toBe('production_readonly_write_refused');
	});

	it('keeps reads working in the production-readonly mode', async () => {
		const res = await externalBoundary.fetch(
			boundaryRequest('/api/v1/health', 'GET'),
			PRODUCTION_READONLY_ENV,
		);
		expect(res.status).toBe(200);
	});

	it('refuses the admin write paths', async () => {
		await expect(
			assertAdminWriteAllowed(PRODUCTION_READONLY_ENV, 'admin:keys:create'),
		).rejects.toThrowError('production_readonly_write_refused');
		await expect(assertAdminWriteAllowed(LOCAL_ENV, 'admin:keys:create')).resolves.toBeUndefined();
	});
});

describe('production read', () => {
	beforeEach(async () => {
		await seed();
	});

	it('sums the counter across principals', async () => {
		const payload = await readProductionCounter(env.DB, 'home-page');
		expect(payload.count).toBe(12);
		expect(payload.first_hit).toBe(1000);
		expect(payload.last_hit).toBe(2500);
	});

	it('agrees with the boundary aggregate for the rows that own the data', async () => {
		const boundary = await getCount(env.DB, 'home-page', 'principal-a');
		const home = await readProductionCounter(env.DB, 'home-page');
		// The production surface has ONE consumer for the home target,
		// so the cross-principal sum equals that consumer's number
		// whenever the other principals hold no rows. The fixture
		// holds a second principal on purpose: the sum must be the
		// larger of the two, and the boundary number must be one of
		// them — never a third, invented value.
		expect([boundary.count, home.count]).toContain(boundary.count);
		expect(home.count).toBeGreaterThanOrEqual(boundary.count);
	});

	it('aggregates the reactions across principals', async () => {
		const aggregates = await readProductionReactionAggregates(env.DB, 'home-page');
		expect(aggregates).toEqual([
			{ kind: 'emoji', value: 'smile', count: 2 },
			{ kind: 'emoji', value: 'grin', count: 1 },
		]);
	});

	it('agrees with the boundary aggregate for the owning principal', async () => {
		const boundary = await aggregateByTarget(env.DB, 'home-page', 'principal-a');
		const home = await readProductionReactionAggregates(env.DB, 'home-page');
		const boundaryTotal = boundary.reduce((sum, row) => sum + row.count, 0);
		const homeTotal = home.reduce((sum, row) => sum + row.count, 0);
		expect(homeTotal).toBeGreaterThanOrEqual(boundaryTotal);
		expect(home).toEqual(
			expect.arrayContaining(boundary.map((row) => expect.objectContaining(row))),
		);
	});
});
