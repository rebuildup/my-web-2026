-- Migration 0011 — Discord presence snapshot (Issue #320).
--
-- Purpose
-- -------
-- The home status section renders the owner's Discord presence
-- (online/idle/dnd/offline, custom status, activities / Rich
-- Presence). A Cloudflare Worker cannot hold a Gateway WebSocket,
-- so an operator-side bot (`scripts/sync-discord-presence.mjs`)
-- maintains the official Gateway connection and pushes normalized
-- snapshots to `PUT /api/v1/presence/discord`, which lands here.
--
-- Shape
-- -----
-- Single-row table (`id = 1`): the latest accepted snapshot only.
-- `payload` is the validated JSON document; `received_at` is the
-- server-side receipt instant used for audit. The public reader
-- (`src/home/presence/reader.ts`) enforces freshness on the
-- snapshot's own `generatedAt`, so a stopped feed degrades to the
-- unavailable state instead of showing a stale "online".
--
-- Additive only: one new table, no existing row is touched.
CREATE TABLE discord_presence_snapshot (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL
);
