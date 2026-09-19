# ADR-0012 — Access counter backend + home integration

Status: accepted (Sprint 0.3.0-extended, Ticket F, branch 38)

## Context

Sprint 0.3.0 plan §Ticket C specified an access-counter backend
keyed by an opaque `key`, with `(counter_key, principal,
session_id)` dedup inside a 60-minute window. Branch 35 shipped
only the rate-limit middleware + `wrangler.jsonc` `ratelimits`
binding; the actual counter (schema, `recordHit`, router) was
deferred. The home now needs the counter to render the
`04 — Access counter` tile alongside the reactions widget from
Ticket E.

## Decision

### 1. Storage shape

Two tables in `migrations/0002_access_counter.sql`:

```sql
CREATE TABLE access_counters (
    key        TEXT PRIMARY KEY,
    count      INTEGER NOT NULL DEFAULT 0,
    first_hit  INTEGER NOT NULL,
    last_hit   INTEGER NOT NULL
);

CREATE TABLE access_dedup (
    counter_key TEXT    NOT NULL,
    principal   TEXT    NOT NULL,
    session_id  TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    PRIMARY KEY (counter_key, principal, session_id)
);
```

The `access_dedup` PK is the UNIQUE constraint that gives us atomic
dedup without an explicit transaction.

### 2. `session_id` strategy — per-request UUID in 0.3.0

The home consumer pattern mints a fresh `session_id =
crypto.randomUUID()` per request. The counter is therefore a
**page-view** counter, not a per-visitor counter.

Per-visitor dedup via the `mw_actor_id` cookie is a 0.4.0 ticket.
We intentionally do NOT couple it to Ticket E's cookie now because:

- The reactions cookie is visitor identity at the *reaction* level
  (same visitor sees / unsubscribes from their own reactions). The
  access counter is an aggregate view counter with different
  privacy posture (visitor does not need a stable identity to
  count their own views).
- Coupling forces one backend to chase the other's privacy stance
  (cookie attributes, consent flow, retention). Splitting them
  keeps each surface single-purpose.

### 3. Atomic batch

The increment path is three D1 statements:

1. `DELETE FROM access_dedup WHERE … AND expires_at <= ?` — drop
   expired dedup rows (no-op when absent).
2. `INSERT INTO access_dedup (…) ON CONFLICT (counter_key,
   principal, session_id) DO NOTHING` — atomic slot claim.
   `meta.changes = 1` for the winner, `0` for losers.
3. `INSERT INTO access_counters (…) ON CONFLICT (key, principal)
   DO UPDATE SET count = count + 1, last_hit = excluded.last_hit`
   — atomic upsert, gated on having won the dedup slot.

P1 review finding from branch 35: the increment MUST be gated on
having won the dedup slot, otherwise a race between two concurrent
hits can land two increments for the same window. The split is
expressed by the `if (!incremented) return …` branch between
steps 2 and 3.

The counter PK is `(key, principal)` — added in migration 0005
after the 0.3.0 release-branch review (PR #48, finding P1 #4)
surfaced that the 0002 PK of `key` alone contradicted this ADR's
per-principal isolation promise. Two consumers (API key ids)
writing to the same `key` now each keep their own count; the
schema actually matches the design.

### 4. `MY_WEB_2026_COUNTER_KEY` env

Default value `home-page`. Same pattern as
`MY_WEB_2026_REACTIONS_TARGET` from Ticket E — env-overridable
narrow target so per-section counters (`home:hero`, etc.) become
a 0.4.0 ticket without code changes.

### 5. Rate-limit posture

Already in place from branch 35:

- `RATE_LIMIT_WRITE` (60 req / 60 s) on `POST /hit`
- `RATE_LIMIT_READ` (600 req / 60 s) on `GET /count/:key`

Per ADR-0010, both limits are request-IP-scoped (no principal
separation). That is correct for this endpoint — the home is a
single principal and the read is genuinely public-equivalent (no
sensitive payload).

## Trade-offs

| Decision | Trade-off | Mitigation |
|---|---|---|
| Per-request UUID | Inflates counter for visitors who refresh | Window is 60 min; 0.4.0 will switch to `mw_actor_id` |
| Counter per principal (API key id) | Two principals hitting the same key would each see their own count | 0.3.0 has one consumer (the home); PK `(key, principal)` (migration 0005) enforces isolation at the schema layer so adding more consumers is a no-shape-change |
| 60-min dedup window | Visitor who revisits after 60 min is counted again | Matches GA expectations for "views today" semantics; configurable via env if needed |

## Out of scope (0.4.0+)

- Per-visitor dedup via `mw_actor_id`.
- Admin UI for counter history (the count is read-only).
- Per-section counters (`home:hero`, `home:footer`).
- Bot score / fingerprinting (out of scope per the 0.3.0 plan).
