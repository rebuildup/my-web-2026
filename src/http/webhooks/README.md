# Inbound webhook verification

Signature / freshness / replay verification for future inbound
webhooks on the external HTTP boundary (Issue #463).

**No handler is mounted.** `/webhooks/*` is dispatched here by
`src/server.ts`, and nothing answers it — a signed delivery still gets
`404 {"error":"not_found"}`. That absence is asserted by
`boundary.test.ts` and `test/integration/webhook-entry.test.ts`.

## Modules

- `signature.ts` — the adapter. `verifyWebhookDelivery()` is a pure
  function over `{ headers, body, secret, nowMs, toleranceSeconds,
  replayGuard, replayTtlMs, scheme }`. Web Crypto only: no binding, no
  `Env`, no network, so the contract is testable without workerd.
- `fixtures.ts` — 19 local fixtures (frozen clock, literal
  non-credential keys) shared by the Vitest contract test and
  `scripts/webhook-signature-fixture-report.mjs`.
- `*.test.ts` — the contract, the mechanism, and the absent entry
  point.

## Contract in one paragraph

`sha256=<hex>` HMAC-SHA256 compared in constant time via
`crypto.subtle.verify`, over the material the sender actually signs:
the **raw body alone** for `GITHUB_WEBHOOK_SCHEME` (GitHub sends no
timestamp header) or `"<timestamp>.<raw body>"` for
`TIMESTAMPED_WEBHOOK_SCHEME`, whose timestamp must be integer unix
seconds within ±300 s. The delivery id is claimed atomically **after**
the signature passes, with a TTL derived from the freshness window in
use (`webhookReplayTtlMs`), and a TTL shorter than the window is
refused rather than clamped. Because a `body-only` sender signs no
timestamp, its replay claim window is the only freshness bound — so
that scheme is refused without a replay guard. Rejection reasons and
their statuses are stable (`401` for every authentication failure,
`400` missing delivery id, `409` replay, `500` for our own
configuration faults) and are documented in
[`docs/security/webhook-signature-verification.md`](../../../docs/security/webhook-signature-verification.md).

## Three rules for a future handler

- Pass `await c.req.text()` — the **raw** bytes. Re-serialized JSON
  changes the signature.
- Keep the response **body** uniform across every rejection reason;
  log the reason instead.
- Do not mount this before the promotion checklist in the same
  document is done, and do not change the absence tests to get a green
  build.