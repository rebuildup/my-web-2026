# ADR-0011 — Home self-consumption (consumer pattern)

- Status: Accepted (Sprint 0.3.0, Ticket E)
- Date: 2026-09-19
- Deciders: repository owner
- Consulted: ADR-0009 (Better Auth foundation), ADR-0010 (rate limiting)

## Context

The 0.3.0 backend stack exposes `/api/v1/reactions` and
`/api/v1/access` as versioned public contracts that any consumer
(browser, native app, server-to-server) can call. The home page is
also a consumer of those contracts — it needs to read the home
reaction aggregates and (in Ticket F) record page views. There are
three reasonable shapes for that integration:

1. **Bypass the boundary** — let the home call `src/http/reactions/`
   directly from a server function. Removes auth + rate-limit
   overhead, but breaks the AGENTS.md §3 rule that the home must
   not depend on HTTP handlers' internals, and removes the
   audit/rate-limit story for the home's own traffic.
2. **Separate "internal" key** — a key with privileged scopes that
   only the home can present. Doubles the permission surface for
   the same consumer identity.
3. **Internal API key (consumer pattern)** — the home holds an
   ordinary Better Auth api-key row, identical in shape to any
   external consumer's key, and self-calls `/api/v1/*` over `fetch`
   the same way an external caller would. The home is **its own
   consumer**.

## Decision

Adopt option 3 (Internal API key, consumer pattern). The home:

- Provisions a key with prefix `mk_home_` via
  `scripts/bootstrap-home-api-key.mjs` (operator runs once per
  environment).
- Stores the key plaintext in `MY_WEB_2026_CONSUMER_API_KEY`
  (Wrangler secret).
- Holds the configured `target_key` in
  `MY_WEB_2026_REACTIONS_TARGET` (named `vars`, default
  `home-page`).
- Calls `/api/v1/reactions` server-side from
  `src/home/reactions/load.ts` with `Authorization: Bearer …`.
- Carries visitor identity via the anonymous `mw_actor_id` cookie
  (see §3 below) — read on entry, written on first visit, forwarded
  as `actor_id` on PUT/DELETE.

## Consequences

### Trade-offs accepted

- **Aggregate scope is principal-scoped.** The reactions API
  computes aggregates per `(target_key, principal)`. The home sees
  only its own principal's reactions, not cross-principal roll-ups.
  For 0.3.0 this is acceptable: there is only one home principal
  and external consumers are not yet writing reactions to home
  targets. A 0.4.0 ticket can introduce a per-target roll-up view
  if needed.
- **Bootstrap is a manual operator step.** Provisioning the key
  requires `wrangler dev` (or remote D1 apply) + the bootstrap
  script. This is intentional: automating it would risk leaking
  the plaintext key into deployment artefacts.
- **Per-visitor dedup rides on the cookie.** The reactions API
  dedupes at `(target_key, principal, actor_id, kind, value)`. A
  returning visitor sees their own prior reactions because the
  cookie carries the same `actor_id` across visits. Clearing the
  cookie (or using a different browser) yields a fresh actor id
  and a separate reaction — same shape as any anonymous vote.

### Benefits

- **Single boundary.** The home is not a backdoor — every byte
  crosses `/api/v1/reactions` with the same auth, rate-limit,
  validation, and audit story as an external caller.
- **Single permission shape.** The home uses the same
  `{ resource: ["read","write"] }` permission contract documented
  in ADR-0009 §3. No "internal" / "external" split.
- **Testable end-to-end.** The workerd integration test for the
  home reactions flow can exercise the real `/api/v1/reactions`
  handler via `SELF.fetch` and assert the same observable
  behaviour an external consumer would see.

## Cookie contract

`mw_actor_id`:

| Attribute | Value |
| --- | --- |
| Name | `mw_actor_id` |
| Value | 32 lowercase hex characters (`crypto.randomUUID().replace(/-/g, '')`) |
| `Path` | `/` |
| `Max-Age` | `31536000` (1 year) |
| `HttpOnly` | yes |
| `SameSite` | `Lax` |
| `Secure` | yes when the request scheme is HTTPS; omitted on plain HTTP (local dev) |

The cookie carries **no information** — it is purely a random
visitor handle. JP Cookie Policy "minimal impact" + EU ePrivacy
"anonymous cookie" exemptions both apply; the home footer carries a
plain JP+EN notice to that effect (see `src/home/footer.tsx`).

## Bootstrap

`pnpm run bootstrap:home-api-key` resolves the first admin user in
the local D1 binding, generates a 64-hex plaintext, stores its
SHA-256 hash in the `apikey` table with the configured
`{ reactions: ['read','write'], access_counter: ['read','write'] }`
scopes, and prints the plaintext once. The operator then writes it
into `.dev.vars` (local) or sets it via `wrangler secret put`
(production).

## Out of scope

- Cross-principal roll-ups (0.4.0)
- Per-visitor rate limiting beyond the existing
  `RATE_LIMIT_WRITE` / `RATE_LIMIT_READ` bindings
- Consent management / cookie banner (the cookie is anonymous and
  the privacy notice is plain text in the footer)

## References

- ADR-0009 — Better Auth as auth foundation (permission shape)
- ADR-0010 — Abuse protection (rate-limit bindings)
- `src/home/reactions/{cookie,load,widget}.tsx`
- `scripts/bootstrap-home-api-key.mjs`
