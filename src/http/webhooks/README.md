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
  replayGuard }`. Web Crypto only: no binding, no `Env`, no network, so
  the contract is testable without workerd.
- `fixtures.ts` — 16 local fixtures (frozen clock, literal
  non-credential keys) shared by the Vitest contract test and
  `scripts/webhook-signature-fixture-report.mjs`.
- `*.test.ts` — the contract, the mechanism, and the absent entry
  point.

## Contract in one paragraph

`sha256=<hex>` HMAC-SHA256 over `"<timestamp>.<raw body>"`, compared in
constant time via `crypto.subtle.verify`; timestamp must be integer
unix seconds within ±300 s; delivery id is claimed atomically **after**
the signature passes. Rejection reasons and their statuses are stable
(`401` for every authentication failure, `400` missing delivery id,
`409` replay, `500` missing key) and are documented in
[`docs/security/webhook-signature-verification.md`](../../../docs/security/webhook-signature-verification.md).

## Two rules for a future handler

- Pass `await c.req.text()` — the **raw** bytes. Re-serialized JSON
  changes the signature.
- Do not mount this before the promotion checklist in the same
  document is done, and do not change the absence tests to get a green
  build.