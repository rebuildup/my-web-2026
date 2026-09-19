-- 0004_emoji_catalog.sql — Ticket G (branch 39, Sprint 0.3.0-extended).
--
-- DB-backed catalog for reaction emoji slugs. Replaces the
-- hard-coded 16-slug catalog that lived in
-- `src/home/reactions/emoji-catalog.ts` from Ticket E. The slug
-- contract (`:slug:` opaque string ≤ 32 chars, lowercase
-- `[a-z][a-z0-9_]*`) is unchanged — see ADR-0013.
--
-- The home widget reads via a server fn that returns the active set
-- of slugs; the reactions API still accepts opaque `:slug:` values
-- (validation happens at the consumer boundary, not at the
-- reactions API). Admin rebinds are the documented admin-CUD
-- surface — the slug is a stable opaque key, so removing or
-- rebinding a slug does NOT retroactively rewrite existing
-- reactions, only hides the chip on the home page until a new
-- mapping is added.
--
-- Seed: the first 16 slugs from Ticket E are inserted as
-- `enabled = 1` so a fresh deploy renders the same vocabulary as
-- 0.3.0-extended before any admin action. INSERT OR IGNORE keeps
-- the migration idempotent across re-runs on existing databases.

CREATE TABLE IF NOT EXISTS reaction_emoji_catalog (
    slug         TEXT    PRIMARY KEY,
    codepoint    TEXT    NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created_by   TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reaction_emoji_catalog_enabled
    ON reaction_emoji_catalog(enabled);

INSERT OR IGNORE INTO reaction_emoji_catalog (slug, codepoint, enabled, created_by, created_at, updated_at)
VALUES
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
    ('bulb', '💡', 1, NULL, strftime('%s','now') * 1000, strftime('%s','now') * 1000);
