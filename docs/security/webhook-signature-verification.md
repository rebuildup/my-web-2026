# Inbound webhook signature verification

> Adapter + contract-test record for Issue #463.
> Scope: **verification only — no inbound entry point is published.**
> Code: [`src/http/webhooks/`](../../src/http/webhooks/README.md)

## Why this exists

`docs/domain/integrations.md` records that no third-party integration
has been promoted yet, and `src/server.ts` already dispatches
`/webhooks/*` to the Hono external boundary. The first sender will need
three answers before any body is trusted:

1. **Signature** — is this request from the sender?
2. **Freshness** — is it recent?
3. **Replay** — has this delivery already been processed?

A signature check alone answers neither 2 nor 3. A captured,
perfectly-signed payload stays replayable forever, which is why the
three checks are one indivisible verdict here: nothing downstream ever
sees an unverified body.

## Current state: adapter, no route

| Piece | State |
| --- | --- |
| `src/http/webhooks/signature.ts` — verification adapter | implemented, binding-free |
| `src/http/webhooks/fixtures.ts` — local fixtures | implemented, 20 inputs |
| Contract tests (`src/http/webhooks/*.test.ts`) | implemented |
| Report generator + its own test (`scripts/webhook-signature-fixture-report*.{mjs,test.mjs}`) | implemented, wired into `pnpm run test` |
| Entry-point absence tests (`boundary.test.ts`, `test/integration/webhook-entry.test.ts`) | implemented |
| `POST /webhooks/*` handler | **not implemented — must stay 404** |

`GET` / `POST /webhooks/**` answers `404 {"error":"not_found"}` even
for a correctly signed, never-seen delivery. That is asserted at two
layers (Hono app and real Worker via `SELF`) so the absence cannot be
removed accidentally: promoting the route must change a test on
purpose.

## The contract

Two schemes, because senders disagree about **what is signed**, and an
adapter that assumes one shape rejects every real delivery of its own
sender:

| scheme | signed material | headers | freshness bound |
| --- | --- | --- | --- |
| `GITHUB_WEBHOOK_SCHEME` (default) | the raw body alone | `x-hub-signature-256`, `x-github-delivery` | the replay claim — GitHub signs no timestamp, so the claim does not expire by default |
| `TIMESTAMPED_WEBHOOK_SCHEME` | `"<timestamp>.<raw body>"` | `x-webhook-signature`, `x-webhook-timestamp`, `x-webhook-delivery` | the signed timestamp (±window); the claim only has to outlast it |

Both are `sha256=<64 hex>` HMAC-SHA256 compared in constant time.

Why the split matters:

- **GitHub signs the raw body only.**
  `X-Hub-Signature-256` is the HMAC of the request payload, and a
  GitHub delivery carries **no timestamp header at all** —
  `X-Hub-Request-Timestamp` is not part of the documented delivery
  headers. Verifying `"<timestamp>.<body>"` for GitHub therefore
  rejects 100 % of real deliveries (`missing_timestamp`), and adding
  the header by hand only moves the failure to `signature_mismatch`.
  ([verification spec](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries),
  [delivery headers](https://docs.github.com/en/webhooks/webhook-events-and-payloads))
- **Other senders sign `<timestamp>.<body>`.** There the timestamp is
  inside the MAC, so a captured payload cannot be re-stamped without
  invalidating the signature.
- The scheme is a discriminated union (`signedMaterial:
  'body-only' | 'timestamped-body'`), so a `body-only` scheme cannot
  ship a `timestampHeader` that nothing reads, and the two materials
  cannot be signed and verified against each other by accident.

Header names are configurable, so a CMS with a different header set
reuses the adapter instead of forking it.

Check order is part of the contract — the *first* failing check is the
reported reason:

1. secret present → `missing_secret` (500)
2. claim retention covers the delivery's whole accepted span → `invalid_replay_ttl` (500)
3. `body-only` sender has a replay guard → `replay_guard_required` (500)
4. signature header present → `missing_signature`
5. `sha256=` + 64 hex digits → `unsupported_algorithm` / `malformed_signature`
6. *timestamped-body only:* timestamp present and integer → `missing_timestamp` / `malformed_timestamp`
7. *timestamped-body only:* inside the freshness window (±300 s) → `stale_timestamp` / `future_timestamp`
8. HMAC matches → `signature_mismatch`
9. delivery id **and** signed digest claimed → `missing_delivery_id` / `replayed_delivery`

Five properties are load-bearing:

- **Constant-time comparison.** Only `crypto.subtle.verify` decides the
  signature. A `!==` on the hex strings leaks how many leading
  characters an attacker guessed — the exact oracle HMAC removes.
- **Replay is checked last.** Claiming the delivery id before the HMAC
  matched would let anyone burn an id with a forged request and lock the
  sender's legitimate retry out: an unauthenticated DoS. A delivery
  that fails verification never consumes a claim
  (`signature.test.ts` asserts this).
- **The replay key is authenticated material, not a sender-chosen id.**
  `X-GitHub-Delivery` is not signed, so an attacker holding one captured
  delivery would get a second accepted copy by changing only that
  header. Two keys are therefore claimed: the delivery id (the
  sender's retry identity) **and** the signed digest
  (`sha256-material:<hex>`), which cannot be changed without the key. A
  blocked re-labelled copy releases the delivery-id claim it took, so an
  attacker's replay cannot burn an id the sender still needs.
- **The claim outlives the delivery it protects.** For a
  `timestamped-body` sender a delivery accepted at the *future* edge
  stays acceptable for `2 x toleranceSeconds`, so a claim must cover
  that whole span; `webhookReplayTtlMs(toleranceSeconds)` is the only
  default, and an explicit `replayTtlMs` shorter than `2 x` the window
  is **refused** (`invalid_replay_ttl`) rather than silently clamped.
- **A `body-only` claim does not expire.** GitHub signs no timestamp,
  so the claim is the freshness bound; expiring it hands the captured
  delivery back on every cycle (a byte-identical delivery accepted
  again at 661 s, at 1321 s, …). `body-only` claims default to
  `UNBOUNDED_REPLAY_RETENTION_MS` and only take an explicit
  `replayRetentionMs` — at which point that number is a *replay
  horizon* (the sender's redelivery window), not a cleanup hint, and a
  promotion decision.

- **No algorithm downgrade.** `sha1=` is rejected, not accepted with a
  warning.

### Failure behaviour

| reason | status | meaning |
| --- | --- | --- |
| `missing_secret` | `500` | operator fault — no HMAC key registered; must page, never look like a rejected caller |
| `invalid_replay_ttl` | `500` | operator fault — `replayTtlMs` shorter than the delivery's accepted span (`2 x window`) |
| `replay_guard_required` | `500` | operator fault — `body-only` sender verified with no replay guard, so nothing bounds a captured body |
| `missing_signature` | `401` | no signature header (or empty) |
| `unsupported_algorithm` | `401` | not `sha256=` |
| `malformed_signature` | `401` | not `<alg>=<64 hex>` |
| `missing_timestamp` | `401` | no timestamp header (`timestamped-body` only) |
| `malformed_timestamp` | `401` | timestamp is not integer seconds |
| `stale_timestamp` | `401` | older than the window |
| `future_timestamp` | `401` | ahead of the window (clock skew or forged stamp) |
| `signature_mismatch` | `401` | well-formed but forged or tampered |
| `missing_delivery_id` | `400` | delivery id absent while replay protection is on |
| `replayed_delivery` | `409` | delivery already processed |

Every authentication failure shares `401` so a caller cannot use the
response to distinguish "wrong key" from "wrong body". `missing_secret`,
`invalid_replay_ttl` and `replay_guard_required` are separated because
they are our own configuration faults, and `replayed_delivery` is
separated because a sender can act on "you already got this one"
differently from "that was forged".

**The status is not the only thing that must stay uniform.** The
reason is for logs; a route must not echo it in the response body. The
freshness window runs *before* the HMAC, so a body that returned
`stale_timestamp` vs `signature_mismatch` would let an unauthenticated
caller bisect our clock. See the promotion checklist.

The body must be the **raw** request text (`await c.req.text()`).
Re-serializing with `JSON.stringify(await c.req.json())` changes the
bytes and therefore the signature. `string` is exact for UTF-8; a
non-UTF-8 body has already been mangled by `c.req.text()` (U+FFFD) and
fails closed. A promoted route that must accept binary payloads should
pass an `ArrayBuffer` instead — the HMAC path is byte-oriented, only
this convenience is not.

## Test inputs (fixtures)

All fixtures are local: frozen clock (`1767225600`), literal
non-credential keys, a static CMS-shaped body, no binding, no network,
no D1/R2. They cannot reach production even in principle. `body-only`
(GitHub) and `timestamped-body` fixtures are both present, because
neither sender may be only half-pinned.

| fixture | input | expected |
| --- | --- | --- |
| `signed` | GitHub-shaped: valid HMAC over the raw body, delivery id | accepted |
| `signed_timestamped` | valid HMAC over `<ts>.<body>`, delivery id | accepted |
| `unsigned` | signature header removed | `missing_signature` → 401 |
| `blank_signature` | signature header is whitespace | `missing_signature` → 401 |
| `tampered_body` | one byte appended after signing | `signature_mismatch` → 401 |
| `tampered_timestamp` | header re-stamped after signing | `signature_mismatch` → 401 |
| `wrong_secret` | signed under a rotated / foreign key | `signature_mismatch` → 401 |
| `expired` | correctly signed, one hour old | `stale_timestamp` → 401 |
| `future_stamp` | timestamp one hour ahead | `future_timestamp` → 401 |
| `missing_timestamp` | signature without a timestamp header | `missing_timestamp` → 401 |
| `malformed_timestamp` | timestamp header = `not-a-number` | `malformed_timestamp` → 401 |
| `weak_algorithm` | `sha1=<40 hex>` | `unsupported_algorithm` → 401 |
| `truncated_signature` | `sha256=abcd` | `malformed_signature` → 401 |
| `replayed` | byte-identical second copy of an accepted delivery | `replayed_delivery` → 409 |
| `replayed_relabelled` | the same signed body under a *fresh* delivery id | `replayed_delivery` → 409 |
| `missing_delivery_id` | signed delivery without a delivery id | `missing_delivery_id` → 400 |
| `missing_secret` | no HMAC key on our side | `missing_secret` → 500 |
| `replay_guard_required` | GitHub-shaped delivery, no replay guard | `replay_guard_required` → 500 |
| `invalid_replay_ttl` | window 300 s, `replayTtlMs` 60 s | `invalid_replay_ttl` → 500 |
| `distinct_event` | same key, different payload bytes | accepted (no false positive) |

The last row matters as much as the rejects: de-duplication that
rejects everything is not a security control, it is an outage. And
`replayed_relabelled` is the row that separates a replay guard from a
delivery-id equality check.

## Reproduce

```bash
# Contract test (Node env, no workerd, no bindings)
pnpm exec vitest run src/http/webhooks

# Entry-point absence, through the real Worker
pnpm exec vitest run test/integration/webhook-entry.test.ts

# Verification report (writes .tmp/webhook-signature-fixture-report.html,
# exits 1 if any fixture deviates from its declared verdict)
pnpm run webhook:fixture:report
```

The report generator is itself tested
(`scripts/webhook-signature-fixture-report.test.mjs`, wired into
`pnpm run test`), including the exit-1 path — otherwise the screenshot
and the suite could drift apart with nothing noticing.

The committed screenshot
[`docs/verification/security/webhook-signature-fixture.webp`](../verification/security/webhook-signature-fixture.webp)
is that report rendered in a browser. The Issue names the `.png` path;
it is committed as `.webp` (same image, ~180 KB instead of ~680 KB)
because a PNG of a text table is repo bloat. Regenerate it with
`pnpm run webhook:fixture:report`, then the same `sharp` conversion the
PR records.

## Known limitation: replay storage is not durable here

`createMemoryReplayGuard()` is **fixture/test only**:

- state lives in one Worker isolate, so a second isolate — or a
  redeploy — starts empty and accepts a replay;
- entries are pruned by TTL, so the map is bounded but not durable;
- `ttlMs: Infinity` (the `body-only` default) never prunes, so the map
  grows without bound for the life of the isolate.

The seam (`WebhookReplayGuard`) is the contract; the implementation is
a stub until a route exists.

## Promotion checklist (before any route ships)

The entry point stays unpublished until every item is done in the same
ticket:

1. **Durable replay store** — implement `WebhookReplayGuard` on D1
   (`INSERT` on a unique key, expire rows after the horizon). Anything
   less than durable means the third guarantee is absent, and for a
   `body-only` sender (GitHub) it also means there is no freshness
   bound at all. Store **both** claim keys (delivery id and
   `sha256-material:<hex>`) and decide the `body-only` replay horizon:
   `UNBOUNDED_REPLAY_RETENTION_MS` is correct only for a fixture run,
   a real deployment needs a stated horizon plus row retention for it.
2. **HMAC key registration** — add the secret name to
   `wrangler.jsonc#secrets.required` **and** its
   `wrangler.production.jsonc` mirror, seed it in Infisical
   (`docs/runbook/infisical-secrets.md`), type it in
   `src/cloudflare/auth/env.d.ts`, run `pnpm run cf-typegen`, and add
   the release-sequence step in
   `docs/runbook/cloudflare-workers-builds.md`. Until then the adapter
   must treat an absent key as `missing_secret` (500), never as an
   anonymous request.
3. **Raw body** — read `await c.req.text()` once and pass those exact
   bytes to the adapter.
4. **Uniform failure response** — the status from the table above, and
   a body that is identical across every reason (no `reason` field, no
   timestamp echo). Log the reason instead; a body that distinguishes
   `stale_timestamp` from `signature_mismatch` hands an
   unauthenticated caller a clock oracle.
5. **Failure release** — call `release(deliveryId)` when downstream
   processing fails, so our own error does not block the sender's retry.
6. **Rate limit + size cap** — apply the read-side rate-limit binding
   and reject oversized bodies before hashing (ADR-0010).
7. **Audit without payload** — log delivery id, verdict, and reason.
   Never log the body, the signature, or the key.
8. **Update the absence tests** in the same PR.
9. **ADR** — required only if promotion introduces a new Cloudflare
   service (e.g. KV for the replay store); ADR-0004 governs that.

## References

- `docs/domain/integrations.md` — promotion is not a precondition, it is
  an outcome.
- `docs/runbook/infisical-secrets.md` — secret inventory and rotation
  ownership.
- [`docs/security.md`](../security.md) — project security policy.
- [GitHub: validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
  and [webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
  — the header set and the body-only signature this adapter follows.
- ADR-0002 (boundary policy), ADR-0004 (Cloudflare services policy),
  ADR-0010 (abuse protection).