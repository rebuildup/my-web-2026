# Login enumeration + credential brute force (Issue #443)

Operating contract for `POST /api/v1/auth/sign-in/email`, the one
unauthenticated credential endpoint on the external boundary
(`src/http/auth/router.ts` → Better Auth's `auth.handler`).

Everything here is measured in the **local workerd pool** against the
real Worker entrypoint. No production traffic is generated, and no
credential, cookie, or personal field is logged, asserted on, or
committed. See
[`docs/security.md`](../security.md#login-enumeration-and-credential-brute-force)
for the pointer and [`../adr/ADR-0009-better-auth-foundation.md`](../adr/ADR-0009-better-auth-foundation.md)
for the decision this implements.

## What the audit found

| Question | Before this change | Now |
| --- | --- | --- |
| Does a wrong password on an existing account differ from an attempt on a non-existent one? | No — both `401` / `INVALID_EMAIL_OR_PASSWORD`, single `content-type` header. Correct, but unpinned. | Same, and pinned by an equality assertion over status + body + the whole header set. |
| Does a burst of failed logins from one client get throttled? | **No.** 12 consecutive failures from one client IP all returned `401`. Better Auth 1.7.5 defaults `rateLimit.enabled` to `NODE_ENV === 'production'`, and this Worker declares no `NODE_ENV` (`wrangler.jsonc#vars` holds only the two `MY_WEB_2026_*` vars). | Yes: `401, 401, 401, 429`, then `429` with `X-Retry-After`. Pinned explicitly, so the control no longer depends on an ambient build/runtime variable. |
| What identifies the client for throttling? | Better Auth's default header `x-forwarded-for`. On Cloudflare that header is a **chain**; a two-hop request resolves to *no* IP, which collapses every caller into one shared bucket — one caller could lock out every other caller, including the operator. | `CF-Connecting-IP`, which Cloudflare sets and overwrites on every request, and which `src/http/middleware/rate-limit.ts` already trusts for the Workers Rate Limiting binding. |

## The pinned configuration

All of it lives in `src/cloudflare/auth/better-auth.ts` and is asserted
in `src/cloudflare/auth/better-auth.test.ts` (config level) plus
`test/integration/auth-login-hardening.test.ts` (runtime behaviour).

| Setting | Value | Why it is stated explicitly |
| --- | --- | --- |
| `rateLimit.enabled` | `true` | The library default is `NODE_ENV === 'production'`. Relying on it made the brute-force control both unverifiable locally and dependent on a variable this repository does not declare. |
| `rateLimit.customRules['/sign-in/email']` | `{ window: 10, max: 3 }` | Same value as Better Auth's built-in `/sign-in*` special rule. Restating it moves the budget out of library internals into a file that is reviewed, so a library upgrade cannot silently loosen or tighten it. The key is normalized against `basePath`, hence `/sign-in/email`, not `/api/v1/auth/sign-in/email`. |
| `rateLimit.window` / `max` | `10` / `100` | The library defaults for every other auth path. Stated for the same drift reason; changing either is a security decision, not an accident. |
| `rateLimit.storage` | `'memory'` | The library default, stated so the weak spot below is a visible choice rather than an implicit one. |
| `advanced.ipAddress.ipAddressHeaders` | `['cf-connecting-ip']` | See the table above. Cloudflare overwrites this header, so it is not client-spoofable. |

## Response contract

| Situation | Status | Body | Headers |
| --- | --- | --- | --- |
| Correct credentials | `200` | session payload | `set-cookie` carries `better-auth.session_token` |
| Wrong password **or** non-existent account | `401` | `{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}` | `content-type` only |
| Over budget (4th attempt in 10 s from one client IP) | `429` | `{"message":"Too many requests. Please try again later."}` — generic, no `code`, and identical whether or not the account exists | `content-type` + `X-Retry-After` |

Three properties the tests hold in place:

1. **No existence oracle.** `401` is byte-identical for existing and
   unknown accounts. `429` — which is decided *before* the password is
   ever verified — is also identical for both, so a throttled client
   cannot use the throttle to probe which accounts exist.
2. **Retry control.** A `429` carries `X-Retry-After`, an integer number
   of seconds until the window frees up. Note the name: `X-Retry-After`
   is Better Auth's implementation header, not the standard
   `Retry-After`.
3. **Per client, not global.** The budget key is *client IP + path*. A
   throttled client cannot lock out another client, so the control is not
   a denial-of-service lever against the operator.

## What the local tests do and do not prove

They prove, against the real Worker entrypoint:

- the two failure modes are indistinguishable, and neither leaks the
  submitted email or password, mints a cookie, or writes a session row;
- the pinned budget engages at the pinned number and answers `429` with
  a retry hint;
- the throttle precedes credential verification and is per client.

They do **not** prove anything about the deployed limiter's strength:
the counter lives in the isolate's heap, so it resets on isolate recycle
and is not shared across locations. See "Known limits" below.

## Operator-facing behaviour

`/admin/login` (`src/routes/admin.login.tsx`) is a plain HTML form that
POSTs straight to `/api/v1/auth/sign-in/email`, so Better Auth owns the
whole response. Consequences worth knowing:

- Three mistyped sign-ins inside 10 seconds now produce `429` instead of a
  fourth `401`. The browser renders Better Auth's generic body —
  `{"message":"Too many requests. Please try again later."}` — which is
  the same shape the wrong-password case already produced, and carries no
  account information. A programmatic client reads `X-Retry-After`.
- The message deliberately does not say whether the address is registered,
  so an operator cannot use the throttle to probe their own account list
  either.
- A successful sign-in from the same client after the window elapses is
  unaffected; the budget is a rolling 10-second window, not a daily cap
  and not an account lockout. There is no administrative unlock path
  because there is no lockout state to clear.

## Reproducing

```sh
pnpm exec vitest run test/integration/auth-login-hardening.test.ts
```

The suite prints the measured matrix between
`<!-- login-rate-limit-matrix:start -->` and
`<!-- login-rate-limit-matrix:end -->`; it carries status codes and
Better Auth error codes only, and the suite asserts that no email,
password, or `@test.local` string reached it.

To regenerate the committed verification artefact:

```sh
pnpm run verification:login-rate-limit
```

## Known limits (not fixed here)

- **Memory-backed counter.** `storage: 'memory'` is per-isolate, so the
  throttle is a speed bump rather than a hard global budget. Making it
  durable needs either a `rateLimit` table (a migration) or a KV /
  Rate Limiting binding (a new binding plus an ADR, per AGENTS.md §4).
  Recorded as an open decision, not silently accepted.
- **Two retry header names inside the boundary.** The Workers Rate
  Limiting middleware returns `Retry-After`; Better Auth's throttle
  returns `X-Retry-After`. Normalising them would mean rewriting a
  Better Auth-owned response from the Hono router — a contract change
  beyond this ticket's scope.
- **No production measurement.** Per this repository's own rule, no
  load was generated against `rebuildup.dev`. The evidence here is local
  by design.
- **Other auth paths are covered only by the base rule.** `sign-up`,
  `change-password`, and `change-email` keep Better Auth's own special
  rule (3 per 10 s) because only `/sign-in/email` is exposed to
  unauthenticated callers in this deployment. Sign-up is additionally
  disabled (`emailAndPassword.disableSignUp`).

## Files that must change together if this contract moves

| Change | Touch |
| --- | --- |
| Budget / window / enablement | `src/cloudflare/auth/better-auth.ts` **and** `src/cloudflare/auth/better-auth.test.ts` **and** `test/integration/auth-login-hardening.test.ts` (it asserts the exact status sequence and the `X-Retry-After` bound) |
| Client IP source | same three files, plus `src/http/middleware/rate-limit.ts` if the boundary middleware should key on the same header |
| Durable storage | new migration + `wrangler.jsonc` / `cloudflare.config.ts` / `vitest.config.ts` bindings + an ADR |