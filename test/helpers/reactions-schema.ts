/**
 * Test-only schema fixture for the reactions tables.
 *
 * Lives outside `src/` so an integration test can bootstrap D1 state
 * without creating a production owner dependency from `src/**` to the
 * test tree (the same reason `test/helpers/better-auth.ts` exists).
 *
 * The queries MUST stay byte-identical to `migrations/0003_reactions.sql`
 * and `migrations/0004_emoji_catalog.sql` — workerd cannot
 * `fs.readFile` the migration files, so a suite that needs the
 * reactions tables has to inline them. Two suites need them
 * (`test/integration/d1.test.ts` and
 * `test/integration/lazy-media-contract.test.ts`), and a second
 * hand-maintained copy of the schema is a third place to forget an
 * update.
 */

export const REACTIONS_MIGRATIONS = [
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
