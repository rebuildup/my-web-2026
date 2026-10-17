# CORS — external HTTP boundary

The origin policy every `/api/v1/*` response obeys (Issue #455).

Implementation detail and the reviewer-facing contract live in
[`docs/security/api-cors.md`](../../../docs/security/api-cors.md). This
file is the short version for anyone reading the boundary source.

## Why it exists

Before Issue #455 the boundary emitted **no** CORS header at all. That
is a safe default, but it is not a contract: the public read routes
(`/api/v1/health`, `/api/v1/reaction-images/:id`) were unusable from
any other origin even though they carry no secret, and the only
wildcard the project shipped (`public/_headers`, `/tools/:slug/app/*`,
a Static Assets rule for Tool artefacts) had nothing tying it to the
API surface. "The wildcard never reaches authenticated data" was an
assumption a reviewer had to take on trust.

## Three classes, one decision function

| Class          | Routes                                                                  | Response                                                             |
|----------------|-------------------------------------------------------------------------|----------------------------------------------------------------------|
| `credentialed` | `/api/v1/auth/*`, `/api/v1/access/*`, `/api/v1/reactions`                | echo ONE allow-listed origin + `Access-Control-Allow-Credentials: true` |
| `public-read`  | `/api/v1/health`, `/api/v1/reaction-images/:id`                          | `Access-Control-Allow-Origin: *`, never any credentials header        |
| `none`         | everything else, including `/api/v1/db/ping`, `/webhooks/*`, `/oauth/*`, `/integrations/*` | no CORS header at all            |

A cross-origin request that is not permitted is **refused** with
`403 { "error": "cors_origin_rejected" | "cors_method_rejected" | "cors_header_rejected", "class": … }`
and no CORS header. A preflight that is permitted is answered `204`
with the policy headers. A same-origin request, and any request with no
`Origin` header at all (the SSR self-calls, `curl`, the E2E suite), is
untouched apart from `Vary: Origin`.

## Files

- `policy.ts` — pure: the route table, the allow-list comparison and
  the header decision. No Hono, no `Env`, no I/O, so the whole matrix is
  unit-testable.
- `middleware.ts` — the Hono adapter. Reads the request inputs, renders
  the decision, short-circuits the two cases that must not reach a
  handler.
- `policy.test.ts` / `middleware.test.ts` — unit.
- `test/integration/cors.test.ts` — the same matrix over the real
  Worker through `SELF.fetch`, plus the route-inventory gate and the
  `CORS_PREFLIGHT_MEASUREMENT` line the verification screenshot is
  generated from.

## The two invariants worth knowing before editing

1. **A `credentialed` route never answers with `*`.** Not on a
   preflight, not on an error, not "only for GET".
   `credentialWildcardViolation()` in `policy.ts` encodes the rule and
   both test suites assert it over the whole route × origin × method
   matrix, including the real response bytes.
2. **A `credentialed` route never answers the opaque `null` origin.**
   `Origin: null` is what a Tool iframe served from
   `/tools/<slug>/app/*` (sandboxed `allow-scripts`, so no
   `allow-same-origin`) sends. Those Tools are same-origin static
   artefacts that are given a wildcard by `_headers`; they must never be
   able to turn that into authenticated API access.

## Adding a route

Add it to `CORS_ROUTES` in `policy.ts`, or acknowledge it in
`INTENTIONALLY_UNCLASSIFIED` in `test/integration/cors.test.ts` with a
reason. The inventory test compares the two sets in both directions, so
a route that ships without a decision fails the suite rather than
quietly inheriting a neighbour's policy.