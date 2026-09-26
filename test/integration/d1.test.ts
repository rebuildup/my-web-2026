import { SELF, applyD1Migrations, env } from 'cloudflare:test';
/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * D1 binding SELF smoke for my-web-2026.
 *
 * Runs in the `integration` project (workerd via
 * `@cloudflare/vitest-plugin`). The `cloudflare:test` virtual module
 * exposes the Worker entrypoint through `SELF.fetch(request)` and
 * the bindings declared in `wrangler.jsonc` through helpers like
 * `applyD1Migrations`.
 *
 * Schema bootstrap: the home route reads both `reactions` and
 * `reaction_emoji_catalog` through the reactions loader (Ticket G,
 * branch 39). These tables live in `migrations/0003_reactions.sql`
 * and `migrations/0004_emoji_catalog.sql` and must exist before the
 * home renders. The Better Auth schema is already applied by
 * `test/setup/better-auth-schema.ts`; access-counter tables are not
 * queried on the home route's read path (only hit/count via the
 * external API), so they are intentionally NOT bootstrapped here.
 *
 * The queries below MUST stay byte-identical to the corresponding
 * `migrations/*.sql` files — workerd cannot `fs.readFile` them.
 *
 * Acceptance: /api/v1/db/ping returns 200 and the SELECT 1 row from
 * the D1 binding declared in `wrangler.jsonc`.
 */
const MIGRATIONS = [
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
			'CREATE INDEX IF NOT EXISTS idx_reaction_emoji_catalog_enabled ON reaction_emoji_catalog(enabled)',
			`INSERT OR IGNORE INTO reaction_emoji_catalog (slug, codepoint, enabled, created_by, created_at, updated_at) VALUES
    ('thumbs_up', '👍', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('tada', '🎉', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('fire', '🔥', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('eyes', '👀', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('sparkles', '✨', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('rocket', '🚀', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('heart', '❤', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('laughing', '😄', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('thinking', '🤔', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('clap', '👏', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('wave', '👋', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('check', '✅', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('cross', '❌', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('warning', '⚠️', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('star', '⭐', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000),
    ('bulb', '💡', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000)`,
		],
	},
];

const D1 = () => env.DB;

beforeAll(async () => {
	await applyD1Migrations(D1(), MIGRATIONS);
});

describe('D1 binding smoke', () => {
	it('renders the internal D1 result through the home loader', async () => {
		const res = await SELF.fetch('https://example.com/');
		expect(res.status).toBe(200);
		const html = (await res.text()).replaceAll('<!-- -->', '');
		// The home page renders the D1 status inside the system
		// status section as the row labelled "Internal data" with the
		// D1 binding tag and a "reachable" badge. Asserting on those
		// three tokens keeps the test stable across copy edits while
		// still verifying that the createServerFn probe ran on the
		// server during SSR.
		expect(html).toContain('Internal data');
		expect(html).toContain('D1');
		expect(html).toMatch(/Internal data[\s\S]*?D1[\s\S]*?>\s*reachable\s*</);
	});

	it('responds to /api/v1/db/ping with the binding result', async () => {
		const res = await SELF.fetch('https://example.com/api/v1/db/ping');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; binding: string; one: number | null };
		expect(body.binding).toBe('d1');
		expect(body.status).toBe('ok');
		expect(body.one).toBe(1);
	});
});
