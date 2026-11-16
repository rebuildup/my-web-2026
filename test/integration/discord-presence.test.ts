/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadDiscordPresenceCardFromSource } from '../../src/home/presence/reader';
import { auth } from '../../test/helpers/better-auth';

/**
 * Discord presence ingest — boundary + storage contract (Issue #320).
 *
 * Every request is a real `SELF.fetch` through the Worker entry
 * (`src/server.ts` → Hono `externalBoundary` → `csrfGuard` →
 * `requireApiKey` → `requireResourceAction` → D1 upsert), and every
 * key is minted by the real `auth.api.createApiKey` against the
 * local workerd D1 — nothing auth-related is stubbed.
 *
 * The suite pins three contracts:
 *   1. WRITE: only a `discord_presence:write` key may store a
 *      snapshot, and only the allowlisted document shape reaches D1
 *      (unknown fields are rejected, not stripped-and-kept).
 *   2. READ: the stored payload re-validates through the public
 *      reader (`src/home/presence/reader.ts`) into an available card.
 *   3. LEAK: a body carrying non-contract fields (message content,
 *      tokens, other users' data) is refused before D1.
 */

const MIGRATIONS = [
	{
		name: '0011_discord_presence',
		queries: [
			`CREATE TABLE discord_presence_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
)`,
		],
	},
];

const PATH = '/api/v1/presence/discord';
const WORKER_ORIGIN = 'https://example.com';
const USER_ID = '123456789012345678';

const VALID_SNAPSHOT = {
	generatedAt: new Date().toISOString(),
	userId: USER_ID,
	status: 'online',
	customStatusText: 'Building my-web-2026',
	customStatusEmoji: '🛠️',
	activities: [
		{
			type: 0,
			name: 'Visual Studio Code',
			details: 'Editing src/http/presence/router.ts',
			isPrimary: true,
		},
	],
	client: 'desktop',
	isLive: true,
};

let userId = '';
let writeKey = '';
let readOnlyKey = '';

async function clearRows(): Promise<void> {
	// Only the snapshot table — `apikey`/`user` hold the fixtures the
	// whole suite authenticates with.
	await env.DB.prepare('DELETE FROM discord_presence_snapshot').run();
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
			email: 'presence-ingest@example.com',
			password: 'correct-horse-battery-staple',
			name: 'Presence Admin',
			role: 'admin',
		},
	});
	userId = String(result.user.id);
	writeKey = await issueKey('presence-ingest', { discord_presence: ['write'] });
	readOnlyKey = await issueKey('presence-readonly', { discord_presence: ['read'] });
});

afterAll(async () => {
	await env.DB.prepare('DELETE FROM discord_presence_snapshot').run();
});

describe('PUT /api/v1/presence/discord', () => {
	it('stores a valid snapshot for a discord_presence:write key', async () => {
		await clearRows();
		const res = await put(VALID_SNAPSHOT, writeKey);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { stored: boolean; receivedAt: string };
		expect(body.stored).toBe(true);
		expect(typeof body.receivedAt).toBe('string');

		const row = await env.DB.prepare(
			'SELECT payload, received_at AS receivedAt FROM discord_presence_snapshot WHERE id = 1',
		).first<{ payload: string; receivedAt: string }>();
		expect(row).not.toBeNull();
		if (!row) throw new Error('snapshot row missing after PUT');
		expect(JSON.parse(row.payload)).toMatchObject({
			userId: USER_ID,
			status: 'online',
			isLive: true,
		});
	});

	it('the stored payload re-validates through the public reader', async () => {
		await clearRows();
		await put(VALID_SNAPSHOT, writeKey);
		const row = await env.DB.prepare(
			'SELECT payload FROM discord_presence_snapshot WHERE id = 1',
		).first<{ payload: string }>();
		if (!row) throw new Error('snapshot row missing after PUT');
		const card = await loadDiscordPresenceCardFromSource(
			{ read: async () => row.payload },
			{ expectedUserId: USER_ID, maxAgeMs: 15 * 60 * 1000 },
		);
		expect(card.available).toBe(true);
		expect(card.statusLabel).toBeTruthy();
		expect(card.customStatus?.text).toBe('Building my-web-2026');
		expect(card.primaryActivity?.name).toBe('Visual Studio Code');
	});

	it('rejects a key without discord_presence:write (403)', async () => {
		await clearRows();
		const res = await put(VALID_SNAPSHOT, readOnlyKey);
		expect(res.status).toBe(403);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM discord_presence_snapshot').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('rejects a missing key (401)', async () => {
		const res = await put(VALID_SNAPSHOT);
		expect(res.status).toBe(401);
	});

	it('rejects a body with non-contract fields before D1 (400)', async () => {
		await clearRows();
		const res = await put(
			{
				...VALID_SNAPSHOT,
				// Fields a hostile/buggy sender might try to smuggle:
				message: { content: 'private guild message' },
				token: 'discord-token-leak',
				activities: [{ ...VALID_SNAPSHOT.activities[0], secret: 'leak' }],
			},
			writeKey,
		);
		expect(res.status).toBe(400);
		const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM discord_presence_snapshot').first<{
			c: number;
		}>();
		expect(row?.c).toBe(0);
	});

	it('rejects an out-of-contract status value (400)', async () => {
		const res = await put({ ...VALID_SNAPSHOT, status: 'broadcasting' }, writeKey);
		expect(res.status).toBe(400);
	});

	it('rejects a non-snowflake userId (400)', async () => {
		const res = await put({ ...VALID_SNAPSHOT, userId: 'not-a-snowflake' }, writeKey);
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
