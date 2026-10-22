/**
 * Reactions D1 schema for the workerd integration pool.
 *
 * `workerd` cannot read `migrations/*.sql`, so a suite that renders the
 * Home surface has to create the tables the home loaders read. This
 * fixture is the one copy of `0003_reactions.sql` /
 * `0004_emoji_catalog.sql` in `test/integration/`; a suite that needs
 * the Home document imports it instead of pasting the DDL again.
 *
 * The catalog seed rows are deliberately not inserted: a suite that
 * asserts what a public surface carries does not depend on which emoji
 * are configured, and an empty catalog still renders the page.
 */
import { applyD1Migrations } from 'cloudflare:test';

const REACTIONS_MIGRATIONS = [
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
		],
	},
];

/** Creates the reactions / emoji-catalog tables on the given D1 binding. */
export async function applyReactionsSchema(db: D1Database): Promise<void> {
	await applyD1Migrations(db, REACTIONS_MIGRATIONS);
}
