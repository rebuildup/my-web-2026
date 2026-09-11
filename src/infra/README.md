# Infra

Cross-cutting infrastructure modules that talk to the Cloudflare runtime:

- `env.ts` - typed access to Worker bindings
- `design-tokens.ts` - semantic mapping from raw Panda CSS tokens
- `logging.ts` - structured logger backed by Workers `console`
- `runtime.ts` - request-scoped helpers (clock, request id, ...)

Any code that imports `cloudflare:*` packages or reads `c.env` lives here
or in `src/boundary/**`. Application / domain code stays portable.
