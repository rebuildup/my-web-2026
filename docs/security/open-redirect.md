# Open redirect — redirect target contract (Issue #454)

The shipped contract for untrusted redirect targets: what the guard
accepts, where it is mounted, and what an operator has to keep true.
Read this before changing `src/http/security/**`, the Better Auth
router, or any surface that turns a query / body value into a
`Location` header.

## The rule

**A redirect target is either an internal absolute path or nothing.**

| Input | Verdict |
| --- | --- |
| `/admin`, `/admin/keys?tab=recent#list` | accepted, used as-is |
| `%2Fadmin%2Finvitations` | accepted, normalised to `/admin/invitations` |
| `https://rebuildup.dev/admin` (origin in `trustedOrigins`) | accepted, **downgraded to `/admin`** |
| `https://evil.example/`, `//evil.example`, `/\evil.example` | refused — `external_origin` / `protocol_relative` / `backslash` |
| `%2F%2Fevil.example`, `%252F%252Fevil.example`, … | refused — the decoded layer is what gets checked |
| `javascript:`, `data:`, `vbscript:` (encoded or not) | refused — `scheme_not_allowed` |
| `admin/keys`, `../admin` | refused — `missing_leading_slash` |
| CRLF, NUL, zero-width space, BOM, soft hyphen | refused — `control_characters` |
| `%zz`, more than four encoding layers | refused — `decode_failed` |
| longer than 2048 characters | refused — `too_long` |
| absent / empty / not a string | treated as "no target" |

A refusal is **never** a rewrite. The caller decides what happens
next: an API boundary answers `400`, a page falls back to a constant it
owns. `classifyRedirectTarget` returns the reason; it never returns a
"cleaned up" version of a hostile value.

## Why the target is decoded before it is judged

A validator that inspects the raw string and a consumer that decodes
later disagree about what `%2F%2Fevil.example` is. The guard therefore
percent-decodes to a **fixed point** before the authority checks and
returns the decoded value, so:

- a second decode by any downstream consumer is a no-op, and
- every intermediate representation is bounded by a representation that
  already passed.

Four layers is the budget; deeper nesting is treated as hostile rather
than as a path that happens to be deep.

## Where it is mounted

| Surface | Mount | Contract |
| --- | --- | --- |
| `/api/v1/auth/*` | `src/http/auth/router.ts`, `redirectTargetGuard` in front of `auth.handler` | checks `callbackURL`, `redirectTo`, `errorCallbackURL`, `newUserCallbackURL`, `returnTo`, `return_to`, `next`, `redirect_uri` in the query string **and** in `application/json` / `application/x-www-form-urlencoded` bodies |
| `/admin/login?returnTo=` | `src/routes/admin.login.tsx` loader | same classifier, scoped to `allowedPrefixes: ['/admin']`; falls back to `/admin` and renders a notice |
| `/oauth/*`, `/integrations/*` | **not implemented** | when either lands, mount `redirectTargetGuard` from `src/http/security/redirect-guard.ts`; do not re-derive the rules |

A refused boundary request answers:

```json
{ "error": "invalid_redirect_target", "param": "callbackURL", "reason": "external_origin", "source": "body" }
```

with status `400`, and **without** the submitted value — the response
is safe to log and cannot be used as a reflector. The
`X-Request-Id` correlation header assigned by
`src/http/middleware/request-id.ts` is still present.

## Operator contract

1. **`BETTER_AUTH_URL` is the origin allow-list.** The auth router
   reads it from `c.env` per request and passes it as
   `trustedOrigins`. Production pins it in
   `wrangler.production.jsonc` to `https://rebuildup.dev` (ADR-0014).
   If it is **missing**, the guard refuses *every* absolute URL —
   including same-origin ones. That is deliberate: a missing binding
   narrows the allow-list, it never widens it. A same-origin absolute
   `callbackURL` will `400` in an environment without the binding;
   internal relative paths keep working, which is what the project's
   own login form sends.
2. **Changing the canonical origin means changing two files.**
   `wrangler.production.jsonc` (`BETTER_AUTH_URL`) and
   `BETTER_AUTH_URL` in the Infisical dev environment (see
   [`../runbook/infisical-secrets.md`](../runbook/infisical-secrets.md)).
   Nothing else needs touching; the guard reads the binding at
   request time.
3. **A new surface that redirects must mount the guard**, not copy the
   rules. The accepted parameter names live in
   `REDIRECT_TARGET_PARAM_NAMES`; a surface that needs a different
   vocabulary passes `params` explicitly so the decision stays visible
   in review.
4. **Body inspection is bounded.** Bodies that are not
   `application/json` / `application/x-www-form-urlencoded`, bodies
   with no redirect field name in them, and bodies over 16 KiB are not
   parsed by the guard. A surface that carries a redirect target in a
   third encoding needs its own mount — and its own test.

## Verification

- Unit matrix (pure classifier): `src/http/security/redirect.test.ts`
- Mounted behaviour through the real Worker entry and Better Auth:
  `src/http/security/redirect-guard.test.ts`
- Rendered matrix + screenshot:
  [`../verification/security/README.md`](../verification/security/README.md),
  regenerate with `pnpm run security:redirect:report`

## Known limits

- `..` segments are **not** resolved (`/admin/../about` stays inside
  the origin). Traversal inside the same origin is a routing concern,
  not an open redirect, and rewriting it here would change the target
  the caller asked for.
- A redirect target cannot carry a fragment-only or query-only value
  (`#top`, `?next=x`) — those are refused as
  `missing_leading_slash`. No shipped surface needs them.
- `trustedOrigins` is matched against whole origins, not wildcards.
  There is no pattern support, so there is no pattern to get subtly
  wrong.