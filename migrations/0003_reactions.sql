-- Migration 0003 — Reactions + image library (Ticket D).
--
-- Two tables:
--
--   reactions        one row per (target_key, principal, actor_id,
--                    kind, value) tuple. Composite UNIQUE makes the
--                    PUT idempotent at the storage layer.
--   reaction_images  one row per uploaded image. SHA-256 content
--                    hash ensures content-addressed dedup (same
--                    image uploaded twice collapses to one row +
--                    R2 object).
--
-- R2 storage layout: `reactions/{content_hash}.{ext}`. The image GET
-- endpoint streams the R2 object with `Cache-Control: public,
-- max-age=31536000, immutable` so consumers and intermediaries can
-- cache aggressively.

CREATE TABLE reactions (
    id TEXT PRIMARY KEY,
    target_key TEXT NOT NULL,
    actor_id TEXT NOT NULL,            -- consumer-supplied opaque visitor id
    principal TEXT NOT NULL,           -- API key id (consumer)
    kind TEXT NOT NULL CHECK (kind IN ('emoji', 'image')),
    value TEXT NOT NULL,               -- emoji char or image id
    created_at INTEGER NOT NULL,
    UNIQUE (target_key, principal, actor_id, kind, value)
);
CREATE INDEX idx_reactions_target ON reactions(target_key);
CREATE INDEX idx_reactions_target_kind ON reactions(target_key, kind);

CREATE TABLE reaction_images (
    id TEXT PRIMARY KEY,
    content_hash TEXT UNIQUE NOT NULL,
    content_type TEXT NOT NULL,        -- image/png, image/jpeg, image/webp, image/gif
    size INTEGER NOT NULL,
    r2_key TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL
);
CREATE INDEX idx_reaction_images_hash ON reaction_images(content_hash);
