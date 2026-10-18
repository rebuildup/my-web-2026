# Security

> my-web-2026 security policy and current controls.

## Reporting vulnerabilities

- Open a GitHub Issue tagged `security`, target a release.
- Implement the fix in a normal ticket branch
  (`<issue-number>`) or a patch release branch.
- Run `pnpm run validate:release`.
- Land via the canonical release PR flow.

For urgent / out-of-band reports (live site exploitation, credential
leaks), contact the maintainer directly via the channel listed in
`CODEOWNERS` / repository Settings → Code security before opening a
public Issue. If you find a leaked credential, assume it is
compromised: revoke and rotate immediately. Do not wait for the
patch release.

## CSRF

The Worker serves two mutation layers, and **each layer owns a
different CSRF check**. `src/server.ts` dispatches by path prefix
*before* the TanStack Start handler runs, so anything under the
external boundary prefixes never reaches the framework middleware —
which is why the two cannot be one mechanism.

| Layer                            | Owner                                         | Applies to                                      |
| -------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| TanStack Start server functions  | **framework default** CSRF middleware          | `/_serverFn/*` (`handlerType === 'serverFn'`)   |
| Hono external boundary           | `csrfGuard` (`src/http/middleware/csrf.ts`)   | `/api/v1/*` unsafe methods                      |
| `/api/v1/auth/*`                 | Better Auth (`trustedOrigins` + form CSRF)     | cookie-carrying writes                          |

### TanStack Start layer (default middleware)

`createStartHandler` installs
`createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' })`
**only while no custom `startInstance` exists**. `src/start.ts` is
intentionally absent: adding one would replace the default middleware
with whatever that file declares and leave every server-function
mutation unprotected, with no production warning. AGENTS.md §2
requires an ADR before that happens.

### Hono boundary layer (`csrfGuard`)

ADR-0002 §1/§2 split the Worker into two layers, so the external
boundary never reaches the framework middleware and therefore owes its
write methods their own origin check (that obligation is inferred
from the split, not quoted from the ADR; whether it deserves its own
ADR is an open owner decision). `csrfGuard` implements it for unsafe
methods (`POST` / `PUT` / `PATCH` / `DELETE`) under `/api/v1/*`:

1. Safe methods are **never** checked — the boundary exposes no
   state-changing `GET`.
2. `Sec-Fetch-Site` present → must be `same-origin`.
3. Else `Origin` present → must equal the request origin
   (`Origin: null` is never same-origin).
4. Else `Referer` present → must be same-origin, with a delimiter
   check so `https://host.evil.example` cannot pass.
5. Else → **rejected**. Fail-closed, matching the framework default
   (`allowRequestsWithoutOriginCheck: false`).

A refusal is `403` with a stable body and no caller-supplied value in
it:

```json
{ "error": "csrf_rejected", "reason": "cross_site_fetch_metadata" }
```

`reason` is one of `cross_site_fetch_metadata`, `origin_mismatch`,
`referer_mismatch`, `origin_check_missing`. It names the header that
failed, never its value.

One precedence note: the CORS layer (Issue #455) is mounted ahead of
this guard, so on a non-auth route a write whose `Origin` is outside
its allow-list is refused there first, with
`{ "error": "cors_origin_rejected" }` (`/api/v1/auth/*` is CSRF-exempt
and delegates to Better Auth). The
CSRF contract is unaffected — both refusals are `403` before
authentication or D1 — and a request whose `Origin` *is* allow-listed
but whose `Sec-Fetch-Site` says `cross-site` still gets
`csrf_rejected`.

The guard is mounted in `src/http/hono.ts` after the local mock gate
and the request-id middleware, and before every router — so a refused
cross-site write never reaches authentication, rate limiting, or D1.

**No credential-based exemption.** The boundary's writes use
`Authorization: Bearer <api key>`, which a browser cannot attach
cross-site by itself. Exempting bearer requests anyway would make the
guard untestable for the requests that matter, so first-party callers
declare their origin instead: the Home self-calls
(`src/home/{access,reactions}/load.ts`) send
`Origin: <the origin they are calling>`.

**Consequence for scripted API calls.** A non-browser client hitting a
write endpoint directly must send the header itself:

```bash
curl -s -X POST https://rebuildup.dev/api/v1/access/hit \
  -H 'Authorization: Bearer …' \
  -H 'Origin: https://rebuildup.dev' \
  -H 'Content-Type: application/json' -d '{…}'
```

Reads (`GET` / `HEAD` / `OPTIONS`) are unaffected. The local
`LOCAL_API_MODE=mock` gate answers before the guard, so the mock smoke
commands in [`docs/development.md`](development.md) keep working; the
mock has no D1 / R2 side effects.

**Consequence for the repository's own suites.** The same signal
applies in-process: a workerd integration suite that writes through the
real boundary must declare the origin in its shared request headers,
otherwise it measures the guard instead of what it was written to prove.
The suites that write today do exactly that —
`test/integration/d1-parameter-binding.test.ts` (`http://localhost`, the
origin Hono's `app.request()` resolves a relative path against),
`test/integration/admin-authorization.test.ts` and
`test/integration/api-key-scope.test.ts` (`https://example.com`, the
pool's Worker origin). The guard's refusal behaviour is asserted
separately in `test/integration/csrf-contract.test.ts`.

### What breaks the contract, and what catches it

| Break                                                | Caught by                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Adding `src/start.ts` / a custom `startInstance`      | `pnpm run csrf:contract:check` (`validate:fast`), integration test |
| Turning on `skipCSRFCheck` / `disableCSRFCheck` / `disableOriginCheck` / `disableCsrfMiddlewareWarning` | `pnpm run csrf:contract:check` |
| Removing or unmounting `csrfGuard`                    | `pnpm run csrf:contract:check`, workerd integration test       |
| Moving the guard mount below `route()` (Hono dispatches in registration order) | `pnpm run csrf:contract:check` (order rule) |
| Changing the rejection code / behaviour               | `src/http/middleware/csrf.test.ts`, `test/integration/csrf-contract.test.ts` |
| A write endpoint answering on `GET`                   | `test/integration/csrf-contract.test.ts` (D1 before/after read on `GET /api/v1/reactions`) |

Where the assertions live:

- `src/http/middleware/csrf.test.ts` — decision matrix (unit).
- `test/integration/csrf-contract.test.ts` — end-to-end through the
  real Worker in the local workerd pool: a cross-site write with a
  **valid** API key is refused and leaves no D1 row; a same-origin
  write is accepted; cross-site reads stay readable and write nothing.
  The "GET writes nothing" evidence is a D1 before/after read on
  `GET /api/v1/reactions` only — the boundary's other reads
  (`/api/v1/access/count/:key`, `/api/v1/reaction-images/:id`,
  `/api/v1/db/ping`, `/api/v1/media/ping`) are asserted reachable but
  have no side-effect assertion, so widening that claim is future work
  rather than something this record overstates.
- `e2e/csrf.spec.ts` — the same positive/negative cases over HTTP
  against the built preview server, including the `/_serverFn/*`
  endpoint (the workerd pool does not wire that URL, see below).
- `scripts/check-csrf-contract.mjs` — the structural gate; its own
  tests are `scripts/check-csrf-contract.test.mjs`.

Why the `/_serverFn/*` half is not asserted in the workerd pool:
`TSS_SERVER_FN_BASE` is injected by the Vite plugin's `define`, which
the vitest worker bundle does not apply, so `createStartHandler` skips
its server-function branch and the router answers 404. Probing it
there would test the harness rather than the contract.

See also: [`ADR-0002`](adr/ADR-0002-architecture-boundary.md) (the
two-layer split), [`ADR-0010`](adr/ADR-0010-abuse-protection-rate-limit.md)
(the write-path rate limit that still applies after the guard).

## OAuth / OIDC callback: state and redirect (Issue #444)

The shipped auth config (`src/cloudflare/auth/better-auth.ts`) registers
the `admin()` and `apiKey()` plugins and **no social provider**. The
OAuth machinery therefore ships unconfigured: `/api/v1/auth/callback/:id`
and `/api/v1/auth/sign-in/social` are reachable, but no provider round
trip can complete, so **no callback can mint a session** on this
deployment. What an attacker controls is everything in front of that
stop, and that is what the contract test pins.

Contract: [`src/http/auth/oauth-callback.test.ts`](../src/http/auth/oauth-callback.test.ts).

An untrusted redirect target crosses two gates before a session could
exist: the project-owned
[`redirectTargetGuard`](../src/http/security/redirect-guard.ts) mounted
in front of the handler (Issue #454), and then Better Auth's own origin
check. Which gate answers is part of the contract, so both are pinned.

| Gate                                   | Rejection signal                                                  |
| -------------------------------------- | ----------------------------------------------------------------- |
| `state` missing                         | redirect to `<base>/error?error=state_not_found`                 |
| `state` unknown / tampered / replayed   | redirect to `<base>/error?error=state_mismatch`                  |
| `state` cookie absent, for another id, or with a forged signature | same (`state_security_mismatch` is reported as `state_mismatch`) |
| `state` payload expired                 | `state_mismatch`                                                  |
| valid `state`, provider not configured   | `oauth_provider_not_found` — the *next* gate, i.e. state passed   |
| redirect target in query or body that is not an internal path | `400` + `invalid_redirect_target { param, reason, source }`, and no `Location` |
| `Origin` / `Referer` from another site   | `403` + `INVALID_ORIGIN`                                          |
| cookie-bearing request with no origin    | `403` + `MISSING_OR_NULL_ORIGIN`                                  |

Three properties are asserted beyond the status codes, because any one
of them alone would still leave a redirect open:

1. Every callback `Location` stays on the base URL Better Auth resolved
   for that request. The suite runs without `BETTER_AUTH_URL` (see
   "Test scope" below), so Better Auth infers the base URL from the
   request origin — the assertion is *weaker* than production, where the
   base URL is pinned by the binding (ADR-0014), never stronger.
2. A guard rejection carries **no** `Location` header at all, and its
   body names the field, the reason and the source without echoing the
   value. A `callbackURL` injected on the callback request therefore
   cannot become the redirect target. The *success*-path redirect target
   is not observed on this deployment (there is no provider to reach
   it), so it is not claimed here.
3. No rejection path sets a session cookie or leaves a `session` row.

Each guard is paired with a positive control, so the suite cannot pass
by rejecting everything: a correctly bound `state` reaches the provider
gate instead of the state gate, and a *relative* `callbackURL` passes
both redirect gates instead of being refused.

One deviation is deliberate and recorded in the test: the pool omits
`BETTER_AUTH_URL`, so the guard's trusted-origin list is empty there and
**every** absolute URL is refused — including this origin's own
(`400`, reason `external_origin`). With the production binding that
value is trusted and downgraded to its path. The suite pins the
fail-closed direction, not the pinned-origin production configuration.

Scope note: the callback rejections above all take Better Auth's default
`${baseURL}/error` branch. A flow started with a validated
`errorCallbackURL` redirects to that trusted origin instead — a branch
this suite does not observe, because the fixture never writes `errorURL`
into the signed state. The chain is still defended at the entry point,
where an off-origin `errorCallbackURL` is refused.

Fixtures are local only: rows in the workerd test pool's D1 plus a cookie
signed with the dummy `BETTER_AUTH_SECRETS` binding that
`vitest.config.ts` declares. No production secret is read, logged, or
asserted, and no test contacts a real IdP. Response capture from the
local run:
[`verification/security/oauth-negative-tests.webp`](verification/security/oauth-negative-tests.webp).

## CORS

The external boundary splits its routes into three origin classes
(Issue #455):

- `credentialed` — `/api/v1/auth/*`, `/api/v1/access/*`,
  `/api/v1/reactions`. The response echoes **one** allow-listed origin
  plus `Access-Control-Allow-Credentials: true`, restricted to a fixed
  method and request-header allow-list. Any other origin — including the
  opaque `null` origin a sandboxed Tool iframe sends — gets `403` and no
  CORS header for preflights and state-changing requests. A `GET`/`HEAD`
  from a foreign origin still reaches the handler (Issue #440's CSRF
  contract keeps safe reads unaffected) but carries no CORS echo, so the
  browser cannot read the body. On `/api/v1/auth/*` the actual-request
  refusal is Better Auth's (`INVALID_ORIGIN`, Issue #444); CORS only
  withholds the echo and owns the preflight refusal.
- `public-read` — `/api/v1/health` and `/api/v1/reaction-images/:id`.
  `Access-Control-Allow-Origin: *`, and never a credentials header.
- `none` — everything else, including `/api/v1/db/ping`,
  `/api/v1/media/ping` and the unimplemented `/webhooks/*`, `/oauth/*`,
  `/integrations/*` prefixes. No CORS header at all.

The allow-list is derived from runtime input only: the origin the
request arrived on, plus `env.BETTER_AUTH_URL` — the same value that
feeds Better Auth's `trustedOrigins`. A wildcard never reaches a
credentialed route, and that invariant is asserted over the whole
route × origin × method matrix in `src/http/cors/policy.test.ts` and
again against the real response bytes in
`test/integration/cors.test.ts`.

The echo is rendered onto the **finalized** response, after
`await next()`. Hono only merges `c.header()` calls made before
`next()` into a response the context itself produced, so a handler
returning a raw `Response` — `auth.handler(c.req.raw)` and the
`LOCAL_API_MODE=mock` gate's `mockApp.fetch(...)` — would otherwise
drop the whole allow branch. Both shapes are asserted in
`src/http/cors/middleware.test.ts` and on the wire in
`test/integration/cors.test.ts`.

Full contract, the measured matrix and the known local-dev deviation
(`vite dev` answers preflights itself, so the Worker is never consulted):
[`docs/security/api-cors.md`](security/api-cors.md).

## API key scope and revocation

The API keys that guard `/api/v1/access/*` and `/api/v1/reactions/*`
have two decision layers: the boundary middleware
(`src/http/api-keys/middleware.ts`) owns the `Authorization` shape and
the resource/action scope lookup, and `@better-auth/api-key` owns hash
verification, revocation, and expiry. Every denial collapses to a single
shape (`401 missing_authorization`, `401 invalid_api_key`, or
`403 missing_scope`) so a refusal cannot become an oracle.

The scope matrix, the fixtures that pin each refusal, and the
secret-handling invariants live in
[`docs/security/api-key-scope.md`](security/api-key-scope.md). Its
measured artefact is
[`docs/verification/security/api-key-scope-matrix.webp`](verification/security/api-key-scope-matrix.webp)
(regenerate with `pnpm run verification:api-key-scope`). Verification is
local-only: fixtures live in a throwaway Miniflare D1 database, and no
production endpoint, secret, or operator account is read or written.

## Cache isolation

Responses whose body depends on who asked for them (per-principal
counters, per-visitor reaction state, sessions, `/admin*`, and
server-function payloads) are marked so that a **shared** cache — CDN
edge, corporate proxy — cannot store them: `private, no-store` on the
external boundary, `private, no-cache` on caller-specific SSR
documents, `no-store` under `/admin*`. Public immutable payloads opt
in explicitly with `public, max-age=…, immutable`.

The full contract, the audit it came from, and the verification
suites are documented in
[`docs/security/cache-isolation.md`](security/cache-isolation.md).

## Open redirect

Every `returnTo`-shaped value that crosses the external boundary is
untrusted. `src/http/security/**` refuses anything that is not an
internal absolute path, and is mounted in front of the Better Auth
handler at `/api/v1/auth/*`. `BETTER_AUTH_URL` is the trusted-origin
allow-list; when it is unset the guard refuses every absolute URL
(fail-closed). The shipped contract, operator duties and known limits:
[`docs/security/open-redirect.md`](security/open-redirect.md).

## D1 parameter binding (Issue #452)

### Rule

Every D1 statement that user input reaches must bind that input with
`?` / `?N` + `.bind(...)`. Splicing a value into the statement text is
a defect even when the value is escaped today: the statement text is
the part a reviewer reads as structure, and a bound value cannot change
the parse tree.

### Where it is enforced

Two gates, both run by `pnpm run test` (and therefore by
`pnpm run validate:fast` and CI):

| Gate | What it proves | Where |
| --- | --- | --- |
| Runtime suite | Attack fixtures reach the real endpoints through `externalBoundary`; the recorded SQL text is byte-identical to the benign run, no payload appears in a statement, and the seeded rows survive. | `test/integration/d1-parameter-binding.test.ts` (workerd pool) |
| Static gate | The **literal argument** of every `prepare()` / `exec()` / `batch()` call in `src/**` contains no `${…}` interpolation. A statement assembled into a variable before the call is out of scope by design — that is a dataflow judgement, not a scan. | `scripts/check-d1-sql-binding.mjs`, wired via `scripts/check-d1-sql-binding.test.mjs` |

Run the static gate on its own with `node scripts/check-d1-sql-binding.mjs`.
Exit 1 means one of two things: an interpolated statement, or an
`SQL_STRUCTURE_ALLOWLIST` entry the scan never reached (dead
configuration). Adding an entry is a reviewable decision: it must name
the file, the interpolated identifier, and why the value cannot carry
user input. The single current entry is `cursorPredicate` in
`src/portfolio/load.ts` — a fixed chain of `?` placeholders whose
components are all bound — and it is **live** only because that file
passes its list statement to `prepare()` inline. Write the statement
inline; a `const sql = …` in front of it hides the interpolation from
the gate, and the gate then fails on the unreachable entry rather than
letting it rot.

### Known unscanned inventory

The static gate reads literal arguments, so these D1 statements are
**not** covered by it. None of them interpolates — each is a constant,
or a choice between two literals — so what actually guards them is the
combination of that reading and review:

| Site | Shape | Other coverage |
| --- | --- | --- |
| `src/http/reactions/reactions.ts` (`REACTION_INSERT_SQL`, `REACTION_LOOKUP_SQL`) | module-level string constant | runtime suite (`PUT` / `DELETE` / `GET /api/v1/reactions`) |
| `src/portfolio/load.ts` (`prevSql`, `nextSql` in `loadPortfolioAdjacent`) | local string constant | runtime suite (portfolio slug read) |
| `src/reactions/emoji-catalog.ts` (`loadCatalog`) | `cond ? 'literal A' : 'literal B'` | `src/reactions/emoji-catalog.test.ts` (home widget read; no user input reaches either branch) |

Two further limits are deliberate and documented in the gate's own
docstring: string concatenation inside a call argument
(`db.prepare('… WHERE k = ' + key)`) is not inspected, and `exec`
also matches `RegExp.prototype.exec` — all five `.exec(` sites in
`src/**` today are regexes, so D1 `exec()` / `batch()` have no shipped
call site yet (the fixture test covers both).

### Covered surfaces

Only endpoints that exist today (Issue #452 forbids inventing one):

- `POST /api/v1/access/hit`, `GET /api/v1/access/count/:key`
- `PUT` / `DELETE` / `GET /api/v1/reactions` (`target_key`, `actor_id`, `value`)
- `GET /api/v1/reaction-images/:id`
- portfolio loader slug read (`loadPortfolioProject`, `loadPortfolioAdjacent`)
- emoji catalog slug read (`getCatalogEntry`)

Payload families: tautology, comment tail, UNION, stacked statement,
backslash quote, LIKE wildcard, plus whitespace-free variants that
survive the access-counter validators and inputs the validators reject
(over-length, embedded space, control character).

### Operational contract

This gate changes no runtime contract: the auth / API-key boundary,
the Cloudflare bindings (`DB`, `MEDIA`, `ASSETS`), and the Tool
Registry dependency are all untouched. (One production statement was
reshaped for the gate — `listPortfolioProjectsImpl` now passes its SQL
to `prepare()` inline instead of through a `const sql` local. The
statement text is byte-identical; only where it is written changed, so
the allowlist entry above is enforced rather than dead.)

A new D1 surface is covered by adding it to the runtime suite. An
existing one is covered by the static gate **only if it is written as
the literal argument of `prepare()` / `exec()` / `batch()`**: a
statement written inline fails the gate on its own commit, while a
statement assembled in a variable is not scanned at all and must be
caught by the runtime suite (or by review). The inventory above names
the variable-built statements that exist today — keep it current when
one is added.

## Step-up re-authentication

A live admin session (30-day `session.expiresIn`, ADR-0009 §8) is the
right precondition for *reading* the admin surface, but not for
*granting standing authority*: an API key issued at `/admin/keys`
outlives the session that created it. So that one operation asks the
operator to re-confenticate their password first (step-up), with a
five-minute window keyed on the server-resolved session id.

Implementation, the states it distinguishes (`required` / `confirmed`
/ `expired` / `rejected`), why the grant lives in D1 rather than in a
signed cookie, and why the refusals the UI branches on travel as
returned outcomes rather than thrown errors (TanStack Start's
`ShallowErrorPlugin` drops an `Error` subclass's own properties on the
wire) are recorded in
[`security/step-up-authentication.md`](security/step-up-authentication.md).
Verification runs in the local workerd pool; no production account or
credential is used.

## Test scope: local workerd vs real Cloudflare

`@cloudflare/vitest-plugin` runs SELF tests inside a local workerd
pool with **Miniflare-simulated** D1 / R2 / KV bindings. This proves:

- The Worker entry dispatches the request correctly.
- Hono handlers see the binding through `c.env.<binding>`.
- The D1 / R2 client API surface (`prepare`, `first`, `head`, …)
  behaves as documented.

It does **not** prove that real Cloudflare D1 / R2 resources
exist or are reachable. Real-resource smoke requires:

1. Real D1 `database_id` and real R2 `bucket_name` declared in
   `wrangler.jsonc`.
2. Production deploy via Cloudflare Workers Builds (canonical
   path — uses the `build_token_uuid` binding registered in
   Cloudflare project settings, NOT `CLOUDFLARE_API_TOKEN`). For
   local-diagnostic deploys the operator may instead use
   `pnpm deploy` with `wrangler login` (OAuth) or an explicit
   `CLOUDFLARE_API_TOKEN` env var; see
   [`docs/security/cloudflare-api-token-inventory.md`](security/cloudflare-api-token-inventory.md)
   for the consumer / non-consumer map.
3. A `curl` smoke against the deployed Worker URL: `/`,
   `/api/v1/health`, `/api/v1/db/ping`, `/api/v1/media/ping`.

This real-resource smoke is part of the 0.1.0 release cut (#009
in `docs/release.md`), not the per-binding local SELF tests (#006
/ #007). Until #009 lands, "D1 / R2 binding works" means **"the
binding API is reachable in the local workerd pool"**, not
**"the production database is online"**.

## Session lifecycle (sign-in / sign-out)

Better Auth (`src/cloudflare/auth/better-auth.ts`, ADR-0009) owns the
session; the admin gates that consume it live in
`src/admin/auth/load.ts` and the `/admin/*` route loaders. The
behavioural contract is pinned by
`test/integration/session-logout.test.ts` (Issue #439):

| Property                                                          | How it is proven                                                                 |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A sign-in session authorizes `/admin` and `/api/v1/auth/get-session` | positive case: the issued cookie resolves the user (with role) and the dashboard renders 200 |
| The same cookie is refused after sign-out                         | negative case: `get-session` resolves no user, `/admin` and `/admin/keys` 307 to `/admin/login`, and the D1 `session` row is deleted |
| Sign-out clears the browser cookie jar                            | `Set-Cookie` re-issues `better-auth.session_token` **and** `better-auth.session_data` with `Max-Age=0` |
| A client-supplied cookie is never promoted by sign-in            | fixation case: an attacker-planted value resolves to no session before *and* after login; the server issues its own token |
| A rejected sign-out does not invalidate the session               | an `Origin` mismatch is refused (4xx) and the session row survives |
| Replaying a dead cookie is a no-op                                | a second sign-out neither errors nor resurrects a session                          |

Two notes on reading that table. The redirect is pinned as **307**
(TanStack Start `redirect()`) and the **exact** path is asserted, so a
role denial (bounced back to `/admin`) can never be mistaken for a
session denial (`/admin/login`). And the cookie names are the test
pool's un-prefixed form: under `https://` — production, where
`BETTER_AUTH_URL=https://rebuildup.dev` is pinned by ADR-0014 — Better
Auth prefixes both with `__Secure-`, so the production names are
`__Secure-better-auth.session_token` / `__Secure-better-auth.session_data`.
The local pool (no `baseURL`) exercises the un-prefixed form; the
prefix is a transport attribute, not a contract change.

Run it locally:

```bash
pnpm exec vitest run test/integration/session-logout.test.ts
```

Every request goes through the local workerd pool, because sign-in and
sign-out write and delete D1 rows; running this against production
would mutate the operator's database and could invalidate the live
admin session. Fixture identities are local (`.test.local` addresses,
throwaway password) and cookie values are never printed — they are
never used as an operand of an assertion at all (vitest echoes both
operands of a failed `expect`), only cookie names, attributes, and
non-printing identity comparisons are asserted on.

Known residual (open owner decision, Issue #439): `session.cookieCache`
is enabled with `maxAge: 5 * 60`, so a party that captured BOTH
`better-auth.session_token` and `better-auth.session_data` *before* the
logout can replay the pair until the cache cookie expires — the cache
answers without consulting D1. A real browser is not exposed (the
sign-out response clears the pair), but the window is a real deviation
from "logout invalidates the session immediately", and closing it means
re-tuning the auth policy ADR-0009 owns. Until an owner decision is
taken, the window is **documented, not closed**.

The suite watches it as one `it.fails` case that asserts the *desired*
outcome ("a pair captured before sign-out is refused afterwards") and
therefore fails today. Because `/api/v1/auth/get-session` has no 401
path — an unknown or deleted session answers 200 with a `null` body —
"refused" is asserted as "resolves to no user" plus the `/admin`
redirect, never as a status code. The case fires on either remedy:
disabling the cache means no `session_data` cookie is issued at all, so
there is no pair to replay; shrinking it means the pair expires instead
of outliving the logout. Either way `it.fails` reports the unexpected
pass and the case is converted to a plain `it`. (Disabling the cache
also requires re-tuning the "sign-out clears the browser jar" case,
which by construction requires a cache cookie to clear.)

A redacted transcript of the observed responses is kept at
[`docs/verification/security/session-logout-e2e.webp`](verification/security/session-logout-e2e.webp).

## Inventory at 0.1.0

| Package                     | Pinned version | Notes                                 |
| --------------------------- | -------------- | ------------------------------------- |
| `wrangler`                  | `^4.131.0`     | Cloudflare Workers toolchain          |
| `@cloudflare/vite-plugin`   | `^1.0.0`       | Vite <-> Workers bundling             |
| `@cloudflare/vitest-plugin` | `^1.0.0`       | Worker test pool (local Miniflare)    |
| `@tanstack/react-start`     | `^1.168.52`    | Framework                             |
| `@tanstack/react-router`    | `^1.168.52`    | Router                                |
| `hono`                      | `^4.13.7`      | External HTTP boundary                |
| `@pandacss/dev`             | `^1.12.1`      | Styling                               |
| `@biomejs/biome`            | `^1.9.4`       | Format + lint                         |
| `actionlint`                | latest         | Workflow YAML lint (CI step)          |
| `storybook`                 | `^8.6.18`      | Design-system preview (dev only)      |
| `@playwright/test`          | `^1.63.0`      | E2E suite (chromium)                  |
| `vite`                      | `^7.1.0`       | Bundler                               |
| `vitest`                    | `~4.1.0`       | Test runner                           |
| `react` / `react-dom`       | `^19.2.0`      | UI runtime                            |
| `typescript`                | `^5.9.0`       | Language                              |

## Automated checks

- Secret scanning: enabled as an asynchronous CI job (see
  `quality/profile.yaml#security_gates.secret_scanning`).
- Dependency advisory gate: enabled (Issue #470, see
  `quality/profile.yaml#security_gates.dependency_review`). The
  `Dependency advisory audit` step of the `validate` job checks the
  committed lockfile with `pnpm audit --json` and evaluates it against
  the reviewed declaration in `quality/dependency-advisory-gate.json`:
  `critical` / `high` are the declared blocking severities, an approved
  exception is a record — keyed by `(advisoryId, package)`, because one
  advisory commonly spans several packages — carrying a reason, an
  approver, a tracking issue and an expiry date, and advisory data that
  cannot be read fails closed (exit `3`) instead of being reported as
  "0 vulnerabilities". A usage mistake or a malformed declaration is
  exit `2`, never a security verdict. The gate runs in CI rather than in
  `validate:fast` because it needs the registry advisory endpoint; the
  decision logic is in `scripts/check-dependency-advisories.mjs` and the
  same verdict is reproducible with `pnpm run dep-audit:check`. It ships
  with `enforcement: audit` and no approved exceptions, so outstanding
  findings are recorded rather than blocking; moving to `block` is an
  owner decision. Runbook:
  [`docs/runbook/dependency-advisories.md`](runbook/dependency-advisories.md).
- Code scanning (SAST): deferred.
- Container scanning: not applicable (no `Containerfile` at 0.1.0).
- Workflow YAML lint runs through `pnpm run lint:ci` inside the
  `validate` job (actionlint 1.7.12, downloaded by
  `scripts/lint-ci.mjs`). Biome does not lint `.yml`.
- Redirect-target matrix (Issue #454) is regenerated from the shipped
  guard by `pnpm run security:redirect:report`; the committed image and
  its reading guide are in
  [`docs/verification/security/`](verification/security/).

## Dependency install lifecycle scripts

`pnpm install` can execute third-party code before any repository
test exists. pnpm 12 is default-deny for that: only the packages
listed as `true` in `pnpm-workspace.yaml#allowBuilds` (or in
`#permissions`, which supersedes it) run their `preinstall` /
`install` / `postinstall` hooks.

That list is audited, not remembered:

- `quality/install-scripts.json` records, per package, whether the
  build is actually needed and why. `default_decision` is `block`;
  a record without a `justification` is rejected.
- `pnpm run install:scripts:check` (part of `validate:fast`) fails
  when an installed package can execute code at install time with no
  reviewed record, when the policy decision and pnpm's execution
  allow-list disagree in either direction, when a grant survives only
  in the legacy `onlyBuiltDependencies` list, or when an installed
  manifest grows an undocumented hook. "Can execute" includes an
  implicit `node-gyp rebuild` for a package that ships `binding.gyp`
  and the `prepare` of a git-hosted dependency. It warns when an
  allow-list entry buys no build, and on stale records.
- The audit is **status-only**: it reads package manifests plus those
  two policy files and prints package names, versions, hook names and
  policy text. No secret value (`.dev.vars`, Infisical, Worker
  secret) is read or printed, and nothing in the runtime / deploy
  path is touched.

Operator procedure (what each failure means, how to remediate, and
the recorded high-risk entry) lives in
[`docs/runbook/install-script-audit.md`](runbook/install-script-audit.md).
Tool-side / upstream changes are deliberately out of scope for the
audit itself (Issue #474): the gate records the risk and names the
removal condition instead of patching a dependency.

## Browser binaries (Playwright)

`pnpm run e2e` runs against `pnpm dev` (locally) or a deployed Worker
URL via `PLAYWRIGHT_BASE_URL`. The Chromium browser binary used by the
E2E suite is downloaded on demand:

- Locally: `pnpm run e2e:install` (`playwright install --with-deps
  chromium`). The `--with-deps` flag uses `sudo apt-get install` on
  Linux to add the system shared libraries Chromium needs
  (`libnspr4.so`, etc.) — operators should review this command before
  invoking it. The sandbox where development happens has no `sudo`,
  so `e2e:install` fails there; on CI runners `sudo` is available.
- On CI: the `Install Playwright Chromium` step in
  `.github/workflows/ci.yml` runs `pnpm exec playwright install
  --with-deps chromium`. The resulting `playwright-report/` artefact
  is uploaded via `actions/upload-artifact@v4` with a 7-day retention
  for triage; it contains the same HTML / traces that the local run
  would emit and must not include credentials or secrets.

Playwright is pinned in `package.json#devDependencies` and the
browser version is locked by `@playwright/test`'s `browsers` manifest
(see `pnpm exec playwright --version`). Bumping Playwright requires
running `pnpm run e2e:install` once after the lockfile update so the
new browser binary is available.
