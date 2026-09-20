-- 0006_apikey_key_unique.sql — enforce hash uniqueness on the
-- Better Auth api-key table.
--
-- `apikey.key` stores the SHA-256 base64url hash of the plaintext
-- api-key (Better Auth api-key plugin contract). There is no
-- semantic reason for two rows to share a hash, but the index from
-- migration 0001 was a non-UNIQUE INDEX, and the historical
-- `bootstrap-home-api-key.mjs` script was non-idempotent on the
-- hash — prior runs could leave duplicates that the new idempotent
-- `ensure-home-api-key.mjs` (introduced 0.3.1) cannot reconcile by
-- SELECT-then-INSERT alone when two runs race.
--
-- This migration:
--   1. Disables any existing duplicate-by-hash rows. The row with
--      the largest `updatedAt` per hash is kept; older duplicates
--      are flipped to `enabled = 0` (retained for audit, excluded
--      from the active api-key set by Better Auth's verify path).
--      Tie-break on `id DESC` so the result is deterministic when
--      two rows share an `updatedAt`.
--   2. Adds a UNIQUE INDEX on `apikey.key` so concurrent INSERTs
--      collide deterministically. `INSERT OR IGNORE` in the new
--      ensure script then converges on a single row per hash
--      regardless of which run wins the race.
--
-- Pre-release assumption: 0.3.0 has not shipped to production (the
-- bootstrap script was broken pre-0.3.1, so no production deploy
-- has run the deploy-production workflow yet). The only path that
-- could leave duplicates is operator-side local-dev experimentation.
-- Better Auth itself never issues two api-keys with the same hash.

UPDATE apikey
SET enabled = 0
WHERE EXISTS (
	SELECT 1
	FROM apikey newer
	WHERE newer.`key` = apikey.`key`
	  AND (
		newer.updatedAt > apikey.updatedAt
		OR (newer.updatedAt = apikey.updatedAt AND newer.id > apikey.id)
	  )
	  AND newer.id <> apikey.id
);

CREATE UNIQUE INDEX uq_apikey_key ON apikey(`key`);
