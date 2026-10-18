-- Migration 0008 — Admin step-up re-authentication grants (Issue #445).
--
-- Purpose
-- -------
-- The admin surface holds standing credentials: an API key created on
-- `/admin/keys` is a bearer token that keeps access_counter / reactions
-- write authority long after the click that created it. A session cookie
-- alone (30-day `session.expiresIn`, ADR-0009 §8) is therefore not a
-- sufficient precondition for minting one. Issue #445 asks for a
-- re-authentication ("step-up") gate on ONE existing high-risk admin
-- operation; the operation chosen is **API key creation**
-- (`createApiKey` in `src/admin/keys/load.ts`) because it both issues a
-- secret and grants scopes.
--
-- What this table stores
-- ----------------------
-- `admin_step_up_grant` records *when the current session last proved it
-- still knows the account password*. It is deliberately tiny:
--
--   session_id   PRIMARY KEY, FK -> session(id). The row is addressed by
--                the session Better Auth already resolved from the
--                request cookie; the id never comes from the client, so
--                a stolen cookie still cannot authorise itself.
--   user_id      FK -> user(id). Denormalised so a read-only inspection
--                (`SELECT … WHERE user_id = ?`) can answer "is this
--                admin confirmed?" without joining or reading any
--                credential material.
--   confirmed_at UNIX ms of the last successful password confirmation.
--                Freshness is evaluated in application code
--                (`evaluateStepUp` in `src/admin/auth/step-up.ts`) so the
--                window is one reviewed constant instead of a value
--                duplicated between SQL and TypeScript.
--
-- No credential material is stored here. The confirmation itself is
-- verified by Better Auth's `/verify-password` endpoint, which compares
-- the submitted password against the `account.password` hash and never
-- persists what was submitted.
--
-- ON DELETE CASCADE
-- ----------------
-- Better Auth deletes the `session` row on sign-out and on session
-- revocation, so the grant disappears with the session it belongs to.
-- This is hygiene, not the security boundary: an orphaned row is
-- unreachable because the gate resolves the session from the request
-- cookie first and a dead session never reaches the gate.
--
-- Scope
-- -----
-- Schema only. No seed data. Applying this migration to production D1
-- is a release-time step owned by the release runbook, never by a test.
-- Local verification runs against the workerd / Miniflare D1 binding
-- (`test/setup/better-auth-schema.ts` mirrors this DDL) and the local
-- state created by `pnpm run db:migrate:apply:local`.

CREATE TABLE IF NOT EXISTS admin_step_up_grant (
    session_id   TEXT    PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
    user_id      TEXT    NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    confirmed_at INTEGER NOT NULL   -- UNIX ms
);

CREATE INDEX IF NOT EXISTS idx_admin_step_up_grant_user
    ON admin_step_up_grant(user_id, confirmed_at);