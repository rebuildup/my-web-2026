import { env } from 'cloudflare:test';

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
 * The schema here mirrors `migrations/0001_better_auth.sql`.
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
`;

for (const stmt of MIGRATION_SQL.split(';')
	.map((s) => s.trim())
	.filter(Boolean)) {
	await env.DB.prepare(stmt).run();
}
