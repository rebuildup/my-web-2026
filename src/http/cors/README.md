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
| `none`         | everything else, including `/api/v1/db/ping`, `/robots.txt`, `/sitemap.xml`, `/webhooks/*`, `/oauth/*`, `/integrations/*` | no CORS header at all            |

A cross-origin request that is not permitted is **refused** with
`403 { "error": "cors_origin_rejected" | "cors_method_rejected" | "cors_header_rejected", "class": … }`
and no CORS header. A preflight that is permitted is answered `204`
with the policy headers; `Access-Control-Allow-Methods`,
`-Max-Age` and `-Allow-Headers` are emitted on preflights only, because
that is the only response a browser reads them from. A same-origin
request, and any request with no `Origin` header at all (the SSR
self-calls, `curl`, the E2E suite), is untouched apart from
`Vary: Origin` on a `credentialed` route. `public-read` does not get
that header at all: `Access-Control-Allow-Origin: *` is the same
answer for every origin, so varying on it would only fragment the
shared immutable reaction-image payload that Issue #460 keeps free of a
`Vary` dimension.

## Files

- `policy.ts` — pure: the route table, the allow-list comparison and
  the header decision. No Hono, no `Env`, no I/O, so the whole matrix is
  unit-testable.
- `middleware.ts` — the Hono adapter. Reads the request inputs, renders
  the decision, short-circuits the two cases that must not reach a
  handler. On the pass-through branch it renders onto the **finalized**
  response, after `await next()`: Hono merges a pre-`next()`
  `c.header()` only into a response the context produced itself, so a
  handler returning a raw `Response` (`auth.handler(c.req.raw)`, the
  mock gate's `mockApp.fetch(...)`) would otherwise drop the allow
  branch — which is exactly the `credentialed` case.
- `policy.test.ts` / `middleware.test.ts` — unit.
- `test/integration/cors.test.ts` — the same matrix over the real
  Worker through `SELF.fetch`, plus the route-inventory gate and the
  `CORS_PREFLIGHT_MEASUREMENT` line the verification screenshot is
  generated from.

## The invariants worth knowing before editing

1. **A `credentialed` route never answers with `*`.** Not on a
   preflight, not on an error, not "only for GET".
   `credentialWildcardViolation()` in `policy.ts` encodes the rule and
   both test suites assert it over the whole route × origin × method
   matrix, including the real response bytes.
2. **The allow branch reaches the wire, whichever handler shape answers.**
   This is the one that is easy to get wrong and invisible in review:
   a header set before `next()` is silently dropped by any handler that
   returns a raw `Response`, so `/api/v1/auth/*` looked documented and
   answered with nothing. `middleware.test.ts` reproduces both raw
   shapes (Better Auth and the mock gate) and asserts the handler's
   `Set-Cookie` survives alongside the echo.
3. **A `credentialed` route never answers the opaque `null` origin.**
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
quietly inheriting a neighbour's policy. It reads **both**
`externalBoundary.routes` and `createMockApp().routes`: the mock is a
second Hono app the boundary mounts behind the `LOCAL_API_MODE` gate,
so a mock route is as much a reachable surface as a real one.
