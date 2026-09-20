-- 0005_access_counter_principal.sql — per-principal counter storage.
--
-- ADR-0012 §3 promised per-principal isolation: each consumer (API
-- key id) maintains its own counter for the same `key`. Migration
-- 0002 stored `key` as the only primary key, so two consumers
-- writing to the same `key` collided. This migration drops the old
-- table and recreates it with PK `(key, principal)` so the schema
-- actually delivers the documented contract.
--
-- Pre-release assumption: 0.3.0 has not shipped to production, and
-- the bootstrap script (which records the first consumer key) is
-- still under repair — so remote `access_counters` is empty. Local
-- rows from dev work are not durable. If this assumption stops
-- holding, switch to a RENAME + backfill migration with the legacy
-- principal set to a sentinel.

DROP TABLE IF EXISTS access_counters;
CREATE TABLE access_counters (
    key        TEXT    NOT NULL,
    principal  TEXT    NOT NULL,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL,
    PRIMARY KEY (key, principal)
);
