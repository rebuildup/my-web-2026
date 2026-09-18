-- Migration 0001 — Better Auth tables + project-owned auth_invitation.
--
-- All Better Auth-managed tables (user, session, account, verification,
-- apikey) are created here alongside the project-owned auth_invitation
-- table. Schema is derived from the Better Auth 1.7.5 source
-- (packages/core/src/db/schema/*.ts, packages/better-auth/src/plugins/admin/schema.ts,
-- packages/api-key/src/schema.ts) and reviewed by hand before commit.
--
-- Field-type mapping:
--   - dates       -> INTEGER (Unix milliseconds, per Better Auth D1 adapter convention)
--   - booleans    -> INTEGER (0/1)
--   - permissions -> TEXT (JSON-stringified, per api-key plugin convention)
--   - metadata    -> TEXT (JSON-stringified)
--
-- The D1 adapter relies on auto-create at runtime only for the
-- `--better-auth-` field-metadata columns that we add in follow-up
-- migrations when fields change. Schema added here is the snapshot of
-- the plugins enabled in 0.3.0: admin() + apiKey().

-- ---------- Core tables (email / password auth) ----------

CREATE TABLE user (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);

CREATE TABLE session (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expiresAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_session_userId ON session(userId);

CREATE TABLE account (
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
CREATE INDEX idx_account_userId ON account(userId);

CREATE TABLE verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_verification_identifier ON verification(identifier);

-- ---------- admin() plugin fields ----------
--
-- admin() does not introduce a new table; it extends `user` and `session`.
-- Better Auth's D1 adapter auto-adds these columns on first run, but we
-- add them here so the schema is fully described in version control.

ALTER TABLE user ADD COLUMN role TEXT;
ALTER TABLE user ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN banReason TEXT;
ALTER TABLE user ADD COLUMN banExpires INTEGER;

ALTER TABLE session ADD COLUMN impersonatedBy TEXT;

-- ---------- @better-auth/apiKey plugin table ----------

CREATE TABLE apikey (
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
CREATE INDEX idx_apikey_configId ON apikey(configId);
CREATE INDEX idx_apikey_referenceId ON apikey(referenceId);
CREATE INDEX idx_apikey_key ON apikey(key);

-- ---------- Project-owned invitation flow (ADR-0009 §4) ----------

CREATE TABLE auth_invitation (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    invited_by TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_invitation_email ON auth_invitation(email);
CREATE INDEX idx_auth_invitation_expires ON auth_invitation(expires_at);
