# Open redirect guard

Untrusted redirect targets at the external HTTP boundary (Issue #454).

| File | Role |
| --- | --- |
| `redirect.ts` | Pure classifier + candidate collection. No imports. |
| `redirect-guard.ts` | Hono middleware that applies the classifier to an inbound request. |

## Contract

A redirect target is either an internal absolute path (starting with
exactly one `/`) or nothing. An absolute URL is accepted only when its
origin is in the caller's `trustedOrigins`, and is then downgraded to
its path so no host reaches a `Location` header. Everything else is
refused with a stable reason; nothing is rewritten.

The target is percent-decoded to a fixed point before the authority
checks, so an encoded authority (`%2F%2Fevil.example` and every layer
above it) cannot pass a validator that only inspects the raw string.

## Mount points

- `/api/v1/auth/*` — `src/http/auth/router.ts`, in front of
  `auth.handler`. Inspects `callbackURL`, `redirectTo`,
  `errorCallbackURL`, `newUserCallbackURL`, `returnTo`, `return_to`,
  `next`, `redirect_uri` in the query string and in
  `application/json` / `application/x-www-form-urlencoded` bodies.
- `/admin/login?returnTo=` — `src/routes/admin.login.tsx` loader, via
  the classifier directly (scoped to `allowedPrefixes: ['/admin']`).
- `/oauth/*`, `/integrations/*` — not implemented yet; mount
  `redirectTargetGuard` when they land rather than re-deriving rules.

## Failure shape

```json
{ "error": "invalid_redirect_target", "param": "callbackURL", "reason": "external_origin", "source": "body" }
```

`400`, no submitted value in the body, `X-Request-Id` preserved.

## Operational contract

`BETTER_AUTH_URL` is the trusted-origin allow-list, read from `c.env`
per request. Unset means every absolute URL is refused — fail-closed,
by design. Full operator contract, decision rationale and known limits:
[`docs/security/open-redirect.md`](../../../docs/security/open-redirect.md).

## Tests

- `redirect.test.ts` — the classification matrix (pure).
- `redirect-guard.test.ts` — the same rules through the real Worker
  entry and Better Auth (`SELF.fetch`), plus middleware behaviour that
  is awkward to reach through the auth surface.

Rendered matrix + screenshot:
[`docs/verification/security/README.md`](../../../docs/verification/security/README.md).