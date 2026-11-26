-- Migration 0013 — GitHub stats snapshot (Issues #1244 / #1245).
--
-- Purpose
-- -------
-- The profile Vitals / Top Languages / stats surfaces used to call
-- the GitHub API at REQUEST time (vendored readme-stats fetchers +
-- microCache). The v0.15.0 data contract
-- (`docs/domain/github-profile-data.md`, ADR-0027) separates
-- acquisition from delivery: the operator-side sync job
-- (`scripts/sync-github-stats.mjs --push`) gathers the declared
-- scope×window metrics and PUTs the document to
-- `PUT /api/v1/stats/github`, which lands here. Image requests then
-- read D1 only — upstream API calls per request drop to zero.
--
-- Shape
-- -----
-- Single-row table (`id = 1`): the latest accepted snapshot only.
-- `payload` is the validated JSON document; `received_at` is the
-- server-side receipt instant used for audit. The public reader
-- re-validates the stored document independently and treats a
-- missing row as honest "unavailable", never as zero.
--
-- Privacy
-- -------
-- The ingest schema (`src/http/stats/schema.ts`) admits aggregates
-- and PUBLIC repo totals only — no private repo names, owners, or
-- per-repo rows can be stored here at all.
--
-- Additive only: one new table, no existing row is touched.
CREATE TABLE github_stats_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
);
