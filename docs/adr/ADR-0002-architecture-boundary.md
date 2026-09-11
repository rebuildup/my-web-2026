# ADR-0002: Internal vs external HTTP boundary

- Status: Accepted (revised 2026-09-11)
- Date: 2026-09-11
- Extends: ADR-0001
- Superseded by: None

## Context

ADR-0001 picks Cloudflare Workers + TanStack Start + Hono + Panda
CSS. Hono is reserved for **external** traffic; internal operations
are TanStack Start server functions. We need an implementation that
enforces the boundary by construction and gives Hono real Cloudflare
`env` and `ctx` for future bindings.

The first-pass implementation mounted Hono as TanStack Start
request middleware in `src/start.ts`. This caused two problems:

1. `src/routeTree.gen.ts` expected `startInstance` (the canonical
   TanStack Start contract); the file exported `start`. The build
   passed but the wiring was contract-incompatible.
2. The Hono app was constructed inside the middleware with
   `{} as Env` and a stub `ExecutionContext`. As soon as Hono needed
   D1 / R2 / Queues, this would have silently broken.
3. Defining a custom `startInstance` disabled the TanStack Start
   **default CSRF middleware**, leaving server function mutations
   unprotected.

This ADR revises the boundary implementation: Hono moves to the
Worker entry, and `src/start.ts` is removed.

## Decision

### 1. Two layers, two import directions

| Concern                               | Layer                          |
| ------------------------------------- | ------------------------------ |
| UI loader / action / mutation         | TanStack Start server function |
| Route SSR, navigation, rendering      | TanStack Start SSR handler     |
| Stable external REST API contract     | Hono (`/api/v1/*`)             |
| Inbound webhook from external service | Hono (`/webhooks/*`)           |
| OAuth provider callback               | Hono (`/oauth/*`)              |
| Third-party integration adapter       | Hono (`/integrations/*`)       |

Both layers consume shared capability code from `src/modules/**` but
**never** import each other.

### 2. Implementation: Worker entry dispatcher

`src/server.ts` is the Cloudflare Worker entry. Its default export
shape is `{ fetch(request, env, ctx) }`:

```ts
export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (EXTERNAL_BOUNDARY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return externalBoundary.fetch(request, env, ctx);
    }
    return handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

`wrangler.jsonc.main` is `./src/server.ts`. The
`@cloudflare/vite-plugin` resolves it through Vite; TanStack Start's
default CSRF middleware stays active because no custom `startInstance`
is defined.

`src/http/hono.ts` exports `externalBoundary = new Hono<{ Bindings:
Env }>()`. Bindings are typed and accessed via `c.env`.

### 3. Path prefix list

The list lives at the top of `src/server.ts`
(`EXTERNAL_BOUNDARY_PREFIXES`). Adding a new prefix is a code change
reviewed in a normal ticket. It must not be added by a load-balancer,
CDN, or other external system.

### 4. What server functions must look like

TanStack Start server functions (`createServerFn`) are intended to be
called from the UI. They use `createServerFn({ method }).handler(...)`.

Server functions must **not**:

- Be exposed under `/api/*` or `/webhooks/*` URLs.
- Be advertised in public API documentation.
- Be invoked directly by third parties without an explicit path.

If a third party needs access, that traffic is implemented as a Hono
route that internally calls the same capability operation, not as a
server function.

### 5. Capability code stays portable

Capability code under `src/modules/<capability>/**`:

- Must not import `cloudflare:*` packages.
- Must not import from `hono` or `@tanstack/react-start`.
- The only file in a capability allowed to bridge to those packages
  is `<capability>/server.ts`, and only through TanStack Start's
  `createServerFn` (UI-side) — never Hono.

Adapters in `src/platform/cloudflare/` own the Cloudflare-specific
concerns; capability code does not import them directly. Bindings
flow through function arguments or Hono's `c.env`.

## Consequences

### Positive

- The internal/external split is enforced in **one** place
  (`src/server.ts`).
- Hono has access to real `env` and `ctx` from the first request,
  so D1 / R2 / Queues integration is straightforward.
- The TanStack Start default CSRF middleware is active for every
  server function mutation without explicit configuration.
- Domain code stays portable to alternative runtimes if we ever
  need to extract a worker.

### Negative / Trade-offs

- Adding a new external route means updating the prefix list and
  adding a Hono handler — a tiny amount of friction we accept on
  purpose.
- The Worker entry runs the prefix check on every request. The
  cost is negligible compared to the SSR pipeline.

## Re-evaluation triggers

Re-evaluate when:

- TanStack Start ships a first-class HTTP-route primitive that
  obsoletes the Hono layer.
- The prefix-list approach becomes hard to reason about (too many
  prefixes, prefix collisions).
- We decide to split into multiple Workers, at which point each
  Worker may need its own dispatch + Hono app.
- TanStack Start's CSRF defaults change shape; the
  "no custom startInstance" rule may need an update.
