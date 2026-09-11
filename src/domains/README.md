# Domains

Domain-oriented modules shared by both the TanStack Start server functions
and the Hono external boundary.

Layout:

```
domains/
  <name>/
    application/   - use cases, orchestration (no HTTP knowledge)
    adapters/      - persistence, queue, cache adapters
    contracts/     - public types / events / schemas
    README.md      - one-page overview of the domain
```

Do not import Cloudflare-specific APIs (`D1`, `R2`, `c.env`, ...) inside
`application/`. Adapters own that boundary.

Foundation release does **not** implement any concrete domain module — they
are introduced ticket-by-ticket once a domain-boundary ticket lands.
