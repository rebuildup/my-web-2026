import { expect } from 'vitest';
import { AUTH_SCHEMA_ENV_VAR, needsAuthSchema } from '../../scripts/_vitest-setup-needs.mjs';

/**
 * Vitest setup file — applies the Better Auth schema to the local D1
 * binding BEFORE any test file is imported.
 *
 * Why this exists:
 *
 * `src/cloudflare/auth/better-auth.ts` calls `betterAuth({...})` at
 * module load. Better Auth 1.7.5's constructor eagerly invokes the
 * adapter's `checkSchema()` and caches the verdict per adapter
 * identity. If the D1 tables don't exist when the auth module is
 * first imported, the cached verdict is a `SchemaMismatchError` and
 * is rethrown on every subsequent `auth.api.*` call.
 *
 * Scope (Issue #618)
 * ------------------
 * Importing `cloudflare:test` connects this file to the Workers pool
 * (~2.4s per test FILE). The setup used to do that unconditionally, so
 * every pure unit test paid for a connection it never used. The DDL is
 * only reachable through `env.DB`; a test file only obtains that when
 * its import graph reaches `cloudflare:test` (bindings) or
 * `cloudflare:workers` (the `env` accessor, which cannot be imported
 * without a pool connection). `vitest.config.ts` scans that graph and
 * exposes the set through `AUTH_SCHEMA_ENV_VAR`. Files outside the set
 * run in the same workerd pool but never connect to it.
 * `needsAuthSchema` fails safe (apply the schema) when the set is
 * missing or malformed, so a configuration error cannot leave a DB
 * test without its tables.
 *
 * The schema here mirrors `migrations/0001_better_auth.sql` plus the
 * project-owned tables that later migrations add
 * (`migrations/0008_admin_step_up.sql` is mirrored here so the
 * step-up gate is exercised against a real D1 binding).
 *
 * This DDL is duplicated, not shared, on purpose: each suite that
 * needs a table repeats it with `IF NOT EXISTS` so it stays
 * self-contained and can be reasoned about in one file (the same
 * choice `src/admin/keys/load.test.ts` documents for its own
 * schema). The cost is that a column added to a migration has to be
 * added in every mirror — so a mirror must match the migration,
 * indexes included, and the migration stays the reference. Keep this
 * file in sync when `migrations/` changes.
 */
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  role TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  banReason TEXT,
  banExpires INTEGER
);
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expiresAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  impersonatedBy TEXT
);
CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  providerId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE (providerId, accountId)
);
CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS apikey (
  id TEXT PRIMARY KEY,
  configId TEXT NOT NULL DEFAULT 'default',
  name TEXT,
  start TEXT,
  referenceId TEXT NOT NULL,
  prefix TEXT,
  key TEXT NOT NULL,
  refillInterval INTEGER,
  refillAmount INTEGER,
  lastRefillAt INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  rateLimitEnabled INTEGER NOT NULL DEFAULT 1,
  rateLimitTimeWindow INTEGER NOT NULL DEFAULT 60000,
  rateLimitMax INTEGER NOT NULL DEFAULT 60,
  requestCount INTEGER NOT NULL DEFAULT 0,
  remaining INTEGER,
  lastRequest INTEGER,
  expiresAt INTEGER,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  permissions TEXT,
  metadata TEXT
);
CREATE TABLE IF NOT EXISTS auth_invitation (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_step_up_grant (
  session_id TEXT PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  confirmed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_step_up_grant_user
  ON admin_step_up_grant(user_id, confirmed_at);
`;

if (needsAuthSchema(expect.getState().testPath, process.env[AUTH_SCHEMA_ENV_VAR])) {
	const { env } = await import('cloudflare:test');
	for (const stmt of MIGRATION_SQL.split(';')
		.map((s) => s.trim())
		.filter(Boolean)) {
		await env.DB.prepare(stmt).run();
	}
}
