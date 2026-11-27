/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectActivitySnapshot } from '../../src/home/activity/live';
import { readGitHubActivitySnapshot } from '../../src/home/activity/snapshot';
import { auth } from '../../test/helpers/better-auth';

/**
 * GitHub activity ingest — boundary + storage contract
 * (Issues #316 / #319 / #932).
 *
 * Every request is a real `SELF.fetch` through the Worker entry
 * (`src/server.ts` → Hono `externalBoundary` → `csrfGuard` →
 * `requireApiKey` → `requireResourceAction` → D1 upsert), and every
 * key is minted by the real `auth.api.createApiKey` against the
 * local workerd D1 — nothing auth-related is stubbed.
 *
 * The suite pins four contracts:
 *   1. WRITE: only a `github_activity:write` key may store a
 *      snapshot, and only the allowlisted document shape reaches D1
 *      (unknown fields are rejected, not stripped-and-kept).
 *   2. ANONYMITY: a private-kind entry that carries a real-looking
 *      id, a URL, or any field outside the anonymous allowlist is
 *      refused before D1 — the write boundary enforces the same
 *      contract the generator does.
 *   3. READ: the stored payload re-validates through the public
 *      reader (`src/home/activity/snapshot.ts`) and wins snapshot
 *      selection when it is fresher than the committed artefact.
 *   4. LEAK: a body carrying private identifiers outside the
 *      anonymous contract is refused before D1.
 */

const MIGRATIONS = [
	{
		name: '0012_github_activity',
		queries: [
			`CREATE TABLE github_activity_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
)`,
		],
	},
];

const PATH = '/api/v1/activity/github';
const WORKER_ORIGIN = 'https://example.com';
const OBSERVED_AT = new Date().toISOString();

const VALID_SNAPSHOT = {
	schemaVersion: 1,
	generatedOn: OBSERVED_AT.slice(0, 10),
	windowDays: 30,
	sources: {
		public: { status: 'ok', observedAt: OBSERVED_AT },
		private: { status: 'ok', observedAt: OBSERVED_AT },
	},
	repos: [
		{
			id: 'rebuildup/my-web-2026',
			kind: 'public',
			name: 'my-web-2026',
			repoFullName: 'rebuildup/my-web-2026',
			htmlUrl: 'https://github.com/rebuildup/my-web-2026',
			lastActiveAt: OBSERVED_AT,
			activity: { events: 3, windowDays: 30 },
		},
		{
			id: 'private-0123456789ab',
			kind: 'private',
			name: '非公開プロジェクト',
			lastActiveAt: OBSERVED_AT,
			activity: { events: 0, windowDays: 30 },
		},
	],
	feed: [
		{
			id: 'e1',
			kind: 'public',
			repoId: 'rebuildup/my-web-2026',
			type: 'PushEvent',
			at: OBSERVED_AT,
		},
	],
};

let userId = '';
let writeKey = '';
let readOnlyKey = '';

async function clearRows(): Promise<void> {
	// Only the snapshot table — `apikey`/`user` hold the fixtures the
	// whole suite authenticates with.
	await env.DB.prepare('DELETE FROM github_activity_snapshot').run();
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
			email: 'activity-ingest@example.com',
			password: 'correct-horse-battery-staple',
			name: 'Activity Admin',
			role: 'admin',
		},
	});
	userId = String(result.user.id);
	writeKey = await issueKey('activity-ingest', { github_activity: ['write'] });
	readOnlyKey = await issueKey('activity-readonly', { github_activity: ['read'] });
});

afterAll(async () => {
	await env.DB.prepare('DELETE FROM github_activity_snapshot').run();
});

describe('PUT /api/v1/activity/github', () => {
	it('stores a valid snapshot for a github_activity:write key', async () => {
		await clearRows();
		const res = await put(VALID_SNAPSHOT, writeKey);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { stored: boolean; receivedAt: string };
		expect(body.stored).toBe(true);
		expect(typeof body.receivedAt).toBe('string');

		const row = await env.DB.prepare(
			'SELECT payload, received_at AS receivedAt FROM github_activity_snapshot WHERE id = 1',
		).first<{ payload: string; receivedAt: string }>();
		expect(row).not.toBeNull();
		if (!row) throw new Error('snapshot row missing after PUT');
		expect(JSON.parse(row.payload)).toMatchObject({
			schemaVersion: 1,
			windowDays: 30,
		});
	});

	it('accepts a snapshot larger than the shared 16 KiB JSON cap (Issue #1256)', async () => {
		await clearRows();
		// ~20 KiB of repo entries — over MAX_JSON_BODY_BYTES, well under
		// the route's own cap and the schema's 200-repo ceiling. The
		// production payload crossed 16 KiB on 2026-11-27 and the daily
		// sync was refused with 413.
		const manyRepos = Array.from({ length: 80 }, (_, i) => ({
			id: `rebuildup/repo-${String(i).padStart(3, '0')}-with-a-longish-name`,
			kind: 'public' as const,
			name: `repo-${i}`,
			repoFullName: `rebuildup/repo-${i}`,
			htmlUrl: `https://github.com/rebuildup/repo-${i}`,
			summaryJa: 'あ'.repeat(200),
			scope: 'owned' as const,
			lastActiveAt: OBSERVED_AT,
			activity: { events: i, commits: i, prs: 0, windowDays: 30 },
		}));
		const res = await put({ ...VALID_SNAPSHOT, repos: manyRepos }, writeKey);
		expect(res.status).toBe(200);
	}, 30_000);

	it('the stored payload re-validates through the public reader and wins selection', async () => {
		await clearRows();
		await put(VALID_SNAPSHOT, writeKey);
		const row = await env.DB.prepare(
			'SELECT payload FROM github_activity_snapshot WHERE id = 1',
		).first<{ payload: string }>();
		if (!row) throw new Error('snapshot row missing after PUT');

		const live = JSON.parse(row.payload);
		const parsed = readGitHubActivitySnapshot(live);
		expect(parsed).not.toBeNull();
		expect(parsed?.repos).toHaveLength(2);

		// Fresh observedAt ⇒ the live document is the one selection
		// picks over the committed artefact.
		const committedJson = (await import('../../src/home/activity/github-activity.json', {
			with: { type: 'json' },
		})) as { default: unknown };
		const selected = selectActivitySnapshot(live, committedJson.default);
		expect(selected?.generatedOn).toBe(VALID_SNAPSHOT.generatedOn);
	});

	it('rejects a key without github_activity:write (403)', async () => {
		await clearRows();
		const res = await put(VALID_SNAPSHOT, readOnlyKey);
		expect(res.status).toBe(403);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM github_activity_snapshot').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('rejects a missing key (401)', async () => {
		const res = await put(VALID_SNAPSHOT);
		expect(res.status).toBe(401);
	});

	it('rejects a private entry carrying a real repo identity (400)', async () => {
		await clearRows();
		const res = await put(
			{
				...VALID_SNAPSHOT,
				repos: [
					{
						id: 'private-0123456789ab',
						kind: 'private',
						name: 'secret-side-project',
						htmlUrl: 'https://github.com/rebuildup/secret-side-project',
					},
				],
			},
			writeKey,
		);
		expect(res.status).toBe(400);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM github_activity_snapshot').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('rejects a private entry whose id is not the anonymous shape (400)', async () => {
		const res = await put(
			{
				...VALID_SNAPSHOT,
				repos: [
					{
						id: 'rebuildup/secret-side-project',
						kind: 'private',
						name: '非公開プロジェクト',
					},
				],
			},
			writeKey,
		);
		expect(res.status).toBe(400);
	});

	it('rejects a body with non-contract fields before D1 (400)', async () => {
		await clearRows();
		const res = await put(
			{
				...VALID_SNAPSHOT,
				repos: [
					{
						...VALID_SNAPSHOT.repos[1],
						clone_url: 'https://github.com/rebuildup/secret-side-project.git',
					},
				],
			},
			writeKey,
		);
		expect(res.status).toBe(400);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM github_activity_snapshot').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('rejects an out-of-contract source status (400)', async () => {
		const res = await put(
			{
				...VALID_SNAPSHOT,
				sources: {
					...VALID_SNAPSHOT.sources,
					private: { status: 'error', observedAt: OBSERVED_AT },
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
