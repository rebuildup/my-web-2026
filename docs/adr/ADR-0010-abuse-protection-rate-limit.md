# ADR-0010: Abuse protection — Workers Rate Limiting binding (no bot score)

- Status: Accepted
- Date: 2026-09-19
- Extends: ADR-0004, ADR-0009
- Superseded by: None

## Context

0.3.0 exposes two public feature endpoints to authenticated API
key consumers:

- `POST /api/v1/access/hit` and `GET /api/v1/access/count/:key`
  (Ticket C).
- `PUT /api/v1/reactions` / `DELETE /api/v1/reactions` /
  `GET /api/v1/reactions` (Ticket D).

The user-confirmed DDoS threat model is **Heavy**: these endpoints
will be hit by automated server-to-server traffic by design, and a
malicious consumer (or a misbehaving one) must not be able to
inflate counters, exhaust D1 write capacity, or pin Workers CPU.

The layers that defend against this today:

1. **API key authentication** (`requireApiKey`, ADR-0009 §6) — the
   consumer must hold a valid `mk_*` Bearer key.
2. **Per-consumer-principal rate limit** (Workers Rate Limiting
   binding) — see Decision below.

`cf.botScore` (Cloudflare's heuristic bot score) was considered and
**explicitly rejected**: server-to-server APIs receive automated
traffic by design, so rejecting automated traffic contradicts the
consumption model. A consumer backend that runs on a real Cloudflare
zone would get a high bot score simply by being an automation, and
its legitimate calls would be refused.

The question is therefore: which rate-limit primitive owns the
"per consumer principal, per endpoint" throttle?

## Decision

Adopt the **Cloudflare Workers Rate Limiting binding** for the
per-consumer-principal rate limit on the access-counter and
reactions endpoints. The binding is **per consumer principal**
(the API key id) — not per IP, because the consumer's IP is the
consumer backend's IP, not the visitor's.

Two bindings are declared in `wrangler.jsonc`:

```jsonc
{
  "rate_limit_bindings": [
    {
      "name": "RATE_LIMIT_WRITE",
      "type": "fixed_window",
      "identifier": "key",
      "config": { "limit": 60, "interval": 60 }
    },
    {
      "name": "RATE_LIMIT_READ",
      "type": "fixed_window",
      "identifier": "key",
      "config": { "limit": 600, "interval": 60 }
    }
  ]
}
```

`fixed_window` is chosen over `sliding_window` for two reasons:
(1) cheaper at the edge, (2) the documented "60/min" budget is a
wall-clock minute, which matches `fixed_window` semantics.

Hono middleware (`src/http/middleware/rate-limit.ts`) reads
`c.var.apiKey.id` (set by `requireApiKey`) and calls
`c.env.RATE_LIMIT_WRITE.limit({ key })`:

- `RATE_LIMIT_WRITE` on `POST /api/v1/access/hit`,
  `PUT /api/v1/reactions`, `DELETE /api/v1/reactions`.
- `RATE_LIMIT_READ` on `GET /api/v1/access/count/:key`,
  `GET /api/v1/reactions`, `GET /api/v1/reaction-images/:id`.

`GET /api/v1/reaction-images/:id` is public (no API key — images
are public data), but it still goes through `RATE_LIMIT_READ` keyed
on the request IP. This protects R2 bandwidth from a hot loop that
re-fetches the same image. The middleware supports both keyed and
unkeyed paths.

### Comparison

| Approach | Per-consumer limit | DDoS Heavy? | Cost | Complexity | Verdict |
| --- | --- | --- | --- | --- | --- |
| Workers Rate Limiting binding | yes (per-key) | yes for per-consumer abuse | very cheap | declarative | **chosen** |
| Durable Object (SQLite-backed, typed RPC) | yes + global coordination | yes + global cap | DO invocation cost + storage | DO class to maintain | upgrade path |
| Better Auth API key plugin rate limit | per-key validation throttling | anti-brute-force | included | none | **disabled — redundant with chosen layer** |
| `cf.botScore` rejection | anonymous only | rejects legitimate automation | included | one middleware | rejected |

### Layering

A **single** rate-limit layer runs in sequence on every
authenticated endpoint, mounted by Hono middleware after
`requireApiKey` succeeds and before the route handler:

- **Workers Rate Limiting binding** — `RATE_LIMIT_WRITE`
  (60 / minute / principal) on write endpoints,
  `RATE_LIMIT_READ` (600 / minute / principal) on read endpoints.
  This is the only throttle in 0.3.0; the auth layer below it
  performs validation only.

The Better Auth api-key plugin's per-key rate limit is
**intentionally configured off** (`apiKey({ rateLimit: { enabled:
false } })` in `src/cloudflare/auth/better-auth.ts`). Reasons,
recorded for posterity:

- The plugin's rate limit fires inside `auth.api.verifyApiKey`,
  which runs on every authenticated endpoint. It does not know
  which endpoint the caller is hitting, so it cannot implement
  different per-endpoint budgets.
- It is keyed by key id — same principal as the Workers binding
  we already pay for. Running both layers would gate the
  effective budget at the lower of the two limits; with the
  plugin at 60/min and the Workers binding at 600/min for reads,
  the `RATE_LIMIT_READ` budget was effectively 60/min, contradicting
  the documented contract.
- Anti-brute-force on the key itself is already addressed by the
  key hashing scheme — a guessed `mk_*` plaintext cannot be
  verified in bulk; each wrong guess is one full SHA-256 hash
  round-trip in SQLite.

If a future threat model makes per-key-validation throttling
necessary (e.g. a large fleet of consumer workers that re-tries
rapidly on transient errors), re-enable the plugin rate limit and
re-open this ADR.

The middleware ordering is enforced by composing
`requireApiKey()` then `rateLimit(...)` then the route handler —
see `src/http/api-keys/middleware.ts` and the route mounting in
`src/http/hono.ts`.

The DO upgrade path is the documented trigger for re-opening this
ADR. If global coordination across Cloudflare's edge locations is
required (e.g. a single consumer wants a single global 60/min
budget instead of per-location 60/min), the middleware interface is
preserved and only the backing implementation changes.

## Validation

- `pnpm run validate:release` is green (touches `wrangler.jsonc`,
  so `cf-typegen:check` must pass).
- `pnpm run validate:integration` is green.
- Behavioural tests in `src/http/middleware/rate-limit.test.ts`
  (Ticket C): 60 requests within 60s → 61st returns 429; different
  key → independent budget; read/write bindings are independent.
- Manual sweep after Ticket D lands: spam 100 `POST /api/v1/access/hit`
  → some 429; revoke key → 401 takes precedence over 429.

## Consequences

### Positive

- DDoS Heavy tier is satisfied for per-consumer abuse without
  dropping legitimate automation.
- Declarative configuration — no DO class, no D1 roundtrip on the
  hot path.
- Backed by Cloudflare's edge infrastructure, not project-owned
  state.
- One rate-limit layer, one set of documented budgets; the
  contract "60/min writes and 600/min reads per consumer
  principal" is enforced end-to-end.

### Negative / Trade-offs

- Workers Rate Limiting is location-local: each Cloudflare edge
  enforces its own 60/min budget. For early traffic this is
  acceptable — documented as a known limitation.
- `(key id)` is the principal, not `(key id, IP, route)`. If a
  consumer wants finer buckets, that lands as a new binding +
  middleware composition; it is not in 0.3.0 scope.
- Per-visitor (consumer-end-user) rate limit is **out of scope**:
  the visitor's IP is not visible to the Worker. A future extension
  could require consumer backends to supply an opaque
  HMAC-derived visitor id; that work is not in 0.3.0.

## Risks

1. **Eventual consistency across edge locations**: documented.
   60/min per consumer is large enough that per-location slop is
   not user-visible.
2. **Image GET keying**: `GET /api/v1/reaction-images/:id` keys on
   request IP. A coordinated botnet could fan out from many IPs
   and exhaust R2 bandwidth. Acceptable for MVP because (a) the
   images are content-addressed and CDN-cacheable on the consumer
   side, (b) R2 bandwidth cost is the attacker-funded cost, and
   (c) `cf.botScore` or signed URLs are the documented escalation
   path (not in 0.3.0).
3. **Window type**: `fixed_window` allows a short burst at the
   boundary (60 in the last second of one window + 60 in the first
   second of the next = 120 within 2 seconds). Acceptable for
   60/min budgets. Documented choice.

## Re-evaluation triggers

- A consumer demands a strict global budget (not per-location).
  Upgrade to a SQLite-backed Durable Object with typed RPC.
- Per-visitor rate limit becomes a project requirement. Design an
  opaque visitor id protocol with consumer backends; add a third
  binding.
- Image bandwidth abuse (R2 egress cost) exceeds budget. Add
  `cf.botScore` rejection or signed-URL protection on
  `GET /api/v1/reaction-images/:id`.
