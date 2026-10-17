# Access Counter — `/api/v1/access/*`

External HTTP endpoint for incrementing and reading the per-key
access counter. Built in Ticket F (branch 38; see ADR-0012).

## Contract

| Method | Path                          | Scope                 | Rate limit       |
|--------|-------------------------------|-----------------------|------------------|
| POST   | `/api/v1/access/hit`          | `access_counter:write` | `RATE_LIMIT_WRITE` |
| GET    | `/api/v1/access/count/:key`   | `access_counter:read`  | `RATE_LIMIT_READ`  |

Both routes require a Better Auth api-key (`Authorization: Bearer …`).

### Rejections

Boundary validation is owned by `src/http/validation.ts`; see
[`docs/security/input-validation.md`](../../../docs/security/input-validation.md).
Every rejection below carries `{ error, reason }` and is produced
before any D1 statement runs.

| Status | Body | Cause |
|--------|------|-------|
| 400 | `invalid_body` | `POST` body is not a JSON object, is not JSON, or a field is outside its grammar (e.g. `key` with a space or a control character) |
| 400 | `invalid_key` | `:key` path segment outside the counter-key grammar |
| 401 | `missing_authorization` / `invalid_api_key` | auth failed |
| 403 | `missing_scope` | key lacks the required scope |
| 405 | `method_not_allowed` | verb not in `Allow` (`POST` on `/hit`, `GET` on `/count/:key`) |
| 413 | `payload_too_large` | JSON body over `MAX_JSON_BODY_BYTES` (16 KiB) |
| 415 | `unsupported_media_type` | `Content-Type` is not JSON |
| 429 | `rate_limited` | budget exhausted |

### POST /hit

Request:

```json
{ "key": "home-page", "session_id": "32-hex-actor-id" }
```

Response (200):

```json
{
  "incremented": true,
  "count": 17,
  "first_hit": 1700000000000,
  "last_hit": 1700000000000
}
```

When the dedup window (default 60 minutes) still holds for the same
`(key, principal, session_id)` triple, `incremented` is `false` and
the counter is unchanged.

Pre-D1 ingress filters (Issue #170) run **before** the D1 dedup.
When a hit is rejected by one of them, the response is
`{ "incremented": false, "reason": "bot" | "prefetch" | "dedupe" }`
and **no D1 statement runs**. The GET endpoint is unaffected.

| Gate        | Reject when …                                                                                                  |
|-------------|----------------------------------------------------------------------------------------------------------------|
| Bot UA      | `User-Agent` matches `/bot\|crawler\|spider\|slurp\|bingpreview\|facebookexternalhit\|preview\|monitor\|headlesschrome/i`. Missing / empty UA is also rejected. |
| Prefetch    | Any of `Sec-Purpose`, `Purpose`, `X-Purpose` headers contains the case-insensitive substring `prefetch`.       |
| Dedupe LRU  | The triple `${ip}\|${ua}\|${path}` was seen inside the last **5 minutes** (`LRU_TTL_MS`). Same Worker isolate only. |

The LRU cache is module-scoped and Worker-isolate-local — best-effort
only. Cross-replica dedupe would need KV / Durable Object and is
out of scope. The D1 `(counter_key, principal, session_id)` UNIQUE
primary key remains the durable source of truth.

### GET /count/:key

Response (200):

```json
{ "count": 17, "first_hit": 1700000000000, "last_hit": 1700000000000 }
```

When the key has no rows yet, `count = 0` and `first_hit` / `last_hit`
are `null`.

## Atomicity

The increment path is three D1 statements, ordered so that the
`(counter_key, principal, session_id)` UNIQUE primary key on
`access_dedup` is the source of truth for "this slot has been
claimed". The `INSERT … ON CONFLICT DO NOTHING` returns
`meta.changes = 1` for the winner and `0` for losers, which keeps
two concurrent hits in the same window from both incrementing.

The `access_counters` row is updated only after the dedup slot is
held — the `INSERT … ON CONFLICT (key) DO UPDATE` is the canonical
SQLite upsert and is atomic per-row.

## Self-consumption from home

The home is its own consumer (ADR-0011). The home's
`getHomeCounter` / `recordHomeHit` server functions self-call these
routes via the same `fetch` boundary that any external client would
use, using the `MY_WEB_2026_CONSUMER_API_KEY` provisioned by
`scripts/bootstrap-home-api-key.mjs`.

The home mints a fresh `session_id` per request, making the counter
a **page-view** counter. Per-visitor dedup via the `mw_actor_id`
cookie is deferred — see ADR-0012.
