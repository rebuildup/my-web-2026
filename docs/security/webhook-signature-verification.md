# Inbound webhook signature verification

> Adapter + contract-test record for Issue #463.
> Scope: **verification only — no inbound entry point is published.**
> Code: [`src/http/webhooks/`](../../src/http/webhooks/README.md)

## Why this exists

`docs/domain/integrations.md` records that no third-party integration
has been promoted yet, and `src/server.ts` already dispatches
`/webhooks/*` to the Hono external boundary. The first sender — GitHub
today, a CMS later — will need three answers before any body is
trusted:

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
| `src/http/webhooks/fixtures.ts` — local fixtures | implemented, 16 inputs |
| Contract tests (`src/http/webhooks/*.test.ts`) | implemented |
| Entry-point absence tests (`boundary.test.ts`, `test/integration/webhook-entry.test.ts`) | implemented |
| `POST /webhooks/*` handler | **not implemented — must stay 404** |

`GET` / `POST /webhooks/**` answers `404 {"error":"not_found"}` even
for a correctly signed, fresh, never-seen delivery. That is asserted at
two layers (Hono app and real Worker via `SELF`) so the absence cannot
be removed accidentally: promoting the route must change a test on
purpose.

## The contract

Scheme: `sha256=<64 hex>` HMAC-SHA256 over `"<timestamp>.<raw body>"`,
the scheme GitHub documents. The timestamp is **inside** the signed
material, so a captured payload cannot be re-stamped without
invalidating the signature. Header names are configurable, so a CMS
with a different header set reuses the adapter instead of forking it.

| Default header | Purpose |
| --- | --- |
| `x-hub-signature-256` | `sha256=<hex>` signature |
| `x-hub-request-timestamp` | unix **seconds**, part of the signed material |
| `x-github-delivery` | sender-assigned delivery id (replay de-duplication) |

Check order is part of the contract — the *first* failing check is the
reported reason:

1. secret present → `missing_secret`
2. signature header present → `missing_signature`
3. `sha256=` + 64 hex digits → `unsupported_algorithm` / `malformed_signature`
4. timestamp present and integer → `missing_timestamp` / `malformed_timestamp`
5. inside the freshness window (±300 s) → `stale_timestamp` / `future_timestamp`
6. HMAC matches → `signature_mismatch`
7. delivery id claimed → `missing_delivery_id` / `replayed_delivery`

Three properties are load-bearing:

- **Constant-time comparison.** Only `crypto.subtle.verify` decides the
  signature. A `!==` on the hex strings leaks how many leading
  characters an attacker guessed — the exact oracle HMAC removes.
- **Replay is checked last.** Claiming the delivery id before the HMAC
  matched would let anyone burn an id with a forged request and lock the
  sender's legitimate retry out: an unauthenticated DoS. A delivery
  that fails verification never consumes a claim
  (`signature.test.ts` asserts this).
- **No algorithm downgrade.** `sha1=` is rejected, not accepted with a
  warning.

### Failure behaviour

| reason | status | meaning |
| --- | --- | --- |
| `missing_secret` | `500` | operator fault — no HMAC key registered; must page, never look like a rejected caller |
| `missing_signature` | `401` | no signature header (or empty) |
| `unsupported_algorithm` | `401` | not `sha256=` |
| `malformed_signature` | `401` | not `<alg>=<64 hex>` |
| `missing_timestamp` | `401` | no timestamp header |
| `malformed_timestamp` | `401` | timestamp is not integer seconds |
| `stale_timestamp` | `401` | older than the window |
| `future_timestamp` | `401` | ahead of the window (clock skew or forged stamp) |
| `signature_mismatch` | `401` | well-formed but forged or tampered |
| `missing_delivery_id` | `400` | delivery id absent while replay protection is on |
| `replayed_delivery` | `409` | delivery already processed |

Every authentication failure shares `401` so a caller cannot use the
response to distinguish "wrong key" from "wrong body". `missing_secret`
is separated because it is our own configuration fault, and
`replayed_delivery` is separated because a sender can act on "you
already got this one" differently from "that was forged".

The body must be the **raw** request text (`await c.req.text()`).
Re-serializing with `JSON.stringify(await c.req.json())` changes the
bytes and therefore the signature.

## Test inputs (fixtures)

All fixtures are local: frozen clock (`1767225600`), literal
non-credential keys, a static CMS-shaped body, no binding, no network,
no D1/R2. They cannot reach production even in principle.

| fixture | input | expected |
| --- | --- | --- |
| `signed` | valid HMAC, fresh, first delivery | accepted |
| `unsigned` | signature header removed | `missing_signature` → 401 |
| `blank_signature` | signature header is whitespace | `missing_signature` → 401 |
| `tampered_body` | one byte appended after signing | `signature_mismatch` → 401 |
| `tampered_timestamp` | header re-stamped after signing | `signature_mismatch` → 401 |
| `wrong_secret` | signed under a rotated / foreign key | `signature_mismatch` → 401 |
| `expired` | correctly signed, one hour old | `stale_timestamp` → 401 |
| `future_stamp` | timestamp one hour ahead | `future_timestamp` → 401 |
| `missing_timestamp` | signature without a timestamp header | `missing_timestamp` → 401 |
| `malformed_timestamp` | `x-hub-request-timestamp: not-a-number` | `malformed_timestamp` → 401 |
| `weak_algorithm` | `sha1=<40 hex>` | `unsupported_algorithm` → 401 |
| `truncated_signature` | `sha256=abcd` | `malformed_signature` → 401 |
| `replayed` | byte-identical second copy of an accepted delivery | `replayed_delivery` → 409 |
| `missing_delivery_id` | signed delivery without a delivery id | `missing_delivery_id` → 400 |
| `missing_secret` | no HMAC key on our side | `missing_secret` → 500 |
| `replayed_other_delivery` | same body, different delivery id | accepted (no false positive) |

The last row matters as much as the rejects: de-duplication that
rejects everything is not a security control, it is an outage.

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
- entries are pruned by TTL, so the map is bounded but not durable.

The seam (`WebhookReplayGuard`) is the contract; the implementation is
a stub until a route exists.

## Promotion checklist (before any route ships)

The entry point stays unpublished until every item is done in the same
ticket:

1. **Durable replay store** — implement `WebhookReplayGuard` on D1
   (`INSERT` on a unique delivery id, expire rows after the window).
   Anything less than durable means the third guarantee is absent.
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
4. **Failure release** — call `release(deliveryId)` when downstream
   processing fails, so our own error does not block the sender's retry.
5. **Rate limit + size cap** — apply the read-side rate-limit binding
   and reject oversized bodies before hashing (ADR-0010).
6. **Audit without payload** — log delivery id, verdict, and reason.
   Never log the body, the signature, or the key.
7. **Update the absence tests** in the same PR.
8. **ADR** — required only if promotion introduces a new Cloudflare
   service (e.g. KV for the replay store); ADR-0004 governs that.

## References

- `docs/domain/integrations.md` — promotion is not a precondition, it is
  an outcome.
- `docs/runbook/infisical-secrets.md` — secret inventory and rotation
  ownership.
- [`docs/security.md`](security.md) — project security policy.
- ADR-0002 (boundary policy), ADR-0004 (Cloudflare services policy),
  ADR-0010 (abuse protection).