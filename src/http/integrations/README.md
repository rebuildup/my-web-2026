# Third-party connection scope review

Least-privilege review for the OAuth / API-token grants a future
integration connection would hold (Issue #464).

**No handler is mounted.** `/integrations/*` is dispatched here by
`src/server.ts`, and nothing answers it — even a perfectly-scoped,
fresh, fully-consented grant gets `404 {"error":"not_found"}`. That
absence is asserted by `boundary.test.ts`, and the owner allowlist in
`quality/integration-scope.json` is empty, so no candidate may be
published automatically.

## Modules

- `scope-review.ts` — the adapter. `reviewConnection()` is a pure
  function over `(requirement, grant, now)`: scope names and timestamps
  in, one verdict out. No binding, no `Env`, no network, no clock read,
  no storage — and no field anywhere that could carry a token value.
- `fixtures.ts` — local connection fixtures (frozen clock, scope names
  only) shared by the Vitest contract test and the verification report.
  The requirement blocks are **synthetic** (`local/*`): they pin the
  mechanism, not what any real service may hold.
- `*.test.ts` — the mechanism, the fixture matrix, and the absent entry
  point.

## Contract in one paragraph

A grant is usable only when every reviewed **required** scope is
present, nothing outside `required ∪ optional` was granted, no **denied**
scope is present, the token is not revoked / not expired / not older than
the declared retention ceiling, and the connection names a candidate that
somebody reviewed. The verdict is one of `approved`,
`unapproved_scope`, `insufficient_scope`, `reauth_required`,
`unknown_integration`, each with a stable refusal code, and least
privilege outranks liveness: an over-scoped *and* revoked grant reports
the scope refusal while keeping the revoke reason in `review.reauth`.
Nothing is fail-open — an unreadable issue date, a missing retention
ceiling, or an unreviewed service are all refusals, not warnings. The
reviewed requirements, their sources and the revocation procedure live in
[`quality/integration-scope.json`](../../../quality/integration-scope.json)
and are checked by `pnpm run integration:scope:check`; the operator
contract is [`docs/security/integration-token-scope.md`](../../../docs/security/integration-token-scope.md).

## Three rules for a future handler

- Run the review **before** the token is stored, and refuse to store a
  grant whose verdict is not `approved`. A stored over-scoped token is a
  token you cannot un-hold.
- Persist `issuedAt`. Without it the retention ceiling is unverifiable
  and the review refuses the connection forever.
- Do not mount this before the owner allowlist in
  `quality/integration-scope.json` has an entry for the candidate, and
  do not change the absence tests to get a green build.