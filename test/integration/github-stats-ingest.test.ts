/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth } from '../../test/helpers/better-auth';

/**
 * GitHub stats ingest — boundary + storage contract
 * (Issues #1244 / #1245, data contract
 * `docs/domain/github-profile-data.md`).
 *
 * Every request is a real `SELF.fetch` through the Worker entry
 * (`src/server.ts` → Hono `externalBoundary` → `csrfGuard` →
 * `requireApiKey` → `requireResourceAction` → D1 upsert), and every
 * key is minted by the real `auth.api.createApiKey` against the
 * local workerd D1 — nothing auth-related is stubbed.
 *
 * The suite pins four contracts:
 *   1. WRITE: only a `github_stats:write` key may store a snapshot,
 *      and only the allowlisted document shape reaches D1.
 *   2. NULLS: unmeasured metrics are `null`, never coerced to zero —
 *      the boundary preserves the "not measured" distinction.
 *   3. SCOPE: the document carries aggregates and public repo totals
 *      only — there is no field that could carry a private repo
 *      identity, so the privacy boundary is structural.
 *   4. LEAK: a body with non-contract fields or a non-data-URI avatar
 *      is refused before D1.
 */

const MIGRATIONS = [
	{
		name: '0013_github_stats',
		queries: [
			`CREATE TABLE github_stats_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
)`,
		],
	},
];

const PATH = '/api/v1/stats/github';
const WORKER_ORIGIN = 'https://example.com';
const OBSERVED_AT = new Date().toISOString();

const VALID_SNAPSHOT = {
	schemaVersion: 1,
	generatedOn: OBSERVED_AT.slice(0, 10),
	observedAt: OBSERVED_AT,
	owner: 'rebuildup',
	sources: {
		graphql: { status: 'ok', observedAt: OBSERVED_AT },
		streak: { status: 'ok', observedAt: OBSERVED_AT },
		search: { status: 'ok', observedAt: OBSERVED_AT },
		avatar: { status: 'ok', observedAt: OBSERVED_AT },
	},
	streak: {
		currentStreak: 5,
		longestStreak: 30,
		totalContributions: 9000,
		firstContribution: 'Mar 1, 2020',
		currentStreakStart: 'Nov 23, 2026',
		currentStreakEnd: 'Nov 27',
		longestStreakStart: 'Jan 1, 2025',
		longestStreakEnd: 'Jan 30, 2025',
	},
	metrics: {
		contributionsY1: 420,
		reviewsY1: 35,
		commitsAuthoredAllTime: 1500,
		prsAuthoredAllTime: 180,
		issuesAuthoredAllTime: 95,
		prsOpenedAllTime: 180,
		issuesOpenedAllTime: 90,
		contributedTo: 57,
		followers: 64,
	},
	repos: { owned: 48, contributedTo: 57, participated: 12, complete: true },
	stars: { owned: 340, participated: 890 },
	languages: {
		owned: [{ name: 'TypeScript', color: '#3178c6', size: 9_000_000, count: 10 }],
		participated: [{ name: 'Rust', color: '#dea584', size: 4_000_000, count: 3 }],
	},
	rank: {
		inputs: {
			all_commits: true,
			commits: 1500,
			prs: 180,
			issues: 95,
			reviews: 35,
			repos: 48,
			stars: 340,
			followers: 64,
		},
		current: { level: 'B', percentile: 61.2 },
		legacy: { level: 'B+', percentile: 55.0 },
	},
	avatarDataUri: 'data:image/png;base64,iVBORw0KGgo=',
};

let userId = '';
let writeKey = '';
let readOnlyKey = '';

async function clearRows(): Promise<void> {
	await env.DB.prepare('DELETE FROM github_stats_snapshot').run();
}

async function issueKey(name: string, permissions: Record<string, string[]>): Promise<string> {
	const created = (await auth.api.createApiKey({
		body: { name, userId, permissions },
	})) as { id: string; key?: string };
	if (!created.id || typeof created.key !== 'string') {
		throw new Error(`fixture key ${name} could not be minted`);
	}
	return created.key;
}

async function put(body: unknown, authorization?: string): Promise<Response> {
	const headers: Record<string, string> = {
		origin: WORKER_ORIGIN,
		'content-type': 'application/json',
	};
	if (authorization !== undefined) headers.authorization = `Bearer ${authorization}`;
	return SELF.fetch(`https://example.com${PATH}`, {
		method: 'PUT',
		headers,
		body: JSON.stringify(body),
	});
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
	const result = await auth.api.createUser({
		body: {
			email: 'stats-ingest@example.com',
			password: 'correct-horse-battery-staple',
			name: 'Stats Admin',
			role: 'admin',
		},
	});
	userId = String(result.user.id);
	writeKey = await issueKey('stats-ingest', { github_stats: ['write'] });
	readOnlyKey = await issueKey('stats-readonly', { github_stats: ['read'] });
});

afterAll(async () => {
	await env.DB.prepare('DELETE FROM github_stats_snapshot').run();
});

describe('PUT /api/v1/stats/github', () => {
	it('stores a valid snapshot for a github_stats:write key', async () => {
		await clearRows();
		const res = await put(VALID_SNAPSHOT, writeKey);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { stored: boolean; receivedAt: string };
		expect(body.stored).toBe(true);

		const row = await env.DB.prepare(
			'SELECT payload, received_at AS receivedAt FROM github_stats_snapshot WHERE id = 1',
		).first<{ payload: string; receivedAt: string }>();
		expect(row).not.toBeNull();
		if (!row) throw new Error('snapshot row missing after PUT');
		expect(JSON.parse(row.payload)).toMatchObject({
			schemaVersion: 1,
			owner: 'rebuildup',
		});
		// First request pays the workerd cold start — allow well over
		// the 5s default under loaded machines.
	}, 30_000);

	it('rejects a key without github_stats:write (403)', async () => {
		await clearRows();
		const res = await put(VALID_SNAPSHOT, readOnlyKey);
		expect(res.status).toBe(403);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM github_stats_snapshot').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('rejects a missing key (401)', async () => {
		const res = await put(VALID_SNAPSHOT);
		expect(res.status).toBe(401);
	});

	it('preserves null metrics — unmeasured is not zero', async () => {
		await clearRows();
		const degraded = {
			...VALID_SNAPSHOT,
			metrics: { ...VALID_SNAPSHOT.metrics, commitsAuthoredAllTime: null },
			rank: null,
			sources: {
				...VALID_SNAPSHOT.sources,
				search: { status: 'failed', observedAt: OBSERVED_AT },
			},
		};
		const res = await put(degraded, writeKey);
		expect(res.status).toBe(200);
		const row = await env.DB.prepare(
			'SELECT payload FROM github_stats_snapshot WHERE id = 1',
		).first<{ payload: string }>();
		const stored = JSON.parse(row?.payload ?? '{}') as typeof VALID_SNAPSHOT;
		expect(stored.metrics.commitsAuthoredAllTime).toBeNull();
		expect(stored.rank).toBeNull();
	});

	it('rejects a body with non-contract fields before D1 (400)', async () => {
		await clearRows();
		const res = await put(
			{
				...VALID_SNAPSHOT,
				repos: { ...VALID_SNAPSHOT.repos, privateRepos: ['secret-name'] },
			},
			writeKey,
		);
		expect(res.status).toBe(400);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM github_stats_snapshot').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('rejects a non-data-URI avatar payload (400)', async () => {
		const res = await put(
			{ ...VALID_SNAPSHOT, avatarDataUri: 'https://evil.example/x.png' },
			writeKey,
		);
		expect(res.status).toBe(400);
	});

	it('rejects an out-of-contract source status (400)', async () => {
		const res = await put(
			{
				...VALID_SNAPSHOT,
				sources: {
					...VALID_SNAPSHOT.sources,
					graphql: { status: 'error', observedAt: OBSERVED_AT },
				},
			},
			writeKey,
		);
		expect(res.status).toBe(400);
	});

	it('answers 405 for non-PUT methods', async () => {
		const res = await SELF.fetch(`https://example.com${PATH}`, {
			method: 'GET',
			headers: { origin: WORKER_ORIGIN },
		});
		expect(res.status).toBe(405);
	});
});
