-- Migration 0009 — Portfolio media lookup by R2 key (Issue #634).
--
-- Purpose
-- -------
-- `GET|HEAD /media/<key>` is unauthenticated, and every request that
-- carries a `portfolio/` key resolves the key to its owning media row
-- (`src/portfolio/media-approval.ts`) before the bucket is read. The
-- lookup is `portfolio_media.r2_key = ?`, and without an index each
-- request is a table scan that an enumeration sweep can drive at the
-- Worker's full rate.
--
-- `idx_portfolio_media_project` (0007) covers the project → media
-- navigation the portfolio surfaces use; it does not answer a lookup
-- by key. This index is additive and `IF NOT EXISTS`, so applying it
-- to an already-populated database is safe.
CREATE INDEX IF NOT EXISTS idx_portfolio_media_r2_key
    ON portfolio_media(r2_key);
