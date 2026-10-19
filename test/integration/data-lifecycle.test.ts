/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF, applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { ACTOR_COOKIE_MAX_AGE_SECONDS, generateActorId } from '../../src/home/reactions/cookie';
import { getCount, recordHit } from '../../src/http/access-counter/counter';
import { DEDUP_WINDOW_MS } from '../../src/http/access-counter/schema';
import { aggregateByTarget, deleteReaction, putReaction } from '../../src/http/reactions/reactions';
import {
	DELETION_REQUEST_CHANNEL,
	findUnsupportedClaims,
	getPublishedDataLifecycle,
} from '../../src/privacy/data-lifecycle';
import { applyPortfolioSchema } from './fixtures/portfolio-d1';

/**
 * What the platform says about data, checked against a document it
 * actually served and against the tables that actually hold the data
 * (Issue #496).
 *
 * Three contracts, in the order they can fail:
 *
 *   1. **Published wording.** `GET /` carries every approved registry
 *      entry and the deletion-window statement, and carries none of the
 *      claims `UNSUPPORTED_PUBLIC_CLAIMS` refuses — including the two
 *      the old footer made (「匿名」 / "does not identify").
 *   2. **Non-public data.** A real `reactions` row is written with a
 *      synthetic visitor id, and neither the document nor the public
 *      JSON surfaces may carry that id, the row id, or the value. The
 *      aggregate the widget shows must stay a count.
 *   3. **Retention.** The published numbers are observed, not just
 *      restated: the dedup window really expires (lazily, on the same
 *      request id's next hit — no purge job ships), a burst from one
 *      session counts once, distinct sessions each leave a row whose
 *      expiry is `now + DEDUP_WINDOW_MS`, and a reaction row survives
 *      until the same visitor deletes it.
 *
 * D1 bootstrap: workerd cannot read `migrations/*.sql`, so the DDL is
 * copied from `migrations/0002` / `0003` / `0005` (the same copy
 * `test/integration/privacy-projection.test.ts` carries). No image is
 * stored here, so `reaction_images` stays empty — this suite is about
 * rows that persist, which is exactly what an uploaded image reaction
 * would be.
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
			'CREATE INDEX IF NOT EXISTS idx_access_dedup_expires ON access_dedup(expires_at)',
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
			// `REACTION_INSERT_SQL` validates every value against
			// `reaction_images` even for `kind = 'emoji'`, so the table
			// has to exist for an emoji reaction to be inserted at all.
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
	{
		name: '0005_access_counter_principal',
		queries: ['DROP TABLE IF EXISTS access_counters'],
	},
	{
		name: '0005b_access_counter_principal',
		queries: [
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

/** Synthetic visitor ids. Pattern-shaped, geocoding nowhere (Issue #511 rule). */
const VISITOR_A = generateActorId();
const VISITOR_B = generateActorId();
const TARGET = 'home-page';
const PRINCIPAL = 'fixture-principal';
const COUNTER_KEY = 'home-page';
/** One hour before the tests run, so every expiry assertion is in the past-safe range. */
const T0 = 1_800_000_000_000;

beforeAll(async () => {
	await applyD1Migrations(env.DB, MIGRATIONS);
	// `/about` reads the portfolio projection, so the shared workerd
	// fixture provides the schema (Issue #422) rather than a second
	// inline copy of `migrations/0007_portfolio.sql`.
	await applyPortfolioSchema(env.DB);
	await env.DB.prepare('DELETE FROM reactions').run();
	await env.DB.prepare('DELETE FROM access_dedup').run();
	await env.DB.prepare('DELETE FROM access_counters').run();
});

describe('the served document publishes the registry and claims nothing more', () => {
	it('GET / carries every approved entry and the deletion-window statement', async () => {
		const res = await SELF.fetch('https://example.com/');
		expect(res.status).toBe(200);
		const html = await res.text();
		for (const entry of getPublishedDataLifecycle()) {
			expect(html).toContain(`data-lifecycle-id="${entry.id}"`);
			expect(html).toContain(entry.label.ja);
			// Every published sentence must actually be rendered, in both
			// locales — a registry entry that is documented but not
			// printed is the drift this contract exists to catch.
			expect(html).toContain(entry.stores.ja);
			expect(html).toContain(entry.retention.statement.en);
			expect(html).toContain(entry.deletion.statement.ja);
			expect(html).toContain(entry.transfer.statement.ja);
			expect(html).toContain(entry.visibility.ja);
		}
		expect(html).toContain(DELETION_REQUEST_CHANNEL.statement.ja);
		expect(html).toContain('31536000');
	}, 30_000);

	it('the old anonymity claims are gone from the document', async () => {
		const html = await (await SELF.fetch('https://example.com/')).text();
		expect(findUnsupportedClaims(html)).toEqual([]);
		// Named explicitly so a reworded refusal list cannot quietly
		// re-admit the sentence the Issue was opened about. `anonymous`
		// on its own is not asserted: `crossorigin="anonymous"` on the
		// analytics `<script>` is an attribute value, not a claim.
		expect(html).not.toContain('匿名');
		expect(html).not.toContain('個人を特定しません');
		expect(html).not.toContain('This site uses an anonymous');
		expect(html).not.toContain('anonymously');
	}, 30_000);

	it('no public page carries a refused claim', async () => {
		// The notice itself is rendered by the home footer, but a
		// refused claim is a claim wherever it appears: the other
		// public pages carry their own copy, and a wording change
		// there would fail no test unless it is scanned too.
		for (const path of ['/', '/about', '/contact']) {
			const html = await (await SELF.fetch(`https://example.com${path}`)).text();
			expect(findUnsupportedClaims(html), path).toEqual([]);
		}
	}, 60_000);

	it('the served document scopes the analytics claim to the strip the code performs', async () => {
		const html = await (await SELF.fetch('https://example.com/')).text();
		// The scoped sentence is in the document…
		expect(html).toContain('アプリ内の画面遷移');
		expect(html).toContain('最初の読み込み');
		// …and the unqualified claim the previous wording made is not.
		expect(html).not.toContain('クエリ文字列は送信前に除去され');
		expect(html).not.toContain('Query strings are stripped before sending');
	}, 30_000);

	it('the served document names the surface the invited email address reaches', async () => {
		// `/admin/invitations/accept?token=…` prints the probed email
		// address, so "never reaches a public surface" would be a
		// false claim about the stored address.
		const html = await (await SELF.fetch('https://example.com/')).text();
		expect(html).toContain('/admin/invitations/accept');
		expect(html).not.toContain('認証境界の内側なので公開面には現れません');
		expect(html).not.toContain(
			'It sits behind the authentication boundary and never reaches a public surface',
		);
	}, 30_000);

	it('the reactions section points at the notice instead of claiming anonymity', async () => {
		const html = await (await SELF.fetch('https://example.com/')).text();
		expect(html).toContain('データと保持期間');
		expect(html).toContain('mw_actor_id');
	}, 30_000);
});

describe('non-public data stays out of the public surfaces', () => {
	it('a stored reaction row is not readable from any public surface', async () => {
		// Non-vacuity: the row is really written, with a real synthetic
		// visitor id, before the surfaces are asked about it.
		const put = await putReaction(
			env.DB,
			{ target_key: TARGET, actor_id: VISITOR_A, principal: PRINCIPAL, kind: 'emoji', value: '👍' },
			T0,
		);
		expect(put.created).toBe(true);

		const row = await env.DB.prepare('SELECT id, actor_id, value FROM reactions WHERE id = ?1')
			.bind(put.id)
			.first<{ id: string; actor_id: string; value: string }>();
		expect(row?.actor_id).toBe(VISITOR_A);

		for (const path of ['/', '/about', '/contact']) {
			const html = await (await SELF.fetch(`https://example.com${path}`)).text();
			expect(html).not.toContain(VISITOR_A);
			expect(html).not.toContain(put.id);
		}
		const health = await (await SELF.fetch('https://example.com/api/v1/health')).text();
		expect(health).not.toContain(VISITOR_A);
	}, 60_000);

	it('the aggregate a visitor sees is a count, not a row', async () => {
		// What the widget renders: `kind`, `value`, `count`. The visitor
		// id is not part of the public projection at all.
		const aggregate = await aggregateByTarget(env.DB, TARGET, PRINCIPAL);
		expect(aggregate).toHaveLength(1);
		expect(Object.keys(aggregate[0] ?? {}).sort()).toEqual(['count', 'kind', 'value']);
		expect(JSON.stringify(aggregate)).not.toContain(VISITOR_A);
	});

	it('the authenticated aggregate endpoint refuses without a key rather than leaking', async () => {
		const res = await SELF.fetch(`https://example.com/api/v1/reactions?target=${TARGET}`);
		expect(res.status).toBe(401);
		expect(await res.text()).not.toContain(VISITOR_A);
	});
});

describe('retention is observed, not asserted from the wording', () => {
	it('the cookie Max-Age the registry publishes is the shipped value', () => {
		expect(ACTOR_COOKIE_MAX_AGE_SECONDS).toBe(31_536_000);
	});

	it('a burst from one session counts once inside the window', async () => {
		const burst = 25;
		let count = 0;
		for (let i = 0; i < burst; i++) {
			const result = await recordHit(env.DB, {
				key: COUNTER_KEY,
				principal: PRINCIPAL,
				session_id: 'burst-session',
				now: T0,
			});
			count = result.count;
		}
		expect(count).toBe(1);
		const read = await getCount(env.DB, COUNTER_KEY, PRINCIPAL);
		expect(read.count).toBe(1);

		const rows = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM access_dedup WHERE counter_key = ?1 AND principal = ?2 AND session_id = ?3',
		)
			.bind(COUNTER_KEY, PRINCIPAL, 'burst-session')
			.first<{ n: number }>();
		expect(rows?.n).toBe(1);
	});

	it('each distinct session leaves one row that expires after the window', async () => {
		const sessions = 25;
		for (let i = 0; i < sessions; i++) {
			await recordHit(env.DB, {
				key: COUNTER_KEY,
				principal: PRINCIPAL,
				session_id: `session-${i}`,
				now: T0,
			});
		}
		const row = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM access_dedup WHERE counter_key = ?1 AND principal = ?2 AND session_id LIKE ?3',
		)
			.bind(COUNTER_KEY, PRINCIPAL, 'session-%')
			.first<{ n: number }>();
		expect(row?.n).toBe(sessions);

		// The expiry the registry publishes as "60 minutes", read back
		// from the table rather than from the constant.
		const expiry = await env.DB.prepare(
			'SELECT expires_at FROM access_dedup WHERE counter_key = ?1 AND principal = ?2 AND session_id = ?3',
		)
			.bind(COUNTER_KEY, PRINCIPAL, 'session-0')
			.first<{ expires_at: number }>();
		expect(expiry?.expires_at).toBe(T0 + DEDUP_WINDOW_MS);

		const count = await getCount(env.DB, COUNTER_KEY, PRINCIPAL);
		// 1 from the burst + 25 distinct sessions, and no more: the
		// window is doing its job under repeated traffic.
		expect(count.count).toBe(26);
	});

	it('an expired row is deleted when the same session id returns, and only then', async () => {
		// The wording says deletion is lazy, so this is the observation
		// that earns the word "lazy": the row is still there before the
		// return, gone after it.
		const before = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM access_dedup WHERE counter_key = ?1 AND principal = ?2 AND session_id = ?3',
		)
			.bind(COUNTER_KEY, PRINCIPAL, 'session-0')
			.first<{ n: number }>();
		expect(before?.n).toBe(1);

		await recordHit(env.DB, {
			key: COUNTER_KEY,
			principal: PRINCIPAL,
			session_id: 'session-0',
			now: T0 + DEDUP_WINDOW_MS,
		});

		const after = await env.DB.prepare(
			'SELECT expires_at FROM access_dedup WHERE counter_key = ?1 AND principal = ?2 AND session_id = ?3',
		)
			.bind(COUNTER_KEY, PRINCIPAL, 'session-0')
			.first<{ expires_at: number }>();
		expect(after?.expires_at).toBe(T0 + DEDUP_WINDOW_MS + DEDUP_WINDOW_MS);
		// The same row, re-armed — not a second row left behind.
		const n = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM access_dedup WHERE counter_key = ?1 AND principal = ?2 AND session_id = ?3',
		)
			.bind(COUNTER_KEY, PRINCIPAL, 'session-0')
			.first<{ n: number }>();
		expect(n?.n).toBe(1);

		// The rows nobody came back to are still there. This is the
		// honest cost of shipping no purge job, and it is why the
		// published retention sentence names the gap.
		const orphans = await env.DB.prepare(
			'SELECT COUNT(*) AS n FROM access_dedup WHERE counter_key = ?1 AND principal = ?2',
		)
			.bind(COUNTER_KEY, PRINCIPAL)
			.first<{ n: number }>();
		expect(orphans?.n).toBe(26);
	});

	it('a reaction row survives until the same visitor deletes it', async () => {
		const put = await putReaction(
			env.DB,
			{ target_key: TARGET, actor_id: VISITOR_B, principal: PRINCIPAL, kind: 'emoji', value: '🎉' },
			T0,
		);
		expect(put.created).toBe(true);

		// Another visitor id cannot delete it: the deletion channel the
		// registry publishes is the visitor's own toggle, and nothing
		// wider exists.
		const foreign = await deleteReaction(env.DB, {
			target_key: TARGET,
			actor_id: VISITOR_A,
			principal: PRINCIPAL,
			kind: 'emoji',
			value: '🎉',
		});
		expect(foreign.deleted).toBe(false);

		const own = await deleteReaction(env.DB, {
			target_key: TARGET,
			actor_id: VISITOR_B,
			principal: PRINCIPAL,
			kind: 'emoji',
			value: '🎉',
		});
		expect(own.deleted).toBe(true);

		const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM reactions WHERE actor_id = ?1')
			.bind(VISITOR_B)
			.first<{ n: number }>();
		expect(left?.n).toBe(0);
	});
});
