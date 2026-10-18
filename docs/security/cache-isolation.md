# Cache isolation — per-caller responses and shared caches

> Which responses may be stored by a cache that is shared between
> visitors, which may not, and where that decision is made.

## The contract

Every response whose body depends on who asked for it must be
unusable by anyone else. A cache in front of the Worker — Cloudflare's
edge, a corporate proxy, a mobile HTTP stack — is shared by design: it
is keyed by URL, and a URL does not carry an API key, a session
cookie, or a visitor identity. So the origin has to say, per response,
whether a shared cache may hold it at all. Where the origin says
nothing, the answer is decided by whoever else is in the path, and a
stale entry becomes someone else's data.

The rule this repository enforces:

| Response | `Cache-Control` | `Vary` |
| --- | --- | --- |
| Anything caller-specific (see below) | `private, no-store` | `Cookie, Authorization` (`Origin` too on credentialed CORS routes) |
| Caller-specific SSR document | `private, no-cache` | `Cookie, Authorization` |
| Public document (no cookie, no `Authorization`, no `Set-Cookie`) | `no-cache` | — |
| `/admin*` (any response) | `no-store` | `Cookie, Authorization` |
| Content-addressed reaction image | `public, max-age=31536000, immutable` | — |

The last row is the only deliberate opt-out, and it exists because
that payload is public by construction.

## What makes a response caller-specific

Not a route list — the request itself. A response is caller-specific
when the exchange ties it to an identity:

- the request carries `Cookie` or `Authorization`, or
- the response issues `Set-Cookie`, or
- the endpoint's data is scoped to an authenticated principal.

The third case is the reason the list cannot be derived from headers
alone: `GET /api/v1/access/count/:key` returns a count scoped to the
API key id (ADR-0012 §3), and `GET /api/v1/reactions` returns
`viewer_reactions` for the visitor named by `actor_id`. The API half
therefore applies a deny-by-default policy (below) instead of trying
to enumerate endpoints, because a new per-principal endpoint that
forgets to declare itself is exactly the failure this has to prevent.

## Where the decision is made

### External boundary — `/api/v1/*`

`src/http/middleware/cache-policy.ts`, mounted in
`src/http/hono.ts` **before** the local mock gate so the dev-mode mock
responses are covered too.

Deny by default, opt in explicitly:

- A response is treated as shared-cacheable only when its
  `Cache-Control` carries `public` **and** a positive `s-maxage` or
  `max-age`. `s-maxage` wins over `max-age` when both are present
  (RFC 9111 §5.2.2.10), so `public, s-maxage=0, max-age=600` is a
  refusal, not an opt-in.
- Everything else is rewritten to `private, no-store` plus
  `Vary: Cookie, Authorization`. The rewrite is monotone: the result
  is never weaker than what it replaced, so it can only tighten a
  handler's own policy (Better Auth's session `no-store` is kept as a
  subset). Responses whose route is `credentialed` for CORS (Issue
  #455) also carry `Vary: Origin`: the CORS layer runs *inside* this
  one and renders `Origin` first, then `mergeVary` appends the
  identity fields, producing `Origin, Cookie, Authorization`. That
  order is deliberate — if it were reversed, a CORS `set('Vary', …)`
  would erase the isolation fields. `test/integration/cache-isolation.test.ts`
  pins the merged value on `/api/v1/reactions` and
  `/api/v1/auth/get-session`; see `docs/security/api-cors.md` §4.
- An explicit public opt-in is left completely untouched, `Vary`
  included. Adding `Vary: Cookie` to a public immutable image would
  fragment the shared cache per visitor and change nothing about
  correctness.

### SSR documents and server functions

`applyHtmlCachePolicy` in `src/server.ts`. It extends the policy
introduced for `/admin*` in Issue #291:

- `/admin*` → `no-store`, decided by path alone (an anonymous
  `/admin` answers `307` with no content type, so a content-type
  guard would skip the one response most likely to be recorded).
- `/_serverFn/*` → `private, no-store`, also decided by path alone:
  server-function payloads are JSON, so they never enter the document
  branch, and they are per-caller by construction (the handlers read
  the session cookie and `mw_actor_id`).
- Any other `text/html` response → `private, no-cache` when the
  request carries `Cookie` / `Authorization` or the response issues a
  cookie, `no-cache` otherwise. `private` is the part that forbids a
  shared cache to store the body; `no-cache` is Issue #291's
  "revalidate before reuse" contract, which the per-request hit
  counter and reaction aggregates still require.

An existing `Cache-Control` is never overwritten, so a decision the
framework or a handler already made always wins.

The home page is the case that makes this concrete: the reactions
widget renders the visitor's *own* selection (`viewer_reactions`,
resolved from the `mw_actor_id` cookie) into the SSR HTML. Without
`private`, a shared cache is allowed to store that document, and
serving one visitor's body to the next is both a privacy leak and a
wrong toggle state.

## Failure behaviour

Header mutation can throw: `Response.redirect()` and any
`fetch()`-derived response carry an immutable guard. A cache hint
must never be the reason a request fails, so the mutation is wrapped
and a sealed response is returned unchanged. This is an
availability-over-hygiene trade and it is deliberate — the response
still renders, and an intermediary capable of mishandling the policy
is not one that seals headers in the first place.

## Verification

Two suites, both runnable locally against workerd bindings only. No
remote resource, no deploy, no credential: the API keys used by the
tests are literals in the test file, and all rows come from inlined
migrations plus local inserts.

```bash
pnpm exec vitest run src/http/middleware/cache-policy.test.ts
pnpm exec vitest run test/integration/cache-isolation.test.ts
```

`src/http/middleware/cache-policy.test.ts` pins the decision
functions and the middleware: the explicit opt-in, the refusals
(`no-store`, `private`, zero lifetimes, `s-maxage` precedence), `Vary`
merging and de-duplication, and the sealed-header path.

`test/integration/cache-isolation.test.ts` is the acceptance test.
It models a shared cache (`SharedCache`, a literal reading of the
RFC 9111 §3 storage rules) and drives two auth contexts —
`Authorization: Bearer test-key-alpha` and `…/test-key-beta`, mapped
to two different API key ids — through it:

- The same URL returns different bodies per context (per-principal
  counters, `viewer_reactions` per visitor), and neither body is
  offered to the cache.
- A visitor cookie on the request is refused storage on its own terms.
- `/api/v1/auth/get-session` keeps its origin-declared `no-store` and
  gains `Vary`.
- Errors and unauthenticated responses are isolated too.
- **Negative control:** the public reaction image *is* stored and
  served from the cache. Without this, a policy that refused
  everything would pass every other assertion in the file while
  silently breaking public image delivery.

The document half runs through `SELF.fetch` rather than an in-isolate
call, because `applyHtmlCachePolicy` lives in the Worker entry and no
in-process call can observe the headers it sets.

### Producing the verification report

The review artefact for this contract
(`docs/verification/security/cache-isolation-test.webp`) is generated
from a real run, so it can never drift from what the suites assert:

```bash
pnpm exec vitest run --reporter=json \
  --outputFile=.tmp/cache-isolation-results.json \
  test/integration/cache-isolation.test.ts src/http/middleware/cache-policy.test.ts
node scripts/build-cache-isolation-report.mjs   # JSON -> .tmp/cache-isolation-report.html
node scripts/shoot-cache-isolation-report.mjs    # Chromium screenshot -> docs/verification/security/
```

The report contains assertion names, results and durations only — no
header dump of a live response, no environment value, no credential.
The intermediate PNG and HTML stay in the gitignored `.tmp/`.

## Adding an endpoint

- Per-principal, per-session or per-visitor data: nothing to do. The
  boundary isolates by default, and the endpoint inherits it.
- Genuinely public, immutable data: set
  `Cache-Control: public, max-age=…, immutable` in the handler. That
  is the only way to opt out, and it must be a deliberate statement
  that the payload carries no caller-specific data.
- A new SSR surface that reads a cookie or session: nothing to do. The
  document policy keys off the request headers, not a route list.