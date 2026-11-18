-- Migration 0012 — GitHub activity snapshot (Issues #316 / #319 / #932).
--
-- Purpose
-- -------
-- The home "現在地" sections render the owner's GitHub activity:
-- the status card's recent-activity feed and the auto-selected
-- current projects. The snapshot used to live ONLY as a committed
-- JSON artefact, so every refresh needed a commit + merge + release.
-- An operator-side sync job (`scripts/sync-github-activity.mjs
-- --push`) now pushes the anonymised document to
-- `PUT /api/v1/activity/github`, which lands here; the committed
-- `src/home/activity/github-activity.json` stays as the reviewed
-- fallback / release seed.
--
-- Shape
-- -----
-- Single-row table (`id = 1`): the latest accepted snapshot only.
-- `payload` is the validated JSON document; `received_at` is the
-- server-side receipt instant used for audit. The public reader
-- (`src/home/activity/snapshot.ts`) re-validates the stored document
-- and the loader prefers whichever source observed most recently,
-- so a stopped feed degrades to the committed artefact instead of
-- serving stale data as fresh.
--
-- Privacy
-- -------
-- Private repositories may appear ONLY as `private-<hmac12>`
-- anonymous ids with aggregate counts — the ingest schema
-- (`src/http/activity/schema.ts`) refuses any other private shape
-- before this table is written.
--
-- Additive only: one new table, no existing row is touched.
CREATE TABLE github_activity_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
);
