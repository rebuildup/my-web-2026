# ADR-0009: Better Auth as auth foundation

- Status: Accepted
- Date: 2026-09-19
- Extends: ADR-0002, ADR-0004, ADR-0007
- Superseded by: None

## Context

0.3.0 ships three new server-side surfaces that all share an
authentication foundation:

1. **Admin web app** at `/admin/*` — invitation-only, used by the
   owner and a small circle of friends to issue API keys, manage
   invitations, and curate reaction images.
2. **API key system** for server-to-server consumers calling
   `/api/v1/access/*` and `/api/v1/reactions/*`.
3. **Reusable library model** — other repositories consume the API
   key system with no frontend dependency.

A hand-rolled auth implementation would have to ship and maintain
session storage, password hashing, account recovery, role tables,
API key tables, invitation state machines, rate limiting on auth
endpoints, and CSRF protection. The hand-rolled path is rejected
because the sprint's goal is a **foundation**, not a demonstration
("今後の基盤になる" — explicit user direction).

Better Auth is the chosen foundation. It ships the primitives above
and exposes them through a single typed `auth.api.*` namespace that
integrates with D1 directly in 1.5+, removing any adapter layer.

The open question is which features to enable in 0.3.0 and how the
project owns the parts Better Auth does not provide (invitation flow,
API key permission shape, rate-limit layering).

## Decision

### 1. Adopt Better Auth as the project's auth library

- **Runtime**: Better Auth 1.5+ (current: 1.7.5) — supports D1 via
  `database: env.DB` directly, no Drizzle / Kysely adapter required.
- **Plugins**: `admin()` (user / role management) and `apiKey()`
  (consumer API key authentication). `apiKey` is the
  `@better-auth/api-key` separate npm package, released in lockstep
  with the core library.
- **Auth method**: email + password. OAuth providers, passkeys, and
  password reset are not enabled in 0.3.0 (out of scope).
- **Open sign-up is disabled** via `emailAndPassword.disableSignUp: true`.
  Better Auth returns `EMAIL_PASSWORD_SIGN_UP_DISABLED` (400) on any
  public `POST /sign-up/email` request. User creation only happens
  through the admin invitation accept flow (§4).

### 2. Storage is project-owned D1

- All Better Auth-managed tables (`user`, `session`, `account`,
  `verification`, `apikey`) live in the existing `DB` D1 binding
  alongside the project's other tables (`auth_invitation`, future
  `access_counters`, `reactions`, etc.).
- One migration per ticket lands in `migrations/` and is applied via
  `pnpm run db:migrate:local` / `db:migrate:remote` wrapping
  `wrangler d1 migrations apply`.
- `wrangler.jsonc`'s `d1_databases[0].migrations_dir` is set to
  `"migrations"` so `wrangler d1 migrations apply` finds the directory
  automatically.

### 3. Session policy

| Setting | Value | Rationale |
| --- | --- | --- |
| `session.expiresIn` | `60 * 60 * 24 * 30` (30 days) | explicit project policy; Better Auth default is 7d |
| `session.updateAge` | `60 * 60 * 24` (24h) | rolling refresh, once per day |
| `session.cookieCache` | 5 minutes | reduces DB load on hot admin pages |

The 30-day / 24h refresh pair is a project policy, not a Better Auth
default. Shorter lifetimes are harder on friends who leave the
admin tab open for days.

### 4. Invitation is a custom `auth_invitation` table

Better Auth's `admin()` plugin does **not** ship an `inviteUser`
endpoint. Its `organization()` plugin's invitation flow is
organization-membership-shaped (member-of-org semantics) and does
not match the project model (1 human = 1 account, no org tier).

A custom `auth_invitation` table is project-owned and added in
migration `0001_better_auth.sql`:

```sql
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
```

Acceptance flow:

1. Admin creates an invitation row with a high-entropy token.
2. The plaintext token is shared with the invitee via the
   accept URL.
3. Invitee visits `/admin/invitations/accept?token=...`, submits
   name + password.
4. Server function `acceptInvitation(token, password)`:
   - constant-time compares the SHA-256 of the supplied token against
     `auth_invitation.token_hash`,
   - refuses expired or consumed rows,
   - calls `auth.api.createUser({ body: { email, name, password } },
     { headers: <admin session headers> })` to bypass the
     `disableSignUp` block (admin endpoint is independent),
   - marks `auth_invitation.consumed_at`,
   - returns the new session so the invitee is signed in.

Expiry is 7 days (project policy, not Better Auth's 48h default).

### 5. API key permissions are resource / action

The `@better-auth/api-key` plugin uses object-per-key permission
shapes:

```ts
{
  access_counter: ["read", "write"],
  reactions: ["read", "write"]
}
```

The middleware in `src/http/api-keys/middleware.ts` (Ticket B) checks
`key.permissions[resource]?.includes(action)`. The two resources
are the only ones defined at 0.3.0; new resources land as their
own tickets and migrations.

### 6. Two rate-limit layers, each with a clear job

| Layer | What it protects | Configuration |
| --- | --- | --- |
| Better Auth API key plugin `rateLimit` | anti-brute-force on key validation | per-key, plugin default |
| Workers Rate Limiting binding (ADR-0010) | anti-abuse on per-consumer endpoints | per consumer principal, 60 write / 600 read per minute |

Both layers are independent and intentional: the auth-layer limit
protects the auth path itself; the Workers Rate Limiting layer
protects the feature paths against abuse from authenticated
principals.

### 7. Bootstrap

The first admin is created via the Better Auth CLI:

```sh
pnpm better-auth create-admin --email=owner@example.com --password=...
```

Subsequent admins are bootstrapped in **two steps** by an existing
admin (no "invite admin" shortcut in 0.3.0, deliberately):

1. The existing admin creates an invitation for the future admin's
   email via the admin UI. The invitation accept flow (§4) creates
   a `role = 'user'` account — invitations are user-role-only; the
   schema does not let an admin preset a non-default role.
2. After the invitee signs in, the existing admin promotes them via
   `auth.api.setRole({ userId, role: 'admin' })` (Better Auth admin
   plugin's canonical promotion endpoint, exposed through the admin
   plugin's HTTP handler at `/api/v1/auth/admin/set-role`).

This is a two-person operation by design: there is no way for a
single admin to mint a peer admin without first having a human
accept and confirm. The "user-role invitation then promote" shape
also keeps the invitation schema simple (no `role` column on
`auth_invitation`) and avoids the trap of letting a leaked admin
session spawn another admin via a UI checkbox.

The CLI requires `BETTER_AUTH_SECRET` to be set, which is provided
through `.dev.vars` locally and `wrangler secret put` in
production.

### 8. Configuration shape

```ts
// src/cloudflare/auth/better-auth.ts
const auth = betterAuth({
  database: env.DB,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    autoSignIn: false, // invitation accept flow signs in explicitly
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  plugins: [
    admin(),
    apiKey({
      defaultPrefix: 'mk_',
      permissions: { /* resource list, validated at create */ },
      rateLimit: { enabled: true, timeWindow: 60_000, max: 60 },
    }),
  ],
  sendEmail: async ({ to, subject, body }) => {
    console.log('[email]', { to, subject, body });
  },
});
```

`autoSignIn: false` means invitation accept does not rely on the
sign-up flow (which is disabled); the accept server function signs
the user in explicitly after `auth.api.createUser` succeeds.

## Validation

- `pnpm run validate:fast` is green with the new deps + migrations.
- `pnpm run validate:release` is green (no `wrangler.jsonc` changes
  in this ticket; `migrations_dir` already points at `migrations/`).
- Bootstrap test: `pnpm better-auth create-admin` creates the first
  admin in local D1; sign in at `/admin/login` succeeds; subsequent
  admin can sign in.
- Invitation round trip: admin creates an invitation → invitee
  accepts → invitee signed in → consumed token rejected on second
  use → expired token rejected after 7 days.

## Consequences

### Positive

- Hand-rolled auth / session / account / verification / API key
  tables are avoided.
- `auth.api.*` is the single namespace for all auth operations,
  type-checked against the configured plugins.
- D1 binding is direct (`database: env.DB`); no adapter layer.
- Invitation is custom and project-owned; the model is "1 human = 1
  account", not organization-shaped.
- Rate-limit layers have explicit, narrow jobs.

### Negative / Trade-offs

- Two npm packages to track (`better-auth`, `@better-auth/api-key`)
  in lockstep.
- Service-role pattern for invitation accept (passing admin session
  headers to `auth.api.createUser`) couples the accept flow to the
  admin plugin's auth contract — Better Auth is the source of truth
  for who counts as admin.
- Custom `auth_invitation` table is project-owned and must be
  maintained alongside Better Auth's own migrations.
- `disableSignUp` and `autoSignIn: false` are explicit configuration
  choices that future contributors might unintentionally undo.

## Risks

1. **Service-role pattern headers shape**: `auth.api.createUser`
   requires admin session headers even from a server function that
   itself has no logged-in user. The accept flow must mint a
   short-lived admin context (an internal service token) or invoke
   `auth.api.createUser` with the calling admin's headers. The
   implementation choice is recorded in Ticket A and re-verified at
   integration time.
2. **Better Auth D1 direct binding**: confirmed supported in 1.5+.
   Verified at install time during Ticket A.
3. **`@better-auth/api-key` package name**: separate package, not
   `better-auth/api-key`. Verified at install time.
4. **CLI bootstrap on Workers**: `wrangler d1 execute` + the Better
   Auth CLI must agree on the same D1 database. The `db:migrate:*`
   scripts and the CLI invocation use the same `wrangler.jsonc`
   binding, eliminating drift.

## Re-evaluation triggers

- A second auth method (OAuth, passkey) becomes a project
  requirement — revisit plugin configuration.
- Multi-tenant isolation is needed — invitation flow and admin role
  may need to be reshaped.
- Better Auth's API surface moves and breaks the admin / invitation
  contracts — revisit integration approach.
- Per-visitor (consumer-end-user) rate limit becomes necessary — the
  current two-layer model only protects per consumer principal.
