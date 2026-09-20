-- 0002_access_counter.sql — Ticket F backend (branch 38).
--
-- Aggregates the page-view counter keyed by `key` (e.g. 'home-page').
-- Each (counter_key, principal, session_id) tuple is deduped inside
-- the `DEDUP_WINDOW_MS` window (default 60 minutes). When the dedup
-- row is missing or expired, the counter increments atomically.
--
-- NOTE: `session_id` in 0.3.0 is a per-request `crypto.randomUUID()`
-- minted by the home consumer pattern (Ticket E). Per-visitor dedup
-- via the `mw_actor_id` cookie is a 0.4.0 ticket — see ADR-0012.

CREATE TABLE IF NOT EXISTS access_counters (
    key        TEXT PRIMARY KEY,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS access_dedup (
    counter_key TEXT    NOT NULL,
    principal   TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (counter_key, principal, session_id)
);

CREATE INDEX IF NOT EXISTS idx_access_dedup_expires
    ON access_dedup(expires_at);
